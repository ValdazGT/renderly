import { chatJson } from '../ai/client.js';
import { scriptSystem, scriptUser, wordBudget } from '../ai/prompts.js';
import { PALETTES } from '../render/theme.js';
import { words } from '../util/text.js';
import * as log from '../util/log.js';

const BEATS = ['hook', 'setup', 'insight', 'payoff', 'cta'];

export function normalizeScript(raw, { duration, mode, palette }) {
	const errors = [];
	const data = raw && typeof raw === 'object' ? raw : {};
	const scenes = Array.isArray(data.scenes) ? data.scenes : [];

	const cleaned = scenes
		.map((scene, i) => {
			const narration = String(scene?.narration || scene?.voiceover || scene?.text || '')
				.replace(/\s+/g, ' ')
				.trim();
			const keywords = Array.isArray(scene?.keywords)
				? scene.keywords.map(k => String(k).toUpperCase().trim()).filter(Boolean).slice(0, 3)
				: String(scene?.keywords || scene?.keyword || '')
						.split(/[|,]/)
						.map(k => k.toUpperCase().trim())
						.filter(Boolean)
						.slice(0, 3);

			return {
				id: `s${i + 1}`,
				narration,
				visual: String(scene?.visual || scene?.visual_direction || scene?.direction || '').trim(),
				keywords,
				beat: BEATS.includes(String(scene?.beat || '').toLowerCase()) ? String(scene.beat).toLowerCase() : i === 0 ? 'hook' : 'insight',
			};
		})
		.filter(scene => scene.narration.length > 0);

	if (cleaned.length < 3) errors.push(`skrip hanya punya ${cleaned.length} scene bernarasi (minimal 3)`);
	if (cleaned.length > 12) cleaned.length = 12;

	const totalWords = cleaned.reduce((n, scene) => n + words(scene.narration).length, 0);
	const budget = wordBudget(duration);

	if (!data.title) errors.push('judul kosong');

	const paletteName = Object.keys(PALETTES).includes(String(data.palette || '').toLowerCase()) ? String(data.palette).toLowerCase() : palette;

	return {
		script: {
			title: String(data.title || 'Tanpa judul').slice(0, 80),
			hook: String(data.hook || cleaned[0]?.narration || '').slice(0, 200),
			angle: String(data.angle || '').slice(0, 240),
			palette: paletteName,
			mode,
			targetDuration: duration,
			totalWords,
			scenes: cleaned,
		},
		errors,
		warnings: Math.abs(totalWords - budget) / budget > 0.22 ? [`panjang narasi ${totalWords} kata vs target ${budget} kata`] : [],
	};
}

export async function writeScript({ cfg, topic, mode, duration, lang, palette, extra }) {
	log.step('Menulis skrip');

	let lastErrors = [];
	let best = null;

	for (let attempt = 0; attempt < 3; attempt++) {
		const res = await chatJson({
			cfg,
			messages: [
				{ role: 'system', content: scriptSystem({ lang, mode }) },
				{
					role: 'user',
					content:
						scriptUser({ topic, mode, duration, lang, palette, extra }) +
						(lastErrors.length ? `\n\nSKRIP SEBELUMNYA DITOLAK: ${lastErrors.join('; ')}. Perbaiki.` : ''),
				},
			],
			temperature: 0.75,
			maxTokens: Math.min(cfg.ai.maxTokens, 4000),
		});

		const normalized = normalizeScript(res.data, { duration, mode, palette });

		if (!normalized.errors.length) {
			if (!best || normalized.script.totalWords > best.script.totalWords) best = normalized;
			if (!normalized.warnings.length) break;
			lastErrors = normalized.warnings;
			if (best && attempt >= 1) break;
			continue;
		}

		lastErrors = normalized.errors;
		log.warn(`skrip ditolak: ${normalized.errors.join('; ')}`);
	}

	if (!best) throw new Error(`AI gagal menulis skrip valid: ${lastErrors.join('; ')}`);

	const script = best.script;

	log.ok(`"${script.title}" · ${script.scenes.length} scene · ${script.totalWords} kata · palette ${script.palette}`);
	for (const scene of script.scenes) log.detail(`${scene.id} [${scene.beat}] ${scene.narration}`);

	return script;
}