'use strict';

const { matchDetailField } = require('./adaptive');
const { DEFAULTS } = require('../config');

// Ambil semua pasangan label-nilai dari halaman detail, dari berbagai
// bentuk markup yang mungkin dipakai (table 2 kolom, dl/dt/dd, atau
// "Label : Nilai" dalam satu baris teks). Hasilnya dict label(mentah) -> nilai.
async function extractLabelValuePairs(page) {
  return page.evaluate(() => {
    const pairs = {};

    // Bentuk 1: <table><tr><td>Label</td><td>Nilai</td></tr>...
    document.querySelectorAll('table tr').forEach((tr) => {
      const cells = tr.querySelectorAll('td, th');
      if (cells.length === 2) {
        const label = cells[0].textContent.replace(/\s+/g, ' ').trim();
        const value = cells[1].textContent.replace(/\s+/g, ' ').trim();
        if (label) pairs[label] = value;
      }
    });

    // Bentuk 2: <dl><dt>Label</dt><dd>Nilai</dd></dl>
    document.querySelectorAll('dl').forEach((dl) => {
      const dts = dl.querySelectorAll('dt');
      const dds = dl.querySelectorAll('dd');
      dts.forEach((dt, i) => {
        const label = dt.textContent.replace(/\s+/g, ' ').trim();
        const value = dds[i] ? dds[i].textContent.replace(/\s+/g, ' ').trim() : '';
        if (label) pairs[label] = value;
      });
    });

    return pairs;
  });
}

// Bangun record kanonik dari pairs, dengan try/catch PER FIELD supaya satu
// field yang tidak ada/format aneh tidak menggagalkan seluruh baris.
function buildDetailRecord(pairs) {
  const record = { raw: pairs, fields: {}, missing: [] };
  const labels = Object.keys(pairs);

  const wanted = [
    'kode_rup', 'kode_tender', 'nama_paket', 'tanggal_pembuatan', 'kl_pd',
    'satuan_kerja', 'nilai_pagu', 'nilai_hps', 'jadwal_pengumuman_pemenang',
    'pemenang_nama', 'pemenang_alamat', 'pemenang_npwp', 'harga_penawaran',
    'nilai_kontrak', 'nomor_kontrak', 'tanggal_kontrak',
  ];

  for (const fieldKey of wanted) {
    try {
      const foundLabel = labels.find((l) => matchDetailField(l) === fieldKey);
      if (foundLabel) {
        record.fields[fieldKey] = pairs[foundLabel];
      } else {
        record.missing.push(fieldKey);
      }
    } catch (err) {
      // Field tunggal gagal diproses -> catat, lanjut ke field berikutnya.
      record.missing.push(fieldKey);
      record.fields[fieldKey] = null;
      record[`__error_${fieldKey}`] = err.message;
    }
  }

  // Kasus umum SPSE: bisa ada BEBERAPA peserta/pemenang dalam satu halaman
  // (tabel evaluasi/peserta). Kalau begitu, "pemenang_*" di atas hanya
  // menangkap baris label-value tunggal (biasanya ringkasan pemenang di
  // bagian "Pengumuman Pemenang"). Kita tambahkan juga tabel peserta mentah
  // di raw.tabelPeserta agar tidak ada data yang hilang.
  return record;
}

async function scrapeDetailPage(page, detailUrl, { navigationTimeoutMs = DEFAULTS.navigationTimeoutMs } = {}) {
  try {
    await page.goto(detailUrl, { waitUntil: 'networkidle', timeout: navigationTimeoutMs });
  } catch (err) {
    return { status: 'failed', error: `Gagal membuka halaman detail: ${err.message}` };
  }

  try {
    const pairs = await extractLabelValuePairs(page);
    if (!pairs || Object.keys(pairs).length === 0) {
      return { status: 'failed', error: 'Tidak ada data label-nilai yang bisa diekstrak dari halaman detail.' };
    }
    const record = buildDetailRecord(pairs);
    return { status: 'ok', record };
  } catch (err) {
    return { status: 'failed', error: `Gagal parsing halaman detail: ${err.message}` };
  }
}

module.exports = { scrapeDetailPage, extractLabelValuePairs, buildDetailRecord };
