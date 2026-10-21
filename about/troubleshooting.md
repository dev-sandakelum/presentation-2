# Troubleshooting

Symptoms → causes → fixes. Java-side facts reference `chasse-desktop`
(`~/.chasse-studio/` files, `FsService`, `DesktopBridge`, `SyncRooms`,
`LoopbackFileServer`).

## Desktop app

### "Deck disappears after restarting the desktop app"
- **Cause**: desktop app < 1.3.0 ran JCEF with an in-MEMORY browser profile —
  the webview's IndexedDB (where fallback/first-run decks live) was wiped on
  every close. This was the root cause of the "cannot save" bug (audit
  worklog, audit-phase-0).
- **Fix**: update the desktop app to ≥ 1.3.0 — the profile now persists at
  `~/.chasse-studio/browser-profile`. Decks that already vanished cannot be
  recovered from this side; they only ever existed in that IndexedDB. Decks in
  a chosen desktop folder were never affected.

### "Saved" chip shows in the desktop app, but changes are lost
Check, in order:
1. **Is the desktop folder chosen?** The library shows a banner when the fs
   bridge is active but no valid root is configured — pick a folder once
   (it persists in `~/.chasse-studio/config.json`).
2. **Is the bridge trusted?** In the web console: `await
   window.__chasseDesktop && …` — or check that the library's desktop banner
   isn't reporting an update. Java answers `getBridgeInfo` with `trusted`.
3. **Does `app.url` match the URL you are actually browsing?** Trust is
   exactly `originOf(app.url) === originOf(currentUrl)` (DesktopBridge.java).
   A mismatch — e.g. `app.url=http://localhost:3000` while the window shows the
   Vercel URL — breaks BOTH fs commands and sync silently.
- **Fix**: desktop app menu → **File → Change app URL…** (or edit
  `~/.chasse-studio/app.properties`) so `app.url` is the origin you browse.

### FORBIDDEN — "this page is not allowed to use desktop file commands"
- Same trust check as above: the page's origin is not the configured app
  origin. Also happens when `app.url` is **blank** (Java never trusts a blank
  app.url). Fix the app.url as above. A blank `app.url` should not normally
  happen — the app asks for one at first launch.

### FOLDER_MISSING
- The chosen decks folder moved / was renamed / the drive unmounted. Java
  reports `configured:true, valid:false`; the library banner offers to choose
  again (`fs.chooseRoot`). Pick the folder wherever it now lives.

### NO_OS_PERMISSION
- The folder is not writable at OS level — a read-only share, or a
  cloud-sync folder with on-demand placeholders (OneDrive "files on demand"
  can do this). Pick a genuinely writable folder.

### Export does nothing in the desktop app
- Desktop app < 1.3.0 has no download handler — exports silently fail (the
  window shows no download UI of its own). Update the desktop app: native
  Save-as + a toast for every stage (Exporting… / Saved to `<path>` with
  **Open folder** / failed + reason). The web side contract and the Java
  handler are covered by the download event shape in the bridge tests, but
  the native pipeline has not been exercised on a real Windows machine.

## Browser-store decks

### "Failed to write blobs (IOError)" / QuotaExceededError
- Chromium's IndexedDB quota / IO failure on the browser store.
  `browser-store.ts describeStorageError` explains it and appends the
  `navigator.storage.estimate()` usage. Fixes: export the big decks
  (`.smdeck`), delete or clear site data (IndexedDB `chasse-studio`), or move
  decks to the desktop/server store (duplicate into the desktop folder).
  Your edits are never lost while this error shows — the save queue keeps
  retrying with buffers in memory.

### "Allow this site to edit files?" never appears in the desktop app
- **By design**: JCEF has no permission-handler API (verified against the
  `jcef-17e805a` jar) — that prompt can never appear in the embedded window.
  Use the desktop app's own folder chooser instead. For **device decks in a
  real Chrome**, use the AccessBanner's Allow flow; the "Allow on every
  visit" option that stops the re-prompt needs Chromium ≥ 122
  (`permission.ts offersPersistentGrant`).

