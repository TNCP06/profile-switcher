'use strict';

/* ── KONSTANTA ────────────────────────────────────────────────── */

const AVATAR_COLORS          = ['avatar-purple', 'avatar-green', 'avatar-amber', 'avatar-rose'];
const TOAST_DURATION          = 2200;
const ACTIVE_SESSION_KEY      = 'activeSessionId';
const STORAGE_WARN_THRESHOLD  = 80;
const SW_RETRY_COUNT          = 2;
const SW_RETRY_DELAY_MS       = 300;

/* ── REFERENSI ELEMEN DOM ─────────────────────────────────────── */
const $ = {
  currentDomain:     document.getElementById('current-domain'),
  sessionNameInput:  document.getElementById('session-name-input'),
  btnSave:           document.getElementById('btn-save'),
  btnClearCookies:   document.getElementById('btn-clear-cookies'),
  sessionCount:      document.getElementById('session-count'),
  emptyState:        document.getElementById('empty-state'),
  statusDot:         document.getElementById('status-dot'),
  statusText:        document.getElementById('status-text'),
  toast:             document.getElementById('toast'),
  // Main grid view
  viewMain:          document.getElementById('view-main'),
  sessionGrid:       document.getElementById('session-grid'),
  sessionGridOuter:  document.getElementById('session-grid-outer'),
  btnManage:         document.getElementById('btn-manage'),
  // Domain detail view
  viewDomain:        document.getElementById('view-domain'),
  btnBack:           document.getElementById('btn-back'),
  detailFaviconWrap: document.getElementById('detail-favicon-wrap'),
  detailDomainName:  document.getElementById('detail-domain-name'),
  detailSessionList: document.getElementById('detail-session-list'),
  // Footer
  versionTag:           document.getElementById('version-tag'),
  storageWarning:       document.getElementById('storage-warning'),
  // Import/Export Modal
  btnOpenIo:            document.getElementById('btn-open-io'),
  modalIo:              document.getElementById('modal-io'),
  btnCloseModal:        document.getElementById('btn-close-modal'),
  tabExport:            document.getElementById('tab-export'),
  tabImport:            document.getElementById('tab-import'),
  panelExport:          document.getElementById('panel-export'),
  panelImport:          document.getElementById('panel-import'),
  exportSource:         document.getElementById('export-source'),
  exportFormat:         document.getElementById('export-format'),
  exportPreview:        document.getElementById('export-preview'),
  exportPreviewInfo:    document.getElementById('export-preview-info'),
  btnCopyExport:        document.getElementById('btn-copy-export'),
  btnDownloadExport:    document.getElementById('btn-download-export'),
  importFileInput:      document.getElementById('import-file-input'),
  importFileName:       document.getElementById('import-file-name'),
  importTextarea:       document.getElementById('import-textarea'),
  importDetectedBar:    document.getElementById('import-detected-bar'),
  importDetectedText:   document.getElementById('import-detected-text'),
  importSessionNameRow: document.getElementById('import-session-name-row'),
  importSessionName:    document.getElementById('import-session-name'),
  btnDoImport:          document.getElementById('btn-do-import'),
};

/* ── STATE LOKAL ──────────────────────────────────────────────── */
let activeSessionId     = null;
let currentDetailDomain = null; // domain yang sedang ditampilkan di detail view
let deleteMode          = false;

/* ================================================================
   INISIALISASI
================================================================ */

