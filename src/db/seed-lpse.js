'use strict';

const db = require('./index');

// Starter set (hasil verifikasi manual). INI BUKAN daftar lengkap se-Indonesia
// (ada 700+ LPSE K/L/Pemda). Silakan tambah lewat UI ("Tambah LPSE manual"),
// atau import massal lewat scripts/import-lpse.js dari file CSV/JSON yang
// Anda susun dari direktori resmi https://spse.inaproc.id (portal pencarian)
// dan https://spse.inaproc.id/nasional/kontak.
const SEED = [
  { code: 'lkpp', name: 'LPSE Lembaga Kebijakan Pengadaan Barang/Jasa Pemerintah' },
  { code: 'pu', name: 'LPSE Kementerian Pekerjaan Umum dan Perumahan Rakyat' },
  { code: 'kemendagri', name: 'LPSE Kementerian Dalam Negeri' },
  { code: 'kemendikdasmen', name: 'LPSE Kementerian Pendidikan Dasar dan Menengah' },
  { code: 'kkp', name: 'LPSE Kementerian Kelautan dan Perikanan' },
  { code: 'big', name: 'LPSE Badan Informasi Geospasial' },
  { code: 'jakarta', name: 'LPSE Provinsi DKI Jakarta' },
  { code: 'gresikkab', name: 'LPSE Kabupaten Gresik' },
  { code: 'nasional', name: 'SPSE Nasional (agregasi beberapa K/L kecil)' },
];

const stmt = db.prepare(
  `INSERT INTO lpse_directory (code, name, source) VALUES (?, ?, 'seed')
   ON CONFLICT(code) DO UPDATE SET name = excluded.name`
);

const insertMany = db.transaction((rows) => {
  for (const row of rows) stmt.run(row.code, row.name);
});

insertMany(SEED);
console.log(`Seed selesai: ${SEED.length} LPSE dimasukkan/diperbarui.`);
