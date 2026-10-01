# Business Flow

This document describes the main workflows of the Profile Switcher extension from both the user's perspective and the underlying system process.

## 1. Save Session

**Goal:** Capture and store all session *cookies* from the currently active domain (including the *port* if present) so the session can be restored later.

**User Flow:**
1. The user opens a *website* and *logs in* to account A.
2. The user opens the Profile Switcher extension via the browser *toolbar* icon.
3. The extension automatically detects the URL and domain *host* (including the *port*).
4. The user enters a session name (e.g. "Main Account" or "Dev Port 3000") and presses the **+ Save** button.
5. The session appears in the list of saved sessions in the extension UI.

**System Flow:**
1. **Popup UI (`popup.js`)** sends a `SAVE_SESSION` action message together with the session name to the *Service Worker*.
2. **Service Worker (`background.js`)** receives the message and extracts the *host* identity from the active tab's URL.
3. The Service Worker calls **Cookie Manager (`cookieManager.js`)** to read the *cookies*. The cookie manager automatically queries and deduplicates every *cookie* on the *domain* (the *port* is stripped internally for Browser API requests due to a built-in `chrome.cookies` limitation).
4. Once the cookie set is validated, the session data (name, original target URL, specific domain/host, cookie count, *timestamp*) is stored via **Storage Manager (`storageManager.js`)** into the extension's local database (`chrome.storage.local`).
5. The UI re-renders with the updated list.

---

## 2. Load Session

**Goal:** Restore (inject) the *cookies* from a previously saved session so the user is instantly *logged in* as that account without re-entering credentials.

**User Flow:**
1. The user opens the extension and sees the list of sessions grouped by domain/port host.
2. The user presses the **Load** button on one of the saved sessions (e.g. "Work Account").
3. A tab automatically opens or *reloads* to the relevant page. The user is immediately *logged in*.

**System Flow:**
1. **Popup UI** sends a `LOAD_SESSION` action message with the target session ID to the *Service Worker*.
2. **Service Worker** fetches the session details via **Storage Manager**.
3. **Service Worker** creates a new *tab* using the stored URL (with the original HTTP/HTTPS protocol and the precise port). The tab may be Normal or *Incognito* depending on the window.
4. As the tab is created, **Service Worker** instructs **Cookie Manager** to:
   - Clear any existing *cookies* on that domain to prevent authorization collisions.
   - Inject the session *cookies* one by one into the new tab's *cookie store* via `chrome.cookies.set`. This module specially handles *secure* cookies as well as the `__Host-` and `__Secure-` prefixes.
5. The tab completes the load cycle.

---

## 3. Log Out (Clear Current Cookies)

**Goal:** Sign the user out of the active site locally by removing its cookies and client-side web storage from the current tab's scope, without revoking the session on the server.

**User Flow:**
1. The user opens a site they are logged in to and opens the extension.
2. The user presses the **Log Out** button.
3. The active session badge (if any) is cleared, the tab reloads, and the user is signed out.

**System Flow:**
1. **Popup UI** sends a `CLEAR_CURRENT_COOKIES` action to the *Service Worker*.
2. **Service Worker** resolves the active tab's domain, candidate root domains, auth subdomains (via `getExtraDomains()`), and cookie store.
3. **Service Worker** instructs **Cookie Manager** to clear cookies matching:
   - The active tab URL (catching path-specific and parent domain cookies).
   - 4 domain query variants (with/without leading dot, with/without www) for the primary domain, root domain, and auth subdomains.
4. **Service Worker** calls `chrome.browsingData.remove()` specifically for the tab's origins to wipe `localStorage`, `indexedDB`, `cacheStorage`, and `serviceWorkers` locally in the browser. Crucially, this is purely client-side; no backend logout endpoint is triggered, so saved session cookies are not revoked on the server.
5. The tab is reloaded so the page reflects the signed-out state.
6. **Popup UI** clears `activeSessionId` from `chrome.storage.session` and re-renders the session grid so the "Active" badge disappears.

---

## 4. Delete Session

**Goal:** Permanently remove a specific session from local storage.

**User Flow:**
1. The user opens the session list in the extension and *hovers* over a session name.
2. The user presses the red **✕** (delete) icon.
3. The list re-renders and the item is removed permanently.

**System Flow:**
1. **Popup UI** captures the click and sends a `DELETE_SESSION` action with the bound ID to the *Service Worker*.
2. **Service Worker** delegates to **Storage Manager** to load the existing database object and filter out the session with that ID.
3. The modified object is written back, overwriting the previous database state.
4. A success confirmation is returned to the UI, triggering a refresh.

---

## 5. Import & Export

**Goal:** Enable users to share, migrate, and backup sessions and cookies across devices in multiple standard formats.

**User Flow:**
1. The user clicks **Import / Export** in the action row.
2. An overlay modal opens with **Export** and **Import** tabs:
   - **Export:** Select data source (Active Tab Cookies, Selected Domain Sessions, or All Saved Profiles Backup) and format (`JSON Standard / Cookie-Editor`, `JSON Profile Switcher Backup`, `Netscape HTTP text`, or `Header String`). Preview updates live; user clicks **Copy** or **Download File**.
   - **Import:** Select a `.json` or `.txt` file, or paste text into the textarea. The extension auto-detects the format (Full Backup, Cookie-Editor array, or Netscape HTTP text). If importing a cookie array, the user can adjust the session name. Click **Import Data**.
3. The session list updates immediately with the imported profiles.

**System Flow:**
1. **Export Flow:**
   - **Popup UI** fetches current tab cookies via `GET_CURRENT_TAB_COOKIES` or saved sessions via `GET_ALL_SESSIONS`.
   - Data is transformed using client-side format serializers (`cookiesToStandardJson`, `sessionsToBackupJson`, `cookiesToNetscape`, `cookiesToHeaderString`).
   - Content is copied via `navigator.clipboard.writeText` or downloaded via a browser Blob object URL.
2. **Import Flow:**
   - **Popup UI** inspects and parses the input via `detectAndParseImport()`.
   - Sends `IMPORT_SESSIONS` (for full backup) or `IMPORT_SINGLE_SESSION` (for cookie array / Netscape) to **Service Worker**.
   - **Service Worker** invokes **Storage Manager** (`importSessions()` or `saveSession()`) using atomic read-modify-write with collision-free ID resolution.
   - UI grid is refreshed and a confirmation toast is displayed.
