# SPSE / LPSE Scraper — Web App

Web app untuk scraping data pengadaan barang/jasa pemerintah dari portal
SPSE/LPSE (INAPROC) — bisa dijalankan cukup **satu klik** dari browser,
tanpa buka console/devtools.

> **PENTING — baca dulu sebelum pakai:** kode ini disusun berdasarkan hasil
> inspeksi struktur HTML nyata dari beberapa portal SPSE (LKPP, PU, Kab.
> Gresik, Kemendagri, dll), TAPI belum sempat dijalankan end-to-end secara
> live (lingkungan penyusunan kode ini tidak punya akses jaringan keluar).
> Kemungkinan besar Anda perlu sedikit menyesuaikan selector di
> `data/site-overrides.json` setelah percobaan pertama — lihat bagian
> **"Kalau scraping tidak mengambil data"** di bawah.

## 1. Arsitektur singkat

```
spse-scraper/
├─ src/
│  ├─ config.js           # daftar tab (Tender/NonTender/dst), pola label adaptif
│  ├─ db/                 # SQLite (better-sqlite3): jobs, checkpoints, packages, lpse_directory
│  ├─ scraper/
│  │  ├─ adaptive.js       # pencocokan label kolom secara fleksibel (regex, bukan index kaku)
│  │  ├─ listing.js        # scraping halaman daftar paket + PAGINASI PENUH
│  │  ├─ detail.js         # scraping halaman detail paket, try/catch PER FIELD
│  │  └─ siteOverrides.js  # titik ekstensi: override selector per-LPSE (versi SPSE beda)
│  ├─ jobs/
│  │  ├─ runner.js         # eksekusi scraping per LPSE x tab, simpan progresif, checkpoint
│  │  └─ jobManager.js     # start/cancel/resume job, status & log real-time
│  ├─ export/excel.js      # ekspor ke .xlsx (kolom konsisten + sheet data mentah)
│  └─ server/index.js      # Express: semua endpoint API
├─ public/                # frontend (HTML/CSS/JS polos, tanpa build step)
├─ scripts/import-lpse.js # import daftar LPSE massal dari CSV/JSON
└─ data/                  # spse.sqlite3 + site-overrides.json (dibuat otomatis)
```

**Kenapa Playwright, bukan `fetch`+`cheerio`?**
Saya cek HTML mentah beberapa portal SPSE (`/lelang`, `/nontender`, dst) —
tabel hasil di-render lewat JavaScript (AJAX), HTML awal dari server
tabelnya kosong. Jadi `fetch` biasa tidak akan dapat data; harus pakai
browser headless yang menunggu JS selesai jalan.

