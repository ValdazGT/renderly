const COLOR = {
	reset: '\x1b[0m',
	dim: '\x1b[2m',
	bold: '\x1b[1m',
	red: '\x1b[31m',
	green: '\x1b[32m',
	yellow: '\x1b[33m',
	blue: '\x1b[34m',
	magenta: '\x1b[35m',
	cyan: '\x1b[36m',
	gray: '\x1b[90m',
};

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = fn => (useColor ? fn : s => s);

const c = {
	dim: paint(s => COLOR.dim + s + COLOR.reset),
	bold: paint(s => COLOR.bold + s + COLOR.reset),
	red: paint(s => COLOR.red + s + COLOR.reset),
	green: paint(s => COLOR.green + s + COLOR.reset),
	yellow: paint(s => COLOR.yellow + s + COLOR.reset),
	blue: paint(s => COLOR.blue + s + COLOR.reset),
	magenta: paint(s => COLOR.magenta + s + COLOR.reset),
	cyan: paint(s => COLOR.cyan + s + COLOR.reset),
	gray: paint(s => COLOR.gray + s + COLOR.reset),
};

const T0 = Date.now();
const stderrOnly = () => process.env.RENDERLY_QUIET === '1';

export function elapsed() {
	const s = (Date.now() - T0) / 1000;
	return s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, '0')}s`;
}

export function banner(text, sub) {
	if (stderrOnly()) return;

	const line = '─'.repeat(Math.max(12, Math.min(56, text.length + 4)));

	console.log('');
	console.log(c.cyan(line));
	console.log(c.bold('  ' + text));
	if (sub) console.log(c.gray('  ' + sub));
	console.log(c.cyan(line));
	console.log('');
}

export function step(text) {
	if (stderrOnly()) return;
	console.log(`${c.gray('[' + elapsed() + ']')} ${c.cyan('▸')} ${c.bold(text)}`);
}

export function info(text) {
	if (stderrOnly()) return;
	console.log(`  ${c.gray('·')} ${text}`);
}

export function ai(text) {
	if (stderrOnly()) return;
	console.log(`  ${c.magenta('✦')} ${c.gray(text)}`);
}

export function ok(text) {
	if (stderrOnly()) return;
	console.log(`  ${c.green('✓')} ${text}`);
}

export function warn(text) {
	console.log(`  ${c.yellow('!')} ${text}`);
}

export function fail(text) {
	console.log(`  ${c.red('✗')} ${text}`);
}

export function detail(text) {
	if (stderrOnly()) return;
	for (const line of String(text).split('\n')) console.log(`    ${c.gray(line)}`);
}

export function json(value) {
	return JSON.stringify(value, null, 2);
}
export function hintPath(file) {
	return c.cyan(c.bold('→ ' + file));
}
