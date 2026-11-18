# Renderly Scene SDK (`RL`)

A scene is a single self-contained HTML file. The render engine loads it in headless Chromium,
calls `window.__rl.render(t)` for every frame (`t` = detik, 0 → durasi), and screenshots the viewport.
Everything must therefore be **deterministic**: the same `t` always produces the same frame.

## Aturan wajib

1. Ukuran panggung desain selalu `RL.W` × `RL.H` = 1080×1920 (9:16), 1080×1080 (1:1), 1920×1080 (16:9).
   Resolusi output boleh 720p atau 1080p — engine men-scale sendiri, jadi posisi selalu dalam piksel desain.
2. Animasi **hanya** lewat `RL.tl` (timeline GSAP yang di-pause) memakai helper `RL.anim`, `RL.from`,
   `RL.fromTo`, `RL.reveal`, `RL.stagger`. Jangan pernah memanggil `gsap.to()` langsung, jangan pakai
   `requestAnimationFrame`, `setTimeout`, `setInterval`, CSS `animation`, atau CSS `transition`.
3. Untuk 3D / fisika kustom pakai `RL.onFrame((t) => { ... })` — dipanggil setiap frame dengan `t` absolut.
4. Tanpa akses internet. Hanya aset lokal: `/assets/...`, `/src/render/kit/...`, `/node_modules/...`.
5. Tanpa `Math.random()`. Pakai `RL.rand(seed)` yang deterministik.
6. Teks narasi (subtitle) **sudah dibakar otomatis** oleh pipeline di area bawah (`y > 1400`).
   Scene hanya membuat judul / label / angka / visual. Jangan menaruh teks penting di `y > 1400`.
7. Scene **wajib** diakhiri `RL.finish();`
8. Jangan menulis emoji. Gunakan tipografi, bentuk, SVG, atau angka.
9. Margin aman: `x` 72–1008, `y` 180–1400. Jangan ada elemen penting keluar dari area itu.
10. Tidak ada suara di scene. Audio ditambahkan pipeline.

## Boilerplate

```html
<!doctype html>
<html lang="id">
	<head>
		<meta charset="utf-8" />
		<script src="/node_modules/gsap/dist/gsap.min.js"></script>
		<script src="/src/render/kit/rl-kit.js"></script>
	</head>
	<body>
		<script>
			RL.init();
			// ... visual ...
			RL.finish();
		</script>
	</body>
</html>
```

Versi 3D hanya menambah satu script sebelum `RL.finish()`:

```html
<script src="/node_modules/gsap/dist/gsap.min.js"></script>
<script src="/src/render/kit/rl-kit.js"></script>
<script src="/src/render/kit/rl-3d.js"></script>
...
const view = RL.scene3d({ fov: 52 });
RL.finish();
```

## State & konteks

| Properti | Isi |
| --- | --- |
| `RL.W`, `RL.H` | ukuran panggung (1080×1920 default) |
| `RL.dur` | durasi scene (detik) — sama dengan durasi audio narasi |
| `RL.mode` | `'2d'` atau `'3d'` |
| `RL.topic` | topik video |
| `RL.theme` | `{ bg, ink, muted, accent, accent2, card, border, shadow }` |
| `RL.safe` | `{ top, bottom, left, right }` |
| `RL.tl` | master timeline GSAP (paused) |

## Latar & efek

```js
RL.bg({ color: '#0B1220' });                        // latar polos
RL.bg({ gradient: 'linear-gradient(178deg,#070B16,#0E1A2B)' }); // gradient baru (JANGAN membungkus RL.theme.bg, itu sudah gradient utuh)
RL.bg({ image: '/assets/foto.jpg', kenburns: true });
RL.fx.blobs({ count: 3, seed: 7, opacity: 0.15, blur: 90 }); // cahaya lembut bergerak
RL.fx.vignette(0.55);                              // gelap di pinggir
RL.fx.grain(0.07);                                 // grain film
RL.layer({ z: 3 });                                // div kosong full-frame untuk isi manual
```

## Teks

```js
const el = RL.text({
	text: 'APA ITU OMBAK?',
	x: 72,            // default: otomatis center
	y: 540,           // jarak dari atas
	w: 936,           // lebar blok
	size: 126,
	weight: 800,      // 800 bold (default), 600 semibold, 500 medium
	color: RL.theme.ink,
	align: 'center',  // left | center | right
	lineHeight: 1.05,
	uppercase: true,
	letterSpacing: 0,
	gradient: `linear-gradient(90deg, ${RL.theme.accent}, ${RL.theme.accent2})`, // teks gradien
	shadow: true,     // default true
	stroke: { width: 3, color: '#000' },
	font: 'display',  // 'display' (Poppins Bold) | 'text' (Poppins Medium)
	z: 10,
});
```

`RL.split(el)` memecah teks menjadi `<span>` per kata → array, untuk animasi per kata.
`RL.stat({ value: '+78%', label: 'penjelasan', y: 960, size: 150 })` → `{ value, label }`.
`RL.chip({ text: 'SAINS', y: 300, color: RL.theme.accent })` → label pill kecil bergaya kategori.
`RL.card({ y: 700, h: 520, radius: 44 })` → kotak kaca (glassmorphism) untuk panel.
`RL.icon({ glyph: '!', size: 120, y: 700 })` → karakter besar (hindari emoji).

## Bentuk, garis, grafik

