import fs from 'fs';
import path from 'path';
import { captureScene } from '../render/capture.js';
import { buildASS, buildSRT, shiftWords } from '../render/captions.js';
import { encodeScene } from '../render/ffmpeg.js';
import { themeFor } from '../render/theme.js';
import { fallbackScene } from './scenes.js';
import { ensureDir, ROOT } from '../config.js';
import * as log from '../util/log.js';

export async function renderScenes({ cfg, pool, script, workspace, scenes }) {
	const total = scenes.reduce((n, scene) => n + scene.duration, 0);
	log.step(`Render ${scenes.length} scene · ${total.toFixed(1)}s · ${Math.round(total * cfg.render.fps)} frame · ${pool.size} paralel`);

	const started = Date.now();
	let done = 0;

	const results = await pool.map(
		scenes,
		async (scene, index, page) => {
			const meta = scene.meta;
			const dir = path.join(workspace, 'build', scene.id);

			ensureDir(dir);

			const options = {
				page,
				serverUrl: cfg.__serverUrl,
				sceneRel: scene.relUrl,
				meta,
				dur: scene.duration,
				fps: cfg.render.fps,
				framesDir: path.join(dir, 'frames'),
				jpegQuality: cfg.render.jpegQuality,
			};

			let capture;

			try {
				capture = await captureScene(options);
			} catch (err) {
				log.warn(`${scene.id}: render gagal (${String(err.message).split('\n')[0].slice(0, 120)}) → scene fallback`);

				fs.writeFileSync(scene.file, fallbackScene({ scene, duration: scene.duration, mode: meta.mode, script }), 'utf8');

				capture = await captureScene({ ...options, sceneRel: scene.relUrl });
			}

			const words = scene.words || [];
			const assFile = path.join(dir, `${scene.id}.ass`);

			fs.writeFileSync(
				assFile,
				buildASS(words, {
					width: cfg.render.width,
					height: cfg.render.height,
					accent: themeFor(script.palette).accent,
					font: 'Poppins',
				}),
				'utf8',
			);

			const outFile = path.join(dir, `${scene.id}.mp4`);

			const info = await encodeScene({
				framesDir: path.join(dir, 'frames'),
				fps: cfg.render.fps,
				audioFile: scene.audioFile,
				assFile,
				outFile,
				width: cfg.render.width,
				height: cfg.render.height,
				duration: scene.duration,
				crf: cfg.video.crf,
				preset: cfg.video.preset,
				fontsDir: path.join(ROOT, 'assets', 'fonts'),
			});

			fs.rmSync(path.join(dir, 'frames'), { recursive: true, force: true });

			done += scene.duration;

			const elapsed = (Date.now() - started) / 1000;
			const eta = done > 0 ? (elapsed / done) * (total - done) : 0;

			log.info(
				`${scene.id} selesai · ${scene.duration.toFixed(1)}s video · ${(info.size / 1024 / 1024).toFixed(1)}MB · ` +
					`progress ${Math.round((done / total) * 100)}% · sisa ~${Math.round(eta)}s`,
			);

			if (capture.errors.length) log.warn(`${scene.id} runtime: ${capture.errors.slice(0, 2).join(' | ')}`);
			if (!capture.report.ok) log.warn(`${scene.id} layout: ${capture.report.warnings.slice(0, 2).join(' | ')}`);

			return {
				id: scene.id,
				file: outFile,
				relUrl: scene.relUrl,
				duration: info.duration || scene.duration,
				frames: capture.frames,
				errors: capture.errors.slice(0, 6),
				warnings: capture.report.warnings.slice(0, 6),
			};
		},
		cfg.render.workers || pool.size,
	);

	let cursor = 0;

	for (const item of results) {
		item.offset = cursor;
		cursor += item.duration;
	}

	return { results, total: cursor };
}

export function writeSrt(scenes, outFile, offsets) {
	let index = 0;
	const blocks = [];

	for (const scene of scenes) {
		const shifted = shiftWords(scene.words || [], offsets[scene.id] || 0);
		const srt = buildSRT(shifted);

		for (const block of srt.split('\n\n')) {
			const trimmed = block.trim();

			if (!trimmed) continue;
			const lines = trimmed.split('\n');

			lines[0] = String(++index);
			blocks.push(lines.join('\n'));
		}
	}

	fs.writeFileSync(outFile, blocks.join('\n\n') + '\n', 'utf8');
	return outFile;
}