async function init() {
  setStatus('loading', 'Memuat…');

  try {
    const domain = await getCurrentDomain();
    $.currentDomain.textContent = domain || '—';

    // Restore active session badge across popup open/close cycles
    activeSessionId = await getActiveSessionFromStorage();

    await refreshSessionGrid();

    $.btnSave.addEventListener('click', handleSave);
    $.btnClearCookies.addEventListener('click', handleClearCookies);
    $.sessionNameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleSave();
    });
    $.btnBack.addEventListener('click', hideDomainView);
    $.btnManage.addEventListener('click', toggleDeleteMode);
    $.sessionGrid.addEventListener('scroll', updateScrollFade);

    // Modal Import / Export listeners
    $.btnOpenIo.addEventListener('click', openModalIo);
    $.btnCloseModal.addEventListener('click', closeModalIo);
    $.modalIo.addEventListener('click', (e) => {
      if (e.target === $.modalIo) closeModalIo();
    });
    $.tabExport.addEventListener('click', () => switchIoTab('export'));
    $.tabImport.addEventListener('click', () => switchIoTab('import'));
    $.exportSource.addEventListener('change', updateExportPreview);
    $.exportFormat.addEventListener('change', updateExportPreview);
    $.btnCopyExport.addEventListener('click', handleCopyExport);
    $.btnDownloadExport.addEventListener('click', handleDownloadExport);
    $.importFileInput.addEventListener('change', handleImportFileSelect);
    $.importTextarea.addEventListener('input', handleImportTextInput);
    $.btnDoImport.addEventListener('click', handleExecuteImport);
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && $.modalIo && $.modalIo.style.display !== 'none') {
        closeModalIo();
      }
    });

    // Inject version from manifest so popup.html never needs manual bumping
    $.versionTag.textContent = 'v' + chrome.runtime.getManifest().version;

    // Warn in footer if storage usage exceeds threshold
    const storageRes = await sendMessage({ action: 'GET_STORAGE_INFO' });
    if (storageRes.success && storageRes.data.usedPercent > STORAGE_WARN_THRESHOLD) {
      $.storageWarning.textContent = `⚠ ${storageRes.data.usedPercent}%`;
      $.storageWarning.style.display = 'inline';
    }

    setStatus('ready', 'Storage ready');
  } catch (err) {
    console.error('[SessionSwitcher] init error:', err);
    setStatus('error', 'Gagal memuat');
    showToast('Error saat inisialisasi', 'error');
  }
}

/* ================================================================
   FUNGSI UTAMA: SAVE, LOAD, DELETE
================================================================ */

async function handleSave() {
  const name = $.sessionNameInput.value.trim();

  if (!name) {
    $.sessionNameInput.focus();
    $.sessionNameInput.style.borderColor = '#f43f5e';
    setTimeout(() => { $.sessionNameInput.style.borderColor = ''; }, 1200);
    return;
  }

  setLoadingState(true);
  setStatus('loading', 'Menyimpan session…');

  try {
    const response = await sendMessage({ action: 'SAVE_SESSION', payload: { name } });

    if (response.success) {
      $.sessionNameInput.value = '';
      await refreshSessionGrid();
      if (response.warning) {
        showToast(`⚠ ${response.warning}`, 'warning');
      } else {
        showToast(`✓ "${name}" tersimpan`, 'success');
      }
      setStatus('ready', 'Storage ready');
    } else {
      throw new Error(response.error || 'Gagal menyimpan');
    }
  } catch (err) {
    console.error('[SessionSwitcher] handleSave error:', err);
    showToast('Gagal menyimpan session', 'error');
    setStatus('error', err.message);
  } finally {
    setLoadingState(false);
  }
}

async function handleLoad(sessionId) {
  setLoadingState(true);
  setStatus('loading', 'Memuat session…');

  try {
    const response = await sendMessage({ action: 'LOAD_SESSION', payload: { sessionId } });

    if (response.success) {
      activeSessionId = sessionId;
      await setActiveSessionInStorage(sessionId);
      await refreshSessionGrid();
      const failed = response.data?.failed ?? 0;
      if (failed > 0) {
        showToast(`Session dimuat, ${failed} cookies gagal`, 'error');
      } else {
        showToast('✓ Session berhasil dimuat', 'success');
      }
      setStatus('ready', 'Session aktif');
    } else {
      throw new Error(response.error || 'Gagal memuat session');
    }
  } catch (err) {
    console.error('[SessionSwitcher] handleLoad error:', err);
    showToast('Gagal memuat session', 'error');
    setStatus('error', err.message);
  } finally {
    setLoadingState(false);
  }
}

async function handleDelete(sessionId, sessionName) {
  setLoadingState(true);

  try {
    const response = await sendMessage({ action: 'DELETE_SESSION', payload: { sessionId } });

    if (response.success) {
      if (activeSessionId === sessionId) {
        activeSessionId = null;
        await clearActiveSessionFromStorage();
      }

      await refreshSessionGrid();
      showToast(`"${sessionName}" dihapus`, 'success');

      // Jika sedang di detail view, refresh atau kembali jika domain kosong
      if (currentDetailDomain) {
        const res = await sendMessage({ action: 'GET_ALL_SESSIONS' });
        if (res.success) {
          const remaining = Object.entries(res.data || {})
            .filter(([, d]) => d.domain === currentDetailDomain)
            .map(([id, d]) => ({ sessionId: id, ...d }));

          if (remaining.length === 0) {
            hideDomainView();
          } else {
            renderDetailSessionList(remaining);
          }
        }
      }
    } else {
      throw new Error(response.error || 'Gagal menghapus');
    }
  } catch (err) {
    console.error('[SessionSwitcher] handleDelete error:', err);
    showToast('Gagal menghapus session', 'error');
  } finally {
    setLoadingState(false);
  }
}