```js
RL.shape({ type: 'circle', size: 260, x: 410, y: 700, fill: RL.theme.accent2, opacity: 0.8, blur: 0 });
RL.shape({ type: 'pill', w: 220, h: 10, x: 430, y: 760 });      // garis bawah judul
RL.shape({ type: 'rect', w: 400, h: 240, radius: 32 });
RL.arrow({ from: [240, 800], to: [840, 1100], width: 8, color: RL.theme.accent });
const bar = RL.bar({ y: 1200, value: 0.6 });  bar.set(0.85);
const ring = RL.ring({ y: 700, size: 320, value: 0.4, stroke: 26 }); ring.set(0.9);
const svg = RL.svg({ y: 620, w: 900, h: 620, markup: '<svg viewBox="0 0 900 620">...</svg>' });
```

`RL.svg` menerima markup SVG apa pun (path, gradient, filter). Ini jalan terbaik untuk ilustrasi
kustom: diagram, potongan bumi, panah lengkung, gelombang sinus, grafik batang, dsb.

## Animasi

```js
RL.reveal(el, 0.2, { y: 60, dur: 0.6 });                       // fade + naik
RL.stagger(RL.split(head), 0.3, { y: 80, stagger: 0.09 });     // kata muncul berurutan
RL.anim(el, { x: 120, duration: 1.2, ease: 'power2.out' }, 0.5);
RL.fromTo(el, { scaleX: 0 }, { scaleX: 1, duration: 0.6 }, 0.8);
RL.from(el, { opacity: 0, duration: 0.5 }, 0);
RL.onFrame(t => { mesh.rotation.y = t * 0.4; });                // 3D / manual
```

Argumen terakhir helper adalah **waktu mulai dalam detik**. Semua tween dibatasi durasi scene:
jangan membuat animasi yang mulai setelah `RL.dur`.

Ease GSAP yang aman: `power1.out`, `power2.out`, `power3.out`, `power4.out`, `sine.inOut`,
`back.out(1.6)`, `expo.out`, `none`.

## 3D — `RL.scene3d` (engine default, jalan di semua device)

Renderer 3D software (Canvas2D) dengan API mirip three.js: kamera perspektif, mesh poligon,
flat shading, fog, wireframe. Deterministik dan cepat (target < 25 ms/frame).
File: `/src/render/kit/rl-3d.js` (dimuat setelah `rl-kit.js`).

```js
const view = RL.scene3d({
	fov: 52,                        // field of view vertikal
	position: [0, 2.1, 7.2],        // posisi kamera
	target: [0, -0.2, 0],           // titik yang dilihat kamera
	lightDir: [-0.4, 0.85, 0.45],   // arah cahaya (dinormalisasi otomatis)
	ambient: 0.35,
	diffuse: 0.75,
	fogNear: 8, fogFar: 24, fogColor: '#070B16',
	z: 2,                           // z-index layer 3D
});
```

### Mesh

```js
const mesh = view.mesh({
	geometry: 'icosa',   // box | sphere | icosa | torus | cone | cylinder | plane | {vertices, faces}
	detail: 1,           // icosa: 0..3
	radius: 1.15,        // atau size
	segments: 24,        // atau [x, y] untuk plane/torus
	width: 16, height: 22,   // khusus plane
	position: [0, 0.6, 0],
	rotation: [0, 0, 0],
	rotationSpeed: [0.3, 0.5, 0],  // derajat radian per detik, otomatis by waktu
	scale: 1,            // atau [x,y,z]
	color: RL.theme.accent2,
	wireframe: false,
	opacity: 1,
	shade: true,         // flat shading dari lightDir
	twoSided: true,
	lineWidth: 2,
	fog: true,
	amp: 1.1, frequency: 0.55, speed: 1.15,   // khusus geometry 'plane' → gelombang
});
```

`geometry: 'plane'` dengan `amp > 0` menghasilkan permukaan bergelombang yang dianimasikan oleh
waktu render (cocok untuk laut, medan, kain). Geometri custom:
`{ vertices: [[x,y,z],...], faces: [[a,b,c],...] }`.

### Garis, titik, kamera

```js
view.lines({ points: [[x,y,z], ...], closed: true, color: RL.theme.accent, width: 2, opacity: 0.6 });
const orbit = view.lines({ points: lingkaran, closed: true });
view.onUpdate(t => { orbit.rotation = [0, t * 0.25, 0]; });   // update sebelum draw
view.setCamera({ position: [0, 3, 6], fov: 46 });
view.mesh(...).visible = false;
view.stats();   // { objects, faces, drawn }
```

Setiap `mesh()` mengembalikan objek yang bisa diubah di `onUpdate(t)` (position, rotation,
scale, color, opacity, visible) — perubahan ini deterministik karena fungsi dari `t`.

### Budget performa (penting)

- Total triangle ideal **< 3000** per frame. Plane `segments: [30, 40]` ≈ 2400 triangle.
- `segments` sphere/torus ≤ 32. `detail` icosa ≤ 2.
- Lebih dari ~6000 triangle → render lambat (di atas 60 ms/frame).

### WebGL / three.js (opsional, hanya kalau GPU tersedia)

`RL.three(THREE)` tersedia bila WebGL benar-benar jalan (cek `RL.caps.webgl`). Di device
renderly utama (Android/Termux) SwiftShader tidak bisa mengeksekusi shader, jadi pakai
`RL.scene3d`. Jangan menulis kode WebGL/three.js untuk scene `-3d`.

## Contoh lengkap

Lihat `/src/templates/scene-2d.html` dan `/src/templates/scene-3d.html`.