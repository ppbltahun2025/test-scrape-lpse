(function () {
  const state = { lpseList: [], tabs: [], currentJobId: null, pollTimer: null };

  const el = (id) => document.getElementById(id);

  async function loadLpseList(query) {
    const res = await fetch('/api/lpse' + (query ? `?q=${encodeURIComponent(query)}` : ''));
    state.lpseList = await res.json();
    renderLpseList();
  }

  function renderLpseList() {
    const wrap = el('lpseList');
    wrap.innerHTML = '';
    if (state.lpseList.length === 0) {
      wrap.innerHTML = '<em>Tidak ada hasil. Tambahkan manual di bawah.</em>';
      return;
    }
    for (const item of state.lpseList) {
      const label = document.createElement('label');
      label.innerHTML = `<input type="checkbox" value="${item.code}" /> ${item.name} <code>(${item.code})</code>`;
      wrap.appendChild(label);
    }
  }

  async function loadTabs() {
    const res = await fetch('/api/tabs');
    state.tabs = await res.json();
    const wrap = el('tabList');
    wrap.innerHTML = '';
    for (const t of state.tabs) {
      const label = document.createElement('label');
      label.innerHTML = `<input type="checkbox" value="${t.key}" checked /> ${t.label}`;
      wrap.appendChild(label);
    }
  }

  function loadYears() {
    const sel = el('tahun');
    const now = new Date().getFullYear();
    for (let y = now + 1; y >= 2015; y--) {
      const opt = document.createElement('option');
      opt.value = y;
      opt.textContent = y;
      sel.appendChild(opt);
    }
  }

  function getCheckedValues(containerId) {
    return Array.from(document.querySelectorAll(`#${containerId} input[type=checkbox]:checked`)).map((c) => c.value);
  }

  async function runJob() {
    const lpseCodes = getCheckedValues('lpseList');
    const tabs = getCheckedValues('tabList');
    if (lpseCodes.length === 0) return alert('Pilih minimal satu LPSE.');
    if (tabs.length === 0) return alert('Pilih minimal satu jenis pengadaan.');

    const body = {
      lpseCodes,
      tabs,
      tahun: el('tahun').value,
      fetchDetail: el('fetchDetail').checked,
      rateLimitMs: Number(el('rateLimitMs').value),
    };

    const res = await fetch('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.error) return alert(data.error);

    state.currentJobId = data.jobId;
    localStorage.setItem('lastJobId', data.jobId);
    el('progressWrap').classList.remove('hidden');
    el('cancelBtn').disabled = false;
    el('runBtn').disabled = true;
    startPolling();
  }

  function startPolling() {
    clearInterval(state.pollTimer);
    state.pollTimer = setInterval(pollStatus, 1500);
    pollStatus();
  }

  async function pollStatus() {
    if (!state.currentJobId) return;
    const res = await fetch(`/api/jobs/${state.currentJobId}`);
    if (!res.ok) return;
    const data = await res.json();
    renderProgress(data);
    if (['done', 'error', 'cancelled'].includes(data.status)) {
      clearInterval(state.pollTimer);
      el('runBtn').disabled = false;
      el('cancelBtn').disabled = true;
      if (data.status === 'done') loadResults();
    }
  }

  function renderProgress(data) {
    const counters = (data.progress && data.progress.counters) || {};
    el('progressText').textContent =
      `Status: ${data.status} — halaman: ${counters.pages || 0}, baris: ${counters.rows || 0}, detail ok: ${counters.details || 0}, detail gagal: ${counters.detailErrors || 0}`;
    const fill = Math.min(100, (counters.pages || 0) * 5); // estimasi kasar, karena total halaman tidak diketahui di awal
    el('progressFill').style.width = fill + '%';
    const log = (data.progress && data.progress.log) || [];
    el('logBox').textContent = log.join('\n');
    el('logBox').scrollTop = el('logBox').scrollHeight;
  }

  async function loadResults() {
    const res = await fetch(`/api/jobs/${state.currentJobId}/results?limit=50`);
    const data = await res.json();
    el('resultActions').classList.remove('hidden');
    el('downloadXlsx').href = `/api/jobs/${state.currentJobId}/export.xlsx`;
    el('downloadCsv').href = `/api/jobs/${state.currentJobId}/export.csv`;

    const wrap = el('resultTableWrap');
    if (data.rows.length === 0) {
      wrap.innerHTML = '<p>Belum ada baris hasil.</p>';
      return;
    }
    const cols = ['lpse_code', 'tab_key', 'kode_paket', 'nama_paket', 'instansi', 'tahapan', 'pagu', 'hps'];
    let html = `<p>Menampilkan ${data.rows.length} dari total ${data.total} baris.</p><table><thead><tr>${cols
      .map((c) => `<th>${c}</th>`)
      .join('')}</tr></thead><tbody>`;
    for (const row of data.rows) {
      html += `<tr>${cols.map((c) => `<td>${row[c] ?? ''}</td>`).join('')}</tr>`;
    }
    html += '</tbody></table>';
    wrap.innerHTML = html;
  }

  el('runBtn').addEventListener('click', runJob);
  el('cancelBtn').addEventListener('click', async () => {
    await fetch(`/api/jobs/${state.currentJobId}/cancel`, { method: 'POST' });
  });
  el('resumeBtn').addEventListener('click', async () => {
    const jobId = localStorage.getItem('lastJobId');
    if (!jobId) return;
    const res = await fetch(`/api/jobs/${jobId}/resume`, { method: 'POST' });
    const data = await res.json();
    if (data.error) return alert(data.error);
    state.currentJobId = jobId;
    el('progressWrap').classList.remove('hidden');
    el('cancelBtn').disabled = false;
    el('runBtn').disabled = true;
    startPolling();
  });
  el('addLpseBtn').addEventListener('click', async () => {
    const code = el('newLpseCode').value.trim();
    const name = el('newLpseName').value.trim();
    if (!code || !name) return alert('Isi kode dan nama LPSE.');
    await fetch('/api/lpse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, name }),
    });
    el('newLpseCode').value = '';
    el('newLpseName').value = '';
    loadLpseList(el('lpseSearch').value);
  });
  el('lpseSearch').addEventListener('input', (e) => loadLpseList(e.target.value));

  // Cek kalau ada job sebelumnya yang bisa di-resume.
  (async function initResumeCheck() {
    const jobId = localStorage.getItem('lastJobId');
    if (!jobId) return;
    const res = await fetch(`/api/jobs/${jobId}`);
    if (!res.ok) return;
    const data = await res.json();
    if (data.status === 'interrupted' || data.status === 'error') {
      el('resumeBtn').disabled = false;
    }
  })();

  loadLpseList();
  loadTabs();
  loadYears();
})();
