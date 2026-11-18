/*
 * renderly scene kit (RL)
 * Coordinate space is always 1080x1920 (or 1080x1080 / 1920x1080 by aspect).
 * Everything is deterministic: the master GSAP timeline is paused and the
 * capture engine scrubs it with tl.totalTime(t).
 */
(function (global) {
	'use strict';

	const FALLBACK_THEME = {
		bg: 'linear-gradient(160deg,#0B1220 0%,#101B33 55%,#0B1220 100%)',
		ink: '#F8FAFC',
		muted: 'rgba(226,232,240,.62)',
		accent: '#5EEAD4',
		accent2: '#818CF8',
		card: 'rgba(255,255,255,.06)',
		border: 'rgba(255,255,255,.14)',
		shadow: 'rgba(0,0,0,.45)',
	};

	const SAFE = { top: 200, bottom: 1520, left: 72, right: 1008 };

	const RL = {
		W: 1080,
		H: 1920,
		dur: 10,
		mode: '2d',
		theme: { ...FALLBACK_THEME },
		safe: SAFE,
		fx: {},
	};

	const state = {
		root: null,
		canvas: null,
		tl: null,
		frames: [],
		ready: false,
		pending: 0,
		silent: false,
		seen: [],
		usedFx: {},
	};

	const meta = global.__rlMeta || {};

	RL.W = Number(meta.width) || 1080;
	RL.H = Number(meta.height) || 1920;
	RL.dur = Number(meta.dur) || 10;
	RL.mode = meta.mode || '2d';
	RL.theme = { ...FALLBACK_THEME, ...(meta.theme || {}) };
	RL.fonts = meta.fonts || '/assets/fonts';
	RL.topic = meta.topic || '';

	const px = n => (typeof n === 'number' ? n + 'px' : n === undefined || n === null ? '' : String(n));
	const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
	const byId = id => document.getElementById(id);

	function node(tag, css, html) {
		const el = document.createElement(tag);

		if (css) Object.assign(el.style, css);
		if (html !== undefined) el.innerHTML = html;
		return el;
	}

	function ebrand(el, kind) {
		el.dataset.rl = kind;
		return el;
	}

	function fitText(el) {
		let size = parseFloat(el.style.fontSize) || 72;
		let guard = 40;

		while (guard-- > 0) {
			if (el.scrollWidth - el.clientWidth <= 2) return;
			if (size <= 26) return;

			size *= 0.94;
			el.style.fontSize = size + 'px';
		}
	}

	function canvas() {
		if (!state.canvas) throw new Error('RL.init() belum dipanggil');
		return state.canvas;
	}

	RL.init = function (opts) {
		opts = opts || {};

		if (opts.theme) RL.theme = { ...RL.theme, ...opts.theme };
		if (opts.dur) RL.dur = Number(opts.dur);
		if (opts.mode) RL.mode = opts.mode;

		const theme = RL.theme;
		const style = document.createElement('style');

		style.textContent = `
			@font-face{font-family:'RL Display';src:url('${RL.fonts}/Poppins-Bold.ttf') format('truetype');font-weight:800;}
			@font-face{font-family:'RL Display';src:url('${RL.fonts}/Poppins-SemiBold.ttf') format('truetype');font-weight:600;}
			@font-face{font-family:'RL Text';src:url('${RL.fonts}/Poppins-Medium.ttf') format('truetype');font-weight:500;}
			@font-face{font-family:'RL Text';src:url('${RL.fonts}/Poppins-Regular.ttf') format('truetype');font-weight:400;}
			html,body{margin:0;padding:0;background:#000;}
			#rl-root{position:fixed;inset:0;overflow:hidden;background:${theme.bg};}
			#rl-canvas{position:absolute;top:0;left:0;width:${RL.W}px;height:${RL.H}px;transform-origin:top left;overflow:hidden;
				font-family:'RL Text','Roboto',sans-serif;color:${theme.ink};-webkit-font-smoothing:antialiased;}
			#rl-canvas *{box-sizing:border-box;}
			.rl-layer{position:absolute;inset:0;}
			.rl-text{position:absolute;margin:0;font-family:'RL Display','Roboto',sans-serif;}
			.rl-word{display:inline-block;will-change:transform,opacity;}
			.rl-center{left:0;right:0;margin-left:auto;margin-right:auto;}
		`;

		document.head.appendChild(style);

		state.root = node('div', null);
		state.root.id = 'rl-root';
		state.canvas = node('div', null);
		state.canvas.id = 'rl-canvas';
		state.root.appendChild(state.canvas);
		document.body.appendChild(state.root);

		const fit = () => {
			const sx = global.innerWidth / RL.W;
			const sy = global.innerHeight / RL.H;

			state.canvas.style.transform = `scale(${Math.min(sx, sy)})`;
		};

		fit();
		global.addEventListener('resize', fit);

		state.tl = global.gsap ? global.gsap.timeline({ paused: true }) : null;
		RL.tl = state.tl;

		RL.bg(opts.bg);
		return RL;
	};

	RL.layer = function (opts) {
		opts = opts || {};
		const el = node('div', { position: 'absolute', inset: '0' });

		el.className = 'rl-layer';
		if (opts.z !== undefined) el.style.zIndex = String(opts.z);
		if (opts.opacity !== undefined) el.style.opacity = String(opts.opacity);
		canvas().appendChild(el);
		return el;
	};

	RL.bg = function (spec) {
		spec = spec || {};
		const theme = RL.theme;
		const el = node('div', {
			position: 'absolute',
			inset: '0',
			zIndex: '0',
			background: spec.gradient || spec.background || (spec.color ? spec.color : theme.bg),
			overflow: 'hidden',
		});

		if (spec.image) {
			const img = node('img', { width: '100%', height: '100%', objectFit: 'cover', opacity: String(spec.opacity === undefined ? 1 : spec.opacity) });

			img.src = spec.image;
			img.style.position = 'absolute';
			img.style.inset = '0';
			el.appendChild(img);
			state.pending++;

			const done = () => {
				state.pending--;
			};

			img.onload = done;
			img.onerror = () => {
				done();
				console.warn('gambar gagal dimuat: ' + spec.image);
			};

			if (spec.kenburns !== false && state.tl) {
				state.tl.fromTo(img, { scale: 1 }, { scale: 1.12, duration: RL.dur, ease: 'none' }, 0);
			}
		}

		canvas().appendChild(el);
		return el;
	};

	RL.text = function (spec) {
		spec = spec || {};
		const theme = RL.theme;
		const w = num(spec.w, RL.W - 144);
		const x = spec.x === undefined || spec.x === 'center' ? (RL.W - w) / 2 : num(spec.x, 72);
		const size = num(spec.size, 72);
		const el = node('div', {
			position: 'absolute',
			left: px(x),
			top: px(num(spec.y, 600)),
			width: px(w),
			fontSize: px(size),
			lineHeight: String(num(spec.lineHeight, 1.12)),
			fontWeight: String(num(spec.weight, 800)),
			color: spec.color || theme.ink,
			textAlign: spec.align || 'center',
			letterSpacing: px(num(spec.letterSpacing, 0)),
			textTransform: spec.uppercase ? 'uppercase' : 'none',
			textShadow: spec.shadow === false ? 'none' : `0 ${Math.round(size * 0.06)}px ${Math.round(size * 0.18)}px ${theme.shadow}`,
			zIndex: String(num(spec.z, 10)),
			opacity: spec.opacity === undefined ? '1' : String(spec.opacity),
			whiteSpace: 'pre-wrap',
			wordBreak: 'break-word',
			fontFamily: spec.font === 'text' ? "'RL Text','Roboto',sans-serif" : "'RL Display','Roboto',sans-serif",
		});

		el.className = 'rl-text';
		ebrand(el, 'text');

		if (spec.gradient) {
			el.style.backgroundImage = spec.gradient;
			el.style.webkitBackgroundClip = 'text';
			el.style.backgroundClip = 'text';
			el.style.color = 'transparent';
			el.style.textShadow = 'none';
		}

		if (spec.stroke) {
			el.style.webkitTextStroke = `${spec.stroke.width || 2}px ${spec.stroke.color || '#000'}`;
			el.style.paintOrder = 'stroke';
		}

		el.textContent = String(spec.text === undefined ? '' : spec.text);
		canvas().appendChild(el);

		if (spec.fit !== false) fitText(el);
		return el;
	};

	RL.card = function (spec) {
		spec = spec || {};
		const theme = RL.theme;
		const el = node('div', {
			position: 'absolute',
			left: px(num(spec.x, 72)),
			top: px(num(spec.y, 500)),
			width: px(num(spec.w, RL.W - 144)),
			height: spec.h === undefined ? 'auto' : px(spec.h),
			borderRadius: px(num(spec.radius, 44)),
			background: spec.fill || theme.card,
			border: `${spec.borderWidth || 2}px solid ${spec.border || theme.border}`,
			backdropFilter: spec.blur === false ? 'none' : `blur(${num(spec.blur, 14)}px)`,
			boxShadow: spec.shadow === false ? 'none' : `0 30px 80px ${theme.shadow}`,
			zIndex: String(num(spec.z, 5)),
			overflow: 'hidden',
			padding: px(num(spec.pad, 0)),
			opacity: spec.opacity === undefined ? '1' : String(spec.opacity),
		});

		ebrand(el, 'card');
		canvas().appendChild(el);
		return el;
	};

	RL.chip = function (spec) {
		spec = spec || {};
		const theme = RL.theme;
		const el = node('div', {
			position: 'absolute',
			left: px(num(spec.x, 72)),
			top: px(num(spec.y, 300)),
			padding: `${num(spec.padY, 14)}px ${num(spec.padX, 30)}px`,
			borderRadius: '999px',
			background: spec.fill || 'rgba(255,255,255,.08)',
			border: `${spec.borderWidth || 2}px solid ${spec.border || theme.border}`,
			color: spec.color || theme.accent,
			fontFamily: "'RL Display','Roboto',sans-serif",
			fontWeight: String(num(spec.weight, 600)),
			fontSize: px(num(spec.size, 34)),
			letterSpacing: px(num(spec.letterSpacing, 2)),
			textTransform: spec.uppercase === false ? 'none' : 'uppercase',
			zIndex: String(num(spec.z, 12)),
			whiteSpace: 'nowrap',
		});

		el.textContent = String(spec.text === undefined ? '' : spec.text);
		ebrand(el, 'text');
		canvas().appendChild(el);
		return el;
	};

	RL.stat = function (spec) {
		spec = spec || {};
		const theme = RL.theme;
		const value = RL.text({
			text: spec.value,
			x: spec.x,
			y: spec.y,
			w: spec.w,
			size: num(spec.size, 190),
			color: spec.color || theme.accent,
			align: spec.align || 'center',
			weight: 800,
			z: spec.z,
		});

		const label = RL.text({
			text: spec.label,
			x: spec.x,
			y: num(spec.y, 600) + num(spec.size, 190) * 0.98,
			w: spec.w,
			size: num(spec.labelSize, 40),
			color: spec.labelColor || theme.muted,
			align: spec.align || 'center',
			weight: 500,
			font: 'text',
			z: spec.z,
		});

		return { value, label, el: value };
	};

	RL.shape = function (spec) {
		spec = spec || {};
		const theme = RL.theme;
		const type = spec.type || 'rect';
		const size = num(spec.size, 240);
		const w = num(spec.w, type === 'rect' ? 320 : size);
		const h = num(spec.h, type === 'rect' ? 180 : size);
		const el = node('div', {
			position: 'absolute',
			left: px(num(spec.x, (RL.W - w) / 2)),
			top: px(num(spec.y, 700)),
			width: px(w),
			height: px(h),
			zIndex: String(num(spec.z, 4)),
			opacity: spec.opacity === undefined ? '1' : String(spec.opacity),
			transform: spec.rotate ? `rotate(${spec.rotate}deg)` : 'none',
			background: spec.fill || theme.accent,
		});

		if (type === 'circle' || type === 'dot') el.style.borderRadius = '50%';
		if (type === 'pill') el.style.borderRadius = px(Math.min(w, h) / 2);
		if (type === 'rect') el.style.borderRadius = px(num(spec.radius, 28));
		if (type === 'triangle') {
			el.style.background = 'transparent';
			el.style.width = '0';
			el.style.height = '0';
			el.style.borderLeft = `${w / 2}px solid transparent`;
			el.style.borderRight = `${w / 2}px solid transparent`;
			el.style.borderBottom = `${h}px solid ${spec.fill || theme.accent}`;
		}

		if (spec.blur) el.style.filter = `blur(${spec.blur}px)`;
		if (spec.stroke) el.style.border = `${spec.stroke}px solid ${spec.strokeColor || theme.ink}`;
		ebrand(el, 'shape');
		canvas().appendChild(el);
		return el;
	};

	RL.svg = function (spec) {
		spec = spec || {};
		const wrap = node('div', {
			position: 'absolute',
			left: px(num(spec.x, 72)),
			top: px(num(spec.y, 600)),
			width: px(num(spec.w, RL.W - 144)),
			height: px(num(spec.h, 600)),
			zIndex: String(num(spec.z, 8)),
			opacity: spec.opacity === undefined ? '1' : String(spec.opacity),
		});

		wrap.innerHTML = String(spec.markup || '');
		ebrand(wrap, 'svg');

		const svg = wrap.querySelector('svg');

		if (svg) {
			svg.setAttribute('width', '100%');
			svg.setAttribute('height', '100%');
			if (!svg.getAttribute('viewBox')) svg.setAttribute('viewBox', `0 0 ${num(spec.w, RL.W - 144)} ${num(spec.h, 600)}`);
		}

		canvas().appendChild(wrap);
		return svg || wrap;
	};

	RL.icon = function (spec) {
		spec = spec || {};
		const glyph = String(spec.glyph || spec.name || '•');
		const size = num(spec.size, 120);
		const el = node('div', {
			position: 'absolute',
			left: px(num(spec.x, (RL.W - size) / 2)),
			top: px(num(spec.y, 700)),
			width: px(size),
			height: px(size),
			fontSize: px(size * 0.86),
			lineHeight: px(size),
			textAlign: 'center',
			color: spec.color || RL.theme.ink,
			zIndex: String(num(spec.z, 9)),
			opacity: spec.opacity === undefined ? '1' : String(spec.opacity),
		});

		el.textContent = glyph;
		ebrand(el, 'icon');
		canvas().appendChild(el);
		return el;
	};

	RL.img = function (spec) {
		spec = spec || {};
		const el = node('img', {
			position: 'absolute',
			left: px(num(spec.x, 72)),
			top: px(num(spec.y, 500)),
			width: px(num(spec.w, RL.W - 144)),
			height: spec.h === undefined ? 'auto' : px(spec.h),
			objectFit: spec.fit || 'cover',
			borderRadius: px(num(spec.radius, 32)),
			zIndex: String(num(spec.z, 6)),
			opacity: spec.opacity === undefined ? '1' : String(spec.opacity),
		});

		state.pending++;
		el.onload = () => {
			state.pending--;
		};
		el.onerror = () => {
			state.pending--;
			console.warn('gambar gagal dimuat: ' + spec.src);
		};
		el.src = spec.src;
		canvas().appendChild(el);
		return el;
	};

	RL.arrow = function (spec) {
		spec = spec || {};
		const [x1, y1] = spec.from || [200, 600];
		const [x2, y2] = spec.to || [880, 1000];
		const color = spec.color || RL.theme.accent;
		const width = num(spec.width, 8);
		const head = num(spec.head, width * 3.2);
		const dx = x2 - x1;
		const dy = y2 - y1;
		const len = Math.hypot(dx, dy);
		const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
		const wrap = node('div', {
			position: 'absolute',
			left: px(x1),
			top: px(y1),
			width: px(len),
			height: px(width),
			transformOrigin: 'left center',
			transform: `rotate(${ang}deg)`,
			zIndex: String(num(spec.z, 7)),
			opacity: spec.opacity === undefined ? '1' : String(spec.opacity),
		});
		const bar = node('div', {
			position: 'absolute',
			inset: '0',
			background: color,
			borderRadius: px(width / 2),
			boxShadow: spec.glow === false ? 'none' : `0 0 ${width * 2}px ${color}`,
		});
		const tip = node('div', {
			position: 'absolute',
			right: px(-head * 0.1),
			top: '50%',
			width: '0',
			height: '0',
			transform: `translateY(-50%) rotate(90deg)`,
			borderLeft: `${head * 0.6}px solid transparent`,
			borderRight: `${head * 0.6}px solid transparent`,
			borderBottom: `${head}px solid ${color}`,
		});

		wrap.appendChild(bar);
		wrap.appendChild(tip);
		canvas().appendChild(wrap);
		return wrap;
	};

	RL.bar = function (spec) {
		spec = spec || {};
		const theme = RL.theme;
		const w = num(spec.w, RL.W - 144);
		const h = num(spec.h, 22);
		const track = node('div', {
			position: 'absolute',
			left: px(num(spec.x, 72)),
			top: px(num(spec.y, 900)),
			width: px(w),
			height: px(h),
			borderRadius: px(h / 2),
			background: spec.track || 'rgba(255,255,255,.12)',
			overflow: 'hidden',
			zIndex: String(num(spec.z, 8)),
		});
		const fill = node('div', {
			position: 'absolute',
			left: '0',
			top: '0',
			height: '100%',
			width: Math.round(clamp01(num(spec.value, 0.5)) * 100) + '%',
			background: spec.color || theme.accent,
			borderRadius: px(h / 2),
		});

		track.appendChild(fill);
		canvas().appendChild(track);
		return {
			el: track,
			fill,
			set(v) {
				fill.style.width = clamp01(v) * 100 + '%';
			},
		};
	};

	function clamp01(v) {
		return Math.max(0, Math.min(1, Number(v) || 0));
	}

	RL.ring = function (spec) {
		spec = spec || {};
		const theme = RL.theme;
		const size = num(spec.size, 320);
		const stroke = num(spec.stroke, 24);
		const r = size / 2 - stroke / 2;
		const c = 2 * Math.PI * r;
		const color = spec.color || theme.accent;
		const track = spec.track || 'rgba(255,255,255,.12)';
		const svg = RL.svg({
			x: num(spec.x, (RL.W - size) / 2),
			y: num(spec.y, 700),
			w: size,
			h: size,
			z: spec.z,
			markup: `<svg viewBox="0 0 ${size} ${size}">
				<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${track}" stroke-width="${stroke}"/>
				<circle class="rl-ring-fill" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}"
					stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - clamp01(num(spec.value, 0.5)))}"
					transform="rotate(-90 ${size / 2} ${size / 2})"/>
			</svg>`,
		});
		const fillCircle = svg.querySelector ? svg.querySelector('.rl-ring-fill') : null;

		return {
			el: svg,
			set(v) {
				if (fillCircle) fillCircle.setAttribute('stroke-dashoffset', String(c * (1 - clamp01(v))));
			},
		};
	};

	RL.split = function (el) {
		const text = el.textContent || '';
		const parts = text.split(/(\s+)/);

		el.textContent = '';

		const out = [];

		for (const part of parts) {
			if (!part.trim()) {
				el.appendChild(document.createTextNode(part));
				continue;
			}

			const span = document.createElement('span');

			span.className = 'rl-word';
			span.textContent = part;
			el.appendChild(span);
			out.push(span);
		}

		return out;
	};

	RL.anim = function (targets, vars, at) {
		if (!state.tl) return null;

		return state.tl.to(targets, { ...vars }, num(at, 0));
	};

	RL.from = function (targets, vars, at) {
		if (!state.tl) return null;

		return state.tl.from(targets, { ...vars }, num(at, 0));
	};

	RL.fromTo = function (targets, fromVars, toVars, at) {
		if (!state.tl) return null;

		return state.tl.fromTo(targets, { ...fromVars }, { ...toVars }, num(at, 0));
	};

	RL.reveal = function (targets, at, opts) {
		opts = opts || {};
		const el = targets;
		const from = { opacity: 0, y: num(opts.y, 60) };

		if (opts.scale) from.scale = opts.scale;
		if (el && el.style) el.style.opacity = '0';

		return state.tl
			? state.tl.fromTo(el, from, { opacity: 1, y: 0, scale: 1, duration: num(opts.dur, 0.7), ease: opts.ease || 'power3.out' }, num(at, 0))
			: null;
	};

	RL.stagger = function (targets, at, opts) {
		opts = opts || {};
		const list = Array.isArray(targets) ? targets : RL.split(targets);

		for (const t of list) if (t && t.style) t.style.opacity = '0';

		return state.tl
			? state.tl.fromTo(
					list,
					{ opacity: 0, y: num(opts.y, 70) },
					{ opacity: 1, y: 0, duration: num(opts.dur, 0.55), ease: opts.ease || 'power3.out', stagger: num(opts.stagger, 0.07) },
					num(at, 0),
				)
			: null;
	};

	RL.onFrame = function (fn) {
		state.frames.push(fn);
	};

	RL.three = function (THREE, opts) {
		opts = opts || {};
		const renderer = new THREE.WebGLRenderer({ antialias: opts.antialias !== false, alpha: opts.alpha !== false, preserveDrawingBuffer: true });
		const camera = new THREE.PerspectiveCamera(num(opts.fov, 40), RL.W / RL.H, num(opts.near, 0.1), num(opts.far, 400));
		const scene = new THREE.Scene();

		renderer.setPixelRatio(1);
		renderer.setSize(RL.W, RL.H, false);
		renderer.domElement.style.cssText = `position:absolute;left:0;top:0;width:${RL.W}px;height:${RL.H}px;display:block;`;

		const host = opts.host || canvas();

		if (host !== canvas()) host.appendChild(renderer.domElement);
		else {
			const layer = node('div', { position: 'absolute', inset: '0', zIndex: String(num(opts.z, 2)) });

			layer.appendChild(renderer.domElement);
			canvas().appendChild(layer);
		}

		camera.position.set(num(opts.cameraZ, 7), 0, 7);

		RL.onFrame(() => renderer.render(scene, camera));

		return { THREE, renderer, scene, camera, canvas: renderer.domElement };
	};

	RL.lights = function (THREE, scene, opts) {
		opts = opts || {};
		const amb = new THREE.AmbientLight(0xffffff, num(opts.ambient, 0.7));
		const key = new THREE.DirectionalLight(0xffffff, num(opts.key, 2.2));
		const rim = new THREE.DirectionalLight(opts.rimColor === undefined ? 0x66ccff : opts.rimColor, num(opts.rim, 2.4));

		key.position.set(4, 6, 8);
		rim.position.set(-6, -3, -5);
		scene.add(amb, key, rim);

		return { amb, key, rim };
	};

	RL.rand = function (seed) {
		let a = Math.floor(Math.abs(Number(seed) || 1)) || 1;

		return function () {
			a += 0x6d2b79f5;
			let t = a;

			t = Math.imul(t ^ (t >>> 15), t | 1);
			t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
	};

	RL.fx.vignette = function (strength) {
		state.usedFx.vignette = true;
		const el = node('div', {
			position: 'absolute',
			inset: '0',
			zIndex: '60',
			pointerEvents: 'none',
			background: `radial-gradient(120% 90% at 50% 45%, transparent 45%, rgba(0,0,0,${num(strength, 0.55)}) 100%)`,
		});

		canvas().appendChild(el);
		return el;
	};

	RL.fx.grain = function (opacity) {
		state.usedFx.grain = true;
		const el = node('div', {
			position: 'absolute',
			inset: '0',
			zIndex: '61',
			pointerEvents: 'none',
			opacity: String(num(opacity, 0.1)),
			backgroundImage:
				"url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3'/></filter><rect width='160' height='160' filter='url(%23n)' opacity='0.6'/></svg>\")",
		});

		canvas().appendChild(el);
		return el;
	};

	RL.fx.blobs = function (spec) {
		spec = spec || {};
		state.usedFx.blobs = true;
		const theme = RL.theme;
		const rand = RL.rand(num(spec.seed, 7));
		const colors = spec.colors || [theme.accent, theme.accent2];
		const layer = RL.layer({ z: 1 });

		for (let i = 0; i < num(spec.count, 3); i++) {
			const size = 420 + rand() * 520;
			const color = colors[i % colors.length];
			const el = node('div', {
				position: 'absolute',
				left: px(rand() * (RL.W - size)),
				top: px(rand() * (RL.H - size)),
				width: px(size),
				height: px(size),
				borderRadius: '50%',
				background: `radial-gradient(closest-side, ${color}, transparent 72%)`,
				opacity: String(num(spec.opacity, 0.16)),
			});

			layer.appendChild(el);

			if (state.tl) {
				state.tl.to(el, { x: (rand() - 0.5) * 240, y: (rand() - 0.5) * 240, duration: RL.dur, ease: 'sine.inOut' }, 0);
			}
		}

		return layer;
	};

	RL.report = function () {
		const items = [];
		const warnings = [];
		const root = canvas();
		for (const el of root.querySelectorAll('[data-rl="text"],[data-rl="card"],[data-rl="svg"],[data-rl="icon"]')) {
			const box = {
				kind: el.dataset.rl,
				text: (el.textContent || '').trim().slice(0, 60),
				x: Math.round(el.offsetLeft),
				y: Math.round(el.offsetTop),
				w: Math.round(el.offsetWidth),
				h: Math.round(el.offsetHeight),
			};

			items.push(box);

			if (box.kind !== 'text' && box.kind !== 'icon') continue;

			const label = `"${box.text}"`;

			if (box.y < 0 || box.y + box.h > RL.H) warnings.push(`keluar canvas vertikal: ${label} y=${box.y} h=${box.h}`);
			if (box.x < 0 || box.x + box.w > RL.W + 2) warnings.push(`keluar canvas horizontal: ${label} x=${box.x} w=${box.w}`);
			if (box.kind === 'text' && (box.y + box.h) > SAFE.bottom) warnings.push(`kena area caption (${SAFE.bottom}-${RL.H}): ${label} bottom=${box.y + box.h}`);
			if (box.kind === 'text' && el.scrollWidth - el.clientWidth > 2) warnings.push(`teks melebar keluar kotak: ${label} client=${el.clientWidth} scroll=${el.scrollWidth}`);
		}

		return { ok: warnings.length === 0, warnings: [...new Set(warnings)].slice(0, 12), items: items.slice(0, 40), dur: RL.dur, mode: RL.mode };
	};

	RL.finish = function () {
		if (state.ready) return;

		if (!state.usedFx.vignette) RL.fx.vignette(0.42);
		if (!state.usedFx.grain) RL.fx.grain(0.05);

		const done = () => {
			state.ready = true;
			global.__rl.ready = true;
		};

		if (document.fonts && document.fonts.ready) document.fonts.ready.then(done);
		else done();
	};

	RL.render = function (t) {
		const time = Math.max(0, Number(t) || 0);

		if (state.tl) {
			try {
				state.tl.totalTime(time);
			} catch (e) {
				console.error('timeline error: ' + e.message);
			}
		}

		for (const fn of state.frames) {
			try {
				fn(time);
			} catch (e) {
				console.error('onFrame error: ' + e.message);
			}
		}
	};

	RL.info = function () {
		return {
			ready: state.ready,
			dur: RL.dur,
			mode: RL.mode,
			pendingImages: state.pending,
			timelineDuration: state.tl ? state.tl.duration() : 0,
			frames: state.frames.length,
			gsap: !!global.gsap,
		};
	};

	global.__rl = {
		ready: false,
		dur: RL.dur,
		render: RL.render,
		report: RL.report,
		info: RL.info,
	};

	global.RL = RL;
})(window);