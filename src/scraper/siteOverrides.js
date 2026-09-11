'use strict';

const fs = require('fs');
const path = require('path');

const OVERRIDES_PATH = path.join(__dirname, '..', '..', 'data', 'site-overrides.json');

// File ini opsional. Kalau suatu LPSE ternyata pakai versi SPSE yang
// selector-nya berbeda dari heuristik umum (mis. tombol "Selanjutnya"
// pakai class custom), Anda bisa menambahkan override di sini TANPA
// mengubah kode scraper inti. Contoh isi data/site-overrides.json:
//
// {
//   "beberapakode": {
//     "nextButtonSelector": "a.page-link.next-custom",
//     "yearSelectSelector": "#tahunAnggaran"
//   }
// }
function loadOverrides() {
  try {
    if (fs.existsSync(OVERRIDES_PATH)) {
      return JSON.parse(fs.readFileSync(OVERRIDES_PATH, 'utf8'));
    }
  } catch (err) {
    console.warn('Gagal membaca site-overrides.json, diabaikan:', err.message);
  }
  return {};
}

function getOverrideFor(lpseCode) {
  const all = loadOverrides();
  return all[lpseCode] || {};
}

module.exports = { getOverrideFor, OVERRIDES_PATH };