async function handleClearCookies() {
  setLoadingState(true);
  setStatus('loading', 'Sedang log out…');

  try {
    const response = await sendMessage({ action: 'CLEAR_CURRENT_COOKIES' });

    if (response.success) {
      activeSessionId = null;
      await clearActiveSessionFromStorage();
      await refreshSessionGrid();

      const count = response.data?.cleared ?? 0;
      if (count > 0) {
        showToast('✓ Berhasil log out', 'success');
      } else {
        showToast('Tidak ada sesi aktif untuk di-log out', 'warning');
      }
      setStatus('ready', 'Logged out');
    } else {
      throw new Error(response.error || 'Gagal log out');
    }
  } catch (err) {
    console.error('[SessionSwitcher] handleClearCookies error:', err);
    showToast('Gagal log out', 'error');
    setStatus('error', err.message);
  } finally {
    setLoadingState(false);
  }
}

/* ================================================================
   RENDER UI — GRID VIEW
================================================================ */

async function refreshSessionGrid() {
  const response = await sendMessage({ action: 'GET_ALL_SESSIONS' });

  if (!response.success) {
    console.error('[SessionSwitcher] Gagal mengambil sessions:', response.error);
    return;
  }

  const sessions = response.data || {};
  renderSessionGrid(sessions);

  // Refresh detail view jika sedang terbuka
  if (currentDetailDomain) {
    const remaining = Object.entries(sessions)
      .filter(([, d]) => d.domain === currentDetailDomain)
      .map(([id, d]) => ({ sessionId: id, ...d }));

    if (remaining.length === 0) {
      hideDomainView();
    } else {
      renderDetailSessionList(remaining);
    }
  }
}

function renderSessionGrid(sessions) {
  const entries = Object.entries(sessions);

  $.sessionCount.textContent = `${entries.length} session${entries.length !== 1 ? 's' : ''}`;

  if (entries.length === 0) {
    $.sessionGrid.style.display = 'none';
    $.emptyState.style.display  = 'flex';
    exitDeleteMode();
    return;
  }

  $.emptyState.style.display  = 'none';
  $.sessionGrid.style.display = 'grid';

  // Kelompokkan per domain
  const byDomain = {};
  for (const [sessionId, data] of entries) {
    const domain = data.domain || 'unknown';
    if (!byDomain[domain]) byDomain[domain] = [];
    byDomain[domain].push({ sessionId, ...data });
  }

  // Urutkan domain berdasarkan session terbaru
  const sortedDomains = Object.keys(byDomain).sort((a, b) => {
    const latestA = Math.max(...byDomain[a].map((s) => s.savedAt || 0));
    const latestB = Math.max(...byDomain[b].map((s) => s.savedAt || 0));
    return latestB - latestA;
  });

  $.sessionGrid.innerHTML = '';

  sortedDomains.forEach((domain, index) => {
    const domainSessions = byDomain[domain].sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
    $.sessionGrid.appendChild(createDomainCard(domain, domainSessions, index));
  });

  // Preserve delete mode visual state setelah re-render
  $.sessionGrid.classList.toggle('delete-mode', deleteMode);

  requestAnimationFrame(updateScrollFade);
}

function createDomainCard(domain, sessions, index) {
  const isMulti    = sessions.length > 1;
  const solo       = sessions[0];
  const isActive   = !isMulti && solo.sessionId === activeSessionId;

  const card = document.createElement('div');
  card.className = `site-card${isActive ? ' is-active' : ''}${isMulti ? ' is-multi' : ''}`;

  // Badge count untuk domain dengan banyak session
  if (isMulti) {
    const badge = document.createElement('span');
    badge.className = 'multi-badge';
    badge.textContent = sessions.length;
    card.appendChild(badge);
  }

  // Favicon
  const faviconWrap = document.createElement('div');
  faviconWrap.className = 'favicon-wrap';
  buildFaviconEl(faviconWrap, domain, 24);
  card.appendChild(faviconWrap);

  // Label: nama session (1 session) atau nama domain (banyak session)
  const label = document.createElement('span');
  label.className = 'card-label';
  label.textContent = isMulti ? domain : solo.name;
  card.appendChild(label);

  // Meta (hanya untuk single session)
  if (!isMulti) {
    const meta = document.createElement('span');
    meta.className = 'card-meta';
    meta.textContent = formatTimeAgo(solo.savedAt);
    card.appendChild(meta);
  }

  card.addEventListener('click', () => {
    if (deleteMode) {
      if (isMulti) {
        // Buka detail view agar user bisa pilih session mana yang dihapus
        showDomainView(domain, sessions);
      } else {
        handleDelete(solo.sessionId, solo.name);
      }
      return;
    }
    if (isMulti) {
      showDomainView(domain, sessions);
    } else {
      handleLoad(solo.sessionId);
    }
  });

  return card;
}

