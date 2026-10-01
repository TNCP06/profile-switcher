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
  versionTag:        document.getElementById('version-tag'),
  storageWarning:    document.getElementById('storage-warning'),
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
   JALANKAN
================================================================ */

init();
