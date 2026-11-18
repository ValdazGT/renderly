import { loadConfig } from '../config.js';
import { pickKey, markBad, markGood, keyLabel } from './keys.js';
import { proxyChain, coolEndpoint, warmEndpoint } from './proxy.js';
import { parseToolArgs } from '../util/json.js';
import * as log from '../util/log.js';

const stats = { calls: 0, ok: 0, fail: 0, retries: 0, tokensIn: 0, tokensOut: 0, endpoints: {}, models: {}, keys: {} };

export function aiStats() {
	return {
		...stats,
		endpoints: { ...stats.endpoints },
		models: { ...stats.models },
		keys: { ...stats.keys },
	};
}

export class AIError extends Error {
	constructor(message, { status = 0, body = '', model = '' } = {}) {
		super(message);
		this.name = 'AIError';
		this.status = status;
		this.body = String(body || '').slice(0, 600);
		this.model = model;
	}
}

function bump(bucket, name) {
	bucket[name] = (bucket[name] || 0) + 1;
}

function readErrorBody(text) {
	try {
		const data = JSON.parse(text);
		return data?.error?.message || data?.message || data?.error || text;
	} catch {
		return text;
	}
}

async function readSse(res, onDelta) {
	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	let content = '';
	let finish = null;
	let usage = null;
	const toolCalls = [];
	let saw = false;

	const handleLine = line => {
		const trimmed = line.trim();

		if (!trimmed.startsWith('data:')) return;

		const body = trimmed.slice(5).trim();
		if (!body || body === '[DONE]') return;

		let json;

		try {
			json = JSON.parse(body);
		} catch {
			return;
		}

		saw = true;
		const choice = json.choices?.[0] || {};
		const delta = choice.delta || {};

		if (choice.finish_reason) finish = choice.finish_reason;
		if (json.usage) usage = json.usage;

		if (delta.content) {
			content += delta.content;
			if (onDelta) onDelta(delta.content, content);
		}

		if (Array.isArray(delta.tool_calls)) {
			for (const tc of delta.tool_calls) {
				const idx = Number(tc.index ?? 0);
				const slot = (toolCalls[idx] = toolCalls[idx] || { id: '', type: 'function', function: { name: '', arguments: '' } });

				if (tc.id) slot.id = slot.id || tc.id;
				if (tc.function?.name) slot.function.name += tc.function.name;
				if (tc.function?.arguments) slot.function.arguments += tc.function.arguments;
			}
		}
	};

	while (true) {
		const { done, value } = await reader.read();

		if (done) break;

		buffer += decoder.decode(value, { stream: true });

		let idx;

		while ((idx = buffer.indexOf('\n')) !== -1) {
			handleLine(buffer.slice(0, idx));
			buffer = buffer.slice(idx + 1);
		}
	}

	if (buffer) handleLine(buffer);

	return {
		streamed: saw,
		message: {
			role: 'assistant',
			content: content || null,
			...(toolCalls.filter(Boolean).length ? { tool_calls: toolCalls.filter(Boolean) } : {}),
		},
		usage,
		finish,
	};
}

