import fs from 'fs';
import path from 'path';
import { pad } from '../util/text.js';

export async function captureScene({ page, serverUrl, sceneRel, meta, dur, fps, framesDir, jpegQuality = 92, onProgress }) {
	fs.rmSync(framesDir, { recursive: true, force: true });
	fs.mkdirSync(framesDir, { recursive: true });

	await page.setMeta(meta);
	await page.goto(`${serverUrl}/${sceneRel}`);
	await page.waitReady();

	const info = await page.evaluate('window.__rl.info()');
	const total = Math.max(1, Math.round(dur * fps));

	await page.evaluate(`window.__rl.render(${(dur / 2).toFixed(3)})`);

	const report = await page.evaluate('window.__rl.report()');

	for (let i = 0; i < total; i++) {
		const t = i / fps;

		await page.evaluate(`window.__rl.render(${t.toFixed(4)})`);

		const buf = await page.screenshot(jpegQuality);

		fs.writeFileSync(path.join(framesDir, `${pad(i + 1, 5)}.jpg`), buf);
		if (onProgress) onProgress(i + 1, total);
	}

	return { frames: total, info, report, errors: (page.errors || []).slice(0, 12) };
}

export async function previewScene({ page, serverUrl, sceneRel, meta, dur, times, outDir, jpegQuality = 90 }) {
	fs.mkdirSync(outDir, { recursive: true });
	await page.setMeta(meta);
	await page.goto(`${serverUrl}/${sceneRel}`);
	await page.waitReady();

	const info = await page.evaluate('window.__rl.info()');
	const shots = [];

	for (const t of times) {
		const at = Math.max(0, Math.min(dur - 0.05, t));

		await page.evaluate(`window.__rl.render(${at.toFixed(3)})`);

		const buf = await page.screenshot(jpegQuality);
		const file = path.join(outDir, `preview-${at.toFixed(2).replace('.', '_')}.jpg`);

		fs.writeFileSync(file, buf);
		shots.push(file);
	}

	await page.evaluate(`window.__rl.render(${Math.max(0, dur / 2).toFixed(3)})`);

	const report = await page.evaluate('window.__rl.report()');

	return { shots, info, report, errors: (page.errors || []).slice(0, 12) };
}