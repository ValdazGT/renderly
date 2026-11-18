import { spawn } from 'child_process';

export function run(cmd, args = [], opts = {}) {
	const { cwd, timeoutMs = 0, env, input, silent = true } = opts;

	return new Promise((resolve, reject) => {
		let child;

		try {
			child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
		} catch (e) {
			reject(e);
			return;
		}

		let stdout = '';
		let stderr = '';
		let timer = null;
		let killedBy = null;

		if (timeoutMs > 0) {
			timer = setTimeout(() => {
				killedBy = `timeout ${Math.round(timeoutMs / 1000)}s`;
				try { child.kill('SIGKILL'); } catch {}
			}, timeoutMs);
		}

		child.stdout.on('data', d => {
			stdout += d.toString();
			if (!silent && process.env.RENDERLY_VERBOSE === '1') process.stdout.write(d);
		});

		child.stderr.on('data', d => {
			stderr += d.toString();
			if (!silent && process.env.RENDERLY_VERBOSE === '1') process.stderr.write(d);
		});

		if (input !== undefined) {
			try {
				child.stdin.write(input);
				child.stdin.end();
			} catch {}
		} else {
			try { child.stdin.end(); } catch {}
		}

		child.on('error', err => {
			if (timer) clearTimeout(timer);
			reject(err);
		});

		child.on('close', code => {
			if (timer) clearTimeout(timer);

			if (code === 0) resolve({ stdout, stderr, code });
			else {
				const err = new Error(killedBy || (stderr.trim().split('\n').slice(-6).join('\n') || `${cmd} exited with ${code}`));
				err.code = code;
				err.stdout = stdout;
				err.stderr = stderr;
				reject(err);
			}
		});
	});
}

export async function probe(file) {
	const { stdout } = await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
	const data = JSON.parse(stdout || '{}');

	return {
		duration: Number(data.format?.duration || 0),
		bitrate: Number(data.format?.bitrate || 0),
		size: Number(data.format?.size || 0),
		streams: (data.streams || []).map(s => ({ type: s.codec_type, codec: s.codec_name, w: s.width, h: s.height, fps: s.r_frame_rate })),
	};
}