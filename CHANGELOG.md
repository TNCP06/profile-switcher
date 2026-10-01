# Changelog

All notable changes to this project will be documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Added
- `"browsingData"` permission in `manifest.json` for client-side storage cleanup (`localStorage`, `indexedDB`, `cacheStorage`, `serviceWorkers`) on Log Out without revoking backend session tokens

### Fixed
- Log Out now clears parent/root domains and queries by URL in `clearDomainCookies` so subdomain sessions (e.g. `app.example.com`) are reliably cleared
- `clearDomainCookies` now queries 4 domain variants matching `captureSessionCookies`, preventing missed leading-dot cookies on Chrome and Brave
- `deleteSingleCookie` now uses dual protocol fallback (`https`/`http`), passes `partitionKey` for partitioned cookies (CHIPS), and detects null removal results
- UI active session badge now clears immediately on Log Out in `popup.js`

---

## [1.2.0] — 2026-06-30

### Changed
- Renamed the project from "Quick Session Switcher" to "Profile Switcher" (display name, popup header, manifest description, docs, and repository)
- Relabeled the **Clear Cookies** action to **Log Out** with matching status and toast messages
- Translated all documentation (README and `docs/`) to English

### Fixed
- `handleClearCurrentCookies` in background now also clears auth subdomains via `getExtraDomains()` — previously log out left Google/YouTube/ChatGPT logged in because their session cookies live on `accounts.google.com` / `auth.openai.com`, which were never cleared

---

## [1.1.0] — 2026-05-29

### Added
- Grid card layout for the session list, with a detail view for selected sessions
- Google Favicon Service integration — session cards show site brand icons for each domain
- Delete mode toggle via trash icon in the footer; individual delete buttons appear per card
- `Alt+G` keyboard shortcut to open the extension popup (via `commands` in manifest)
- Scroll fade overlay on the session list for visual depth cue

### Fixed
- `handleLoad` in popup now shows an error toast with the failed count when cookie injection partially fails, instead of always reporting success
- `getExtraDomains` in background now filters the primary domain from its own return value, preventing redundant double-queries on save and double-clears on load
- `handleSaveSession` in background validates session name length ≤ 40 chars on the backend (mirrors frontend `maxlength`)
- Removed `console.debug` from `cookieManager.js` per commit-hygiene rule

---

## [1.0.0] — 2025-04-25

### Added
- Cookie snapshot and restore via `chrome.cookies` API
- Service Worker (`background.js`) handles all cookie and storage operations
- Popup UI (`popup/popup.js`) with session list, save, load, delete, and clear-cookies actions
- `cookieManager.js` — 4-variant domain query to capture cookies correctly on both Chrome and Brave
- `storageManager.js` — atomic read-modify-write pattern for `chrome.storage.local`
- `resolveStoreId()` workaround for Brave's broken `tab.cookieStoreId`
- `getExtraDomains()` for multi-subdomain sites (Google, YouTube, OpenAI)
- `SKIP_COOKIE_PATTERNS` for non-portable cookies (`__cf_*`, `rc::*`)
- `__Host-` and `__Secure-` prefix handling — strips `domain` attribute on inject
- Incognito window support via `incognito: "spanning"` in manifest
- Silent-drop verification via `chrome.cookies.get()` after every `chrome.cookies.set()`

[Unreleased]: https://github.com/TNCP06/profile-switcher/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/TNCP06/profile-switcher/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/TNCP06/profile-switcher/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/TNCP06/profile-switcher/releases/tag/v1.0.0
