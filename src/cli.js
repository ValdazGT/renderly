import { detectLang } from './util/text.js';
import * as log from './util/log.js';

const HELP = `
renderly — bikin video AI explainer dari satu perintah

  node create.js "apa itu ombak" -2d
  node create.js "cara kerja black hole" -3d --dur 45

Opsi
  -2d | -3d          gaya visual (default -2d)
  --dur, -d <detik>  target durasi (default 32)
  --lang <id|en>     bahasa narasi (default: deteksi dari topik)
  --voice <nama>     voice edge-tts (default id-ID-ArdiNeural)
  --palette <nama>   midnight|ocean|sunset|neon|forest|candy|mono
  --res <lebar>      lebar render, misal 720 (default 1080)
  --aspect <r>       rasio, misal 9:16 (default) atau 1:1 / 16:9
  --fps <n>          frame per detik (default 30)
  --workers <n>      browser paralel untuk render (default 2)
  --concurrency <n>  AI paralel saat menulis scene (default 5)
  --music <file>     musik latar (mp3/wav)
  --extra "..."      arahan tambahan untuk penulis skrip
  --out <nama>       nama folder output
  --resume           lanjutkan project yang sudah ada di out/<nama>
  --quiet            log minimal
  --help             tampilkan bantuan

Contoh
  node create.js "kenapa langit biru" -2d --dur 35
  node create.js "apa itu ombak" -3d -d 45 --voice id-ID-GadisNeural --music assets/music/lo-fi.mp3
`;

const FLAGS_WITH_VALUE = new Set(['dur', 'd', 'lang', 'voice', 'palette', 'res', 'aspect', 'fps', 'music', 'extra', 'out', 'workers', 'concurrency']);

export function parseArgs(argv) {
	const opts = { mode: '2d' };
	const words = [];

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];

		if (arg === '-2d' || arg === '--2d') opts.mode = '2d';
		else if (arg === '-3d' || arg === '--3d') opts.mode = '3d';
		else if (arg === '--help' || arg === '-h') opts.help = true;
		else if (arg === '--quiet') opts.quiet = true;
		else if (arg === '--resume') opts.resume = true;
		else if (arg.startsWith('--') || arg === '-d') {
			const key = arg.replace(/^--?/, '');
			const next = argv[i + 1];

			if (FLAGS_WITH_VALUE.has(key) && next !== undefined && !next.startsWith('-')) {
				opts[key] = next;
				i++;
			} else if (key === 'resume') opts.resume = true;
			else if (key === 'quiet') opts.quiet = true;
			else if (key === '2d') opts.mode = '2d';
			else if (key === '3d') opts.mode = '3d';
			else opts[key] = true;
		} else words.push(arg);
	}

	opts.topic = words.join(' ').trim();
	if (!opts.lang) opts.lang = process.env.RENDERLY_LANG || detectLang(opts.topic);
	if (opts.quiet) process.env.RENDERLY_QUIET = '1';

	return opts;
}

export async function main(argv) {
	const opts = parseArgs(argv);

	if (opts.help || (!opts.topic && argv.includes('--help'))) {
		console.log(HELP);
		return;
	}

	if (!opts.topic) {
		console.log(HELP);
		process.exitCode = 1;
		return;
	}

	const { execute } = await import('./pipeline/run.js');

	try {
		const result = await execute(opts);

		if (!process.env.RENDERLY_QUIET) console.log(`\n  ${log.hintPath(result.finalFile)}\n`);
	} catch (err) {
		if (process.env.RENDERLY_DEBUG === '1') console.error(err);
		else log.fail(String(err.message || err));
		process.exitCode = 1;
	}
}