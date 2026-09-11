'use strict';

const path = require('path');
const express = require('express');
const db = require('../db');
const { TABS } = require('../config');
const jobManager = require('../jobs/jobManager');
const { buildWorkbookForJob } = require('../export/excel');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', '..', 'public')));

jobManager.markStaleRunningJobsAsInterrupted();

// ---- LPSE directory ----
app.get('/api/lpse', (req, res) => {
  const q = (req.query.q || '').toString().toLowerCase();
  const rows = db.prepare('SELECT code, name FROM lpse_directory ORDER BY name').all();
  const filtered = q
    ? rows.filter((r) => r.code.toLowerCase().includes(q) || r.name.toLowerCase().includes(q))
    : rows;
  res.json(filtered);
});

app.post('/api/lpse', (req, res) => {
  const { code, name } = req.body || {};
  if (!code || !name) return res.status(400).json({ error: 'code dan name wajib diisi.' });
  const cleanCode = String(code).trim().toLowerCase();
  db.prepare(
    `INSERT INTO lpse_directory (code, name, source) VALUES (?, ?, 'manual')
     ON CONFLICT(code) DO UPDATE SET name = excluded.name`
  ).run(cleanCode, String(name).trim());
  res.json({ ok: true });
});

app.get('/api/tabs', (req, res) => {
  res.json(Object.entries(TABS).map(([key, v]) => ({ key, label: v.label })));
});

// ---- Jobs ----
app.post('/api/jobs', (req, res) => {
  try {
    const { lpseCodes, tahun, tabs, fetchDetail, rateLimitMs, maxConcurrentLpse } = req.body || {};
    if (!Array.isArray(lpseCodes) || lpseCodes.length === 0) {
      return res.status(400).json({ error: 'Pilih minimal satu LPSE.' });
    }
    if (!Array.isArray(tabs) || tabs.length === 0) {
      return res.status(400).json({ error: 'Pilih minimal satu jenis pengadaan.' });
    }
    const id = jobManager.startJob({
      lpseCodes,
      tahun: tahun || null,
      tabs,
      fetchDetail: !!fetchDetail,
      rateLimitMs: rateLimitMs ? Number(rateLimitMs) : undefined,
      maxConcurrentLpse: maxConcurrentLpse ? Number(maxConcurrentLpse) : undefined,
    });
    res.json({ jobId: id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/jobs/:id', (req, res) => {
  const status = jobManager.getJobStatus(req.params.id);
  if (!status) return res.status(404).json({ error: 'Job tidak ditemukan.' });
  res.json(status);
});

app.post('/api/jobs/:id/cancel', (req, res) => {
  try {
    jobManager.cancelJob(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/jobs/:id/resume', (req, res) => {
  try {
    jobManager.resumeJob(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/jobs/:id/results', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 500);
  const offset = Number(req.query.offset) || 0;
  const rows = db
    .prepare(`SELECT * FROM packages WHERE job_id=? ORDER BY rowid LIMIT ? OFFSET ?`)
    .all(req.params.id, limit, offset);
  const total = db.prepare(`SELECT COUNT(*) as c FROM packages WHERE job_id=?`).get(req.params.id).c;
  res.json({ rows, total });
});

app.get('/api/jobs/:id/export.xlsx', async (req, res) => {
  try {
    const wb = await buildWorkbookForJob(req.params.id);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="spse-${req.params.id}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/jobs/:id/export.csv', async (req, res) => {
  const rows = db.prepare(`SELECT * FROM packages WHERE job_id=? ORDER BY rowid`).all(req.params.id);
  const cols = [
    'lpse_code', 'tab_key', 'kode_paket', 'nama_paket', 'instansi', 'satuan_kerja',
    'tahapan', 'tahun_anggaran', 'pagu', 'hps', 'nilai_kontrak', 'pemenang',
    'jadwal_pengumuman', 'detail_status', 'detail_url',
  ];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [cols.join(',')];
  for (const r of rows) lines.push(cols.map((c) => esc(r[c])).join(','));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="spse-${req.params.id}.csv"`);
  res.send('\uFEFF' + lines.join('\n'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`SPSE Scraper berjalan di http://localhost:${PORT}`);
});
