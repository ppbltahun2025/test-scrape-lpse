'use strict';

const { matchListingField } = require('./adaptive');
const { getOverrideFor } = require('./siteOverrides');
const { DEFAULTS } = require('../config');

// Coba pilih Tahun Anggaran di dropdown filter. Heuristik: cari semua
// <select>, ambil yang mayoritas opsinya berupa angka tahun (4 digit).
// Kalau ada override eksplisit untuk LPSE ini, pakai itu dulu.
async function trySelectYear(page, tahun, override) {
  if (!tahun) return false;
  try {
    if (override.yearSelectSelector) {
      await page.selectOption(override.yearSelectSelector, String(tahun));
      return true;
    }
    const selects = await page.$$('select');
    for (const sel of selects) {
      const options = await sel.$$eval('option', (opts) => opts.map((o) => o.textContent.trim()));
      const yearLike = options.filter((t) => /^(19|20)\d{2}$/.test(t));
      if (yearLike.length >= 3 && options.includes(String(tahun))) {
        await sel.selectOption(String(tahun));
        return true;
      }
    }
  } catch (err) {
    console.warn(`[trySelectYear] gagal untuk tahun=${tahun}:`, err.message);
  }
  return false;
}

// Coba klik tombol "Cari"/"Tampilkan" setelah filter diisi.
async function trySubmitFilter(page, override) {
  try {
    if (override.submitSelector) {
      await page.click(override.submitSelector);
      return true;
    }
    const candidates = await page.$$('button, input[type=submit], a.btn');
    for (const el of candidates) {
      const text = ((await el.textContent()) || '').trim().toLowerCase();
      const value = ((await el.getAttribute('value')) || '').toLowerCase();
      if (/cari|tampilkan|tayang|filter|search/.test(text + ' ' + value)) {
        await el.click();
        return true;
      }
    }
  } catch (err) {
    console.warn('[trySubmitFilter] gagal:', err.message);
  }
  return false;
}

// Cari tabel hasil yang paling mungkin: table dengan tbody yang punya baris.
async function findResultTable(page) {
  const tables = await page.$$('table');
  for (const t of tables) {
    const rowCount = await t.$$eval('tbody tr', (rows) => rows.length).catch(() => 0);
    if (rowCount > 0) return t;
  }
  // fallback: tabel pertama yang punya header, walau body masih kosong
  return tables[0] || null;
}

async function extractHeaders(table) {
  const headerCells = await table.$$eval('thead th, thead td', (cells) =>
    cells.map((c) => c.textContent.trim())
  ).catch(() => []);
  if (headerCells.length) return headerCells;
  // fallback: baris pertama tbody dianggap header kalau tidak ada <thead>
  return table.$$eval('tr:first-child th, tr:first-child td', (cells) =>
    cells.map((c) => c.textContent.trim())
  ).catch(() => []);
}

async function extractRows(table) {
  return table.$$eval('tbody tr', (rows) =>
    rows.map((row) => {
      const cells = Array.from(row.querySelectorAll('td'));
      const link = row.querySelector('a[href]');
      return {
        texts: cells.map((c) => c.textContent.replace(/\s+/g, ' ').trim()),
        detailUrl: link ? link.getAttribute('href') : null,
      };
    })
  );
}

// Bangun peta kolom adaptif: index -> nama field kanonik (atau null kalau
// tidak dikenali; tetap disimpan di "raw" supaya tidak ada data yang hilang).
function buildColumnMap(headers) {
  return headers.map((h) => ({ label: h, field: matchListingField(h) }));
}

function rowToRecord(columnMap, row) {
  const record = { raw: {} };
  columnMap.forEach((col, i) => {
    const value = row.texts[i] ?? '';
    record.raw[col.label || `kolom_${i + 1}`] = value;
    if (col.field) record[col.field] = value;
  });
  record.detailUrl = row.detailUrl || null;
  return record;
}

