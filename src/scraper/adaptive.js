'use strict';

const { normalizeLabel, LISTING_FIELD_PATTERNS, DETAIL_FIELD_PATTERNS } = require('../config');

// Cocokkan sebuah label kolom/field ke nama field kanonik kita,
// pakai daftar pola regex. Mengembalikan null kalau tidak ada yang cocok
// (nilainya tetap disimpan apa adanya di kolom "raw", jadi tidak hilang).
function matchField(label, patterns) {
  const norm = normalizeLabel(label);
  for (const [key, regex] of patterns) {
    if (regex.test(norm)) return key;
  }
  return null;
}

function matchListingField(label) {
  return matchField(label, LISTING_FIELD_PATTERNS);
}

function matchDetailField(label) {
  return matchField(label, DETAIL_FIELD_PATTERNS);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function politeDelay(baseMs, jitterMs) {
  const jitter = Math.floor(Math.random() * (jitterMs || 0));
  return sleep((baseMs || 0) + jitter);
}

module.exports = { matchListingField, matchDetailField, sleep, politeDelay };
