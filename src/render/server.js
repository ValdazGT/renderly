import http from 'http';
import fs from 'fs';
import path from 'path';

const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.webp': 'image/webp',
	'.mp3': 'audio/mpeg',
	'.wav': 'audio/wav',
	'.m4a': 'audio/mp4',
	'.ttf': 'font/ttf',
	'.otf': 'font/otf',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
	'.mp4': 'video/mp4',
	'.glb': 'model/gltf-binary',
	'.gltf': 'model/gltf+json',
	'.hdr': 'application/octet-stream',
	'.wasm': 'application/wasm',
};

export async function startServer(root) {
	const server = http.createServer((req, res) => {
		const url = new URL(req.url, 'http://127.0.0.1');
		let file;

		try {
			const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
			file = path.resolve(root, rel);
		} catch {
			res.writeHead(400).end('bad request');
			return;
		}

		if (!file.startsWith(root)) {
			res.writeHead(403).end('forbidden');
			return;
		}

		fs.stat(file, (err, stat) => {
			if (err) {
				res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
				return;
			}

			if (stat.isDirectory()) {
				res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
				return;
			}

			const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';

			res.writeHead(200, {
				'Content-Type': type,
				'Content-Length': stat.size,
				'Access-Control-Allow-Origin': '*',
				'Cache-Control': 'no-store',
			});

			if (req.method === 'HEAD') {
				res.end();
				return;
			}

			fs.createReadStream(file)
				.on('error', () => res.end())
				.pipe(res);
		});
	});

	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});

	const { port } = server.address();

	return {
		url: `http://127.0.0.1:${port}`,
		port,
		close: () => new Promise(resolve => server.close(resolve)),
	};
}