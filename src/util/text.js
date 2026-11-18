export function slugify(input, fallback = 'video') {
	const s = String(input || '')
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 48);

	return s || fallback;
}

export function words(text) {
	return String(text || '')
		.trim()
		.split(/\s+/)
		.filter(Boolean);
}

export function clamp(value, min, max) {
	return Math.min(max, Math.max(min, value));
}

export function detectLang(text) {
	const t = String(text || '').toLowerCase();

	if (/\b(apa|itu|yang|dan|untuk|dengan|bagaimana|kenapa|mengapa|adalah|tidak|bisa|kita|kamu|aku|gue|aja|banget)\b/.test(t)) return 'id';
	if (/\b(the|what|how|why|and|with|this|that|is|are|you|your)\b/.test(t)) return 'en';
	return 'id';
}

export function title_case_summary(text, max = 60) {
	const clean = String(text || '').replace(/\s+/g, ' ').trim();
	return clean.length <= max ? clean : clean.slice(0, max - 1).trimEnd() + '…';
}

export function seconds(n) {
	return Number(n).toFixed(2) + 's';
}

export function pad(n, size = 5) {
	return String(n).padStart(size, '0');
}