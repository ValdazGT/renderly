import net from 'net';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'child_process';

function freePort() {
	return new Promise((resolve, reject) => {
		const srv = net.createServer();

		srv.once('error', reject);
		srv.listen(0, '127.0.0.1', () => {
			const { port } = srv.address();
			srv.close(() => resolve(port));
		});
	});
}

async function getJson(url) {
	const res = await fetch(url, { signal: AbortSignal.timeout(5000) });

	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	return res.json();
}

async function waitHttp(url, timeoutMs) {
	const deadline = Date.now() + timeoutMs;

	while (Date.now() < deadline) {
		try {
			return await getJson(url);
		} catch {
			await new Promise(r => setTimeout(r, 250));
		}
	}

	throw new Error(`browser tidak merespons di ${url}`);
}

class CDP {
	constructor(wsUrl) {
		this.wsUrl = wsUrl;
		this.id = 0;
		this.pending = new Map();
		this.listeners = new Map();
		this.closed = false;
	}

	open() {
		return new Promise((resolve, reject) => {
			const ws = new WebSocket(this.wsUrl);

			this.ws = ws;

			ws.addEventListener('open', () => resolve(this));
			ws.addEventListener('error', e => reject(new Error('ws error: ' + (e?.message || 'unknown'))));
			ws.addEventListener('close', () => {
				this.closed = true;

				for (const [, p] of this.pending) p.reject(new Error('CDP closed'));
				this.pending.clear();
			});
			ws.addEventListener('message', event => {
				let msg;

				try {
					msg = JSON.parse(event.data);
				} catch {
					return;
				}

				if (msg.id && this.pending.has(msg.id)) {
					const p = this.pending.get(msg.id);

					this.pending.delete(msg.id);

					if (msg.error) p.reject(new Error(`${msg.error.message || 'cdp error'} (${msg.error.code || 0})`));
					else p.resolve(msg.result);
					return;
				}

				if (msg.method) {
					const cbs = this.listeners.get(msg.method);

					if (cbs) for (const cb of cbs) cb(msg.params);
				}
			});
		});
	}

	on(method, cb) {
		const list = this.listeners.get(method) || new Set();

		list.add(cb);
		this.listeners.set(method, list);
		return () => list.delete(cb);
	}

	send(method, params = {}, timeoutMs = 120000) {
		if (this.closed) return Promise.reject(new Error('CDP sudah tertutup'));

		const id = ++this.id;

		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`CDP timeout ${method}`));
			}, timeoutMs);

			this.pending.set(id, {
				resolve: v => {
					clearTimeout(timer);
					resolve(v);
				},
				reject: e => {
					clearTimeout(timer);
					reject(e);
				},
			});

			try {
				this.ws.send(JSON.stringify({ id, method, params }));
			} catch (e) {
				clearTimeout(timer);
				this.pending.delete(id);
				reject(e);
			}
		});
	}

	close() {
		try {
			this.ws?.close();
		} catch {}
	}
}

class Page {
	constructor(cdp, browser, size) {
		this.cdp = cdp;
		this.browser = browser;
		this.size = size;
		this.errors = [];
		this.injected = [];
		this.console = [];

		cdp.on('Runtime.consoleAPICalled', p => {
			const text = (p.args || [])
				.map(a => (a.value !== undefined ? a.value : a.description || a.type))
				.join(' ')
				.slice(0, 400);

			if (p.type === 'error' || p.type === 'warning') this.errors.push(`${p.type}: ${text}`);
			this.console.push(text);
		});

		cdp.on('Runtime.exceptionThrown', p => {
			const d = p.exceptionDetails || {};
			this.errors.push(`exception: ${d.exception?.description || d.text || 'unknown'}`.slice(0, 500));
		});

		cdp.on('Log.entryAdded', p => {
			const e = p.entry || {};
			const url = String(e.url || '');

			if (e.level !== 'error') return;
			if (/favicon/i.test(url) || /favicon/i.test(String(e.text || ''))) return;

			this.errors.push(`log: ${String(e.text || '').slice(0, 240)}${url ? ' @ ' + url.slice(-80) : ''}`);
		});
	}

	async init() {
		await this.cdp.send('Page.enable');
		await this.cdp.send('Runtime.enable');
		await this.cdp.send('Log.enable');
		await this.cdp.send('Emulation.setDeviceMetricsOverride', {
			width: this.size.width,
			height: this.size.height,
			deviceScaleFactor: 1,
			mobile: false,
		});
		await this.cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
		return this;
	}