/* ================================================================
   RENDER UI — DOMAIN DETAIL VIEW
================================================================ */

function showDomainView(domain, sessions) {
  currentDetailDomain = domain;

  // Favicon di header detail
  $.detailFaviconWrap.innerHTML = '';
  buildFaviconEl($.detailFaviconWrap, domain, 16);

  $.detailDomainName.textContent = domain;
  renderDetailSessionList(sessions);

  $.viewMain.style.display   = 'none';
  $.viewDomain.style.display = 'block';
}

function hideDomainView() {
  currentDetailDomain = null;
  $.viewDomain.style.display = 'none';
  $.viewMain.style.display   = 'block';
  exitDeleteMode();
}

function renderDetailSessionList(sessions) {
  $.detailSessionList.innerHTML = '';
  sessions.forEach((session, index) => {
    $.detailSessionList.appendChild(createDetailItem(session, index));
  });
}

function createDetailItem(session, index) {
  const { sessionId, name, savedAt, cookieCount } = session;
  const isActive = sessionId === activeSessionId;

  const item = document.createElement('div');
  item.className = `session-item${isActive ? ' is-active' : ''}`;

  // Avatar dengan inisial nama session
  const avatar = document.createElement('div');
  avatar.className = `session-avatar ${AVATAR_COLORS[index % AVATAR_COLORS.length]}`;
  avatar.textContent = (name || '?')[0].toUpperCase();

  // Info
  const info = document.createElement('div');
  info.className = 'session-info';

  const nameEl = document.createElement('div');
  nameEl.className = 'session-name';
  nameEl.textContent = name;

  const metaEl = document.createElement('div');
  metaEl.className = 'session-meta';
  metaEl.textContent = `${isActive ? '● active · ' : ''}${formatTimeAgo(savedAt)} · ${cookieCount || 0} cookies`;

  info.appendChild(nameEl);
  info.appendChild(metaEl);

  // Action buttons
  const actions = document.createElement('div');
  actions.className = 'session-actions';

  const btnLoad = document.createElement('button');
  btnLoad.className = 'btn-load';
  btnLoad.textContent = 'Load';
  btnLoad.addEventListener('click', (e) => {
    e.stopPropagation();
    handleLoad(sessionId);
  });

  const btnDelete = document.createElement('button');
  btnDelete.className = 'btn-delete';
  btnDelete.textContent = '✕';
  btnDelete.title = 'Hapus session';
  btnDelete.addEventListener('click', (e) => {
    e.stopPropagation();
    handleDelete(sessionId, name);
  });

  actions.appendChild(btnLoad);
  actions.appendChild(btnDelete);

  item.appendChild(avatar);
  item.appendChild(info);
  item.appendChild(actions);

  return item;
}

/* ================================================================
   DELETE MODE
================================================================ */

function toggleDeleteMode() {
  deleteMode = !deleteMode;
  $.sessionGrid.classList.toggle('delete-mode', deleteMode);
  $.btnManage.classList.toggle('is-active', deleteMode);
}

function exitDeleteMode() {
  if (!deleteMode) return;
  deleteMode = false;
  $.sessionGrid.classList.remove('delete-mode');
  $.btnManage.classList.remove('is-active');
}

/* ================================================================
   HELPER: FAVICON
================================================================ */

