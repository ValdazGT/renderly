import fs from 'fs';
import path from 'path';
import { run } from './util/proc.js';

const TOOLS = [
	{ name: 'node', args: ['-v'], label: 'node' },
	{ name: 'ffmpeg', args: ['-version'], label: 'ffmpeg' },
	{ name: 'ffprobe', args: ['-version'], label: 'ffprobe' },
];

export async function preflight(cfg) {
	const issues = [];
	const ok = [];

	for (const tool of TOOLS) {
		try {
			const res = await run(tool.name, tool.args, { timeoutMs: 15000 });

			ok.push(`${tool.label}: ${res.stdout.split('\n')[0].slice(0, 60)}`);
		} catch {
			issues.push(`${tool.name} tidak ditemukan di PATH`);
		}
	}

	try {
		await run(cfg.voice.python || 'python3', ['-c', 'import edge_tts'], { timeoutMs: 20000 });
		ok.push(`${cfg.voice.python || 'python3'}: edge-tts siap`);
	} catch {
		issues.push(`edge-tts belum terpasang (jalankan: pip install edge-tts)`);
	}

	try {
		await run(cfg.render.chromium, ['--version'], { timeoutMs: 20000 });
		ok.push(`chromium: ${cfg.render.chromium}`);
	} catch {
		issues.push(`chromium tidak bisa dijalankan (${cfg.render.chromium}); set render.chromium di config.json`);
	}

	for (const mod of ['gsap/dist/gsap.min.js', 'three/package.json']) {
		const file = path.join(cfg.paths.modules, mod);

		if (!fs.existsSync(file)) issues.push(`node_modules/${mod} hilang — jalankan: yarn install`);
	}

	try {
		await run('ffmpeg', ['-hide_banner', '-filters'], { timeoutMs: 20000 }).then(res => {
			if (!/subtitles|ass /.test(res.stdout)) issues.push('ffmpeg tanpa filter subtitles/ass (caption tidak bisa dibakar)');
		});
	} catch {}

	return { ok, issues };
}

export async function checkAi(cfg) {
	const res = await fetch(`${cfg.ai.baseUrl}/models`, {
		headers: { Authorization: `Bearer ${cfg.ai.apiKey || 'none'}` },
		signal: AbortSignal.timeout(20000),
	}).catch(e => ({ ok: false, status: 0, statusText: e.message }));

	return res;
}