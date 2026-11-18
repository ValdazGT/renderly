export function stripFences(text) {
	return String(text || '')
		.replace(/^\uFEFF/, '')
		.replace(/^\s*```[a-zA-Z0-9_-]*\s*/m, '')
		.replace(/\s*```\s*$/m, '')
		.trim();
}

export function extractJson(text) {
	const raw = stripFences(text);
	const first = raw.search(/[[{]/);

	if (first === -1) return null;

	const open = raw[first];
	const close = open === '{' ? '}' : ']';
	let depth = 0;
	let inString = false;
	let escaped = false;

	for (let i = first; i < raw.length; i++) {
		const ch = raw[i];

		if (inString) {
			if (escaped) escaped = false;
			else if (ch === '\\') escaped = true;
			else if (ch === '"') inString = false;
			continue;
		}

		if (ch === '"') inString = true;
		else if (ch === open) depth++;
		else if (ch === close) {
			depth--;
			if (depth === 0) return raw.slice(first, i + 1);
		}
	}

	return null;
}

export function repairJson(text) {
	if (text === null || text === undefined) return null;

	let s = String(text).replace(/,\s*([}\]])/g, '$1');

	const quotes = (s.match(/(?<!\\)"/g) || []).length;

	if (quotes % 2 === 1) s += '"';

	const opens = (s.match(/[{[]/g) || []).length;
	const closes = (s.match(/[}\]]/g) || []).length;

	for (let i = 0; i < opens - closes; i++) {
		const stack = [];

		for (const ch of s) {
			if (ch === '{') stack.push('}');
			else if (ch === '[') stack.push(']');
			else if (ch === '}' || ch === ']') stack.pop();
		}

		if (!stack.length) break;
		s += stack.reverse().join('');
	}

	return s;
}

export function parseJson(text, { repair = true } = {}) {
	const candidate = extractJson(text) || (repair ? repairJson(stripFences(text)) : null);

	if (!candidate) return null;

	try {
		return JSON.parse(candidate);
	} catch {}

	if (!repair) return null;

	try {
		return JSON.parse(repairJson(candidate));
	} catch {}

	return null;
}

export function parseToolArgs(raw) {
	if (!raw) return {};
	if (typeof raw === 'object') return raw;

	const parsed = parseJson(String(raw));

	return parsed && typeof parsed === 'object' ? parsed : {};
}