/*
  Memuat favicon via Google Favicon Service — works for any known domain
  tanpa perlu kunjungi situs tersebut lebih dulu.
  Fallback ke huruf pertama domain jika offline atau domain tidak dikenal.
*/
function buildFaviconEl(container, domain, displaySize) {
  const img = document.createElement('img');
  img.className = 'site-favicon';
  img.width     = displaySize;
  img.height    = displaySize;
  img.alt       = '';

  img.addEventListener('error', () => {
    container.innerHTML = '';
    const fallback = document.createElement('span');
    fallback.className   = 'favicon-fallback';
    fallback.textContent = (domain || '?')[0].toUpperCase();
    container.appendChild(fallback);
  }, { once: true });

  container.appendChild(img);
  img.src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`;
}

/* ================================================================
   HELPER: SCROLL FADE
================================================================ */

function updateScrollFade() {
  const grid = $.sessionGrid;
  const isScrollable = grid.scrollHeight > grid.clientHeight;
  const atBottom     = grid.scrollTop + grid.clientHeight >= grid.scrollHeight - 2;
  $.sessionGridOuter.classList.toggle('has-overflow', isScrollable && !atBottom);
}

/* ================================================================
   HELPER: KOMUNIKASI BACKGROUND
================================================================ */

/*
  MV3 Service Workers can be suspended and may not be awake when the
  popup first opens, causing sendMessage to fail with "Could not establish
  connection." We retry up to SW_RETRY_COUNT times with a short delay
  before surfacing the error to the caller.
*/
async function sendMessage(message) {
  for (let attempt = 0; attempt <= SW_RETRY_COUNT; attempt++) {
    try {
      return await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve(response);
        });
      });
    } catch (err) {
      const isConnectionErr = err.message && err.message.includes('Could not establish connection');
      if (!isConnectionErr || attempt === SW_RETRY_COUNT) throw err;
      await new Promise(r => setTimeout(r, SW_RETRY_DELAY_MS));
    }
  }
}

/* ================================================================
   HELPER: TAB & DOMAIN
================================================================ */

function getCurrentDomain() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError || !tabs || !tabs[0] || !tabs[0].url) {
        resolve(null);
        return;
      }
      try {
        resolve(new URL(tabs[0].url).host);
      } catch {
        resolve(null);
      }
    });
  });
}

/* ================================================================
   HELPER: FEEDBACK UI
================================================================ */

function setLoadingState(isLoading) {
  $.btnSave.disabled         = isLoading;
  $.btnClearCookies.disabled = isLoading;
  if ($.btnOpenIo) $.btnOpenIo.disabled = isLoading;

  document.querySelectorAll('.btn-load, .btn-delete').forEach((btn) => {
    btn.disabled = isLoading;
  });
}

function setStatus(type, text) {
  $.statusDot.classList.remove('dot-ready', 'dot-loading', 'dot-error');
  $.statusDot.classList.add(`dot-${type}`);
  $.statusText.textContent = text;
}

function showToast(message, type = 'success') {
  if (showToast.timer) clearTimeout(showToast.timer);

  $.toast.textContent = message;
  $.toast.className   = `toast toast-${type} toast-visible`;

  showToast.timer = setTimeout(() => {
    $.toast.className = 'toast toast-hidden';
  }, TOAST_DURATION);
}

/* ================================================================
   HELPER: SESSION STORAGE (activeSessionId persistence)
================================================================ */

/*
  chrome.storage.session persists within a browser session (survives popup
  close/open) but clears automatically when the browser closes.
  Requires Chrome 102+.
*/
function getActiveSessionFromStorage() {
  return new Promise((resolve) => {
    chrome.storage.session.get(ACTIVE_SESSION_KEY, (result) => {
      resolve(result[ACTIVE_SESSION_KEY] || null);
    });
  });
}

function setActiveSessionInStorage(sessionId) {
  return new Promise((resolve) => {
    chrome.storage.session.set({ [ACTIVE_SESSION_KEY]: sessionId }, resolve);
  });
}

function clearActiveSessionFromStorage() {
  return new Promise((resolve) => {
    chrome.storage.session.remove(ACTIVE_SESSION_KEY, resolve);
  });
}

/* ================================================================
   HELPER: FORMAT WAKTU
================================================================ */

function formatTimeAgo(timestamp) {
  if (!timestamp) return 'saved recently';

  const diffMs  = Date.now() - timestamp;
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHr  = Math.floor(diffMs / 3_600_000);
  const diffDay = Math.floor(diffMs / 86_400_000);

  if (diffMin < 1)   return 'just now';
  if (diffMin < 60)  return `saved ${diffMin}m ago`;
  if (diffHr  < 24)  return `saved ${diffHr}h ago`;
  if (diffDay < 30)  return `saved ${diffDay}d ago`;
  return 'saved long ago';
}

/* ================================================================
   MODAL IMPORT / EXPORT LOGIC & FORMAT CONVERTERS
================================================================ */

let parsedImportData = null;

async function openModalIo() {
  $.modalIo.style.display = 'flex';
  switchIoTab('export');

  // Reset import form
  $.importFileInput.value = '';
  $.importFileName.textContent = 'atau paste teks:';
  $.importTextarea.value = '';
  $.importDetectedBar.style.display = 'none';
  $.importSessionNameRow.style.display = 'none';
  $.importSessionName.value = '';
  $.btnDoImport.disabled = true;
  parsedImportData = null;

  // Sesuaikan opsi sumber export jika sedang di detail view
  const sourceSelect = $.exportSource;
  const existingDomainOpt = sourceSelect.querySelector('option[value="detail"]');
  if (existingDomainOpt) existingDomainOpt.remove();

  if (currentDetailDomain) {
    const opt = document.createElement('option');
    opt.value = 'detail';
    opt.textContent = `Sesi Domain Ini (${currentDetailDomain})`;
    sourceSelect.appendChild(opt);
  }

  await updateExportPreview();
}

function closeModalIo() {
  $.modalIo.style.display = 'none';
}

function switchIoTab(tab) {
  if (tab === 'export') {
    $.tabExport.classList.add('active');
    $.tabImport.classList.remove('active');
    $.panelExport.style.display = 'flex';
    $.panelImport.style.display = 'none';
    updateExportPreview();
  } else {
    $.tabExport.classList.remove('active');
    $.tabImport.classList.add('active');
    $.panelExport.style.display = 'none';
    $.panelImport.style.display = 'flex';
  }
}

async function updateExportPreview() {
  const source = $.exportSource.value;
  const format = $.exportFormat.value;

  $.exportPreview.value = 'Memuat data…';
  $.exportPreviewInfo.textContent = '…';

  try {
    if (source === 'all') {
      const res = await sendMessage({ action: 'GET_ALL_SESSIONS' });
      const sessions = res.success ? (res.data || {}) : {};
      const count = Object.keys(sessions).length;

      if (format === 'json-standard') {
        const allCookies = Object.values(sessions).flatMap(s => s.cookies || []);
        $.exportPreview.value = cookiesToStandardJson(allCookies);
        $.exportPreviewInfo.textContent = `${count} sesi (${allCookies.length} cookies)`;
      } else if (format === 'netscape') {
        const allCookies = Object.values(sessions).flatMap(s => s.cookies || []);
        $.exportPreview.value = cookiesToNetscape(allCookies);
        $.exportPreviewInfo.textContent = `${allCookies.length} cookies`;
      } else if (format === 'header') {
        const allCookies = Object.values(sessions).flatMap(s => s.cookies || []);
        $.exportPreview.value = cookiesToHeaderString(allCookies);
        $.exportPreviewInfo.textContent = `${allCookies.length} cookies`;
      } else {
        $.exportPreview.value = sessionsToBackupJson(sessions);
        $.exportPreviewInfo.textContent = `${count} sesi total`;
      }
    } else if (source === 'detail' && currentDetailDomain) {
      const res = await sendMessage({ action: 'GET_ALL_SESSIONS' });
      const allSessions = res.success ? (res.data || {}) : {};
      const domainSessions = {};
      let cookiesCount = 0;
      for (const [id, s] of Object.entries(allSessions)) {
        if (s.domain === currentDetailDomain) {
          domainSessions[id] = s;
          cookiesCount += (s.cookies || []).length;
        }
      }

      if (format === 'json-standard') {
        const cookies = Object.values(domainSessions).flatMap(s => s.cookies || []);
        $.exportPreview.value = cookiesToStandardJson(cookies);
        $.exportPreviewInfo.textContent = `${cookies.length} cookies`;
      } else if (format === 'netscape') {
        const cookies = Object.values(domainSessions).flatMap(s => s.cookies || []);
        $.exportPreview.value = cookiesToNetscape(cookies);
        $.exportPreviewInfo.textContent = `${cookies.length} cookies`;
      } else if (format === 'header') {
        const cookies = Object.values(domainSessions).flatMap(s => s.cookies || []);
        $.exportPreview.value = cookiesToHeaderString(cookies);
        $.exportPreviewInfo.textContent = `${cookies.length} cookies`;
      } else {
        $.exportPreview.value = sessionsToBackupJson(domainSessions);
        $.exportPreviewInfo.textContent = `${Object.keys(domainSessions).length} sesi`;
      }
    } else {
      const res = await sendMessage({ action: 'GET_CURRENT_TAB_COOKIES' });
      if (!res.success) {
        $.exportPreview.value = `Gagal membaca cookies tab: ${res.error || 'Unknown error'}`;
        $.exportPreviewInfo.textContent = '0 cookie';
        return;
      }

      const cookies = res.data?.cookies || [];
      if (format === 'json-standard') {
        $.exportPreview.value = cookiesToStandardJson(cookies);
      } else if (format === 'netscape') {
        $.exportPreview.value = cookiesToNetscape(cookies);
      } else if (format === 'header') {
        $.exportPreview.value = cookiesToHeaderString(cookies);
      } else {
        const domain = res.data?.domain || 'current';
        const singleSession = {
          name: `${domain} (Snapshot)`,
          domain,
          url: res.data?.url || `https://${domain}/`,
          extraDomains: [],
          savedAt: Date.now(),
          cookieCount: cookies.length,
          cookies,
        };
        $.exportPreview.value = sessionsToBackupJson({ [`session_${Date.now()}`]: singleSession });
      }
      $.exportPreviewInfo.textContent = `${cookies.length} cookies`;
    }
  } catch (err) {
    console.error('[Popup] updateExportPreview error:', err);
    $.exportPreview.value = `Error: ${err.message}`;
  }
}

