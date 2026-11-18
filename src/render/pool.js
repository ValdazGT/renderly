import os from 'os';
import { launchBrowser } from './browser.js';
import * as log from '../util/log.js';

export async function createBrowserPool({ cfg, size }) {
	const cores = os.cpus().length || (typeof os.availableParallelism === 'function' ? os.availableParallelism() : 0) || 4;
	const wanted = Number(size || cfg.render.workers || 2);
	const count = Math.max(1, Math.min(4, Number.isFinite(wanted) ? wanted : 2, Math.max(1, Math.floor(cores / 2))));

	const browsers = await Promise.all(Array.from({ length: count }, () => launchBrowser(cfg)));
	const idle = [...browsers];
	const waiting = [];

	log.info(`render pool: ${count} browser`);

	const acquire = () => {
		if (idle.length) return Promise.resolve(idle.pop());

		return new Promise(resolve => waiting.push(resolve));
	};

	const release = browser => {
		if (!browsers.includes(browser)) return;

		const next = waiting.shift();

		if (next) next(browser);
		else idle.push(browser);
	};

	const map = async (items, fn, concurrency) => {
		const limit = Math.max(1, Math.min(concurrency || count, count));
		const results = new Array(items.length);
		let cursor = 0;

		const worker = async () => {
			while (cursor < items.length) {
				const index = cursor++;
				const browser = await acquire();

				try {
					results[index] = await fn(items[index], index, browser.page);
				} finally {
					release(browser);
				}
			}
		};

		await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
		return results;
	};

	const close = async () => {
		await Promise.all(browsers.map(b => b.close().catch(() => {})));
	};

	return { size: count, browsers, acquire, release, map, close };
}