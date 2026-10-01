/**
 * utils/storageManager.js — Abstraksi chrome.storage.local
 * ==========================================================
 * Semua baca/tulis ke chrome.storage.local terpusat di sini.
 * background.js TIDAK boleh memanggil chrome.storage langsung —
 * selalu lewat module ini agar mudah di-debug dan di-test.
 *
 * KENAPA ABSTRAKSI INI PENTING?
 * chrome.storage.local menyimpan semua data dalam satu "flat" object.
 * Module ini mengelola struktur internal:
 *
 *   chrome.storage.local = {
 *     "sessions": {
 *       "session_1714000000000": { ...sessionData },
 *       "session_1714000001000": { ...sessionData },
 *     }
 *   }
 *
 * Semua session disimpan di bawah satu key "sessions" (bukan key
 * terpisah per session) karena:
 * 1. Atomic read — satu get() mendapat semua session sekaligus
 * 2. Atomic write — satu set() update semua session tanpa race condition
 * 3. Mudah di-reset — hapus key "sessions" = bersih semua
 *
 * CATATAN PENTING — CHROME.STORAGE LIMITS:
 * - chrome.storage.local: ~5MB total (cukup untuk ratusan session)
 * - chrome.storage.sync: hanya 100KB (TIDAK cocok untuk cookies)
 * - Tidak ada enkripsi — data tersimpan plain text di disk lokal user
 */

'use strict';

/** Key utama di chrome.storage.local yang menampung semua sessions */
const STORAGE_KEY = 'sessions';

/* ================================================================
   READ OPERATIONS
================================================================ */

/**
 * getAllSessions() — Ambil semua session dari storage.
 *
 * @returns {Promise<Object>} - Object { [sessionId]: sessionData }
 *                              atau {} jika belum ada session apapun
 *
 * Selalu kembalikan object (bukan null/undefined) agar caller
 * tidak perlu null-check setiap kali.
 */
async function getAllSessions() {
  try {
    const result = await chromeStorageGet(STORAGE_KEY);
    // Jika key belum ada (fresh install), kembalikan object kosong
    return result[STORAGE_KEY] || {};
  } catch (err) {
    console.error('[StorageManager] getAllSessions error:', err);
    throw err;
  }
}

/**
 * getSession(sessionId) — Ambil satu session berdasarkan ID.
 *
 * @param {string} sessionId
 * @returns {Promise<Object|null>} - sessionData atau null jika tidak ditemukan
 */
async function getSession(sessionId) {
  try {
    const sessions = await getAllSessions();
    return sessions[sessionId] || null;
  } catch (err) {
    console.error('[StorageManager] getSession error:', err);
    throw err;
  }
}

/* ================================================================
   WRITE OPERATIONS
================================================================ */

/**
 * saveSession(sessionId, sessionData) — Simpan atau update satu session.
 *
 * @param {string} sessionId   - Key unik, biasanya "session_" + Date.now()
 * @param {Object} sessionData - Data session lengkap (lihat format di bawah)
 *
 * Format sessionData yang diharapkan:
 * {
 *   name: string,           // nama yang diberi user
 *   domain: string,         // hostname domain, contoh: "app.example.com"
 *   savedAt: number,        // Date.now() saat save
 *   cookieCount: number,    // jumlah cookies (untuk tampilan UI)
 *   cookies: Array<Object>  // snapshot cookies lengkap
 * }
 *
 * POLA BACA-MODIFIKASI-TULIS:
 * Kita tidak bisa hanya set satu key karena chrome.storage.local
 * bekerja seperti Object.assign — set({ sessions: newData }) akan
 * MENGGANTI seluruh "sessions", bukan merge per-item.
 * Jadi kita harus:
 * 1. Baca semua sessions yang ada
 * 2. Tambahkan/update session baru
 * 3. Tulis kembali seluruh object sessions
 */
async function saveSession(sessionId, sessionData) {
  try {
    // 1. Baca state saat ini
    const sessions = await getAllSessions();

    // 2. Tambahkan session baru (atau timpa jika ID sudah ada)
    sessions[sessionId] = sessionData;

    // 3. Tulis kembali seluruh object
    await chromeStorageSet({ [STORAGE_KEY]: sessions });

    console.log(`[StorageManager] Session saved: ${sessionId} (${sessionData.name})`);
  } catch (err) {
    console.error('[StorageManager] saveSession error:', err);
    throw err;
  }
}

/**
 * importSessions(newSessions) — Merge object sessions yang diimpor ke storage.
 *
 * @param {Object} newSessions - Object { [sessionId]: sessionData }
 * @returns {Promise<{ importedCount: number }>}
 */