async function handleCopyExport() {
  const text = $.exportPreview.value;
  if (!text || text.startsWith('Memuat') || text.startsWith('Gagal') || text.startsWith('Error')) return;

  try {
    await navigator.clipboard.writeText(text);
    showToast('✓ Disalin ke clipboard', 'success');
  } catch (err) {
    showToast('Gagal menyalin ke clipboard', 'error');
  }
}

function handleDownloadExport() {
  const text = $.exportPreview.value;
  if (!text || text.startsWith('Memuat') || text.startsWith('Gagal') || text.startsWith('Error')) return;

  const format = $.exportFormat.value;
  const isAll = $.exportSource.value === 'all';
  const ext = format === 'netscape' || format === 'header' ? 'txt' : 'json';
  const mime = format === 'netscape' || format === 'header' ? 'text/plain' : 'application/json';
  const domainPart = isAll ? 'all-sessions' : ($.currentDomain.textContent || 'cookies').replace(/[^a-zA-Z0-9.-]/g, '_');
  const filename = `profile_switcher_${domainPart}_${Date.now()}.${ext}`;

  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast('✓ Unduhan dimulai', 'success');
}

function handleImportFileSelect(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  $.importFileName.textContent = file.name;
  const reader = new FileReader();
  reader.onload = (event) => {
    $.importTextarea.value = event.target?.result || '';
    handleImportTextInput();
  };
  reader.readAsText(file);
}

