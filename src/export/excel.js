'use strict';

const ExcelJS = require('exceljs');
const db = require('../db');

const COLUMNS = [
  { header: 'LPSE', key: 'lpse_code', width: 14 },
  { header: 'Jenis Pengadaan', key: 'tab_key', width: 18 },
  { header: 'Kode Paket', key: 'kode_paket', width: 14 },
  { header: 'Nama Paket', key: 'nama_paket', width: 45 },
  { header: 'Instansi', key: 'instansi', width: 30 },
  { header: 'Satuan Kerja', key: 'satuan_kerja', width: 30 },
  { header: 'Tahapan', key: 'tahapan', width: 20 },
  { header: 'Tahun Anggaran', key: 'tahun_anggaran', width: 14 },
  { header: 'Pagu', key: 'pagu', width: 18 },
  { header: 'HPS', key: 'hps', width: 18 },
  { header: 'Nilai Kontrak', key: 'nilai_kontrak', width: 18 },
  { header: 'Pemenang (listing)', key: 'pemenang', width: 30 },
  { header: 'Jadwal Pengumuman', key: 'jadwal_pengumuman', width: 20 },
  { header: 'Kode RUP', key: 'd_kode_rup', width: 16 },
  { header: 'Tanggal Pembuatan', key: 'd_tanggal_pembuatan', width: 16 },
  { header: 'K/L/PD (detail)', key: 'd_kl_pd', width: 26 },
  { header: 'Pemenang - Nama', key: 'd_pemenang_nama', width: 30 },
  { header: 'Pemenang - Alamat', key: 'd_pemenang_alamat', width: 35 },
  { header: 'Pemenang - NPWP', key: 'd_pemenang_npwp', width: 20 },
  { header: 'Harga Penawaran', key: 'd_harga_penawaran', width: 18 },
  { header: 'Status Detail', key: 'detail_status', width: 12 },
  { header: 'Catatan Detail', key: 'detail_error', width: 30 },
  { header: 'URL Detail', key: 'detail_url', width: 40 },
];

function cleanNumberLike(text) {
  if (!text) return text;
  // Normalisasi angka gaya Indonesia "Rp1.234.567,00" -> tetap sebagai teks
  // rapi (kita TIDAK memaksa jadi number, karena "-" / "belum ada" valid).
  return String(text).replace(/\s+/g, ' ').trim();
}

async function buildWorkbookForJob(jobId) {
  const rows = db.prepare(`SELECT * FROM packages WHERE job_id = ? ORDER BY lpse_code, tab_key, kode_paket`).all(jobId);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'SPSE Scraper';
  wb.created = new Date();

  const ws = wb.addWorksheet('Hasil Scraping');
  ws.columns = COLUMNS;
  ws.getRow(1).font = { bold: true };
  ws.autoFilter = { from: 'A1', to: `${String.fromCharCode(64 + COLUMNS.length)}1` };

  for (const r of rows) {
    let detail = {};
    try {
      detail = r.detail_json ? JSON.parse(r.detail_json).fields || {} : {};
    } catch {
      detail = {};
    }
    ws.addRow({
      lpse_code: r.lpse_code,
      tab_key: r.tab_key,
      kode_paket: cleanNumberLike(r.kode_paket),
      nama_paket: cleanNumberLike(r.nama_paket),
      instansi: cleanNumberLike(r.instansi),
      satuan_kerja: cleanNumberLike(r.satuan_kerja),
      tahapan: cleanNumberLike(r.tahapan),
      tahun_anggaran: r.tahun_anggaran,
      pagu: cleanNumberLike(r.pagu),
      hps: cleanNumberLike(r.hps),
      nilai_kontrak: cleanNumberLike(r.nilai_kontrak),
      pemenang: cleanNumberLike(r.pemenang),
      jadwal_pengumuman: cleanNumberLike(r.jadwal_pengumuman),
      d_kode_rup: detail.kode_rup || '',
      d_tanggal_pembuatan: detail.tanggal_pembuatan || '',
      d_kl_pd: detail.kl_pd || '',
      d_pemenang_nama: detail.pemenang_nama || '',
      d_pemenang_alamat: detail.pemenang_alamat || '',
      d_pemenang_npwp: detail.pemenang_npwp || '',
      d_harga_penawaran: detail.harga_penawaran || '',
      detail_status: r.detail_status,
      detail_error: r.detail_error || '',
      detail_url: r.detail_url || '',
    });
  }

  // Sheet kedua: data mentah per-kolom apa adanya (raw_listing_json), untuk
  // LPSE dengan kolom non-standar yang tidak sepenuhnya ter-mapping di atas.
  const wsRaw = wb.addWorksheet('Data Mentah (raw)');
  wsRaw.columns = [
    { header: 'LPSE', key: 'lpse_code', width: 14 },
    { header: 'Jenis Pengadaan', key: 'tab_key', width: 18 },
    { header: 'Kode Paket', key: 'kode_paket', width: 14 },
    { header: 'Raw Listing (JSON)', key: 'raw', width: 80 },
  ];
  wsRaw.getRow(1).font = { bold: true };
  for (const r of rows) {
    wsRaw.addRow({
      lpse_code: r.lpse_code,
      tab_key: r.tab_key,
      kode_paket: r.kode_paket,
      raw: r.raw_listing_json || '',
    });
  }

  return wb;
}

module.exports = { buildWorkbookForJob };