	async setMeta(meta) {
		for (const id of this.injected) {
			try {
				await this.cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: id });
			} catch {}
		}

		this.injected = [];

		const source = `window.__rlMeta = ${JSON.stringify(meta || {})};`;

		const { identifier } = await this.cdp.send('Page.addScriptToEvaluateOnNewDocument', { source });

		this.injected.push(identifier);
	}

	async goto(url, { timeoutMs = 30000 } = {}) {
		this.errors = [];

		await this.cdp.send('Page.navigate', { url });

		const loaded = new Promise(resolve => {
			const off = this.cdp.on('Page.loadEventFired', () => {
				off();
				resolve('load');
			});

			setTimeout(() => {
				off();
				resolve('timeout');
			}, timeoutMs);
		});

		await loaded;
	}

	async evaluate(expression, { awaitPromise = true } = {}) {
		const res = await this.cdp.send('Runtime.evaluate', {
			expression,
			returnByValue: true,
			awaitPromise,
			userGesture: true,
		});

		if (res.exceptionDetails) {
			const d = res.exceptionDetails;
			throw new Error(`${d.exception?.description || d.text || 'eval error'}`.slice(0, 600));
		}

		return res.result?.value;
	}

	async waitReady({ timeoutMs = 25000 } = {}) {
		const deadline = Date.now() + timeoutMs;
		let lastError = null;

		while (Date.now() < deadline) {
			try {
				const ready = await this.evaluate('!!(window.__rl && window.__rl.ready)', { awaitPromise: false });

				if (ready) return true;
			} catch (e) {
				lastError = e;
			}

			await new Promise(r => setTimeout(r, 100));
		}

		const hint = this.errors.length ? `\n${this.errors.slice(0, 4).join('\n')}` : '';
		throw new Error(`scene tidak siap dirender${lastError ? `: ${lastError.message}` : ''}${hint}`);
	}

	async screenshot(quality = 92) {
		const { data } = await this.cdp.send('Page.captureScreenshot', {
			format: 'jpeg',
			quality,
			optimizeForSpeed: true,
			captureBeyondViewport: false,
		});

		return Buffer.from(data, 'base64');
	}
}

export async function launchBrowser(cfg) {
	const { width, height } = cfg.render;
	const port = await freePort();
	const profile = path.join(os.tmpdir(), 'renderly-chrome-' + crypto.randomUUID().slice(0, 8));

	fs.mkdirSync(profile, { recursive: true });

	const args = [
		'--headless=new',
		'--no-sandbox',
		'--disable-dev-shm-usage',
		'--enable-unsafe-swiftshader',
		'--hide-scrollbars',
		'--mute-audio',
		'--no-first-run',
		'--no-default-browser-check',
		'--disable-background-timer-throttling',
		'--disable-backgrounding-occluded-windows',
		'--disable-renderer-backgrounding',
		'--force-device-scale-factor=1',
		'--disable-features=Translate,MediaRouter,OptimizationHints',
		`--window-size=${width},${height}`,
		`--user-data-dir=${profile}`,
		`--remote-debugging-port=${port}`,
		'about:blank',
	];

	const proc = spawn(cfg.render.chromium, args, { stdio: ['ignore', 'pipe', 'pipe'] });
	let stderr = '';

	proc.stderr.on('data', d => {
		stderr += d.toString().slice(0, 4000);
		if (stderr.length > 8000) stderr = stderr.slice(-6000);
	});

	let exited = false;

	proc.on('exit', () => {
		exited = true;
	});

	try {
		await waitHttp(`http://127.0.0.1:${port}/json/version`, 30000);
	} catch (e) {
		try { proc.kill('SIGKILL'); } catch {}
		throw new Error(`chromium gagal start (${cfg.render.chromium}): ${e.message}\n${stderr.split('\n').filter(Boolean).slice(-4).join('\n')}`);
	}

	const targets = await waitHttp(`http://127.0.0.1:${port}/json/list`, 10000);
	const target = targets.find(t => t.type === 'page') || targets[0];

	if (!target) {
		try { proc.kill('SIGKILL'); } catch {}
		throw new Error('tidak ada target page di chromium');
	}

	const cdp = new CDP(target.webSocketDebuggerUrl);

	await cdp.open();

	const page = await new Page(cdp, null, { width, height }).init();

	page.cleanup = () => {
		for (const dir of [profile]) {
			try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
		}
	};

	return {
		page,
		port,
		alive: () => !exited,
		stderr: () => stderr,
		close: async () => {
			cdp.close();
			try { proc.kill('SIGTERM'); } catch {}

			await new Promise(r => setTimeout(r, 400));
			try { proc.kill('SIGKILL'); } catch {}
			try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
		},
	};
}