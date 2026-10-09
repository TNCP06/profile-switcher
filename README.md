# Profile Switcher — Chrome Extension

Quickly switch between accounts via cookies snapshot.  
All data is stored locally in the browser — no backend required.

---

## Folder Structure

```
profile-switcher/
├── manifest.json          ← Extension config (incognito: spanning)
├── background.js          ← Service Worker (core logic)
│
├── popup/
│   ├── popup.html         ← Popup UI
│   ├── popup.css          ← Styling
│   └── popup.js           ← Event handlers + render
│
├── utils/
│   ├── cookieManager.js   ← chrome.cookies API operations
│   └── storageManager.js  ← chrome.storage.local operations
│
├── docs/                  ← Comprehensive Documentation
│   ├── BUSINESS_FLOW.md   ← User vs system business flow
│   ├── ARCHITECTURE.md    ← Manifest V3 architecture principles
│   └── CODE_MAP.md        ← File responsibility map
│
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

> **Documentation note:** For a deeper understanding of the code, a full set of documentation is provided:
> - 📄 **[Business Flow](docs/BUSINESS_FLOW.md)**
> - 🏛️ **[Architecture](docs/ARCHITECTURE.md)**
> - 🗺️ **[Code Map](docs/CODE_MAP.md)**

---

## Installation

### Chrome

1. Go to `chrome://extensions`
2. Enable **"Developer mode"** (top-right toggle)
3. Click **"Load unpacked"**
4. Select the `profile-switcher` folder (the one containing `manifest.json`)
5. The extension will appear in the Chrome toolbar

### Brave

Same steps as Chrome, with two required extra steps:

1. Go to `brave://extensions` → enable **"Developer mode"** → click **"Load unpacked"**
2. After the extension loads, click **"Details"** on the extension card
3. Enable **"Allow in Private"** (Brave uses "Private" instead of "Incognito")
4. On the same page, leave **"Allow access to file URLs"** unchecked unless specifically needed

> **Why this is required on Brave:**  
> Without "Allow in Private", Brave does not populate `tab.cookieStoreId` even when the
> manifest includes `"incognito": "spanning"`. As a result, cookie injection targets the
> wrong store and the session won't be active in a private window.

---

## Usage

**Save Session:**
1. Log in to a website in the active tab
2. Click the extension icon in the toolbar
3. Type a session name → click **+ Save**
4. The session appears in the list ✓

**Load Session:**
1. Open a new tab to the same domain (or in a private/incognito window)
2. Click **Load** next to the saved session
3. The tab reloads automatically → you're now logged in as the selected account ✓

**Delete Session:**
1. Hover over a session item
2. Click the **✕** button
3. The session is removed from the list ✓

**Export & Import:**
1. Click **Import / Export** in the action row
2. **Export:** Choose source and format (JSON Standard, Profile Switcher Backup, Netscape HTTP text, Header String) → Click **Copy** or **Download**
3. **Import:** Upload a `.json`/`.txt` file or paste text → Click **Import Data** to migrate sessions across devices ✓

---

## Debugging

### 1. Background Service Worker DevTools

The Service Worker has its own DevTools, separate from the regular tab DevTools.

```
chrome://extensions  (or brave://extensions)
  → Extension card → Click "Service Worker" (blue link)
```

From here you can:
- View console logs from `background.js` and `utils/*.js`
- Set breakpoints across all files
- Monitor injection results (look for `Inject done — injected: X, failed: Y`)

### 2. Popup DevTools

```
Right-click anywhere in the popup → "Inspect"
```

Or alternatively:
```
chrome://extensions → Extension card → Click the three-dot menu (⋮) → "Inspect popup"
```

### 3. Inspect Storage

Run in the Service Worker DevTools console:

```javascript
// View all saved sessions
chrome.storage.local.get(null, console.log)

// Or use the helper:
storageManager.getAllSessions().then(console.log)

// View cookie names from a specific session:
storageManager.getAllSessions().then(s => {
  const session = Object.values(s)[0]; // first session
  console.log(session.cookies.map(c => `${c.httpOnly ? '[HttpOnly] ' : ''}${c.name}`));
});

// Clear all sessions:
storageManager.clearAllSessions()
```

### 4. Inspect Cookies

```javascript
// View cookies for a domain (query both variants for complete results):
const domain = 'chatgpt.com';
chrome.cookies.getAll({ domain }, c => console.log('plain:', c.length, c.map(x => x.name)));
chrome.cookies.getAll({ domain: `.${domain}` }, c => console.log('dot:', c.length, c.map(x => x.name)));

// Test manual capture (already handles all domain variants):
cookieManager.captureSessionCookies('chatgpt.com').then(console.log)

// Check active cookie stores (run from SW while an incognito window is open):
chrome.cookies.getAllCookieStores(stores => console.log(stores))
// Normal only:             [{ id: "0" }]
// Incognito also active:   [{ id: "0" }, { id: "1" }]
```

### 5. Verify a Load Session Succeeded

After clicking Load, check the SW log — you should see:

```
[Background] handleLoadSession: tabId=..., incognito=true,
  rawCookieStoreId="undefined", resolvedStoreId="1"
[CookieManager] Inject done — injected: 33, skipped: 4, failed: 0
```

What to check:
- `incognito=true` → correct target tab
- `resolvedStoreId="1"` → injecting into the incognito store ✓
- `injected` > 0 and `failed` = 0 → all cookies written successfully

### 6. Common Errors and Fixes

