import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const DEFAULTS = {
	ai: {
		baseUrl: 'https://tokenharbor.ai/v1',
		model: 'deepseek-v4.1-flash:free',
		fallbackModels: ['mimo-v2.6-flash:free'],
		apiKey: '',
		keysFile: 'data/keys.json',
		temperature: 0.7,
		maxTokens: 8000,
		timeoutMs: 240000,
		maxSteps: 30,
		concurrency: 5,
	},
	proxy: {
		enabled: true,
		useProxyAlways: false,
		urls: ['https://proxy.nixel.dev', 'https://proxy.prayogananda549.workers.dev'],
		key: '',
	},
	voice: {
		engine: 'edge-tts',
		voice: 'id-ID-ArdiNeural',
		rate: '+10%',
		pitch: '+0Hz',
		volume: '+0%',
		python: 'python3',
	},
	render: {
		fps: 30,
		width: 1080,
		height: 1920,
		chromium: 'chromium-browser',
		jpegQuality: 90,
		workers: 2,
	},
	video: {
		crf: 21,
		preset: 'veryfast',
		music: null,
		musicVolume: 0.12,
		loudnorm: true,
	},
	style: {
		palette: 'midnight',
		font: 'Roboto',
		accent: '#5EEAD4',
	},
};

function merge(base, over) {
	if (!over || typeof over !== 'object' || Array.isArray(over)) return over === undefined ? base : over;
	const out = Array.isArray(base) ? [...base] : { ...base };

	for (const [k, v] of Object.entries(over)) out[k] = k in out ? merge(out[k], v) : v;
	return out;
}

function readJson(file) {
	try {
		return JSON.parse(fs.readFileSync(file, 'utf8'));
	} catch {
		return null;
	}
}

let cached = null;

export function loadConfig() {
	if (cached) return cached;

	const user = readJson(path.join(ROOT, 'config.json')) || {};
	const cfg = merge(DEFAULTS, user);

	cfg.ai.keysFile = path.resolve(ROOT, cfg.ai.keysFile);
	cfg.ai.baseUrl = String(cfg.ai.baseUrl || '').replace(/\/+$/, '');
	cfg.ai.apiKey = process.env.RENDERLY_API_KEY || cfg.ai.apiKey || '';
	if (process.env.RENDERLY_MODEL) cfg.ai.model = process.env.RENDERLY_MODEL;
	if (process.env.RENDERLY_CHROMIUM) cfg.render.chromium = process.env.RENDERLY_CHROMIUM;
	if (process.env.RENDERLY_PROXY === '0') cfg.proxy.enabled = false;

	cfg.paths = {
		scenes: path.join(ROOT, 'src', 'templates'),
		kit: path.join(ROOT, 'src', 'render', 'kit'),
		modules: path.join(ROOT, 'node_modules'),
	};

	cached = cfg;
	return cfg;
}

export function outDir(slug, dir) {
	return path.join(ROOT, 'out', slug, dir || '');
}

export function ensureDir(dir) {
	fs.mkdirSync(dir, { recursive: true });
	return dir;
}

export function relative(file) {
	return path.relative(ROOT, file).split(path.sep).join('/');
}