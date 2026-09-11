'use strict';

const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { runJob } = require('./runner');

const insertJob = db.prepare(
  `INSERT INTO jobs (id, params_json, status, progress_json) VALUES (?, ?, 'pending', '{}')`
);
const updateJobStatus = db.prepare(
  `UPDATE jobs SET status=?, progress_json=?, updated_at=datetime('now') WHERE id=?`
);
const getJobRow = db.prepare(`SELECT * FROM jobs WHERE id=?`);

// jobs aktif di memori (proses Node yang sedang berjalan). Kalau server
// direstart, job yang masih 'running' di DB otomatis dianggap 'interrupted'
// saat startup (lihat index.js) dan bisa di-resume manual oleh user.
const activeJobs = new Map();

const MAX_LOG_LINES = 500;

function createJobState(id) {
  return {
    id,
    cancelled: false,
    browser: null,
    counters: { pages: 0, rows: 0, details: 0, detailErrors: 0 },
    logLines: [],
    pushLog(msg) {
      const line = `[${new Date().toISOString()}] ${msg}`;
      this.logLines.push(line);
      if (this.logLines.length > MAX_LOG_LINES) this.logLines.shift();
      persistProgress(this);
    },
  };
}

function persistProgress(state) {
  const progress = { counters: state.counters, log: state.logLines.slice(-50) };
  updateJobStatus.run(state.status || 'running', JSON.stringify(progress), state.id);
}

function startJob(params) {
  const id = uuidv4();
  insertJob.run(id, JSON.stringify(params));
  const state = createJobState(id);
  state.status = 'running';
  activeJobs.set(id, state);
  updateJobStatus.run('running', '{}', id);

  runJob(state, params)
    .then(() => {
      state.status = state.cancelled ? 'cancelled' : 'done';
      persistProgress(state);
    })
    .catch((err) => {
      state.status = 'error';
      state.pushLog(`[FATAL] ${err.stack || err.message}`);
      persistProgress(state);
    });

  return id;
}

function resumeJob(jobId) {
  const row = getJobRow.get(jobId);
  if (!row) throw new Error('Job tidak ditemukan.');
  if (activeJobs.has(jobId) && activeJobs.get(jobId).status === 'running') {
    throw new Error('Job masih berjalan.');
  }
  const params = JSON.parse(row.params_json);
  const state = createJobState(jobId);
  state.status = 'running';
  activeJobs.set(jobId, state);
  updateJobStatus.run('running', row.progress_json, jobId);
  state.pushLog('Melanjutkan job (resume) dari checkpoint terakhir...');

  runJob(state, params)
    .then(() => {
      state.status = state.cancelled ? 'cancelled' : 'done';
      persistProgress(state);
    })
    .catch((err) => {
      state.status = 'error';
      state.pushLog(`[FATAL] ${err.stack || err.message}`);
      persistProgress(state);
    });

  return jobId;
}

function cancelJob(jobId) {
  const state = activeJobs.get(jobId);
  if (!state) throw new Error('Job tidak sedang berjalan di proses ini.');
  state.cancelled = true;
  state.pushLog('Permintaan pembatalan diterima, menghentikan setelah item berjalan selesai...');
}

function getJobStatus(jobId) {
  const row = getJobRow.get(jobId);
  if (!row) return null;
  const live = activeJobs.get(jobId);
  return {
    id: jobId,
    status: live ? live.status : row.status,
    params: JSON.parse(row.params_json),
    progress: live
      ? { counters: live.counters, log: live.logLines.slice(-50) }
      : JSON.parse(row.progress_json || '{}'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Dipanggil sekali saat server start: job yang masih tercatat 'running' di
// DB (dari proses sebelumnya yang mati/crash) ditandai 'interrupted' supaya
// user tahu harus klik Resume, bukan dianggap masih jalan.
function markStaleRunningJobsAsInterrupted() {
  db.prepare(`UPDATE jobs SET status='interrupted' WHERE status='running'`).run();
}

module.exports = { startJob, resumeJob, cancelJob, getJobStatus, markStaleRunningJobsAsInterrupted };
