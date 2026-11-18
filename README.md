# renderly

Bikin video **AI explainer** vertikal (TikTok/Reels/Shorts) dari satu perintah:

```bash
node create.js "apa itu ombak" -2d
node create.js "cara kerja black hole" -3d --dur 45
```

Renderly menulis skrip, membuat suara narasi, mendesain scene, merender frame, membakar subtitle
gaya karaoke, dan menyusun video final — semuanya tanpa sentuh aplikasi editing.

```
topic ──▶ skrip AI ──▶ TTS (edge-tts, paralel) ──▶ scene AI (paralel)
       ──▶ render frame (chromium + GSAP/Canvas3D) ──▶ encode ffmpeg ──▶ final.mp4
```

## Hasil

```
out/apa-itu-ombak/
├── final.mp4          1080x1920 · H.264 · subtitle terbakar
├── thumbnail.jpg
├── captions.srt
├── narration.txt
├── description.txt    judul + hook + hashtag
├── manifest.json      durasi, scene, token AI, dll
├── script.json        skrip lengkap
├── scenes/*.html      scene yang ditulis AI (bisa diedit manual lalu --resume)
├── audio/*.mp3        narasi per scene + timing kata
└── build/*            potongan per scene
```

## Kebutuhan

| Komponen | Catatan |
| --- | --- |
| Node.js ≥ 20 | ESM, tanpa dependensi berat di sisi Node |
| yarn | install: `yarn install` |
| ffmpeg + ffprobe | harus punya filter `ass`/`subtitles` (libass) |
| chromium | headless, dipakai untuk render scene |
| python3 + `edge-tts` | `pip install edge-tts` |

Cek semuanya sekaligus:

```bash
node scripts/doctor.js
```

## Instalasi

```bash
yarn install
cp config.example.json config.json     # lalu isi apiKey / proxy
node scripts/doctor.js
```

Kunci API bisa ditaruh di dua tempat:

- `config.json` → `ai.apiKey` (satu key), atau
- `data/keys.json` → array key (dirotasi acak, key yang kena 429/401 ditandai buruk sementara).

Keduanya **di-gitignore**. Jangan commit kunci API.

## Pemakaian

```bash
node create.js "kenapa langit biru" -2d --dur 35
node create.js "apa itu ombak" -3d -d 45 --voice id-ID-GadisNeural
node create.js "inflasi itu apa" -2d --palette sunset --extra "gaya santai, banyak analogi"
node create.js "cara kerja otak" -2d --resume      # lanjutkan project yang sudah ada
```

| Opsi | Arti |
| --- | --- |
| `-2d` / `-3d` | gaya visual (default `-2d`) |
| `--dur N` | target durasi detik (default 32; hasil bisa ±15%) |
| `--res N` | lebar render, misal `720` atau `1080` (default 1080) |
| `--aspect r` | `9:16` (default), `1:1`, `16:9` |
| `--fps N` | frame per detik (default 30) |
| `--workers N` | jumlah browser paralel saat render (default 2) |
| `--concurrency N` | jumlah scene yang ditulis AI bersamaan (default 5) |
| `--voice`, `--palette`, `--music`, `--out`, `--extra` | lihat `--help` |
| `--quiet` | log minimal |

## Cara kerja

1. **Skrip** — satu panggilan AI menghasilkan JSON: judul, hook, palet, dan 4–9 scene berisi
   narasi + arahan visual + kata kunci layar. Panjang narasi dihitung dari target durasi
   (±2,1 kata/detik untuk TTS Indonesia).
2. **Narasi** — semua scene di-TTS **paralel** lewat `edge-tts` (mp3 + timing per kata).
   Durasi scene = durasi audio + padding, dibulatkan ke kelipatan frame.
3. **Scene** — tiap scene ditulis AI **paralel** sebagai satu file HTML deterministik memakai SDK
   `RL` (lihat `src/render/kit/SDK.md`). Hasilnya divalidasi (lint) dan dipreview di chromium;
   yang bermasalah diperbaiki otomatis sebelum render.
4. **Render** — chromium headless men-scrub timeline tiap frame (`window.__rl.render(t)`) lalu
   screenshot JPEG. N browser bekerja paralel. Frame + audio + subtitle karaoke di-encode per scene.
5. **Final** — scene digabung, audio dinormalisasi (atau dicampur musik), thumbnail + SRT +
   manifest dibuat.

### Mesin visual

- **2D** — HTML/CSS + GSAP + SVG. Kit menyediakan teks auto-fit, kartu, chip, statistik, bar/ring,
  panah, dan efek latar ringan.
- **3D** — `RL.scene3d`: software renderer Canvas2D dengan API ala three.js (mesh poligon, flat
  shading, fog, wireframe, gelombang). Dipakai karena WebGL/SwiftShader di sebagian environment
  (Android/Termux) tidak bisa mengeksekusi shader, sehingga three.js WebGL tampil kosong.
  Butuh 3D asli berbasis GPU di server Linux/macOS/Windows? Build scene three.js di Node lalu render
  dengan `@headless-three/renderer` (wgpu). Catatan: paket itu hanya menyediakan binary
  `linux-x64/arm64-gnu`, `darwin`, `win32` — **tidak jalan di Termux/bionic**, jadi tidak dipakai
  sebagai default di repo ini.