async function goToNextPage(page, override) {
  try {
    if (override.nextButtonSelector) {
      const el = await page.$(override.nextButtonSelector);
      if (!el) return false;
      const disabled = await el.evaluate(
        (e) => e.classList.contains('disabled') || e.getAttribute('aria-disabled') === 'true'
      );
      if (disabled) return false;
      await el.click();
      return true;
    }

    // Heuristik umum: cari elemen pagination, lalu cari yang teksnya
    // "selanjutnya" / ">" / "»" / "next" dan tidak berstatus disabled.
    const candidates = await page.$$('.pagination a, .pagination button, a.page-link, nav[aria-label] a');
    for (const el of candidates) {
      const text = ((await el.textContent()) || '').trim().toLowerCase();
      if (/^(selanjutnya|next|»|›|>)$/.test(text)) {
        const parentDisabled = await el.evaluate((e) => {
          const li = e.closest('li');
          return (li && li.classList.contains('disabled')) || e.classList.contains('disabled');
        });
        if (parentDisabled) return false;
        await el.click();
        return true;
      }
    }
  } catch (err) {
    console.warn('[goToNextPage] gagal:', err.message);
  }
  return false;
}

// Scrape SATU tab (Tender/Non Tender/dst) untuk SATU LPSE, dengan paginasi
// penuh. `onPage(pageIndex, records)` dipanggil tiap halaman selesai supaya
// caller bisa menyimpan progresif dan mendukung resume.
async function scrapeListingWithPagination({
  page,
  url,
  lpseCode,
  tahun,
  startPage = 1,
  rateLimitMs = DEFAULTS.rateLimitMs,
  jitterMs = DEFAULTS.jitterMs,
  maxPages = DEFAULTS.maxPagesPerTab,
  onPage,
  isCancelled,
  log,
}) {
  const override = getOverrideFor(lpseCode);
  await page.goto(url, { waitUntil: 'networkidle', timeout: DEFAULTS.navigationTimeoutMs });

  if (tahun) {
    const selected = await trySelectYear(page, tahun, override);
    if (selected) {
      await trySubmitFilter(page, override);
      await page.waitForLoadState('networkidle').catch(() => {});
    } else {
      log?.(`Tidak menemukan dropdown Tahun Anggaran yang cocok untuk ${lpseCode}; melanjutkan tanpa filter tahun.`);
    }
  }

  // Kalau resume dan startPage > 1, klik "next" berkali-kali untuk mengejar
  // posisi terakhir. Ini sederhana namun cukup untuk paginasi berbasis klik.
  for (let i = 1; i < startPage; i++) {
    const moved = await goToNextPage(page, override);
    if (!moved) break;
    await page.waitForLoadState('networkidle').catch(() => {});
  }

  let pageIndex = startPage;
  let previousSignature = null;

  while (pageIndex <= maxPages) {
    if (isCancelled?.()) {
      log?.('Job dibatalkan, menghentikan paginasi.');
      break;
    }

    const table = await findResultTable(page);
    if (!table) {
      log?.(`Tidak menemukan tabel hasil di ${url} (halaman ${pageIndex}).`);
      break;
    }

    const headers = await extractHeaders(table);
    const rawRows = await extractRows(table);
    const columnMap = buildColumnMap(headers);
    const records = rawRows.map((r) => rowToRecord(columnMap, r));

    // Guard anti infinite-loop: kalau isi halaman identik dengan sebelumnya
    // (link "next" tidak benar-benar berpindah), hentikan.
    const signature = JSON.stringify(records.map((r) => r.detailUrl || r.raw));
    if (signature === previousSignature) {
      log?.('Isi halaman sama dengan sebelumnya, dianggap sudah di halaman terakhir.');
      break;
    }
    previousSignature = signature;

    await onPage?.(pageIndex, records, headers);

    await require('./adaptive').politeDelay(rateLimitMs, jitterMs);

    const moved = await goToNextPage(page, override);
    if (!moved) break;
    await page.waitForLoadState('networkidle').catch(() => {});
    pageIndex += 1;
  }

  return { lastPage: pageIndex };
}

module.exports = { scrapeListingWithPagination, findResultTable, extractHeaders, extractRows };
