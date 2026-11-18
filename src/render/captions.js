function hexToAss(hex) {
	const clean = String(hex || '#FFFFFF').replace('#', '').trim();

	if (clean.length !== 6) return '&H00FFFFFF';

	const r = clean.slice(0, 2);
	const g = clean.slice(2, 4);
	const b = clean.slice(4, 6);

	return `&H00${b}${g}${r}`.toUpperCase();
}

function escape(text) {
	return String(text || '')
		.replace(/\\/g, '/')
		.replace(/\{/g, '(')
		.replace(/\}/g, ')')
		.replace(/\r?\n/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function assTime(t) {
	const total = Math.max(0, Number(t) || 0);
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = Math.floor(total % 60);
	const cs = Math.round((total - Math.floor(total)) * 100);

	return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(Math.min(99, cs)).padStart(2, '0')}`;
}

export function buildLines(words, { maxChars = 22, maxWords = 4, gapBreak = 1.15 } = {}) {
	const lines = [];
	let current = null;

	const flush = () => {
		if (current && current.length) lines.push(current);
		current = null;
	};

	for (const word of words) {
		const text = escape(word.w);

		if (!text) continue;

		if (current && current.length) {
			const last = current[current.length - 1];
			const chars = current.map(w => w.w).join(' ').length + 1 + text.length;
			const gap = word.t - (last.t + last.d);

			if (current.length >= maxWords || chars > maxChars || gap > gapBreak) flush();
			else if (/([.!?:;])$/.test(current[current.length - 1].w) && current.length >= 2) flush();
		}

		const line = current || (current = []);

		line.push({ ...word, w: text });
	}

	flush();

	return lines.filter(line => line.length);
}

function fontSizeFor(text, { width, maxSize = 92, minSize = 44 }) {
	const available = width * 0.86;
	const estimate = text.length * 0.54 * maxSize;

	if (estimate <= available) return maxSize;
	return Math.max(minSize, Math.round((available / (text.length * 0.54)) * 1));
}

export function buildASS(words, opts = {}) {
	const width = opts.width || 1080;
	const height = opts.height || 1920;
	const marginV = opts.marginV === undefined ? Math.round(height * 0.219) : opts.marginV;
	const font = opts.font || 'Poppins';
	const accent = hexToAss(opts.accent || '#5EEAD4');
	const base = hexToAss(opts.color || '#FFFFFF');
	const dim = opts.dimAlpha === undefined ? 'B4' : opts.dimAlpha;
	const lines = buildLines(words, opts);
	const events = [];

	for (let li = 0; li < lines.length; li++) {
		const line = lines[li];
		const text = line.map(w => w.w).join(' ');
		const size = fontSizeFor(text, { width, maxSize: opts.maxSize || 92, minSize: opts.minSize || 44 });
		const last = line[line.length - 1];
		const nextLine = lines[li + 1];
		const lineEnd = Math.max(last.t + Math.min(0.6, last.d + 0.18), last.t + 0.12);
		const hardEnd = nextLine && nextLine[0].t > line[0].t ? nextLine[0].t : lineEnd;

		line.forEach((word, index) => {
			const next = line[index + 1];
			const start = Math.max(line[0].t, word.t);
			const end = Math.min(index === line.length - 1 ? hardEnd : next.t, hardEnd);

			if (end - start < 0.02) return;

			const rich = line
				.map((w, j) => {
					if (j === index) {
						return `{\\1c${accent}\\1a&H00&\\fscx100\\fscy100\\t(0,70,\\fscx106\\fscy106)\\t(70,170,\\fscx100\\fscy100)}${w.w}{\\1c${base}\\1a&H00&}`;
					}

					if (j > index) return `{\\1c${base}\\1a&H${dim}&}${w.w}`;
					return `{\\1c${base}\\1a&H00&}${w.w}`;
				})
				.join(' ');

			events.push({ start, end, text: rich, size });
		});
	}

	const header = `[Script Info]
Title: renderly
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
PlayResX: ${width}
PlayResY: ${height}
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: RL,${font},84,&H00FFFFFF,&H00FFFFFF,&H00000000,&H96000000,-1,0,0,0,100,100,0,0,1,7,3,2,60,60,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

	const body = events.map(e => `Dialogue: 0,${assTime(e.start)},${assTime(e.end)},RL,,0,0,0,,{\\fs${e.size}}${e.text}`).join('\n');

	return header + body + '\n';
}

export function buildSRT(words, opts = {}) {
	const lines = buildLines(words, opts);

	const time = t => {
		const total = Math.max(0, Number(t) || 0);
		const h = String(Math.floor(total / 3600)).padStart(2, '0');
		const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
		const s = String(Math.floor(total % 60)).padStart(2, '0');
		const ms = String(Math.round((total - Math.floor(total)) * 1000)).padStart(3, '0');

		return `${h}:${m}:${s},${ms}`;
	};

	return lines
		.map((line, i) => {
			const start = line[0].t;
			const last = line[line.length - 1];
			const end = last.t + last.d + 0.25;

			return `${i + 1}\n${time(start)} --> ${time(end)}\n${line.map(w => w.w).join(' ')}\n`;
		})
		.join('\n');
}

export function shiftWords(words, offset) {
	return words.map(w => ({ ...w, t: Math.max(0, w.t + offset) }));
}

export { assTime };