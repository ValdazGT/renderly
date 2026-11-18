import { chat, parseToolArgs, toolSchema, aiStats } from './client.js';
import * as log from '../util/log.js';

export function defineTool({ name, description, parameters = {}, required = [], handler }) {
	return { name, description, parameters, required, handler, schema: toolSchema(name, description, parameters, required) };
}

function short(value, max = 220) {
	const s = typeof value === 'string' ? value : JSON.stringify(value);

	if (!s) return '';
	return s.length > max ? s.slice(0, max) + '…' : s;
}

export async function runAgent({ cfg, system, messages, tools, maxSteps, label = 'agent', onTool, onText }) {
	const toolMap = new Map(tools.map(t => [t.name, t]));
	const schemas = tools.length ? tools.map(t => t.schema) : undefined;
	const convo = [{ role: 'system', content: system }, ...messages];
	const limit = maxSteps || cfg.ai.maxSteps || 30;
	const trace = [];

	for (let step = 1; step <= limit; step++) {
		let res;

		try {
			res = await chat({
				cfg,
				messages: convo,
				tools: schemas,
				maxTokens: cfg.ai.maxTokens,
				onDelta: onText,
			});
		} catch (err) {
			log.fail(`${label}: ${err.message}`);
			throw err;
		}

		const message = res.message || {};
		const calls = (message.tool_calls || []).filter(tc => tc?.function?.name);

		if (!calls.length) {
			const content = (message.content || '').trim();

			if (content) trace.push({ step, text: content });
			return { final: content, messages: convo, trace, stats: aiStats() };
		}

		convo.push({ role: 'assistant', content: message.content || null, tool_calls: message.tool_calls });

		for (const call of calls) {
			const name = call.function.name;
			const args = parseToolArgs(call.function.arguments);
			const tool = toolMap.get(name);
			const started = Date.now();
			let output;
			let isError = false;

			log.ai(`${label} → ${name}(${short(args, 120)})`);

			if (!tool) {
				output = { error: `tool "${name}" tidak ada. Tool tersedia: ${[...toolMap.keys()].join(', ')}` };
				isError = true;
			} else {
				try {
					output = await tool.handler(args, { step, messages: convo });
				} catch (err) {
					output = { error: String(err?.message || err).slice(0, 800) };
					isError = true;
					log.warn(`${name} error: ${String(err?.message || err).slice(0, 200)}`);
				}
			}

			const duration = Date.now() - started;
			const text = typeof output === 'string' ? output : JSON.stringify(output ?? { ok: true });

			trace.push({ step, tool: name, args, output: !isError ? JSON.parse(JSON.stringify(output ?? {})) : output, duration });
			if (onTool) onTool({ name, args, output, isError, duration, step });

			convo.push({
				role: 'tool',
				tool_call_id: call.id || `call_${step}_${name}`,
				content: text.length > 20000 ? text.slice(0, 20000) + '…[truncated]' : text,
			});

			if (!isError && output && typeof output === 'object' && output.__done) {
				return { final: String(output.summary || 'selesai'), messages: convo, trace, stats: aiStats(), done: true };
			}
		}
	}

	const closing = await chat({
		cfg,
		messages: [
			...convo,
			{
				role: 'user',
				content: 'Batas langkah habis. Berhenti memakai tool. Tulis ringkasan singkat (maks 6 baris) tentang status pekerjaan dan apa yang sudah selesai.',
			},
		],
		maxTokens: 600,
	});

	return { final: (closing.message?.content || '').trim(), messages: convo, trace, stats: aiStats(), limitReached: true };
}