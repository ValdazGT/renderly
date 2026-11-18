import fs from 'fs';

const BAD_MS = 10 * 60000;

let cache = null;
let cacheAt = 0;
const bad = new Map();
const recent = new Map();

function readList(file) {
	try {
		const raw = fs.readFileSync(file, 'utf8').trim();

		if (raw.startsWith('[') || raw.startsWith('{')) {
			const data = JSON.parse(raw);
			const arr = Array.isArray(data) ? data : data.keys || data.apiKeys || [];
			return arr.filter(k => typeof k === 'string' && k.trim()).map(k => k.trim());
		}

		return raw
			.split(/[\s,]+/)
			.map(k => k.trim())
			.filter(Boolean);
	} catch {
		return [];
	}
}

export function getKeys(cfg) {
	const now = Date.now();

	if (!cache || now - cacheAt > 60000) {
		const set = new Set(readList(cfg.ai.keysFile));

		if (cfg.ai.apiKey) set.add(cfg.ai.apiKey);
		cache = [...set];
		cacheAt = now;
	}

	return cache;
}

export function keyCount(cfg) {
	return getKeys(cfg).length;
}

export function isBad(key) {
	return (bad.get(key) || 0) > Date.now();
}

export function markBad(key, ms = BAD_MS) {
	if (!key) return;
	bad.set(key, Date.now() + Math.max(30000, Number(ms) || BAD_MS));
}

export function markGood(key) {
	if (!key) return;
	bad.delete(key);
	recent.set(key, Date.now());
}

export function pickKey(cfg, used = new Set()) {
	const keys = getKeys(cfg).filter(k => !used.has(k) && !isBad(k));

	if (keys.length) return keys[Math.floor(Math.random() * keys.length)];

	const fresh = getKeys(cfg).filter(k => !isBad(k));

	if (fresh.length) return fresh[Math.floor(Math.random() * fresh.length)];

	const all = getKeys(cfg);

	return all.length ? all[Math.floor(Math.random() * all.length)] : '';
}

export function keyLabel(key) {
	if (!key) return 'none';
	return '…' + String(key).slice(-6);
}

export function keyStats() {
	return { bad: bad.size, recent: recent.size };
}