async function importSessions(newSessions) {
  try {
    const existing = await getAllSessions();
    let importedCount = 0;

    for (const [id, sessionData] of Object.entries(newSessions)) {
      if (!sessionData || !sessionData.cookies || !Array.isArray(sessionData.cookies)) {
        continue;
      }
      let targetId = id;
      if (existing[targetId]) {
        targetId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      }

      existing[targetId] = {
        name: sessionData.name || 'Imported Session',
        domain: sessionData.domain || 'unknown',
        url: sessionData.url || `https://${sessionData.domain || ''}/`,
        extraDomains: sessionData.extraDomains || [],
        savedAt: sessionData.savedAt || Date.now(),
        cookieCount: sessionData.cookies.length,
        cookies: sessionData.cookies,
      };
      importedCount++;
    }

    await chromeStorageSet({ [STORAGE_KEY]: existing });
    return { importedCount };
  } catch (err) {
    console.error('[StorageManager] importSessions error:', err);
    throw err;
  }
}

/**
 * deleteSession(sessionId) — Hapus satu session dari storage.
 *
 * @param {string} sessionId
 * @throws {Error} jika sessionId tidak ditemukan
 */
async function deleteSession(sessionId) {
  try {
    const sessions = await getAllSessions();

    if (!sessions[sessionId]) {
      throw new Error(`Session "${sessionId}" tidak ditemukan`);
    }

    // Hapus property dari object menggunakan delete operator
    delete sessions[sessionId];

    // Tulis kembali object yang sudah dikurangi
    await chromeStorageSet({ [STORAGE_KEY]: sessions });

    console.log(`[StorageManager] Session deleted: ${sessionId}`);
  } catch (err) {
    console.error('[StorageManager] deleteSession error:', err);
    throw err;
  }
}

/**
 * clearAllSessions() — Hapus semua session (untuk debug/reset).
 *
 * Tidak dipakai di UI MVP, tapi berguna saat testing.
 * Bisa dipanggil dari DevTools: storageManager.clearAllSessions()
 */
async function clearAllSessions() {
  try {
    await chromeStorageSet({ [STORAGE_KEY]: {} });
    console.log('[StorageManager] All sessions cleared');
  } catch (err) {
    console.error('[StorageManager] clearAllSessions error:', err);
    throw err;
  }
}

/* ================================================================
   UTILITAS: CEK STORAGE USAGE
================================================================ */

/**
 * getStorageInfo() — Cek berapa banyak storage yang sudah dipakai.
 *
 * @returns {Promise<Object>} - { usedBytes, totalBytes, usedPercent, sessionCount }
 *
 * Berguna untuk menampilkan warning jika storage hampir penuh.
 * Batas chrome.storage.local = 5MB (5,242,880 bytes).
 * Bisa diperluas di masa depan untuk tampilkan di UI footer.
 */
async function getStorageInfo() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.getBytesInUse(null, (bytesInUse) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      const totalBytes   = chrome.storage.local.QUOTA_BYTES || 5_242_880; // 5MB
      const usedPercent  = ((bytesInUse / totalBytes) * 100).toFixed(1);

      getAllSessions().then((sessions) => {
        resolve({
          usedBytes:    bytesInUse,
          totalBytes,
          usedPercent:  parseFloat(usedPercent),
          sessionCount: Object.keys(sessions).length,
        });
      }).catch(reject);
    });
  });
}

/* ================================================================
   PRIVATE: WRAPPER PROMISE UNTUK CHROME.STORAGE
================================================================ */

/**
 * chromeStorageGet(keys) — Wrapper Promise untuk chrome.storage.local.get
 *
 * @param {string|string[]|null} keys
 * @returns {Promise<Object>}
 *
 * Kenapa perlu di-wrap?
 * chrome.storage menggunakan callback pattern. Dengan Promise wrapper,
 * semua fungsi di atas bisa pakai async/await yang lebih bersih.
 */
function chromeStorageGet(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(result);
    });
  });
}

/**
 * chromeStorageSet(items) — Wrapper Promise untuk chrome.storage.local.set
 *
 * @param {Object} items - Key-value pairs yang akan disimpan
 * @returns {Promise<void>}
 */
function chromeStorageSet(items) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(items, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

/* ================================================================
   EXPORT
================================================================ */
/*
  Chrome Extension MV3 Service Worker mendukung ES Modules,
  tapi background.js kita menggunakan importScripts() (lebih compatible).
  Maka kita expose fungsi via globalThis agar bisa diakses
  setelah file ini di-import dengan importScripts().

  Jika suatu saat ingin migrasi ke ES Modules, ganti dengan:
  export { getAllSessions, getSession, saveSession, deleteSession, ... }
*/
globalThis.storageManager = {
  getAllSessions,
  getSession,
  saveSession,
  importSessions,
  deleteSession,
  clearAllSessions,
  getStorageInfo,
};
