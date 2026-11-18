import fs from 'fs';
import path from 'path';
import { chat } from '../ai/client.js';
import { sceneSystem, sceneUser, sceneRepairUser, loadSdk } from '../ai/prompts.js';
import { previewScene } from '../render/capture.js';
import { themeFor, safeArea } from '../render/theme.js';
import { ROOT } from '../config.js';
import * as log from '../util/log.js';

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;
const MAX_BYTES = 90000;
const MIN_FRAME_BYTES = 9000;

export function lintScene(html, { mode } = {}) {
	const errors = [];
	const warnings = [];
	const src = String(html || '');

	if (src.length < 200) errors.push('file terlalu pendek / kosong');
	if (!/^\s*<!doctype html>/i.test(src)) errors.push('harus diawali <!doctype html>');
	if (!/<\/html>\s*$/i.test(src)) errors.push('harus diakhiri </html>');
	if (!/RL\.init\s*\(/.test(src)) errors.push('tidak memanggil RL.init()');
	if (!/RL\.finish\s*\(/.test(src)) errors.push('tidak memanggil RL.finish()');
	if (Buffer.byteLength(src) > MAX_BYTES) errors.push(`file terlalu besar (${Math.round(Buffer.byteLength(src) / 1024)} KB, maks ${MAX_BYTES / 1000} KB)`);

	const forbidden = [
		[/Math\.random\s*\(/, 'Math.random() tidak deterministik, pakai RL.rand(seed)'],
		[/requestAnimationFrame/, 'requestAnimationFrame dilarang, pakai RL.onFrame'],
		[/\bsetInterval\s*\(/, 'setInterval dilarang'],
		[/\bsetTimeout\s*\(/, 'setTimeout dilarang'],
		[/\bfetch\s*\(/, 'fetch dilarang (tidak ada jaringan)'],
		[/XMLHttpRequest/, 'XMLHttpRequest dilarang'],
		[/gsap\.(to|from|fromTo|timeline|set)\s*\(/, 'jangan pakai gsap langsung, pakai RL.anim / RL.fromTo / RL.stagger'],
		[/src\s*=\s*["']https?:/, 'aset eksternal dilarang, pakai /assets/ atau /node_modules/'],
	];

	for (const [re, message] of forbidden) if (re.test(src)) errors.push(message);
	if (EMOJI.test(src)) errors.push('ada emoji, hapus semua emoji');
	if (/<link[^>]+href=["']https?:/i.test(src)) errors.push('stylesheet eksternal dilarang');
	if (mode === '3d' && !/RL\.scene3d\s*\(/.test(src)) warnings.push('mode 3d tapi tidak memakai RL.scene3d');

	const visualCalls = (src.match(/RL\.(shape|svg|bar|ring|arrow|icon|img|card|mesh|lines|cloud|scene3d)\s*\(/g) || []).length;

	if (visualCalls < 3) errors.push(`terlalu sedikit elemen visual (${visualCalls}); minimal 3 elemen grafis selain teks`);

	const scripts = [...src.matchAll(/<script(?![^>]*type=["']module["'])[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);

	for (const code of scripts) {
		if (!code.trim()) continue;

		try {
			new Function(code);
		} catch (err) {
			errors.push(`syntax error di <script>: ${String(err.message).slice(0, 140)}`);
			break;
		}
	}

	return { ok: errors.length === 0, errors, warnings };
}

export function sceneMeta({ cfg, script, duration, mode }) {
	return {
		dur: duration,
		width: cfg.render.width,
		height: cfg.render.height,
		mode,
		theme: themeFor(script.palette),
		fonts: '/assets/fonts',
		topic: script.topic || script.title,
		palette: script.palette,
		safe: safeArea(cfg.render.height),
	};
}

function extractHtml(data) {
	const raw = String(typeof data === 'string' ? data : data?.html || data?.code || data?.scene || '');

	if (!raw.trim()) return '';

	const start = raw.search(/<!doctype html/i);
	const end = raw.toLowerCase().lastIndexOf('</html>');

	if (start !== -1 && end > start) return raw.slice(start, end + 7).trim();

	return raw
		.replace(/^\s*```[a-zA-Z]*\s*/m, '')
		.replace(/```\s*$/m, '')
		.trim();
}

const MAX_SCENE_TOKENS = 7000;

async function generateScene({ cfg, scene, index, total, duration, mode, script, sdk }) {
	const meta = { ...script, topic: script.topic || script.title };
	const res = await chat({
		cfg,
		messages: [
			{ role: 'system', content: sceneSystem({ sdk, mode }) },
			{ role: 'user', content: sceneUser({ scene, index, total, duration, mode, meta }) },
		],
		temperature: 0.65,
		maxTokens: Math.min(cfg.ai.maxTokens, MAX_SCENE_TOKENS),
	});

	return { html: extractHtml(res.message?.content || ''), summary: '' };
}

async function repairScene({ cfg, html, errors, duration, mode, sdk }) {
	const res = await chat({
		cfg,
		messages: [
			{ role: 'system', content: sceneSystem({ sdk, mode }) },
			{ role: 'user', content: sceneRepairUser({ html, errors, duration, mode }) },
		],
		temperature: 0.35,
		maxTokens: Math.min(cfg.ai.maxTokens, MAX_SCENE_TOKENS),
	});

	return { html: extractHtml(res.message?.content || ''), summary: '' };
}

async function previewOnce({ cfg, page, file, meta, duration, sceneId, workspace }) {
	try {
		const res = await previewScene({
			page,
			serverUrl: cfg.__serverUrl,
			sceneRel: path.relative(ROOT, file).split(path.sep).join('/'),
			meta,
			dur: duration,
			times: [Math.min(0.45, duration / 3), duration * 0.45, Math.max(0.8, duration - 0.35)],
			outDir: path.join(workspace, 'preview', sceneId),
		});

		const sizes = res.shots.map(shot => {
			try {
				return fs.statSync(shot).size;
			} catch {
				return 0;
			}
		});

		const severe = res.report.warnings.filter(w => /keluar canvas|melebar/.test(w));
		const errors = [...res.errors, ...severe.map(w => 'layout: ' + w)];

		if (Math.max(...sizes) < MIN_FRAME_BYTES) errors.push('semua frame hampir kosong (scene tidak menampilkan apa pun)');
		if (res.info && res.info.timelineDuration === 0 && meta.mode !== '3d') errors.push('timeline GSAP kosong');

		return { ok: errors.length === 0, errors: errors.slice(0, 6), warnings: res.report.warnings.slice(0, 6), info: res.info };
	} catch (err) {
		return { ok: false, errors: [String(err.message).slice(0, 400)], warnings: [], info: {} };
	}
}

export async function writeScenes({ cfg, pool, script, scenes, mode, workspace }) {
	const dir = path.join(workspace, 'scenes');
	const sdk = loadSdk();
	const concurrency = Math.max(2, Math.min(6, Number(cfg.ai.concurrency) || 5));

	fs.mkdirSync(dir, { recursive: true });

	log.step(`Menulis ${scenes.length} scene paralel (${concurrency} AI)`);

	const items = scenes.map((scene, index) => ({
		scene,
		index,
		file: path.join(dir, `${scene.id}.html`),
		meta: sceneMeta({ cfg, script, duration: scene.duration, mode }),
	}));

	const generated = await mapLimit(items, concurrency, async item => {
		const started = Date.now();

		try {
			const out = await generateScene({ cfg, scene: item.scene, index: item.index, total: scenes.length, duration: item.scene.duration, mode, script, sdk });
			const lint = lintScene(out.html, { mode });

			log.info(`${item.scene.id}: ai ${((Date.now() - started) / 1000).toFixed(1)}s · ${lint.ok ? 'lint ok' : 'lint gagal — ' + lint.errors.slice(0, 2).join(' | ')}`);

			return { ...item, html: out.html, summary: out.summary, errors: lint.errors };
		} catch (err) {
			log.warn(`${item.scene.id}: AI gagal (${String(err.message).slice(0, 120)})`);
			return { ...item, html: '', errors: [String(err.message).slice(0, 200)] };
		}
	});

	const broken = generated.filter(item => item.errors.length);

	if (broken.length) {
		log.step(`Perbaikan lint: ${broken.length} scene`);

		await mapLimit(broken, Math.min(concurrency, broken.length), async item => {
			for (let attempt = 0; attempt < 2 && item.errors.length; attempt++) {
				try {
					const out = await repairScene({ cfg, html: item.html, errors: item.errors, duration: item.scene.duration, mode, sdk });
					const lint = lintScene(out.html, { mode });

					item.html = out.html;
					item.errors = lint.errors;
					item.summary = out.summary || item.summary;
					log.info(`${item.scene.id}: repair ${attempt + 1} ${lint.ok ? 'ok' : 'masih gagal'}`);
				} catch (err) {
					log.warn(`${item.scene.id}: repair gagal (${String(err.message).slice(0, 100)})`);
				}
			}

			return item;
		});
	}

	for (const item of generated) {
		if (!item.errors.length && item.html) fs.writeFileSync(item.file, item.html, 'utf8');
	}

	log.step('Preview + QA scene');

	const previewed = await pool.map(generated, async (item, index, page) => {
		if (!item.html || item.errors.length) return { ...item, preview: { ok: false, errors: ['scene tidak valid'] } };

		const preview = await previewOnce({ cfg, page, file: item.file, meta: item.meta, duration: item.scene.duration, sceneId: item.scene.id, workspace });

		if (preview.ok) log.info(`${item.scene.id}: preview bersih`);
		else log.warn(`${item.scene.id}: preview bermasalah — ${(preview.errors || []).slice(0, 2).join(' | ')}`);

		return { ...item, preview };
	});

	const needsRepair = previewed.filter(item => item.preview && !item.preview.ok && item.html);

	if (needsRepair.length) {
		log.step(`Perbaikan runtime: ${needsRepair.length} scene`);

		await mapLimit(needsRepair, concurrency, async item => {
			try {
				const out = await repairScene({ cfg, html: item.html, errors: item.preview.errors, duration: item.scene.duration, mode, sdk });
				const lint = lintScene(out.html, { mode });

				if (!lint.ok) {
					log.warn(`${item.scene.id}: repair runtime gagal, pakai scene fallback`);
					fs.writeFileSync(item.file, fallbackScene({ scene: item.scene, duration: item.scene.duration, mode, script }), 'utf8');
					item.html = fs.readFileSync(item.file, 'utf8');
					return item;
				}

				fs.writeFileSync(item.file, out.html, 'utf8');
				item.html = out.html;
			} catch (err) {
				log.warn(`${item.scene.id}: repair runtime gagal (${String(err.message).slice(0, 100)})`);
			}

			return item;
		});

		const recheck = await pool.map(needsRepair, async (item, index, page) => {
			const preview = await previewOnce({ cfg, page, file: item.file, meta: item.meta, duration: item.scene.duration, sceneId: item.scene.id, workspace });

			return { id: item.scene.id, ok: preview.ok, errors: preview.errors };
		});

		for (const status of recheck) log.info(`${status.id}: ${status.ok ? 'bersih setelah repair' : 'masih bermasalah, lanjut apa adanya'}`);
	}

	return previewed.map(item => {
		if (!item.html || item.errors.length) {
			log.warn(`${item.scene.id}: memakai scene fallback`);
			fs.writeFileSync(item.file, fallbackScene({ scene: item.scene, duration: item.scene.duration, mode, script }), 'utf8');
		}

		return {
			...item.scene,
			file: item.file,
			relUrl: path.relative(ROOT, item.file).split(path.sep).join('/'),
			meta: item.meta,
			summary: item.summary,
		};
	});
}

async function mapLimit(items, limit, fn) {
	const out = new Array(items.length);
	let cursor = 0;

	const worker = async () => {
		while (cursor < items.length) {
			const index = cursor++;
			out[index] = await fn(items[index], index);
		}
	};

	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
	return out;
}

export function fallbackScene({ scene, duration, mode, script }) {
	const theme = themeFor(script.palette);
	const keywords = (scene.keywords && scene.keywords.length ? scene.keywords : [script.title]).slice(0, 3).map(k => String(k).toUpperCase());
	const primary = keywords[0] || String(script.title).toUpperCase();
	const secondary = keywords.slice(1);
	const label = scene.beat ? String(scene.beat).toUpperCase() : 'EXPLAINER';
	const chips = secondary
		.map((text, i) => `const chip${i} = RL.chip({ text: ${JSON.stringify(text)}, x: ${120 + i * 420}, y: 1210, size: 30 }); RL.reveal(chip${i}, ${(1.5 + i * 0.15).toFixed(2)}, { y: 30 });`)
		.join('\n');

	if (mode === '3d') {
		return `<!doctype html>
<html lang="id"><head><meta charset="utf-8" />
<script src="/node_modules/gsap/dist/gsap.min.js"></script>
<script src="/src/render/kit/rl-kit.js"></script>
<script src="/src/render/kit/rl-3d.js"></script>
</head><body><script>
RL.init();
const view = RL.scene3d({ fov: 52, position: [0, 1.5, 7.6], target: [0, 0.2, 0], fogNear: 8, fogFar: 24 });
view.mesh({ geometry: 'icosa', detail: 1, radius: 1.25, color: RL.theme.accent2, position: [0, 0.15, 0], rotationSpeed: [0.3, 0.5, 0] });
view.mesh({ geometry: 'plane', width: 18, height: 20, segments: [26, 30], color: RL.theme.accent, wireframe: true, lineWidth: 1.4, opacity: 0.55, amp: 0.9, position: [0, -1.7, 0], rotation: [-0.12, 0, 0] });
view.lines({ points: Array.from({ length: 64 }, (_, i) => { const a = (i / 64) * Math.PI * 2; return [Math.cos(a) * 2.2, 0.15, Math.sin(a) * 2.2]; }), closed: true, color: RL.theme.accent, width: 2, opacity: 0.5 });
RL.fx.vignette(0.55);
RL.fx.grain(0.05);
const chip = RL.chip({ text: ${JSON.stringify(label)}, y: 300 });
RL.reveal(chip, 0.05, { y: 26 });
const head = RL.text({ text: ${JSON.stringify(primary)}, y: 430, size: 112, uppercase: true });
RL.stagger(RL.split(head), 0.22, { y: 70, stagger: 0.08 });
const line = RL.shape({ type: 'pill', w: 220, h: 10, x: 430, y: 590, fill: RL.theme.accent });
RL.fromTo(line, { scaleX: 0 }, { scaleX: 1, duration: 0.6 }, 0.8);
${chips}
RL.finish();
</script></body></html>`;
	}

	return `<!doctype html>
<html lang="id"><head><meta charset="utf-8" />
<script src="/node_modules/gsap/dist/gsap.min.js"></script>
<script src="/src/render/kit/rl-kit.js"></script>
</head><body><script>
RL.init();
RL.fx.blobs({ count: 3, seed: 9, opacity: 0.16 });
RL.fx.vignette(0.5);
RL.fx.grain(0.05);
const wave = RL.svg({ y: 940, w: 936, h: 300, markup: '<svg viewBox="0 0 936 300"><path d="M0 200 C 120 90 240 90 360 200 C 480 310 600 310 720 200 C 800 125 870 120 936 150" fill="none" stroke="' + RL.theme.accent + '" stroke-width="6" stroke-linecap="round" opacity="0.75"/></svg>' });
RL.from(wave, { opacity: 0, y: 40, duration: 0.8 }, 0.75);
const chip = RL.chip({ text: ${JSON.stringify(label)}, y: 300 });
RL.reveal(chip, 0.05, { y: 26 });
const head = RL.text({ text: ${JSON.stringify(primary)}, y: 430, size: 116, uppercase: true });
RL.stagger(RL.split(head), 0.22, { y: 70, stagger: 0.08 });
const line = RL.shape({ type: 'pill', w: 220, h: 10, x: 430, y: 600, fill: RL.theme.accent });
RL.fromTo(line, { scaleX: 0 }, { scaleX: 1, duration: 0.6 }, 0.8);
${chips}
RL.finish();
</script></body></html>`;
}
