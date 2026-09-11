'use strict';

const { chromium } = require('playwright');
const db = require('../db');
const { TABS, DEFAULTS } = require('../config');
const { scrapeListingWithPagination } = require('../scraper/listing');
const { scrapeDetailPage } = require('../scraper/detail');
const { politeDelay } = require('../scraper/adaptive');

const upsertPackage = db.prepare(`
  INSERT INTO packages (
    job_id, lpse_code, tab_key, kode_paket, nama_paket, instansi, satuan_kerja,
    tahapan, pagu, hps, nilai_kontrak, pemenang, jadwal_pengumuman, tahun_anggaran,
    detail_url, detail_status, detail_error, detail_json, raw_listing_json
  ) VALUES (
    @job_id, @lpse_code, @tab_key, @kode_paket, @nama_paket, @instansi, @satuan_kerja,
    @tahapan, @pagu, @hps, @nilai_kontrak, @pemenang, @jadwal_pengumuman, @tahun_anggaran,
    @detail_url, @detail_status, @detail_error, @detail_json, @raw_listing_json
  )
  ON CONFLICT(job_id, lpse_code, tab_key, kode_paket, nama_paket) DO UPDATE SET
    instansi=excluded.instansi, satuan_kerja=excluded.satuan_kerja, tahapan=excluded.tahapan,
    pagu=excluded.pagu, hps=excluded.hps, nilai_kontrak=excluded.nilai_kontrak,
    pemenang=excluded.pemenang, jadwal_pengumuman=excluded.jadwal_pengumuman,
    detail_url=excluded.detail_url
`);

const updateDetail = db.prepare(`
  UPDATE packages SET detail_status=?, detail_error=?, detail_json=?
  WHERE job_id=? AND lpse_code=? AND tab_key=? AND kode_paket=? AND nama_paket=?
`);

const getCheckpoint = db.prepare(
  `SELECT * FROM job_checkpoints WHERE job_id=? AND lpse_code=? AND tab_key=?`
);
const upsertCheckpoint = db.prepare(`
  INSERT INTO job_checkpoints (job_id, lpse_code, tab_key, last_page_done, status, error, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  ON CONFLICT(job_id, lpse_code, tab_key) DO UPDATE SET
    last_page_done=excluded.last_page_done, status=excluded.status,
    error=excluded.error, updated_at=datetime('now')
`);

const findPackagesNeedingDetail = db.prepare(`
  SELECT rowid as id, kode_paket, nama_paket, detail_url FROM packages
  WHERE job_id=? AND lpse_code=? AND tab_key=? AND detail_url IS NOT NULL
    AND detail_status = 'not_fetched'
`);

function buildUrl(lpseCode, tabKey) {
  const tab = TABS[tabKey];
  return `https://spse.inaproc.id/${lpseCode}/${tab.path}`;
}

function resolveDetailUrl(baseListingUrl, href) {
  try {
    return new URL(href, baseListingUrl).toString();
  } catch {
    return href;
  }
}

