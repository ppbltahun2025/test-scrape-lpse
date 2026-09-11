'use strict';

// Pakai: node scripts/import-lpse.js path/ke/daftar-lpse.json
// atau:  node scripts/import-lpse.js path/ke/daftar-lpse.csv
//
// Format JSON yang diharapkan: [{ "code": "kotamalang", "name": "LPSE Kota Malang" }, ...]
// Format CSV yang diharapkan (header wajib): code,name

const fs = require('fs');
const path = require('path');
const db = require('../src/db');

const filePath = process.argv[2];
if (!filePath) {
  console.error('Pakai: node scripts/import-lpse.js <file.json|file.csv>');
  process.exit(1);
}

const ext = path.extname(filePath).toLowerCase();
const raw = fs.readFileSync(filePath, 'utf8');

let rows = [];
if (ext === '.json') {
  rows = JSON.parse(raw);
} else if (ext === '.csv') {
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const codeIdx = header.indexOf('code');
  const nameIdx = header.indexOf('name');
  if (codeIdx === -1 || nameIdx === -1) {
    console.error('CSV harus punya header "code,name".');
    process.exit(1);
  }
  rows = lines.slice(1).map((line) => {
    const cols = line.split(',');
    return { code: cols[codeIdx]?.trim(), name: cols[nameIdx]?.trim() };
  });
} else {
  console.error('Format file tidak didukung. Pakai .json atau .csv.');
  process.exit(1);
}

const stmt = db.prepare(
  `INSERT INTO lpse_directory (code, name, source) VALUES (?, ?, 'discovered')
   ON CONFLICT(code) DO UPDATE SET name = excluded.name`
);
const insertMany = db.transaction((items) => {
  let count = 0;
  for (const item of items) {
    if (!item.code || !item.name) continue;
    stmt.run(String(item.code).trim().toLowerCase(), String(item.name).trim());
    count += 1;
  }
  return count;
});

const inserted = insertMany(rows);
console.log(`Berhasil impor/perbarui ${inserted} LPSE dari ${filePath}.`);
