'use strict';

const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, '..', '..', 'data', 'spse.sqlite3');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  params_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending|running|paused|done|error|cancelled
  progress_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Checkpoint per kombinasi (job, lpse, tab): sampai halaman berapa sudah
-- selesai. Dipakai untuk resume tanpa mengulang dari awal.
CREATE TABLE IF NOT EXISTS job_checkpoints (
  job_id TEXT NOT NULL,
  lpse_code TEXT NOT NULL,
  tab_key TEXT NOT NULL,
  last_page_done INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending', -- pending|in_progress|done|failed
  error TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (job_id, lpse_code, tab_key)
);

-- Hasil scraping. unique key mencegah duplikasi saat resume / re-run.
CREATE TABLE IF NOT EXISTS packages (
  job_id TEXT NOT NULL,
  lpse_code TEXT NOT NULL,
  tab_key TEXT NOT NULL,
  kode_paket TEXT,
  nama_paket TEXT,
  instansi TEXT,
  satuan_kerja TEXT,
  tahapan TEXT,
  pagu TEXT,
  hps TEXT,
  nilai_kontrak TEXT,
  pemenang TEXT,
  jadwal_pengumuman TEXT,
  tahun_anggaran TEXT,
  detail_url TEXT,
  detail_status TEXT DEFAULT 'not_fetched', -- not_fetched|ok|failed|skipped
  detail_error TEXT,
  detail_json TEXT, -- semua field detail (termasuk yang tidak ter-mapping) sbg JSON
  raw_listing_json TEXT, -- kolom mentah dari baris listing, apa adanya, per-LPSE
  scraped_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(job_id, lpse_code, tab_key, kode_paket, nama_paket)
);

CREATE TABLE IF NOT EXISTS lpse_directory (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source TEXT DEFAULT 'manual' -- 'seed' | 'manual' | 'discovered'
);
`);

module.exports = db;
