#!/usr/bin/env node
import { loadConfig } from '../src/config.js';
import { preflight, checkAi } from '../src/env.js';
import { getKeys, keyStats } from '../src/ai/keys.js';
import { chat } from '../src/ai/client.js';
import { voices } from '../src/pipeline/voice.js';
import * as log from '../src/util/log.js';

const cfg = loadConfig();
const withAi = process.argv.includes('--ai');

log.banner('renderly doctor', 'memeriksa environment');

const health = await preflight(cfg);

for (const line of health.ok) log.ok(line);
for (const issue of health.issues) log.fail(issue);

const keys = getKeys(cfg);

log.info(`api key: ${keys.length} (bad sementara: ${keyStats().bad})`);

if (keys.length) {
	const res = await checkAi(cfg);

	if (res.ok || res.status === 401 || res.status === 403) log.ok(`${cfg.ai.baseUrl} terjangkau (HTTP ${res.status})`);
	else log.warn(`${cfg.ai.baseUrl} → ${res.status || res.statusText || 'tidak terjangkau'}`);
}

if (withAi && keys.length) {
	const started = Date.now();

	try {
		const res = await chat({ cfg, messages: [{ role: 'user', content: 'Balas dengan satu kata: siap' }], maxTokens: 20 });
		log.ok(`chat uji: "${String(res.message?.content || '').trim().slice(0, 40)}" · ${Date.now() - started}ms · via ${res.endpoint}`);
	} catch (err) {
		log.fail(`chat uji gagal: ${String(err.message).slice(0, 200)}`);
	}
}

try {
	const list = await voices();

	log.ok(`edge-tts: ${list.filter(v => v.startsWith('id-ID')).join(', ') || 'tidak ada voice id-ID'}`);
} catch (err) {
	log.warn(`daftar voice gagal: ${String(err.message).slice(0, 120)}`);
}

if (health.issues.length) process.exitCode = 1;