import fs from 'fs';
import path from 'path';
import { ROOT } from '../config.js';
import { run, probe } from '../util/proc.js';

const SCRIPT = path.join(ROOT, 'scripts', 'tts.py');

export async function synthesize({ cfg, text, outFile, wordsFile }) {
	fs.mkdirSync(path.dirname(outFile), { recursive: true });
	fs.mkdirSync(path.dirname(wordsFile), { recursive: true });

	const textFile = path.join(path.dirname(outFile), path.basename(outFile, path.extname(outFile)) + '.txt');

	fs.writeFileSync(textFile, text, 'utf8');

	const voice = cfg.voice || {};
	const args = [
		SCRIPT,
		'--text-file',
		textFile,
		'--out',
		outFile,
		'--words',
		wordsFile,
		'--voice',
		voice.voice || 'id-ID-ArdiNeural',
		'--rate',
		voice.rate || '+0%',
		'--pitch',
		voice.pitch || '+0Hz',
		'--volume',
		voice.volume || '+0%',
	];

	await run(voice.python || 'python3', args, { timeoutMs: 180000 });

	const info = await probe(outFile);
	const words = JSON.parse(fs.readFileSync(wordsFile, 'utf8'));

	return {
		file: outFile,
		wordsFile,
		duration: info.duration,
		words: words.words || [],
		voice: words.voice || voice.voice,
	};
}

export async function voices() {
	const { stdout } = await run('python3', ['-m', 'edge_tts', '--list-voices'], { timeoutMs: 60000 });

	return stdout
		.split('\n')
		.map(line => line.trim())
		.filter(line => line && !/^Name/.test(line))
		.map(line => line.split(/\s{2,}/)[0])
		.filter(Boolean);
}