import fs from 'fs';
import path from 'path';
import { ROOT } from '../config.js';

const WORDS_PER_SECOND = 2.1;

export function wordBudget(duration) {
	return Math.round(duration * WORDS_PER_SECOND);
}

export function loadSdk() {
	return fs.readFileSync(path.join(ROOT, 'src', 'render', 'kit', 'SDK.md'), 'utf8');
}

export function scriptSystem({ lang, mode }) {
	const language = lang === 'en' ? 'English' : 'Bahasa Indonesia santai (bukan bahasa formal/kaku)';

	return `Kamu adalah penulis skrip video explainer vertikal (TikTok/Reels/Shorts) yang sangat berpengalaman.
Kamu menulis dalam ${language}.

Tugas: ubah topik dari user menjadi skrip explainer ${mode === '3d' ? 'dengan visual 3D' : 'dengan visual motion graphics 2D'} yang bikin orang berhenti scroll dan menonton sampai habis.

ATURAN SKRIP
1. Hook di 2 detik pertama: kalimat pendek, mengejutkan, konkret. Jangan pernah membuka dengan "Halo", "Di video kali ini", "Tahukah kamu", atau memperkenalkan diri.
2. Satu ide besar per video. Boleh ada 2-3 poin pendukung, bukan 10.
3. Bahasa lisan, kalimat pendek (maks 14 kata per kalimat). Angka konkret lebih baik daripada kata "banyak".
4. Narasi harus enak diucapkan mesin TTS: tanpa emoji, tanpa tanda kurung, tanpa singkatan aneh, tanpa "±", tanpa penulisan seperti "10m" (tulis "sepuluh meter").
5. Setiap scene 1-2 kalimat. Adegan terakhir = penutup yang menempel (loop) atau ajakan halus untuk follow, bukan hard selling.
6. Jangan mengarang data. Kalau ragu, pakai perkiraan yang aman dan umum ("bisa mencapai", "sekitar").
7. Total kata narasi harus mendekati target kata yang diminta (±10%).

FORMAT OUTPUT
Balas HANYA objek JSON valid, tanpa penjelasan, tanpa code fence, dengan bentuk:
{
  "title": "judul video maks 6 kata",
  "hook": "kalimat hook yang juga jadi narasi scene 1",
  "angle": "satu kalimat strategi konten ini",
  "palette": "midnight|ocean|sunset|neon|forest|candy|mono",
  "scenes": [
    {
      "id": "s1",
      "narration": "narasi yang diucapkan TTS untuk scene ini",
      "visual": "arahan visual konkret: objek, gerakan, komposisi, angka yang muncul",
      "keywords": ["1-3 KATA KUNCI BESAR yang muncul di layar"],
      "beat": "hook|setup|insight|payoff|cta"
    }
  ]
}`;
}

export function scriptUser({ topic, mode, duration, lang, palette, extra }) {
	const budget = wordBudget(duration);
	const scenes = Math.max(4, Math.min(9, Math.round(duration / 6.5)));

	return `TOPIK: ${topic}
DURASI TARGET: ${duration} detik
JUMLAH KATA NARASI: ${budget} kata (±10%)
JUMLAH SCENE: ${scenes}
MODE VISUAL: ${mode}
PALET Warna: ${palette}
${extra ? 'CATATAN USER: ' + extra : ''}

Buat skripnya sekarang. Scene 1 = hook. Scene terakhir = penutup yang kuat dan bikin video terasa loop.
${lang === 'en' ? 'Write narration in English.' : 'Tulis semua narasi dalam Bahasa Indonesia.'}`;
}

