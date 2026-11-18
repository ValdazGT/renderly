/*
 * renderly 3D kit — deterministic software renderer on Canvas2D.
 * Used as the portable engine when WebGL is unavailable (Android/Termux,
 * headless SwiftShader). API is intentionally three.js-shaped.
 */
(function (global) {
	'use strict';

	const RL = global.RL;

	if (!RL) throw new Error('rl-kit.js harus dimuat sebelum rl-3d.js');

	const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
	const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
	const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
	const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
	const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
	const len = a => Math.sqrt(dot(a, a));
	const norm = a => {
		const l = len(a) || 1;
		return [a[0] / l, a[1] / l, a[2] / l];
	};

	function hexToRgb(color, fallback) {
		if (Array.isArray(color)) return color.slice(0, 3).map(v => Math.max(0, Math.min(255, v | 0)));

		const s = String(color || fallback || '#ffffff').replace('#', '').trim();
		const full = s.length === 3 ? s.split('').map(c => c + c).join('') : s.padEnd(6, 'f').slice(0, 6);
		const n = parseInt(full, 16);

		if (Number.isNaN(n)) return [255, 255, 255];

		return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
	}

	function rotMatrix(rot) {
		const [rx, ry, rz] = rot || [0, 0, 0];
		const cx = Math.cos(rx), sx = Math.sin(rx);
		const cy = Math.cos(ry), sy = Math.sin(ry);
		const cz = Math.cos(rz), sz = Math.sin(rz);

		return [
			[cy * cz + sy * sx * sz, -cy * sz + sy * sx * cz, sy * cx],
			[cx * sz, cx * cz, -sx],
			[-sy * cz + cy * sx * sz, sy * sz + cy * sx * cz, cy * cx],
		];
	}

	function applyMat(m, v) {
		return [m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2], m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2], m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2]];
	}

	const GEOMETRY = {
		box(spec) {
			const size = spec.size || 1;
			const seg = Math.max(1, spec.segments || 1);
			const s = size / 2;
			const v = [];
			const f = [];

			for (let i = 0; i <= seg; i++) {
				for (let j = 0; j <= seg; j++) {
					const u = -s + (2 * s * i) / seg;
					const w = -s + (2 * s * j) / seg;
					v.push([u, w, s], [u, w, -s], [s, u, w], [-s, u, w], [u, s, w], [u, -s, w]);
				}
			}

			const stride = (seg + 1) * (seg + 1);
			const idx = (k, i, j) => k * stride + i * (seg + 1) + j;

			for (let i = 0; i < seg; i++) {
				for (let j = 0; j < seg; j++) {
					for (let k = 0; k < 6; k++) {
						const a = idx(k, i, j), b = idx(k, i + 1, j), c = idx(k, i + 1, j + 1), d = idx(k, i, j + 1);

						f.push([a, b, c], [a, c, d]);
					}
				}
			}

			return { vertices: v, faces: f };
		},

		sphere(spec) {
			const radius = spec.radius === undefined ? spec.size || 1 : spec.radius;
			const seg = Math.max(6, spec.segments || 16);
			const rings = Math.max(3, Math.round(seg / 2));
			const v = [];
			const f = [];

			for (let y = 0; y <= rings; y++) {
				const phi = (Math.PI * y) / rings;

				for (let x = 0; x <= seg; x++) {
					const theta = (2 * Math.PI * x) / seg;

					v.push([radius * Math.sin(phi) * Math.cos(theta), radius * Math.cos(phi), radius * Math.sin(phi) * Math.sin(theta)]);
				}
			}

			const idx = (y, x) => y * (seg + 1) + x;

			for (let y = 0; y < rings; y++) {
				for (let x = 0; x < seg; x++) f.push([idx(y, x), idx(y + 1, x), idx(y + 1, x + 1)], [idx(y, x), idx(y + 1, x + 1), idx(y, x + 1)]);
			}

			return { vertices: v, faces: f };
		},

		icosa(spec) {
			const radius = spec.radius === undefined ? spec.size || 1 : spec.radius;
			const detail = Math.max(0, Math.min(3, spec.detail === undefined ? 0 : spec.detail));
			const t = (1 + Math.sqrt(5)) / 2;
			let v = [
				[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
				[0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
				[t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
			].map(p => scale(norm(p), radius));
			let f = [
				[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
				[1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
				[3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
				[4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
			];

			for (let d = 0; d < detail; d++) {
				const cache = new Map();
				const mid = (a, b) => {
					const key = a < b ? a + '_' + b : b + '_' + a;

					if (cache.has(key)) return cache.get(key);

					const p = scale(norm(add(v[a], v[b])), radius);

					v.push(p);
					const id = v.length - 1;

					cache.set(key, id);
					return id;
				};
				const next = [];

				for (const [a, b, c] of f) {
					const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);

					next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
				}

				f = next;
			}

			return { vertices: v, faces: f };
		},

		torus(spec) {
			const radius = spec.radius === undefined ? spec.size || 1 : spec.radius;
			const tube = spec.tube === undefined ? radius * 0.35 : spec.tube;
			const tubularSeg = Math.max(6, spec.segments || 28);
			const radialSeg = Math.max(4, spec.rings || Math.round(tubularSeg * 0.7));
			const v = [];
			const f = [];

			for (let i = 0; i <= radialSeg; i++) {
				const u = (i / radialSeg) * Math.PI * 2;

				for (let j = 0; j <= tubularSeg; j++) {
					const w = (j / tubularSeg) * Math.PI * 2;

					v.push([(radius + tube * Math.cos(w)) * Math.cos(u), tube * Math.sin(w), (radius + tube * Math.cos(w)) * Math.sin(u)]);
				}
			}

			const idx = (i, j) => i * (tubularSeg + 1) + j;

			for (let i = 0; i < radialSeg; i++) {
				for (let j = 0; j < tubularSeg; j++) {
					f.push([idx(i, j), idx(i + 1, j), idx(i + 1, j + 1)], [idx(i, j), idx(i + 1, j + 1), idx(i, j + 1)]);
				}
			}

			return { vertices: v, faces: f };
		},

		cone(spec) {
			const radius = spec.radius === undefined ? spec.size || 1 : spec.radius;
			const height = spec.height === undefined ? radius * 2 : spec.height;
			const seg = Math.max(4, spec.segments || 24);
			const v = [[0, height / 2, 0], [0, -height / 2, 0]];
			const f = [];

			for (let i = 0; i <= seg; i++) {
				const a = (i / seg) * Math.PI * 2;

				v.push([radius * Math.cos(a), -height / 2, radius * Math.sin(a)]);
			}

			for (let i = 0; i < seg; i++) {
				f.push([0, 2 + i + 1, 2 + i], [1, 2 + i, 2 + i + 1]);
			}

			return { vertices: v, faces: f };
		},

		cylinder(spec) {
			const radius = spec.radius === undefined ? spec.size || 1 : spec.radius;
			const height = spec.height === undefined ? radius * 2 : spec.height;
			const seg = Math.max(4, spec.segments || 24);
			const v = [];
			const f = [];

			for (let y = 0; y <= 1; y++) {
				for (let i = 0; i <= seg; i++) {
					const a = (i / seg) * Math.PI * 2;

					v.push([radius * Math.cos(a), (y - 0.5) * height, radius * Math.sin(a)]);
				}
			}

			const idx = (y, i) => y * (seg + 1) + i;

			for (let i = 0; i < seg; i++) f.push([idx(0, i), idx(1, i), idx(1, i + 1)], [idx(0, i), idx(1, i + 1), idx(0, i + 1)]);

			return { vertices: v, faces: f };
		},

		plane(spec) {
			const width = spec.width || 10;
			const height = spec.height || 10;
			const grid = spec.segments || spec.grid;
			const ws = Math.max(1, (Array.isArray(grid) ? grid[0] : grid) || 1);
			const hs = Math.max(1, (Array.isArray(grid) ? grid[1] : grid) || ws);
			const v = [];
			const f = [];

			for (let i = 0; i <= ws; i++) {
				for (let j = 0; j <= hs; j++) v.push([-width / 2 + (width * i) / ws, 0, -height / 2 + (height * j) / hs]);
			}

			const idx = (i, j) => i * (hs + 1) + j;

			for (let i = 0; i < ws; i++) {
				for (let j = 0; j < hs; j++) f.push([idx(i, j), idx(i + 1, j), idx(i + 1, j + 1)], [idx(i, j), idx(i + 1, j + 1), idx(i, j + 1)]);
			}

			return { vertices: v, faces: f, dynamic: 'wave' };
		},
	};

	function buildGeometry(spec) {
		if (spec && spec.geometry && typeof spec.geometry === 'object' && Array.isArray(spec.geometry.vertices)) spec = spec.geometry;

		if (spec && Array.isArray(spec.vertices) && Array.isArray(spec.faces)) {
			return {
				vertices: spec.vertices.map(p => [Number(p[0]) || 0, Number(p[1]) || 0, Number(p[2]) || 0]),
				faces: spec.faces.map(t => [t[0] | 0, t[1] | 0, t[2] | 0]),
			};
		}

		const name = String(spec && spec.geometry ? spec.geometry : spec || 'icosa');
		const make = GEOMETRY[name];

		if (!make) throw new Error(`geometry "${name}" tidak ada. Pilih: ${Object.keys(GEOMETRY).join(', ')}`);

		return make(typeof spec === 'object' && spec ? spec : { size: spec });
	}

	RL.scene3d = function (opts) {
		opts = opts || {};

		const canvas = document.createElement('canvas');
		const W = RL.W;
		const H = RL.H;

		canvas.width = W;
		canvas.height = H;
		canvas.style.cssText = `position:absolute;left:0;top:0;width:${W}px;height:${H}px;display:block;`;
		canvas.setAttribute('data-rl', 'scene3d');

		const host = document.createElement('div');

		host.style.cssText = `position:absolute;inset:0;z-index:${opts.z === undefined ? 2 : opts.z};`;
		host.appendChild(canvas);

		if (RL.init) RL.init.__stage = true;

		const ctx = canvas.getContext('2d');
		const cam = {
			position: opts.position || [0, 1.6, 7],
			target: opts.target || [0, 0, 0],
			up: opts.up || [0, 1, 0],
			fov: opts.fov === undefined ? 55 : opts.fov,
			near: opts.near || 0.15,
		};
		const lights = {
			dir: norm(opts.lightDir || [-0.45, 0.75, 0.55]),
			ambient: opts.ambient === undefined ? 0.35 : opts.ambient,
			diffuse: opts.diffuse === undefined ? 0.75 : opts.diffuse,
		};
		const objects = [];
		const updates = [];
		let drawn = 0;

		const attach = () => {
			const stage = document.getElementById('rl-canvas') || document.body;

			stage.appendChild(host);
		};

		attach();

		function project(p, basis, focal) {
			const rel = sub(p, cam.position);
			const z = dot(rel, basis.forward);

			if (z < cam.near) return null;

			const k = focal / z;

			return {
				x: W / 2 + dot(rel, basis.right) * k,
				y: H / 2 - dot(rel, basis.up) * k,
				z,
			};
		}

		function basisFor() {
			const forward = norm(sub(cam.target, cam.position));
			let right = cross(forward, cam.up);

			if (len(right) < 1e-4) right = [1, 0, 0];

			right = norm(right);

			return { forward, right, up: norm(cross(right, forward)) };
		}

		function addObject(spec) {
			const geo = buildGeometry(spec);
			const obj = {
				geometry: geo.vertices.map(v => v.slice()),
				base: geo.vertices.map(v => v.slice()),
				faces: geo.faces,
				dynamic: geo.dynamic || null,
				position: spec.position || [0, 0, 0],
				rotation: spec.rotation || [0, 0, 0],
				scale: Array.isArray(spec.scale) ? spec.scale : [spec.scale || 1, spec.scale || 1, spec.scale || 1],
				color: hexToRgb(spec.color, RL.theme.accent),
				wireframe: !!spec.wireframe,
				opacity: spec.opacity === undefined ? 1 : spec.opacity,
				shade: spec.shade !== false,
				twoSided: spec.twoSided !== false,
				lineWidth: spec.lineWidth || 2,
				amp: spec.amp === undefined ? 0.6 : spec.amp,
				freq: spec.frequency || 0.6,
				speed: spec.speed === undefined ? 1 : spec.speed,
				fog: spec.fog !== false,
				rotSpeed: spec.rotationSpeed || null,
				onFrame: spec.onFrame || null,
				visible: true,
			};

			objects.push(obj);
			return obj;
		}

		function draw(t) {
			ctx.clearRect(0, 0, W, H);

			const basis = basisFor();
			const focal = H / 2 / Math.tan(((cam.fov / 2) * Math.PI) / 180);
			const polys = [];

			drawn = 0;

			for (const obj of objects) {
				if (!obj.visible) continue;

				let rot = obj.rotation;

				if (obj.rotSpeed) rot = [obj.rotation[0] + obj.rotSpeed[0] * t, obj.rotation[1] + obj.rotSpeed[1] * t, obj.rotation[2] + obj.rotSpeed[2] * t];
				if (obj.onFrame) obj.onFrame(obj, t);

				const matrix = rotMatrix(rot);
				const verts = obj.geometry;
				const world = new Array(verts.length);

				if (obj.dynamic === 'wave') {
					for (let i = 0; i < verts.length; i++) {
						const b = obj.base[i];
						const x = b[0];
						const z = b[2];

						verts[i][1] = b[1] + Math.sin(x * obj.freq * 1.6 + t * obj.speed * 1.6) * obj.amp * 0.5 + Math.cos(z * obj.freq - t * obj.speed * 0.9) * obj.amp * 0.5;
					}
				}

				for (let i = 0; i < verts.length; i++) {
					const v = verts[i];
					const local = applyMat(matrix, [v[0] * obj.scale[0], v[1] * obj.scale[1], v[2] * obj.scale[2]]);

					world[i] = add(local, obj.position);
				}

				const projected = world.map(p => project(p, basis, focal));

				for (const face of obj.faces) {
					const pa = projected[face[0]];
					const pb = projected[face[1]];
					const pc = projected[face[2]];

					if (!pa || !pb || !pc) continue;

					const wa = world[face[0]];
					const wb = world[face[1]];
					const wc = world[face[2]];
					const normal = norm(cross(sub(wb, wa), sub(wc, wa)));
					const toCam = norm(sub(cam.position, wa));
					const facing = dot(normal, toCam);

					if (!obj.twoSided && facing <= 0) continue;

					const n = facing < 0 ? scale(normal, -1) : normal;
					const lambert = Math.max(0, dot(n, lights.dir));
					const intensity = obj.shade ? lights.ambient + lights.diffuse * lambert : 1;
					const depth = (pa.z + pb.z + pc.z) / 3;

					polys.push({ obj, pa, pb, pc, intensity, depth });
				}
			}

			polys.sort((a, b) => b.depth - a.depth);

			const fogNear = opts.fogNear === undefined ? 8 : opts.fogNear;
			const fogFar = opts.fogFar === undefined ? 26 : opts.fogFar;
			const fogColor = hexToRgb(opts.fogColor, '#070b16');

			for (const p of polys) {
				const { obj, pa, pb, pc, intensity, depth } = p;
				const fogT = clamp01((depth - fogNear) / Math.max(0.001, fogFar - fogNear));
				const mix = obj.fog && opts.fog !== false ? fogT * 0.85 : 0;
				const r = Math.round(obj.color[0] * intensity * (1 - mix) + fogColor[0] * mix);
				const g = Math.round(obj.color[1] * intensity * (1 - mix) + fogColor[1] * mix);
				const b = Math.round(obj.color[2] * intensity * (1 - mix) + fogColor[2] * mix);

				ctx.beginPath();
				ctx.moveTo(pa.x, pa.y);
				ctx.lineTo(pb.x, pb.y);
				ctx.lineTo(pc.x, pc.y);
				ctx.closePath();

				if (obj.wireframe) {
					ctx.strokeStyle = `rgba(${r},${g},${b},${obj.opacity})`;
					ctx.lineWidth = obj.lineWidth;
					ctx.stroke();
				} else {
					ctx.fillStyle = `rgba(${r},${g},${b},${obj.opacity})`;
					ctx.fill();
				}
			}

			drawn = polys.length;

			for (const fn of updates) {
				try {
					fn(t);
				} catch (e) {
					console.error('scene3d update: ' + e.message);
				}
			}
		}

		function clamp01(v) {
			return Math.max(0, Math.min(1, v));
		}

		RL.onFrame(draw);

		const api = {
			canvas,
			ctx,
			camera: cam,
			lights,
			mesh(spec) {
				return addObject(spec || {});
			},
			lines(spec) {
				spec = spec || {};
				const points = (spec.points || []).map(p => [p[0], p[1], p[2]]);
				const faces = [];
				const count = points.length;

				for (let i = 0; i < count - 1; i++) faces.push([i, i + 1, i + 1]);
				if (spec.closed && count > 2) faces.push([count - 1, 0, 0]);

				return addObject({
					vertices: points,
					faces,
					color: spec.color,
					wireframe: true,
					lineWidth: spec.width || 3,
					opacity: spec.opacity,
					position: spec.position,
					shade: false,
				});
			},
			cloud(spec) {
				spec = spec || {};
				const rand = RL.rand(spec.seed || 11);
				const count = spec.count || 120;
				const spread = spec.spread || 6;
				const v = [];

				for (let i = 0; i < count; i++) v.push([(rand() - 0.5) * spread, (rand() - 0.5) * spread, (rand() - 0.5) * spread]);

				return addObject({ vertices: v, faces: [], color: spec.color, position: spec.position, wireframe: true });
			},
			remove(obj) {
				const i = objects.indexOf(obj);

				if (i !== -1) objects.splice(i, 1);
			},
			clear() {
				objects.length = 0;
			},
			onUpdate(fn) {
				updates.push(fn);
			},
			setCamera(next) {
				Object.assign(cam, next || {});
			},
			lookAt(target) {
				cam.target = target;
			},
			stats() {
				return { objects: objects.length, faces: objects.reduce((n, o) => n + o.faces.length, 0), drawn };
			},
			destroy() {
				objects.length = 0;
				host.remove();
			},
		};

		return api;
	};

	RL.GEOMETRY = Object.keys(GEOMETRY);
})(window);