async function postChat(cfg, payload, key, { signal, onDelta } = {}) {
	const target = `${cfg.ai.baseUrl}/chat/completions`;
	const chain = proxyChain(cfg, target);
	const timeout = AbortSignal.timeout(Number(cfg.ai.timeoutMs) || 240000);
	const merged = signal && !signal.aborted ? AbortSignal.any([signal, timeout]) : timeout;
	const body = JSON.stringify(payload);
	let lastError = null;

	for (const hop of chain) {
		const started = Date.now();

		try {
			const res = await fetch(hop.url, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${key}`,
					'Content-Type': 'application/json',
					Accept: payload.stream ? 'text/event-stream' : 'application/json',
					'User-Agent': 'renderly/1.0',
				},
				body,
				signal: merged,
			});
			const ms = Date.now() - started;

			if (!res.ok) {
				const text = await res.text().catch(() => '');
				const err = new AIError(`HTTP ${res.status}: ${String(readErrorBody(text)).slice(0, 240)}`, {
					status: res.status,
					body: text,
					model: payload.model,
				});

				if (res.status === 429) {
					coolEndpoint(hop.label, 120000);
					throw err;
				}

				if (![500, 502, 503, 504].includes(res.status)) {
					err.endpoint = hop.label;
					throw err;
				}

				coolEndpoint(hop.label, 60000);
				lastError = err;
				continue;
			}

			const ctype = res.headers.get('content-type') || '';
			let out;

			if (payload.stream && ctype.includes('event-stream')) out = await readSse(res, onDelta);
			else {
				const text = await res.text();
				let data;

				try {
					data = JSON.parse(text);
				} catch {
					out = await readSse(new Response(text), onDelta);
					data = null;
				}

				if (data) {
					const choice = data.choices?.[0] || {};
					out = {
						streamed: false,
						message: choice.message || { role: 'assistant', content: data.choices?.[0]?.text || '' },
						usage: data.usage,
						finish: choice.finish_reason,
					};
				}
			}

			warmEndpoint(hop.label);
			bump(stats.endpoints, hop.label);

			out.endpoint = hop.label;
			out.ms = ms;
			out.model = out.model || payload.model;

			return out;
		} catch (err) {
			const status = err?.status || 0;

			if (err?.name === 'AbortError' || err?.name === 'TimeoutError') {
				lastError = new AIError(`timeout ${Math.round((cfg.ai.timeoutMs || 0) / 1000)}s`, { model: payload.model });
				coolEndpoint(hop.label, 30000);
				continue;
			}

			if (status === 429 || status >= 500 || !status) {
				lastError = err;
				continue;
			}

			throw err;
		}
	}

	throw lastError || new AIError('semua jalur gagal', { model: payload.model });
}

export async function chat(options = {}) {
	const cfg = options.cfg || loadConfig();
	const messages = options.messages || [];
	const models = [options.model || cfg.ai.model, ...(cfg.ai.fallbackModels || [])].filter(Boolean);
	const used = new Set();
	let lastError = null;

	for (const model of models) {
		const attempts = Number(options.tries || 5);

		for (let i = 0; i < attempts; i++) {
			const key = pickKey(cfg, used);

			if (!key) throw new AIError('tidak ada API key — isi data/keys.json atau config.json ai.apiKey');

			used.add(key);

			const payload = {
				model,
				messages,
				temperature: options.temperature ?? cfg.ai.temperature,
				max_tokens: options.maxTokens ?? cfg.ai.maxTokens,
				stream: options.stream ?? true,
			};

			if (options.tools?.length) {
				payload.tools = options.tools;
				payload.tool_choice = options.toolChoice || 'auto';
			}

			stats.calls++;

			try {
				const res = await postChat(cfg, payload, key, options);

				markGood(key);
				stats.ok++;
				bump(stats.models, model);

				const k = keyLabel(key);
				stats.keys[k] = (stats.keys[k] || 0) + 1;

				if (res.usage) {
					stats.tokensIn += Number(res.usage.prompt_tokens || 0);
					stats.tokensOut += Number(res.usage.completion_tokens || 0);
					log.info(`ai ${model} · ${keyLabel(key)} · ${(res.ms / 1000).toFixed(1)}s · ${res.usage.prompt_tokens || '?'}+${res.usage.completion_tokens || '?'} tok · via ${res.endpoint}`);
				} else {
					log.info(`ai ${model} · ${keyLabel(key)} · ${(res.ms / 1000).toFixed(1)}s · via ${res.endpoint}`);
				}

				return res;
			} catch (err) {
				lastError = err;
				stats.fail++;
				stats.retries++;

				const status = err?.status || 0;

				if (status === 401 || status === 403) {
					markBad(key, 6 * 3600000);
					log.warn(`key ${keyLabel(key)} ditolak (${status}), coba key lain`);
					continue;
				}

				if (status === 429) {
					markBad(key, 180000);
					log.warn(`key ${keyLabel(key)} kena limit, coba key lain`);
					continue;
				}

				if (status === 400 && /tool|function|schema/i.test(String(err.message))) {
					throw err;
				}

				if (status === 400 || status === 422) {
					log.warn(`request ditolak (${status}): ${String(err.message).slice(0, 160)}`);
					continue;
				}

				log.warn(`gagal: ${String(err.message).slice(0, 160)}`);
			}
		}
	}

	throw lastError || new AIError('AI tidak bisa dihubungi');
}

export async function chatJson(options = {}) {
	const res = await chat(options);
	const text = res.message?.content || '';
	const { parseJson } = await import('../util/json.js');
	const parsed = parseJson(text);

	if (parsed) return { data: parsed, text, res };

	const retry = await chat({
		...options,
		messages: [...options.messages, { role: 'assistant', content: text || '(kosong)' }, { role: 'user', content: 'Output kamu bukan JSON valid. Kirim ulang HANYA objek JSON valid sesuai skema, tanpa penjelasan, tanpa code fence.' }],
	});

	const retryText = retry.message?.content || '';
	const retryParsed = parseJson(retryText);

	if (!retryParsed) throw new AIError('AI gagal memberi JSON valid', { body: retryText.slice(0, 400) });

	return { data: retryParsed, text: retryText, res: retry };
}

export function toolSchema(name, description, properties, required = []) {
	return {
		type: 'function',
		function: {
			name,
			description,
			parameters: { type: 'object', properties, required, additionalProperties: false },
		},
	};
}

export { parseToolArgs };