function handleImportTextInput() {
  const text = $.importTextarea.value.trim();
  if (!text) {
    $.importDetectedBar.style.display = 'none';
    $.importSessionNameRow.style.display = 'none';
    $.btnDoImport.disabled = true;
    parsedImportData = null;
    return;
  }

  const parsed = detectAndParseImport(text);
  if (!parsed) {
    $.importDetectedBar.style.display = 'block';
    $.importDetectedBar.style.borderColor = 'rgba(244, 63, 94, 0.4)';
    $.importDetectedBar.style.background = 'rgba(244, 63, 94, 0.12)';
    $.importDetectedText.style.color = '#f43f5e';
    $.importDetectedText.textContent = '⚠ Format tidak dikenali (gunakan JSON atau Netscape)';
    $.importSessionNameRow.style.display = 'none';
    $.btnDoImport.disabled = true;
    parsedImportData = null;
    return;
  }

  parsedImportData = parsed;
  $.importDetectedBar.style.display = 'block';
  $.importDetectedBar.style.borderColor = 'rgba(16, 185, 129, 0.4)';
  $.importDetectedBar.style.background = 'rgba(16, 185, 129, 0.12)';
  $.importDetectedText.style.color = 'var(--success)';

  if (parsed.type === 'backup') {
    $.importDetectedText.textContent = `✓ Format Backup Profil: ${parsed.count} sesi siap diimpor`;
    $.importSessionNameRow.style.display = 'none';
    $.btnDoImport.disabled = false;
  } else {
    const typeLabel = parsed.type === 'single-session' ? 'Single Profile' : 'Cookie Array / Netscape';
    $.importDetectedText.textContent = `✓ ${typeLabel}: ${parsed.count} cookies (${parsed.domain})`;
    $.importSessionNameRow.style.display = 'flex';
    if (!$.importSessionName.value) {
      $.importSessionName.value = parsed.name || `${parsed.domain} (Imported)`;
    }
    $.btnDoImport.disabled = false;
  }
}

