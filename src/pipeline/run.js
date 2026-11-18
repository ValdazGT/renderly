import fs from 'fs';
import path from 'path';
import { loadConfig, ensureDir, ROOT } from '../config.js';
import { preflight } from '../env.js';
import { startServer } from '../render/server.js';
import { createBrowserPool } from '../render/pool.js';
import { writeScript } from './script.js';
import { synthesize } from './voice.js';
import { writeScenes } from './scenes.js';
import { renderScenes } from './render.js';
import { assemble, verify } from './assemble.js';
import { slugify } from '../util/text.js';
import { aiStats } from '../ai/client.js';
import { keyCount } from '../ai/keys.js';
import * as log from '../util/log.js';

const MIN_SCENE = 2.4;
const TAIL = 0.55;

export function planDuration(audioDuration, words, fps) {
	const lastWordEnd = (words || []).reduce((m, w) => Math.max(m, w.t + w.d), 0);
	const raw = Math.max(audioDuration + TAIL, lastWordEnd + 0.45, MIN_SCENE);

	return Math.max(MIN_SCENE, Math.round(raw * fps) / fps);
}

async function prepareVoices({ cfg, script, workspace }) {
	log.step(`Membuat ${script.scenes.length} narasi paralel`);

	const jobs = script.scenes.map(async scene => {
		const audioFile = path.join(workspace, 'audio', `${scene.id}.mp3`);
		const wordsFile = path.join(workspace, 'audio', `${scene.id}.words.json`);
		const res = await synthesize({ cfg, text: scene.narration, outFile: audioFile, wordsFile });
		const duration = planDuration(res.duration, res.words, cfg.render.fps);

		log.info(`tts ${scene.id} · ${duration.toFixed(2)}s · ${res.words.length} kata`);

		return { ...scene, audioFile, wordsFile, audioDuration: res.duration, words: res.words, duration };
	});

	return Promise.all(jobs);
}

export async function execute(opts) {
	const cfg = loadConfig();

	if (opts.voice) cfg.voice.voice = opts.voice;
	if (opts.fps) cfg.render.fps = Number(opts.fps);
	if (opts.music !== undefined) cfg.video.music = opts.music;
	if (opts.workers) cfg.render.workers = Number(opts.workers);
	if (opts.concurrency) cfg.ai.concurrency = Number(opts.concurrency);

	if (opts.res) {
		const width = Math.round(Number(opts.res) || 1080);

		cfg.render.width = width;
		cfg.render.height = Math.round((width * 1920) / 1080);
	}

	if (opts.aspect && !opts.res) {
		const [w, h] = String(opts.aspect).split(':').map(Number);

		if (w > 0 && h > 0) {
			cfg.render.width = 1080;
			cfg.render.height = Math.round((1080 * h) / w);
		}
	}

	const topic = String(opts.topic || '').trim();

	if (!topic) throw new Error('topik kosong. contoh: node create.js "apa itu ombak" -2d');

	const mode = opts.mode === '3d' ? '3d' : '2d';
	const duration = Number(opts.dur) || 32;
	const lang = opts.lang || 'id';
	const palette = opts.palette || cfg.style.palette;
	const slug = slugify(opts.out || topic, 'video');
	const workspace = path.join(ROOT, 'out', slug);
	const started = Date.now();

	log.banner('renderly', `${topic} · ${mode} · target ${duration}s · ${cfg.render.width}x${cfg.render.height}`);

	const health = await preflight(cfg);

	for (const line of health.ok) log.info(line);

	if (health.issues.length) {
		for (const issue of health.issues) log.fail(issue);
		throw new Error('environment belum siap');
	}

	log.info(`ai: ${cfg.ai.model} · ${keyCount(cfg)} api key · proxy ${cfg.proxy.enabled ? cfg.proxy.urls.length : 0}`);

	ensureDir(workspace);
	ensureDir(path.join(workspace, 'audio'));
	ensureDir(path.join(workspace, 'scenes'));
	ensureDir(path.join(workspace, 'build'));

	const projectFile = path.join(workspace, 'project.json');
	const scriptFile = path.join(workspace, 'script.json');

	let script;
	let scenes;

	if (opts.resume && fs.existsSync(projectFile)) {
		const previous = JSON.parse(fs.readFileSync(projectFile, 'utf8'));

		if (previous.scenes?.length) {
			script = JSON.parse(fs.readFileSync(scriptFile, 'utf8'));
			scenes = previous.scenes.map(scene => ({
				...scene,
				audioFile: path.join(workspace, 'audio', `${scene.id}.mp3`),
				wordsFile: path.join(workspace, 'audio', `${scene.id}.words.json`),
				words: JSON.parse(fs.readFileSync(path.join(workspace, 'audio', `${scene.id}.words.json`), 'utf8')).words,
			}));

			log.info('resume: skrip + audio lama dipakai');
		}
	}

	if (!scenes) {
		script = await writeScript({ cfg, topic, mode, duration, lang, palette, extra: opts.extra });
		script.topic = topic;
		scenes = await prepareVoices({ cfg, script, workspace });

		script.scenes = scenes.map(({ id, narration, visual, keywords, beat, duration: d }) => ({ id, narration, visual, keywords, beat, duration: d }));

		const portable = scenes.map(({ words, ...rest }) => rest);

		fs.writeFileSync(scriptFile, JSON.stringify({ ...script, scenes: portable }, null, 2), 'utf8');
		fs.writeFileSync(projectFile, JSON.stringify({ topic, mode, palette, audioReady: true, scenes: portable }, null, 2), 'utf8');
	}

	log.ok(`total durasi narasi: ${scenes.reduce((n, s) => n + s.duration, 0).toFixed(1)}s`);

	const server = await startServer(ROOT);

	cfg.__serverUrl = server.url;

	const pool = await createBrowserPool({ cfg });
	const report = { scenes: scenes.length, mode, palette, timeline: [] };

	try {
		const built = await writeScenes({ cfg, pool, script, scenes, mode, workspace });

		log.step('Render + encode');
		const rendered = await renderScenes({ cfg, pool, script, workspace, scenes: built });

		log.step('Finalisasi');
		const { finalFile, thumb, info, manifest } = await assemble({
			cfg,
			script,
			workspace,
			rendered: rendered.results,
			total: rendered.total,
			meta: { elapsed: Math.round((Date.now() - started) / 1000) },
		});

		await verify(finalFile);

		const stats = aiStats();
		const totalSeconds = Math.round((Date.now() - started) / 1000);

		log.banner('Selesai', path.relative(process.cwd(), finalFile));
		log.info(`durasi ${info.duration.toFixed(2)}s · ${cfg.render.width}x${cfg.render.height} · ${(info.size / 1024 / 1024).toFixed(1)}MB · ${manifest.scenes.length} scene`);
		log.info(`thumbnail ${path.relative(process.cwd(), thumb)}`);
		log.info(`ai ${stats.calls} panggilan · ${stats.ok} ok · ${stats.tokensIn}+${stats.tokensOut} token · ${stats.retries} retry`);
		log.info(`total waktu ${totalSeconds}s`);

		report.timeline.push({ step: 'total', seconds: totalSeconds });

		return { finalFile, workspace, manifest };
	} finally {
		await pool.close().catch(() => {});
		await server.close().catch(() => {});
	}
}