| Error / Symptom | Cause | Fix |
|---|---|---|
| `Could not establish connection` | Background SW is sleeping | Reload the extension at `extensions` |
| `0 cookies found` | Not logged in, or wrong domain | Make sure you're logged in, then retry capture |
| `injected: 0, failed: 0` | All cookies matched `SKIP_COOKIE_PATTERNS` | Normal if the site only has Cloudflare cookies — log in manually |
| `Cookie rejected by browser` | SameSite=Strict or HTTPS mismatch | Check the SW log for details — usually non-critical |
| `Extension context invalidated` | Extension was reloaded while popup was open | Close the popup, reload the extension, reopen |
| Load session doesn't log in (incognito) | "Allow in Private" not enabled in Brave | Go to `brave://extensions` → Details → enable "Allow in Private" |
| `resolvedStoreId="0"` while in incognito | The resolved tab is a normal window | Make sure the incognito window is focused when clicking Load |
| Session token not captured | Cookie is stored under `.example.com` (dot-prefix domain) but was only queried without the dot | `captureSessionCookies` already handles this — if still failing, check the captured cookie name list in the SW log |

### 7. Reloading After Code Changes

After editing any JS/HTML/CSS file:
```
chrome://extensions → Click the reload icon (↺) on the extension card
```

After reloading, reopen the Service Worker DevTools (blue link on the card) — the previous DevTools session disconnects automatically.

For `manifest.json` changes: click **"Load unpacked"** again, or use the reload button on the card.

---

## Known Limitations

### Brave Browser

- `tab.cookieStoreId` is always `"undefined"` from `chrome.tabs.query()` even with the `cookies` permission granted. The extension works around this via `resolveStoreId()`, which derives the store ID from the `tab.incognito` boolean as a fallback (`"1"` for incognito, `"0"` for normal).

- `chrome.cookies.getAll({ domain: "example.com" })` does not always return cookies stored under `.example.com` (with a leading dot). The extension works around this by querying four domain variants simultaneously inside `captureSessionCookies()`.

### Non-Portable Cookies

Some cookies are intentionally skipped during injection (this does not cause an error):

| Cookie Pattern | Reason Skipped |
|---|---|
| `__cf_*`, `_cf*`, `cf_*` | Cloudflare bot management — tied to browser fingerprint |
| `rc::*` | Google reCAPTCHA — tied to browser session |

Sessions typically still work without these cookies since they are not part of authentication.

### Sites That May Not Work

- **Sites with hardware-bound sessions** (some banking apps): the server-side session is tied to a device fingerprint, not just cookies
- **Sites with strict IP binding**: the session becomes invalid if the IP address changes
- **Sites with short-lived session tokens**: the token may have expired by the time it is restored

---

## Generating Placeholder Icons

If you don't have icon files yet, run this in a regular browser tab console:

```javascript
function makeIcon(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, size, size);
  g.addColorStop(0, '#6366f1');
  g.addColorStop(1, '#7c3aed');
  ctx.fillStyle = g;
  ctx.roundRect(0, 0, size, size, size * 0.2);
  ctx.fill();
  ctx.fillStyle = 'white';
  ctx.font = `bold ${size * 0.55}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('⚡', size / 2, size / 2);
  return c.toDataURL();
}
// Copy each output and save as a PNG file
[16, 48, 128].forEach(s => console.log(s + 'px:', makeIcon(s)));
```

---

## Roadmap

### A. localStorage Support

Some modern apps store sessions in `localStorage` (e.g. JWT tokens in SPAs). Approach via Content Script:

**1. Add a content script in `manifest.json`:**

```json
"content_scripts": [{
  "matches": ["<all_urls>"],
  "js": ["content/localStorageCapture.js"]
}]
```

**2. Create `content/localStorageCapture.js`:**

```javascript
chrome.runtime.onMessage.addListener((msg, _, sendResponse) => {
  if (msg.action === 'GET_LOCALSTORAGE') {
    const data = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      data[key] = localStorage.getItem(key);
    }
    sendResponse({ success: true, data });
  }
  if (msg.action === 'SET_LOCALSTORAGE') {
    Object.entries(msg.payload).forEach(([k, v]) => localStorage.setItem(k, v));
    sendResponse({ success: true });
  }
  return true;
});
```

**3. Extend the session format in `storageManager.js`:**

```javascript
{
  name: "...",
  cookies: [...],
  localStorage: { "token": "eyJ...", "user": "{...}" } // NEW
}
```

**4. Restore localStorage in `handleLoadSession` (`background.js`):**

```javascript
// After injecting cookies, before reloading the tab:
if (session.localStorage && Object.keys(session.localStorage).length > 0) {
  await chrome.tabs.sendMessage(tab.id, {
    action: 'SET_LOCALSTORAGE',
    payload: session.localStorage
  });
}
```

> **Note:** `SET_LOCALSTORAGE` must be sent **before** `reloadTab()`. After the reload, a
> fresh content script instance is injected and the restored localStorage will be available
> to the page immediately.

### B. Additional Features

| Feature | Complexity | Notes |
|---|---|---|
| Export / Import sessions as JSON | Low | Backup and share sessions across devices |
| Encrypt cookie values in storage | Medium | Use `crypto.subtle` API (AES-GCM) |
| Session groups / folders | Medium | Organize sessions by project or domain |
| Domain mismatch warning on Load | Low | Warn when the saved session domain differs from the active tab |
| Keyboard shortcut | Low | `chrome.commands` API in manifest |
| Cross-device sync | High | `chrome.storage.sync` — 100 KB limit, suitable for metadata only |
| IndexedDB snapshot support | High | Some apps store sessions in IndexedDB; requires an injected script |