## Konfigurasi

`config.json` (lihat `config.example.json`):

```jsonc
{
  "ai": {
    "baseUrl": "https://tokenharbor.ai/v1",
    "model": "deepseek-v4.1-flash:free",
    "fallbackModels": ["mimo-v2.6-flash:free"],
    "keysFile": "data/keys.json",
    "temperature": 0.7,
    "maxTokens": 8000,
    "timeoutMs": 240000,
    "concurrency": 5
  },
  "proxy": {
    "enabled": true,
    "useProxyAlways": false,
    "urls": ["https://proxy.example.dev", "https://proxy2.example.dev"],
    "key": "<kunci proxy>"
  },
  "voice": { "voice": "id-ID-ArdiNeural", "rate": "+10%", "pitch": "+0Hz" },
  "render": { "fps": 30, "width": 1080, "height": 1920, "workers": 2 },
  "video": { "crf": 21, "preset": "veryfast", "music": null, "musicVolume": 0.12 }
}
```

**Jalur AI**: request dicoba ke `direct` lalu ke proxy (`url = <proxy>/p?url=<endpoint>`), dengan
cooldown per endpoint saat 429/5xx, rotasi key acak, dan fallback model. Statistik token + endpoint
tercatat di `manifest.json`.

## Kecepatan

Bottleneck nyata (diukur di Android/Termux):

| Tahap | Biaya |
| --- | --- |
| AI menulis 4 scene paralel | ~60–90 s (model free tier, 1 panggilan/scene) |
| Render frame 720p | ~0,27 s/frame/browser |
| Render frame 1080p | ~0,44 s/frame/browser |
| Encode + finalisasi | ~10–20 s |

Contoh nyata: video 18 detik (4 scene) selesai ~3,5 menit di Android/Termux:
AI ~1,5 menit, render 543 frame dengan 2 browser ~1,5 menit, sisanya encode.

Untuk hasil cepat: `--res 720 --workers 2 --dur 24`. Untuk kualitas posting: default 1080p
(desain scene tetap 1080×1920, hanya resolusi output yang berubah).

Kalau mau lebih cepat lagi: turunkan `--dur`, kurangi `--concurrency` hanya bila kena rate limit,
dan hindari `filter: blur()` di scene.

Jangan pakai `filter: blur()`, `backdrop-filter`, atau blend mode di scene — di renderer software
biaya per frame bisa naik 10×. Kit sudah memakai radial-gradient untuk efek cahaya.

## Struktur proyek

```
create.js                     entry CLI
src/cli.js                    parsing argumen
src/pipeline/run.js           orkestrasi: skrip → tts → scene → render → final
src/pipeline/script.js        skrip + validasi
src/pipeline/voice.js         edge-tts
src/pipeline/scenes.js        lint + authoring paralel + QA preview
src/pipeline/render.js        capture + encode per scene
src/pipeline/assemble.js      gabung, musik, thumbnail, manifest
src/ai/client.js              client LLM (streaming, tool calling, rotasi key/proxy)
src/ai/agent.js               loop tool-calling
src/ai/prompts.js             prompt skrip + scene
src/ai/keys.js, proxy.js      rotasi key & jalur fetch
src/render/browser.js         chromium via CDP (tanpa puppeteer)
src/render/pool.js            pool browser paralel
src/render/capture.js         scrub frame → JPEG
src/render/captions.js        subtitle ASS karaoke + SRT
src/render/ffmpeg.js          encode, concat, mix, thumbnail
src/render/kit/rl-kit.js      SDK scene 2D
src/render/kit/rl-3d.js       SDK scene 3D (software renderer)
src/render/kit/SDK.md         dokumentasi SDK untuk AI
src/templates/scene-2d.html   contoh scene 2D
src/templates/scene-3d.html   contoh scene 3D
```

## Menulis scene manual

Scene adalah file HTML biasa. Edit `out/<slug>/scenes/s1.html`, lalu:

```bash
node create.js "<topik sama>" -2d --resume
```

Semua yang ada di `src/render/kit/SDK.md` boleh dipakai. Setiap scene harus memanggil `RL.init()`,
menjadwalkan animasi di `RL.tl`, dan ditutup `RL.finish()`.

## Troubleshooting

| Gejala | Solusi |
| --- | --- |
| `chromium gagal start` | set `render.chromium` ke path chromium yang benar (`which chromium-browser`) |
| frame hitam / scene kosong | pastikan `RL.init()` dan `RL.finish()` ada; cek `preview/` |
| video tanpa subtitle | ffmpeg tanpa libass — pakai build ffmpeg yang punya filter `ass` |
| semua key 429 | tambah key di `data/keys.json`, atau aktifkan proxy lain di `proxy.urls` |
| render lambat | turunkan `--res`, `--fps`, atau jumlah efek blur di scene |

## Lisensi

MIT