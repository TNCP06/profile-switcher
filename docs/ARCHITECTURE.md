# Architecture

The **Profile Switcher** extension is built on the **Chrome Extension Manifest V3** ecosystem and specification.

Because Manifest V3 enforces a strict security and memory-management model, the application separates concerns into three isolated execution layers (contexts):

## 1. User Interface Context (`popup/`)

- The *front-end* interface the user sees when clicking the extension icon.
- Responsible for all *DOM manipulation*, binding *event listeners* for buttons and text inputs, and rendering UI elements (session list, *loading* states, warning messages, etc.).
- Confined to the extension's *sandboxed* area. This script and its elements are **fully destroyed** by the *browser* every time the user clicks outside the *popup* window (closing the popup). For this reason, this module must not hold critical, long-lived asynchronous *state* on its own.
- **Access boundary:** The Popup context is *not allowed* to call essential Chrome APIs such as `chrome.cookies` directly, in order to keep the logic stable. It must bridge requests to the Service Worker through `chrome.runtime.sendMessage`.

## 2. Background / Service Worker Context (`background.js`)

- Acts as the "brain" (*core logic controller*) of the extension, running behind the scenes.
- Follows an *Event-Driven* model: the *Service Worker* sleeps automatically when idle and only *wakes up* passively when triggered by an event such as `chrome.runtime.onMessage`.
- The **single place** where calls to and from the browser *engine APIs* (`chrome.cookies`, `chrome.storage`, `chrome.tabs`, `chrome.browsingData`) operate. This centralizes the *data flow*.
- Handles complex system flows, such as opening a tab to a profile (*normal/incognito*), distributing cookie injection into each *CookieStore* safely, and performing client-side storage cleanup (`chrome.browsingData.remove`) during Log Out so local web tokens are wiped without triggering server session invalidation.

## 3. Abstraction / Utility Context (`utils/`)

The extension splits specific *background* tasks into utility script modules. The goal is to reduce complexity (spaghetti code) in `background.js` so it stays focused as the "Action Controller".

- **Cookie Manager (`cookieManager.js`):** A dedicated helper library for `chrome.cookies` manipulation. It encapsulates all the complexity — extraction, *host/secure prefix* attribute handling, ignoring *host-only* domain filters, and dynamically adjusting the security configuration when injecting over HTTP vs HTTPS. This module works around `chrome.cookies` API quirks that sometimes reject attribute writes due to *strict RFC cookie constraints*.
- **Storage Manager (`storageManager.js`):** A protective layer in front of the native `chrome.storage.local` API. It wraps the purely asynchronous interaction in a *read-modify-write pattern*. This abstraction guarantees consistency so that modifying part of the local schema does not accidentally overwrite or delete other data. It also supports atomic batch importing (`importSessions`) to merge external backups seamlessly without key collisions.