async function handleExecuteImport() {
  if (!parsedImportData) return;

  setLoadingState(true);
  setStatus('loading', 'Mengimpor data…');

  try {
    if (parsedImportData.type === 'backup') {
      const res = await sendMessage({
        action: 'IMPORT_SESSIONS',
        payload: { sessions: parsedImportData.sessions }
      });
      if (res.success) {
        closeModalIo();
        await refreshSessionGrid();
        showToast(`✓ Berhasil mengimpor ${res.data?.count || 0} sesi`, 'success');
        setStatus('ready', 'Storage ready');
      } else {
        throw new Error(res.error || 'Gagal mengimpor backup');
      }
    } else {
      const name = $.importSessionName.value.trim() || `${parsedImportData.domain} (Imported)`;
      const res = await sendMessage({
        action: 'IMPORT_SINGLE_SESSION',
        payload: {
          name,
          domain: parsedImportData.domain,
          cookies: parsedImportData.cookies,
          url: parsedImportData.session?.url
        }
      });
      if (res.success) {
        closeModalIo();
        await refreshSessionGrid();
        showToast(`✓ Sesi "${name}" berhasil diimpor`, 'success');
        setStatus('ready', 'Storage ready');
      } else {
        throw new Error(res.error || 'Gagal mengimpor sesi');
      }
    }
  } catch (err) {
    console.error('[Popup] handleExecuteImport error:', err);
    showToast(err.message, 'error');
    setStatus('error', err.message);
  } finally {
    setLoadingState(false);
  }
}

function cookiesToNetscape(cookies) {
  let output = '# Netscape HTTP Cookie File\n# Generated by Profile Switcher\n\n';
  for (const c of cookies) {
    const domain = c.domain || '';
    const flag = domain.startsWith('.') ? 'TRUE' : 'FALSE';
    const path = c.path || '/';
    const secure = c.secure ? 'TRUE' : 'FALSE';
    const expiry = c.expirationDate ? Math.round(c.expirationDate) : 0;
    const name = c.name || '';
    const value = c.value || '';
    output += `${domain}\t${flag}\t${path}\t${secure}\t${expiry}\t${name}\t${value}\n`;
  }
  return output;
}

function parseNetscape(text) {
  const lines = text.split('\n');
  const cookies = [];
  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split('\t');
    if (parts.length >= 7) {
      cookies.push({
        domain: parts[0],
        path: parts[2] || '/',
        secure: parts[3].toUpperCase() === 'TRUE',
        expirationDate: parseInt(parts[4], 10) || undefined,
        name: parts[5],
        value: parts[6],
        sameSite: 'unspecified',
        httpOnly: false,
      });
    }
  }
  return cookies;
}

function cookiesToStandardJson(cookies) {
  const clean = cookies.map(c => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path || '/',
    secure: Boolean(c.secure),
    httpOnly: Boolean(c.httpOnly),
    sameSite: c.sameSite || 'unspecified',
    expirationDate: c.expirationDate,
  }));
  return JSON.stringify(clean, null, 2);
}

function cookiesToHeaderString(cookies) {
  return cookies.map(c => `${c.name}=${c.value}`).join('; ');
}

function sessionsToBackupJson(sessions) {
  return JSON.stringify({
    version: 1,
    exportedAt: Date.now(),
    sessions: sessions,
  }, null, 2);
}

function detectAndParseImport(text) {
  text = text.trim();
  if (!text) return null;

  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      const data = JSON.parse(text);
      if (Array.isArray(data)) {
        if (data.length === 0) return null;
        return {
          type: 'cookie-array',
          cookies: data,
          domain: data[0]?.domain ? data[0].domain.replace(/^\./, '') : 'unknown',
          count: data.length,
        };
      }
      if (data.version && data.sessions && typeof data.sessions === 'object') {
        const count = Object.keys(data.sessions).length;
        return {
          type: 'backup',
          sessions: data.sessions,
          count,
        };
      }
      if (data.cookies && Array.isArray(data.cookies)) {
        return {
          type: 'single-session',
          session: data,
          cookies: data.cookies,
          domain: data.domain || (data.cookies[0]?.domain ? data.cookies[0].domain.replace(/^\./, '') : 'unknown'),
          name: data.name || '',
          count: data.cookies.length,
        };
      }
      const values = Object.values(data);
      if (values.length > 0 && values[0]?.cookies && Array.isArray(values[0].cookies)) {
        return {
          type: 'backup',
          sessions: data,
          count: values.length,
        };
      }
    } catch {
      // bukan JSON valid, lanjut coba Netscape
    }
  }

  const netscapeCookies = parseNetscape(text);
  if (netscapeCookies.length > 0) {
    return {
      type: 'cookie-array',
      cookies: netscapeCookies,
      domain: netscapeCookies[0]?.domain ? netscapeCookies[0].domain.replace(/^\./, '') : 'unknown',
      count: netscapeCookies.length,
    };
  }

  return null;
}

/* ================================================================
   JALANKAN
================================================================ */

init();