// jobState: objek in-memory yang dipegang jobManager, berisi status,
// progress counters, log ring-buffer, dan flag cancel.
async function runJob(jobState, params) {
  const {
    lpseCodes,
    tahun,
    tabs, // array of tab keys, mis. ['tender','nontender']
    fetchDetail,
    rateLimitMs = DEFAULTS.rateLimitMs,
    jitterMs = DEFAULTS.jitterMs,
    maxConcurrentLpse = DEFAULTS.maxConcurrentLpse,
  } = params;

  const log = (msg) => jobState.pushLog(msg);
  const isCancelled = () => jobState.cancelled;

  const browser = await chromium.launch({ headless: true });
  jobState.browser = browser;

  try {
    // Proses LPSE dengan konkurensi terbatas (default 1 = berurutan) supaya
    // tidak membebani server SPSE.
    const queue = [];
    for (const lpseCode of lpseCodes) {
      for (const tabKey of tabs) {
        queue.push({ lpseCode, tabKey });
      }
    }

    let cursor = 0;
    async function worker() {
      const context = await browser.newContext();
      const page = await context.newPage();
      while (cursor < queue.length) {
        if (isCancelled()) break;
        const item = queue[cursor];
        cursor += 1;
        await processOne(page, item);
      }
      await context.close();
    }

    async function processOne({ lpseCode, tabKey }) {
      const url = buildUrl(lpseCode, tabKey);
      const cp = getCheckpoint.get(jobState.id, lpseCode, tabKey);
      if (cp && cp.status === 'done') {
        log(`[skip] ${lpseCode}/${tabKey} sudah selesai (resume).`);
        return;
      }
      const startPage = cp && cp.status === 'in_progress' ? cp.last_page_done + 1 : 1;
      log(`Mulai memproses ${lpseCode} - ${TABS[tabKey].label} (mulai dari halaman ${startPage})...`);
      upsertCheckpoint.run(jobState.id, lpseCode, tabKey, startPage - 1, 'in_progress', null);

      try {
        await scrapeListingWithPagination({
          page,
          url,
          lpseCode,
          tahun,
          startPage,
          rateLimitMs,
          jitterMs,
          isCancelled,
          log,
          onPage: async (pageIndex, records) => {
            for (const r of records) {
              const kode = r.kode_paket || r.raw['Kode'] || null;
              const nama = r.nama_paket || r.raw['Nama Paket'] || null;
              if (!kode && !nama) continue; // baris kosong/aneh, lewati
              upsertPackage.run({
                job_id: jobState.id,
                lpse_code: lpseCode,
                tab_key: tabKey,
                kode_paket: kode,
                nama_paket: nama,
                instansi: r.instansi || null,
                satuan_kerja: r.satuan_kerja || null,
                tahapan: r.tahapan || null,
                pagu: r.pagu || null,
                hps: r.hps || null,
                nilai_kontrak: r.nilai_kontrak || null,
                pemenang: r.pemenang || null,
                jadwal_pengumuman: r.jadwal_pengumuman || null,
                tahun_anggaran: r.tahun_anggaran || (tahun ? String(tahun) : null),
                detail_url: r.detailUrl ? resolveDetailUrl(url, r.detailUrl) : null,
                detail_status: 'not_fetched',
                detail_error: null,
                detail_json: null,
                raw_listing_json: JSON.stringify(r.raw),
              });
              jobState.counters.rows += 1;
            }
            upsertCheckpoint.run(jobState.id, lpseCode, tabKey, pageIndex, 'in_progress', null);
            jobState.counters.pages += 1;
            log(`  ${lpseCode}/${tabKey}: halaman ${pageIndex} selesai (${records.length} baris).`);
          },
        });

        upsertCheckpoint.run(jobState.id, lpseCode, tabKey, jobState.counters.pages, 'done', null);
        log(`Selesai listing ${lpseCode}/${tabKey}.`);

        if (fetchDetail && !isCancelled()) {
          await processDetails(page, lpseCode, tabKey, url, log, isCancelled, rateLimitMs, jitterMs, jobState);
        }
      } catch (err) {
        upsertCheckpoint.run(jobState.id, lpseCode, tabKey, jobState.counters.pages, 'failed', err.message);
        log(`[ERROR] ${lpseCode}/${tabKey}: ${err.message}`);
      }
    }

    const workerCount = Math.max(1, Math.min(maxConcurrentLpse, lpseCodes.length || 1));
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
  } finally {
    await browser.close().catch(() => {});
  }
}

async function processDetails(page, lpseCode, tabKey, listingUrl, log, isCancelled, rateLimitMs, jitterMs, jobState) {
  const rows = findPackagesNeedingDetail.all(jobState.id, lpseCode, tabKey);
  log(`Mengambil detail untuk ${rows.length} paket di ${lpseCode}/${tabKey}...`);
  for (const row of rows) {
    if (isCancelled()) break;
    const result = await scrapeDetailPage(page, row.detail_url);
    if (result.status === 'ok') {
      updateDetail.run('ok', null, JSON.stringify(result.record), jobState.id, lpseCode, tabKey, row.kode_paket, row.nama_paket);
      jobState.counters.details += 1;
    } else {
      updateDetail.run('failed', result.error, null, jobState.id, lpseCode, tabKey, row.kode_paket, row.nama_paket);
      jobState.counters.detailErrors += 1;
      log(`  [detail gagal] ${row.kode_paket || row.nama_paket}: ${result.error}`);
    }
    await politeDelay(rateLimitMs, jitterMs);
  }
}

module.exports = { runJob, buildUrl };
