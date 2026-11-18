import fs from 'fs';
import path from 'path';
import { run, probe } from '../util/proc.js';

function rel(from, to) {
	return path.relative(from, to).split(path.sep).join('/') || '.';
}

export async function encodeScene(opts) {
	const {
		framesDir,
		fps,
		audioFile,
		assFile,
		outFile,
		width,
		height,
		duration,
		crf = 20,
		preset = 'veryfast',
		fontsDir,
	} = opts;

	const cwd = path.dirname(outFile);
	const frames = rel(cwd, framesDir);
	const audio = audioFile ? rel(cwd, audioFile) : null;
	const threads = Math.max(1, Math.min(4, Number(process.env.RENDERLY_THREADS) || 2));
	const videoFilters = [`scale=${width}:${height}:flags=lanczos`, 'setsar=1', 'format=yuv420p'];

	if (assFile) {
		const ass = rel(cwd, assFile);
		videoFilters.push(`ass=${ass}${fontsDir ? `:fontsdir=${fontsDir}` : ''}`);
	}

	const args = ['-y', '-hide_banner', '-loglevel', 'error', '-framerate', String(fps), '-i', `${frames}/%05d.jpg`];

	if (audio) args.push('-i', audio);

	const filter = audio
		? `[0:v]${videoFilters.join(',')}[v];[1:a]aresample=48000,apad[a]`
		: `[0:v]${videoFilters.join(',')}[v]`;

	args.push('-filter_complex', filter, '-map', '[v]');

	if (audio) args.push('-map', '[a]', '-c:a', 'aac', '-ar', '48000', '-b:a', '160k');
	else args.push('-an');

	args.push(
		'-c:v',
		'libx264',
		'-preset',
		preset,
		'-crf',
		String(crf),
		'-profile:v',
		'high',
		'-level',
		'4.1',
		'-pix_fmt',
		'yuv420p',
		'-g',
		String(Math.round(fps * 2)),
		'-threads',
		String(threads),
		'-t',
		Number(duration).toFixed(3),
		'-movflags',
		'+faststart',
		path.basename(outFile),
	);

	await run('ffmpeg', args, { cwd, timeoutMs: 30 * 60000 });

	return probe(outFile);
}

export async function concatScenes(files, outFile, opts = {}) {
	if (!files.length) throw new Error('tidak ada scene untuk digabung');

	if (files.length === 1) {
		fs.copyFileSync(files[0], outFile);
		return probe(outFile);
	}

	const cwd = path.dirname(outFile);
	const listFile = path.join(cwd, 'concat.txt');

	fs.writeFileSync(listFile, files.map(f => `file '${rel(cwd, f)}'`).join('\n') + '\n');

	try {
		await run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.basename(listFile), '-c', 'copy', '-movflags', '+faststart', path.basename(outFile)], {
			cwd,
			timeoutMs: 10 * 60000,
		});

		const info = await probe(outFile);

		if (!info.duration || info.duration < 1) throw new Error('concat hasil kosong');
		return info;
	} catch {
		const args = ['-y', '-hide_banner', '-loglevel', 'error'];

		for (const f of files) args.push('-i', rel(cwd, f));

		const streams = files.map((_, i) => `[${i}:v][${i}:a]`).join('');
		const filter = `${streams}concat=n=${files.length}:v=1:a=1[v][a]`;

		args.push(
			'-filter_complex',
			filter,
			'-map',
			'[v]',
			'-map',
			'[a]',
			'-c:v',
			'libx264',
			'-preset',
			opts.preset || 'veryfast',
			'-crf',
			String(opts.crf || 20),
			'-pix_fmt',
			'yuv420p',
			'-c:a',
			'aac',
			'-b:a',
			'160k',
			'-movflags',
			'+faststart',
			path.basename(outFile),
		);

		await run('ffmpeg', args, { cwd, timeoutMs: 30 * 60000 });
		return probe(outFile);
	}
}

export async function muxMusic(opts) {
	const { video, music, outFile, volume = 0.12, loudnorm = true } = opts;
	const cwd = path.dirname(outFile);
	const v = rel(cwd, video);
	const m = rel(cwd, music);
	const fade = 1.8;
	const chain = loudnorm
		? `[0:a]aresample=48000[a0];[1:a]aresample=48000,volume=${volume},afade=t=in:st=0:d=${fade}[m];[a0][m]amix=inputs=2:duration=first:dropout_transition=4,loudnorm=I=-14:TP=-1.5:LRA=11[a]`
		: `[0:a]aresample=48000[a0];[1:a]aresample=48000,volume=${volume},afade=t=in:st=0:d=${fade}[m];[a0][m]amix=inputs=2:duration=first:dropout_transition=4[a]`;

	await run(
		'ffmpeg',
		[
			'-y',
			'-hide_banner',
			'-loglevel',
			'error',
			'-i',
			v,
			'-stream_loop',
			'-1',
			'-i',
			m,
			'-filter_complex',
			chain,
			'-map',
			'0:v',
			'-map',
			'[a]',
			'-c:v',
			'copy',
			'-c:a',
			'aac',
			'-ar',
			'48000',
			'-b:a',
			'192k',
			'-shortest',
			'-movflags',
			'+faststart',
			path.basename(outFile),
		],
		{ cwd, timeoutMs: 20 * 60000 },
	);

	return probe(outFile);
}

export async function normalizeAudio(opts) {
	const { video, outFile } = opts;
	const cwd = path.dirname(outFile);

	await run(
		'ffmpeg',
		[
			'-y',
			'-hide_banner',
			'-loglevel',
			'error',
			'-i',
			rel(cwd, video),
			'-map',
			'0:v',
			'-map',
			'0:a',
			'-c:v',
			'copy',
			'-af',
			'loudnorm=I=-14:TP=-1.5:LRA=11',
			'-c:a',
			'aac',
			'-ar',
			'48000',
			'-b:a',
			'192k',
			'-movflags',
			'+faststart',
			path.basename(outFile),
		],
		{ cwd, timeoutMs: 20 * 60000 },
	);

	return probe(outFile);
}

export async function thumbnail(opts) {
	const { video, outFile, at = 1.2, width = 720 } = opts;

	await run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(at), '-i', video, '-vframes', '1', '-vf', `scale=${width}:-2`, '-q:v', '3', outFile], {
		timeoutMs: 120000,
	});

	return outFile;
}

export async function extractAudio(video, outFile) {
	await run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', video, '-vn', '-c:a', 'aac', '-b:a', '160k', outFile], { timeoutMs: 300000 });
	return outFile;
}

export async function silence(seconds, outFile, secondsTotal) {
	await run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `anullsrc=r=48000:cl=stereo`, '-t', String(secondsTotal || seconds), '-c:a', 'aac', outFile], {
		timeoutMs: 120000,
	});
	return outFile;
}