**Kenapa adaptif berbasis label, bukan index kolom?**
Tiap LPSE bisa beda urutan/label kolom (mis. "Nilai Kontrak" vs "Tender
Sudah Selesai", ada/tidaknya kolom tertentu). `src/scraper/adaptive.js`
mencocokkan **teks header** ke field kanonik pakai regex yang longgar. Kalau
suatu kolom tidak dikenali sama sekali, isinya tetap disimpan apa adanya di
`raw_listing_json` (lihat sheet "Data Mentah" di file Excel) — jadi tidak
ada data yang hilang walau mapping-nya belum sempurna.

**Kenapa ada `site-overrides.json`?**
Anda sebut sendiri ada variasi versi SPSE (mis. label "spse 4.5"). Alih-alih
menebak semua kemungkinan di kode inti, saya sediakan titik ekstensi: kalau
suatu LPSE ternyata butuh selector khusus (tombol "Selanjutnya" beda class,
dropdown tahun beda id), tambahkan override di `data/site-overrides.json`
TANPA mengubah kode scraper.

## 2. Instalasi

Butuh Node.js 18+.

```bash
cd spse-scraper
npm install          # otomatis juga menjalankan `playwright install chromium`
node src/db/seed-lpse.js   # isi starter daftar LPSE (9 contoh — lihat bagian 4)
npm start
```

Buka `http://localhost:3000` di browser.

## 3. Cara pakai (dari UI)

1. **Pilih LPSE** — cari lewat kotak pencarian, centang satu/lebih. Kalau
   LPSE yang Anda mau belum ada di daftar, tambahkan manual lewat form
   "LPSE tidak ada di daftar? Tambah manual" (isi kode dari URL-nya, mis.
   untuk `https://spse.inaproc.id/kotamalang/lelang` kodenya `kotamalang`).
2. **Pilih Tahun Anggaran** dan **Jenis Pengadaan** (Tender/Non
   Tender/Pencatatan Non Tender/Swakelola/Darurat — bisa pilih beberapa).
3. Centang **"Ambil detail lanjutan"** kalau butuh data RUP, pemenang,
   NPWP, dst (lebih lambat karena tiap paket dibuka satu-satu).
4. Atur **jeda antar-request** kalau perlu (default 1800ms — jangan
   diturunkan drastis, ini situs pemerintah, sopan-sopan saja).
5. Klik **▶ Jalankan Scraping**. Progress & log realtime muncul di bawah.
6. Setelah selesai, tabel preview muncul + tombol **Download Excel/CSV**.

**Resume:** kalau scraping terhenti (server dimatikan, error jaringan),
buka lagi halamannya — tombol **↻ Resume Job Terakhir** akan aktif kalau
job terakhir Anda berstatus `interrupted`/`error`. Klik untuk melanjutkan
dari checkpoint halaman terakhir yang berhasil, bukan dari awal.

## 4. Mendapatkan daftar lengkap LPSE se-Indonesia

Saya sertakan **starter set 9 LPSE** hasil verifikasi manual di
`src/db/seed-lpse.js` — INI BUKAN daftar lengkap (ada 700+ K/L/Pemda yang
punya SPSE sendiri). Untuk daftar lengkap, dua opsi:

- **Manual/bertahap**: tambah lewat form di UI setiap kali butuh LPSE baru.
- **Impor massal**: susun sendiri file `daftar-lpse.json` atau `.csv`
  (kolom `code,name`) dari sumber resmi:
  - Portal pencarian LPSE: `https://spse.inaproc.id/` (form "Cari K/L/Pemda/Instansi")
  - Direktori kontak: `https://spse.inaproc.id/nasional/kontak`
  - Data terbuka LKPP: `https://data.inaproc.id`
  
  lalu jalankan:
  ```bash
  node scripts/import-lpse.js daftar-lpse.json
  ```

Saya sengaja tidak menyertakan scraper otomatis untuk direktori LPSE ini di
versi awal — lebih aman divalidasi manual dulu supaya kode LPSE (yang jadi
bagian URL) benar-benar akurat, baru kemudian bisa dibuatkan scraper
direktori terpisah kalau Anda mau.

## 5. Kalau scraping tidak mengambil data / macet di 0 baris

Ini kemungkinan besar terjadi karena heuristik selector generik tidak cocok
dengan versi SPSE LPSE tertentu. Langkah debug:

1. Cek `logBox` di UI — biasanya sudah menyebutkan tahap yang gagal (mis.
   "Tidak menemukan dropdown Tahun Anggaran yang cocok").
2. Jalankan dengan `headless: false` sementara untuk lihat langsung apa
   yang terjadi — ubah baris di `src/jobs/runner.js`:
   ```js
   const browser = await chromium.launch({ headless: true });
   ```
   jadi `headless: false` lalu jalankan ulang; Anda akan melihat browser
   Chromium terbuka dan bisa amati di titik mana ia tersendat.
3. Tambahkan override untuk LPSE tersebut di `data/site-overrides.json`,
   contoh:
   ```json
   {
     "kotamalang": {
       "yearSelectSelector": "#tahunAnggaran",
       "submitSelector": "#btnCariPaket",
       "nextButtonSelector": "a.page-link.next"
     }
   }
   ```
   (Cara dapat selector: klik kanan elemen di browser → Inspect → Copy →
   Copy selector.)

## 6. Etika & batasan scraping situs pemerintah

- Scraper ini **hanya mengambil data yang memang terbuka untuk umum** (info
  tender/non-tender publik) — tidak ada bagian yang login atau bypass akun.
  Jangan arahkan scraper ini ke halaman yang mensyaratkan login penyedia.
- Rate limiting sudah dibuat default sopan (±1.8 detik/request + jitter,
  dan LPSE diproses satu per satu secara default). Jangan menaikkan
  `maxConcurrentLpse` atau menurunkan jeda terlalu agresif — SPSE adalah
  infrastruktur pemerintah yang dipakai banyak pihak (penyedia jasa,
  panitia lelang) untuk keperluan resmi.
- Kalau Anda berniat scraping dalam skala besar/rutin, ada baiknya cek dulu
  apakah LKPP menyediakan **data terbuka resmi** (`data.inaproc.id`) atau
  API resmi untuk kebutuhan Anda — itu akan lebih stabil dan tidak
  bergantung pada struktur HTML yang bisa berubah sewaktu-waktu.
- Struktur HTML SPSE bisa berubah kapan saja (ganti versi aplikasi) —
  kalau tiba-tiba scraper berhenti bekerja padahal sebelumnya jalan, cek
  dulu apakah tampilan situsnya berubah.

## 7. Yang belum ada / bisa dikembangkan lagi

- Job queue saat ini in-memory + SQLite (cukup untuk pemakaian personal /
  single-server). Untuk skala besar (ratusan LPSE paralel), pertimbangkan
  migrasi ke `bullmq` + Redis seperti disebut di prompt awal.
- Progress bar di UI masih estimasi kasar (belum tahu total halaman di
  awal) — cukup akurat untuk memantau job tidak macet, tapi bukan
  persentase yang presisi.
- Belum ada scraper otomatis untuk direktori LPSE lengkap (lihat bagian 4).