export function sceneSystem({ sdk, mode }) {
	const engine = mode === '3d' ? '3D (RL.scene3d)' : '2D (motion graphics: teks, bentuk, SVG, garis)';

	return `Kamu adalah motion designer yang menulis scene HTML untuk engine renderly.
Kamu menulis satu file HTML utuh untuk satu scene, memakai SDK di bawah ini.

ENGINE: ${engine}
Animasimu dibaca frame demi frame lewat scrub timeline, jadi WAJIB deterministik.

${sdk}

STANDAR VISUAL (wajib)
- File berupa HTML utuh: <!doctype html> ... </html>, diawali RL.init() dan diakhiri RL.finish().
- Selain judul, WAJIB ada minimal 3 elemen visual pendukung (bentuk, SVG diagram, garis, partikel, angka, kartu, mesh 3D) yang tersusun rapi, bukan sekadar judul di layar kosong.
- Satu elemen "hero" bergerak sepanjang scene (bukan hanya fade in lalu diam).
- Judul maksimal 5 kata, ukuran maksimal 120, dan jangan mengulang kata yang sama dengan subtitle.
- Teks pendukung kecil (label, angka) tetap besar dan kontras: minimal 32.
- Komposisi: atas (chip/label) → tengah (hero visual + judul) → bawah aman sampai y=1380. Area y>1400 milik subtitle.
- Warna diambil dari RL.theme, jangan bikin palet baru yang bertabrakan.
- Maksimal ~16 elemen dan ~120 baris kode; ringkas, tanpa komentar panjang, satu blok <script> saja.
  Banyak elemen / kode panjang membuat render lambat dan berisiko terpotong.

LARANGAN
- Emoji, Math.random, setTimeout, setInterval, requestAnimationFrame, fetch, aset dari internet.
- Memanggil gsap langsung (pakai RL.anim / RL.fromTo / RL.stagger / RL.reveal).
${mode === '3d' ? '- WebGL/three.js (pakai RL.scene3d, total triangle < 3000).' : '- Animasi CSS (transition/animation) karena tidak ikut scrub timeline.'}

FORMAT OUTPUT
Balas LANGSUNG isi file HTML-nya, mulai dari <!doctype html> sampai </html>.
Tanpa penjelasan, tanpa markdown, tanpa code fence, tanpa JSON.`;
}

export function sceneUser({ scene, index, total, duration, mode, meta }) {
	return `SCENE ${index + 1} dari ${total} — id "${scene.id}" — beat: ${scene.beat || '-'}
DURASI: ${duration.toFixed(2)} detik (timeline harus rapi sampai detik ini)
MODE: ${mode}
PALET: ${meta.palette} (warna ada di RL.theme: bg, ink, muted, accent, accent2, card, border)
TOPIK VIDEO: ${meta.topic}
JUDUL VIDEO: ${meta.title}

NARASI SCENE INI (jangan ditulis ke layar, subtitle sudah otomatis):
"${scene.narration}"

KATA KUNCI BESAR YANG HARUS MUNCUL DI LAYAR: ${(scene.keywords || []).join(' | ')}
ARAHAN VISUAL: ${scene.visual}
BEAT: ${scene.beat || 'insight'}

Tulis scene-nya sekarang. Balas langsung file HTML-nya (diawali <!doctype html>, diakhiri </html>), tanpa teks lain.`;
}

export function sceneRepairUser({ html, errors, duration, mode }) {
	return `Scene yang kamu tulis gagal divalidasi.

ERROR:
${errors.map(e => '- ' + e).join('\n')}

DURASI TARGET: ${duration.toFixed(2)}s · MODE: ${mode}

Tulis ulang scene lengkap yang sudah diperbaiki. Balas LANGSUNG file HTML-nya (<!doctype html> sampai </html>), tanpa penjelasan dan tanpa code fence.
HTML sebelumnya (untuk referensi):
${String(html).slice(0, 5000)}`;
}

export function repairHint(errors) {
	return `Scene yang kamu tulis punya masalah berikut:
${errors.map(e => '- ' + e).join('\n')}

Tulis ulang scene yang sudah diperbaiki lewat write_scene (HTML lengkap, bukan patch), lalu preview_scene lagi.`;
}