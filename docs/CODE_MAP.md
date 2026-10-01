# Code Map

The directory structure plus an explanation of the role and responsibility of each file in the codebase.

```text
profile-switcher/
├── manifest.json          ← Extension configuration declaration
├── background.js          ← Main Service Worker script
│
├── popup/
│   ├── popup.html         ← DOM structure / base UI skeleton
│   ├── popup.css          ← Visual styling (styles)
│   └── popup.js           ← UI controller script
│
├── utils/
│   ├── cookieManager.js   ← Cookie extraction & handling logic
│   └── storageManager.js  ← Storage API read/write logic
│
└── docs/
    ├── BUSINESS_FLOW.md   ← User vs system business flow
    ├── ARCHITECTURE.md    ← Manifest V3 architecture principles
    └── CODE_MAP.md        ← File responsibility map (this file)
```

## Per-File Details

### Root Directory
- **`manifest.json`**
  The key *manifest* file that identifies this project to Google Chrome as an extension. It declares the description and release version, defines which *permissions* the extension requests (e.g. `cookies`, `storage`, `tabs`, `browsingData`), points the *Service Worker* entry to `background.js`, and sets optional configuration such as `"incognito": "spanning"` which lets the extension work in *private/Incognito* windows.

- **`background.js`**
  The orchestrator and main engine of the project. It contains the single message listener (an action *switch/case*) for requests sent by `popup.js` via message payloads (`SAVE_SESSION`, `LOAD_SESSION`, `DELETE_SESSION`, `CLEAR_CURRENT_COOKIES`, `GET_ALL_SESSIONS`, `GET_STORAGE_INFO`). It does not manage the UI; instead it orchestrates the flow between the active tab and data retrieval through `cookieManager`, then persists the result via `storageManager`.

### `popup/` Folder
- **`popup.html`**
  A simple HTML file representing the base page (the *layout* container and main *box-sizing*) for the popup panel. It includes the header section for session-save input, the list box for domain cards, and the per-domain detail view.

- **`popup.css`**
  The component styling file. The extension uses an elegant dark theme built with modern *CSS Variables*, *Flexbox* layouts, and subtle *hover transitions* to deliver a premium UI feel without depending on a heavy external *framework* like *Tailwind* or *Bootstrap*.

- **`popup.js`**
  The dedicated UI driver (*frontend logic*). Its job is to manipulate the *DOM* of the `.html` above so it reflects the real *database* content responsively. Its main responsibilities:
  - Fetch data by sending *broadcast* messages to `background.js` (via an *async Promise helper*).
  - Calculate and *group* saved sessions that share the same target URL (*host/port*) so they don't appear duplicated.
  - Render error messages and manage *loading state / disabled buttons*.
  - Render the dynamic card components using native browser APIs (`document.createElement()`).

### `utils/` Folder
- **`cookieManager.js`**
  A *helper library* that isolates and details every trick for cookie extraction, restoration, and injection via Chrome's native cookies API.
  It collects cookie parameters, ignores specific name patterns (e.g. reCAPTCHA, Cloudflare rules), handles colliding formats (resolving SSL protocol and the unique `__Host-` / `__Secure-` security prefixes), and strips the *port number* when wrapping requests to the browser's cookie store. This module is the backbone of reliable login capture.

- **`storageManager.js`**
  A companion helper around `chrome.storage.local`.
  Because Chromium's native `storage` API is fully asynchronous — which can corrupt results during repeated concurrent writes (*race conditions* on large objects) — this module refines the approach into a directed *read-modify-write pattern*: read the whole object first → sort/modify the specific value → write the entire object back in isolation without disturbing other domains' session data.
