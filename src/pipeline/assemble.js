import fs from 'fs';
import path from 'path';
import { concatScenes, muxMusic, normalizeAudio, thumbnail } from '../render/ffmpeg.js';
import { writeSrt } from './render.js';
import { probe } from '../util/proc.js';
import { slugify } from '../util/text.js';
import { aiStats } from '../ai/client.js';
import { keyStats } from '../ai/keys.js';
import * as log from '../util/log.js';

function hashtags(topic) {
	const base = slugify(topic, 'sains').split('-').filter(w => w.length > 3).slice(0, 3);

	return ['#fakta', '#sains', '#explainer', ...base.map(w => '#' + w), '#fyp', '#belajarditiktok'].join(' ');
}

export async function assemble({ cfg, script, workspace, rendered, total, meta }) {
	log.step('Menyusun video final');

	const buildDir = path.join(workspace, 'build');

	ensure(buildDir);

	const cut = path.join(buildDir, 'cut.mp4');
	const files = rendered.map(r => r.file);
	const merged = await concatScenes(files, cut, { crf: cfg.video.crf, preset: cfg.video.preset });

	log.info(`potongan digabung: ${merged.duration.toFixed(2)}s`);

	const finalFile = path.join(workspace, 'final.mp4');
	const music = cfg.video.music && fs.existsSync(cfg.video.music) ? cfg.video.music : null;
	let info;

	if (music) {
		info = await muxMusic({ video: cut, music, outFile: finalFile, volume: cfg.video.musicVolume, loudnorm: cfg.video.loudnorm });
		log.ok(`musik ditambahkan: ${path.basename(music)}`);
	} else {
		info = await normalizeAudio({ video: cut, outFile: finalFile });
	}

	const thumb = await thumbnail({ video: finalFile, outFile: path.join(workspace, 'thumbnail.jpg'), at: Math.min(1.1, info.duration / 4), width: 720 });

	const offsets = {};

	for (const r of rendered) offsets[r.id] = r.offset;

	writeSrt(script.scenes.map(scene => ({ id: scene.id, words: scene.words })), path.join(workspace, 'captions.srt'), offsets);
	fs.writeFileSync(path.join(workspace, 'narration.txt'), script.scenes.map((s, i) => `[${i + 1}] ${s.narration}`).join('\n\n'), 'utf8');
	fs.writeFileSync(path.join(workspace, 'description.txt'), `${script.title}\n\n${script.hook}\n\n${hashtags(script.topic || script.title)}`, 'utf8');

	const manifest = {
		engine: 'renderly',
		version: '1.0.0',
		createdAt: new Date().toISOString(),
		topic: script.topic,
		mode: script.mode,
		title: script.title,
		hook: script.hook,
		angle: script.angle,
		palette: script.palette,
		video: {
			file: path.basename(finalFile),
			duration: Number(info.duration.toFixed(3)),
			width: cfg.render.width,
			height: cfg.render.height,
			fps: cfg.render.fps,
			sizeMB: Number((info.size / 1024 / 1024).toFixed(2)),
			music: music ? path.basename(music) : null,
		},
		scenes: script.scenes.map((scene, i) => ({
			id: scene.id,
			beat: scene.beat,
			narration: scene.narration,
			keywords: scene.keywords,
			visual: scene.visual,
			duration: Number((rendered.find(r => r.id === scene.id)?.duration || 0).toFixed(3)),
			file: path.relative(workspace, rendered.find(r => r.id === scene.id)?.file || ''),
		})),
		ai: aiStats(),
		keys: keyStats(),
		elapsed: meta?.elapsed || null,
	};

	fs.writeFileSync(path.join(workspace, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

	return { finalFile, thumb, info, manifest };
}

function ensure(dir) {
	fs.mkdirSync(dir, { recursive: true });
}

export async function verify(file) {
	const info = await probe(file);

	if (!info.duration || !info.streams.length) throw new Error('file final tidak valid');
	return info;
}