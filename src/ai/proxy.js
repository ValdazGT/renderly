const cool = new Map();

function label(endpoint) {
	if (endpoint === 'direct') return 'direct';

	try {
		return new URL(endpoint).host;
	} catch {
		return endpoint;
	}
}

export function isLocal(url) {
	try {
		const host = new URL(url).hostname;
		return host === '127.0.0.1' || host === 'localhost' || host === '::1';
	} catch {
		return false;
	}
}

export function proxyChain(cfg, targetUrl) {
	const cfgProxy = cfg.proxy || {};

	if (!cfgProxy.enabled || isLocal(targetUrl)) return [{ url: targetUrl, label: 'direct' }];

	const urls = (Array.isArray(cfgProxy.urls) ? cfgProxy.urls : [cfgProxy.urls]).filter(Boolean).map(u => String(u).replace(/\/+$/, ''));
	const key = cfgProxy.key ? '&key=' + encodeURIComponent(cfgProxy.key) : '';
	const now = Date.now();
	const chain = urls.map(base => ({
		url: `${base}/p?url=${encodeURIComponent(targetUrl)}${key}`,
		label: label(base),
	}));

	if (cfgProxy.useProxyAlways && chain.length) return chain.sort((a, b) => (cool.get(a.label) || 0) - (cool.get(b.label) || 0));

	return [{ url: targetUrl, label: 'direct' }, ...chain].sort((a, b) => {
		const aCold = (cool.get(a.label) || 0) > now ? 1 : 0;
		const bCold = (cool.get(b.label) || 0) > now ? 1 : 0;

		return aCold - bCold || (cool.get(a.label) || 0) - (cool.get(b.label) || 0);
	});
}

export function coolEndpoint(endpoint, ms) {
	if (!endpoint) return;
	cool.set(label(endpoint), Date.now() + Math.max(15000, Number(ms) || 60000));
}

export function warmEndpoint(endpoint) {
	if (!endpoint) return;
	cool.delete(label(endpoint));
}

export function coolStats() {
	const now = Date.now();
	const out = {};

	for (const [k, until] of cool) if (until > now) out[k] = Math.round((until - now) / 1000) + 's';
	return out;
}