## Saving

### Stuck on "Saving…"
- The queue retries automatically (1 s → 3 s → 10 s) and logs each attempt
  with its reason in the console: `[save] attempt N failed (…) — retrying in
  … ms`. After the ladder it flips to Failed with a Retry button. Buffers
  always stay in memory, and a recovery copy (≤ 2 MB) sits in localStorage
  (`ss-recovery::<deckId>`) and is restored on next open — nothing is lost
  by closing the tab mid-failure.

### "Cannot save" while the deck is open in TWO places
- Documented limit: each window has its own buffers; the 1.5 s folder poll
  reloads a window when the signature changes externally. The **last writer
  wins per file** — the second save overwrites the first window's file edits.
  Keep one editing window per deck, or use the second window read-only
  (present mode / phone remote).

### Deck deleted while it was still saving
- Desktop store: Java verifies the folder is gone before answering `{ok}`;
  a locked folder surfaces as a clear `{code,message}` error instead of a
  false success. Browser device decks: the delete runs with the click's
  permission gesture; if the folder permission lapsed, nothing is deleted and
  the UI reports `needsAccess` with an "Allow access" re-run. Snapshots keep
  the last 10 states (`.stagesmith/snapshots/` or IndexedDB) if you need the
  content back.

### Compile errors on slide code
- The filmstrip badges the broken slide (error count), the dashboard's jump
  navigates to the error, and **Copy fix prompt** packs the slide code +
  error into a clipboard prompt for your AI tool. `window.prompt` is never
  used (it's dead in the webview) — clipboard failures explain the Ctrl+V
  alternative.

## Phone remote / QR

### QR code scanned, page won't load
- Phone and computer must be on the **same Wi-Fi**; on `10.x` networks, AP
  / client isolation is often ON — turn it off. Firewall must allow UDP/TCP on
  **8765** (the desktop app's embedded server). The interface picker
  de-prioritizes virtual adapters (VMware / WSL / Hyper-V / Docker — marked
  "·vm"); prefer the physical adapter's address.
- The phone page loads but says invalid link: room tokens live in the
  desktop app's memory (12 hex chars; rooms evicted after 2 h idle) —
  **phone links die when the app closes or the room idles out**. Restart the
  server (QrPanel → Start/Restart) and re-scan.

### Which addresses are offered?
- RFC1918 private IPv4 only: `10.0.0.0/8`, `172.16.0.0/12`,
  `192.168.0.0/16` (link-local 169.254 excluded). Ranking (Java
  `LanAddresses`): the configured `network.preferred-prefix` first
  (`~/.chasse-studio/app.properties`), then `10.*`, then `172.16–31.*`,
  then `192.168.*`; virtual adapters last within each group. The web-only
  route `/api/network` (local runs) similarly ranks 192.168 → 10 → 172.

## Windows-specific path rules (fs bridge, Java FsService)

- **Reserved device names rejected**: `CON`, `PRN`, `AUX`, `NUL`,
  `COM1`–`COM9`, `LPT1`–`LPT9`, `CONIN$`, `CONOUT$` — with or without an
  extension (`com3.txt` is rejected too). Error: `BAD_REQUEST`.
- **Trailing dot or trailing space rejected** in any path segment
  (`name must not end with '.' or space`), as are drive references (`C:`),
  absolute paths, `..`/`.` segments and NUL bytes.
- **Path length capped at 240 characters** (`MAX_PATH = 240` in FsService;
  the same cap is enforced in the contract mocks).
- Antivirus/indexers can briefly lock files — atomic writes (temp + fsync +
  rename in the same folder) turn those into a clean retriable error instead
  of a half-written file.
- Non-English names are fine everywhere: the wire is UTF-8, every URL path
  segment is percent-encoded (web `assetRouteUrl`, Java `LoopbackFileServer`),
  and `theme.css` round-trips `url(./assets/…)` with unicode names.
