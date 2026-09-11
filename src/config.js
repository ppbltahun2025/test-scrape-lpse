'use strict';

// Kelima jenis "tab" pengadaan yang ada di setiap portal SPSE/LPSE.
// path = segmen URL setelah kode LPSE, mis: https://spse.inaproc.id/{kode}/lelang
const TABS = {
  tender: { path: 'lelang', label: 'Tender' },
  nontender: { path: 'nontender', label: 'Non Tender' },
  pencatatan: { path: 'pencatatan', label: 'Pencatatan Non Tender' },
  swakelola: { path: 'swakelola', label: 'Pencatatan Swakelola' },
  darurat: { path: 'darurat', label: 'Pencatatan Pengadaan Darurat' },
};

// Normalisasi label kolom/field: lowercase, buang tanda baca, rapikan spasi.
// Dipakai supaya pencocokan label TIDAK bergantung urutan kolom atau
// perbedaan kecil penulisan antar-versi SPSE (mis. "K/L/PD/Instansi Lainnya"
// vs "Instansi" vs "K/L/PD").
function normalizeLabel(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Pola pencocokan label KOLOM TABEL LISTING (halaman daftar paket).
// Urutan penting: pola yang lebih spesifik diletakkan lebih dulu supaya
// tidak salah tangkap (mis. "nilai kontrak" jangan sampai ketangkap oleh "kontrak" saja).
const LISTING_FIELD_PATTERNS = [
  ['kode_paket', /^kode/],
  ['nama_paket', /nama paket/],
  ['instansi', /instansi|k l pd|k\/l\/pd/],
  ['satuan_kerja', /satuan kerja/],
  ['tahapan', /tahapan|status/],
  ['nilai_kontrak', /nilai kontrak/],
  ['pagu', /^pagu|pagu paket/],
  ['hps', /^hps/],
  ['pemenang', /pemenang/],
  ['jadwal_pengumuman', /jadwal pengumuman|pengumuman/],
  ['tanggal_pembuatan', /tanggal (pembuatan|dibuat)/],
  ['tahun_anggaran', /tahun anggaran|^ta$/],
];

// Pola pencocokan label pada HALAMAN DETAIL paket (biasanya berupa
// pasangan label-nilai dalam <table>, <dl>, atau baris "Label : Nilai").
const DETAIL_FIELD_PATTERNS = [
  ['kode_rup', /kode rup/],
  ['kode_tender', /kode (tender|lelang|paket)/],
  ['nama_paket', /nama paket/],
  ['tanggal_pembuatan', /tanggal pembuatan/],
  ['kl_pd', /k l pd|instansi/],
  ['satuan_kerja', /satuan kerja/],
  ['nilai_pagu', /pagu paket|nilai pagu|^pagu/],
  ['nilai_hps', /^hps|nilai hps/],
  ['jadwal_pengumuman_pemenang', /pengumuman pemenang|jadwal pengumuman/],
  ['pemenang_nama', /nama (peserta|penyedia|pemenang)/],
  ['pemenang_alamat', /alamat/],
  ['pemenang_npwp', /npwp/],
  ['harga_penawaran', /harga (penawaran|terkoreksi)/],
  ['nilai_kontrak', /nilai kontrak/],
  ['nomor_kontrak', /nomor kontrak/],
  ['tanggal_kontrak', /tanggal kontrak/],
];

const DEFAULTS = {
  rateLimitMs: 1800, // jeda sopan antar-request ke server SPSE
  jitterMs: 700, // variasi acak tambahan supaya pola request tidak kaku
  maxPagesPerTab: 500, // pengaman anti infinite-loop paginasi
  navigationTimeoutMs: 30000,
  maxConcurrentLpse: 1, // proses LPSE satu per satu secara default (paling sopan)
};

module.exports = {
  TABS,
  normalizeLabel,
  LISTING_FIELD_PATTERNS,
  DETAIL_FIELD_PATTERNS,
  DEFAULTS,
};
