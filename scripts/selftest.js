#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { loadConfig, ROOT, ensureDir, designSize } from '../src/config.js';
import { startServer } from '../src/render/server.js';
import { launchBrowser } from '../src/render/browser.js';
import { captureScene, previewScene } from '../src/render/capture.js';
import { buildASS } from '../src/render/captions.js';
import { encodeScene } from '../src/render/ffmpeg.js';
import { probe } from '../src/util/proc.js';
import { themeFor } from '../src/render/theme.js';
import { synthesize } from '../src/pipeline/voice.js';
import { planDuration } from '../src/pipeline/run.js';
import * as log from '../src/util/log.js';

const cfg = loadConfig();
const mode = process.argv.includes('--3d') ? '3d' : '2d';
const dir = path.join(ROOT, 'out', '_selftest');

fs.rmSync(dir, { recursive: true, force: true });
ensureDir(dir);

log.banner('renderly selftest', `mode ${mode}`);

const server = await startServer(ROOT);
const browser = await launchBrowser(cfg);
const started = Date.now();

try {
	log.step('narasi');
	const voice = await synthesize({
		cfg,
		text: 'Ombak bukan air yang pindah, tapi energi yang lewat.',
		outFile: path.join(dir, 'voice.mp3'),
		wordsFile: path.join(dir, 'voice.words.json'),
	});
	const duration = planDuration(voice.duration, voice.words, cfg.render.fps);

	log.ok(`${voice.words.length} kata · ${duration.toFixed(2)}s`);

	const design = designSize(cfg);
	const meta = {
		dur: duration,
		width: cfg.render.width,
		height: cfg.render.height,
		designWidth: design.width,
		designHeight: design.height,
		mode,
		theme: themeFor(cfg.style.palette),
		fonts: '/assets/fonts',
		topic: 'selftest',
	};

	log.step('preview scene template');
	const preview = await previewScene({
		page: browser.page,
		serverUrl: server.url,
		sceneRel: `src/templates/scene-${mode}.html`,
		meta,
		dur: duration,
		times: [0.5, duration / 2, duration - 0.4],
		outDir: path.join(dir, 'preview'),
	});

	log.ok(`preview ${preview.shots.length} frame · warning ${preview.report.warnings.length}`);
	for (const w of preview.report.warnings.slice(0, 4)) log.warn(w);
	for (const e of preview.errors.slice(0, 4)) log.fail(e);

	log.step('render frames');
	const capture = await captureScene({
		page: browser.page,
		serverUrl: server.url,
		sceneRel: `src/templates/scene-${mode}.html`,
		meta,
		dur: duration,
		fps: cfg.render.fps,
		framesDir: path.join(dir, 'frames'),
		jpegQuality: cfg.render.jpegQuality,
		onProgress: (done, total) => {
			if (done % 30 === 0 || done === total) log.info(`frame ${done}/${total}`);
		},
	});

	log.ok(`${capture.frames} frame`);

	const assFile = path.join(dir, 'cap.ass');

	fs.writeFileSync(assFile, buildASS(voice.words, { width: cfg.render.width, height: cfg.render.height, accent: themeFor(cfg.style.palette).accent }), 'utf8');

	log.step('encode');
	const outFile = path.join(dir, 'selftest.mp4');
	const info = await encodeScene({
		framesDir: path.join(dir, 'frames'),
		fps: cfg.render.fps,
		audioFile: path.join(dir, 'voice.mp3'),
		assFile,
		outFile,
		width: cfg.render.width,
		height: cfg.render.height,
		duration,
		crf: cfg.video.crf,
		preset: cfg.video.preset,
		fontsDir: path.join(ROOT, 'assets', 'fonts'),
	});

	const check = await probe(outFile);

	log.ok(`${path.relative(process.cwd(), outFile)} · ${check.duration.toFixed(2)}s · ${(check.size / 1024 / 1024).toFixed(2)}MB · ${check.streams.map(s => s.type).join('+')}`);
	log.info(`selesai dalam ${((Date.now() - started) / 1000).toFixed(1)}s`);
} catch (err) {
	log.fail(String(err.message));
	process.exitCode = 1;
} finally {
	await browser.close().catch(() => {});
	await server.close().catch(() => {});
}