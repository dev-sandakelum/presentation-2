# Decisions

Each decision with its rationale. "Replaced" entries document the earlier
design and why it had to go.

## 1. Folder-is-project — no database

A deck is a plain folder (`deck.json`, `theme.css`, `slides/*.tsx`, `bg/`,
`overlay/`, `notes/`, `assets/`) and that folder is the only truth. No
database anywhere: `prisma/schema.prisma`, `db/custom.db` and `src/lib/db.ts`
are unused scaffolding (nothing imports `@/lib/db`).

Why: decks are code — they want git, plain-text diffs, hand-editing in VS Code,
and copying a folder to move them. A DB would add a second truth to keep in
sync and make "edit in your editor, watch it live in the dashboard"
(signature polling) impossible. The external-projects case is handled with a
tiny link registry (`decks/.registry.json`), not a DB.

## 2. THREE stores with dispatch rules — not one storage service

`client.ts` dispatches every operation to `desktop` / `server` / `browser`
with two rules: `deckStoreOf` (desktop wins when active, else browser, else
server) and `defaultStore` (desktop > server > browser).

Why: it was the smallest change that keeps web-Chrome behavior byte-identical
while letting the desktop app own files. A unified "storage service" abstraction
would have forced all three backends into the same API shape (the fs bridge
has no transactions, IndexedDB has no mtimes) and re-risked the already-working
web path.

## 3. Java owns the decks folder through the fs bridge (REPLACED: browser File System Access API in the embedded window)

The earlier design relied on the File System Access API inside the desktop
app's embedded window. It cannot work:

- This JCEF build (verified against the `jcef-17e805a` jar, audit-phase-0)
  has **no permission-handler API at all** — the browser's "Allow this site
  to edit files?" prompt can never appear, so a stored handle can never be
  re-granted.
- The JCEF browser profile was **in-memory** (no `CefSettings.cache_path`), so
  the IndexedDB fallback (stored handles AND decks) was wiped on every app
  restart — the actual root cause of the "desktop cannot save" bug.

Fixes: the v2 fs bridge (Java chooses/permissions the folder once, persisted
in `~/.chasse-studio/config.json` — nothing expires), plus a persistent
browser profile in desktop 1.3.0. The File System Access API remains only for
real-Chrome device decks, where the permission sheet works.

## 4. ONE save queue — not per-file saving

`useSaveQueue`: 600 ms debounce, changes during a run merge into the next run,
30 s timeout, retry ladder 1 s/3 s/10 s, localStorage recovery snapshot.

Why: per-file saving (the original behavior) raced autosave against
navigation — buffers were lost or half-written when the user left mid-save
("save during navigation" problems). One serialized queue makes
autosave + Ctrl+S + close-flush safe by construction, and the queue's
signature response feeds the 1.5 s poll so the UI never false-reloads after
its own writes.

## 5. Diff writes + atomic writes — crash safety

Only changed files are written (browser: content-hash diff; desktop:
`persistDiff`; server: PUT per changed file). Java writes atomically: temp
file **in the same folder** (same volume → rename is atomic), full flush +
fsync, then rename over the target. `fs.createDeck` writes `deck.json` LAST,
so a half-created deck is never mistaken for a valid one.

Why: a crash, antivirus lock or power loss mid-write must never leave a
corrupt deck.json — the folder must always be in a readable state, and a
retry must simply redo the one file.

## 6. Loopback-only HTTP for big files — never base64 over cefQuery

Binary assets stream through `http://127.0.0.1:<port>/<session-token>/…`
(uploads PUT to the same URL). Defense in depth per request: Host must be
127.0.0.1/localhost with that exact port, a per-session token no other page
knows, Origin (when present) must be the trusted app origin, the path is
re-confined inside the chosen folder, sizes enforced while streaming.

Why: base64 through CefMessageRouter would copy every image through the
JSON bridge (slow, memory-hungry, size-capped), and binding the file server to
`0.0.0.0` would expose deck files to the LAN — the phone server is a separate
listener and shares nothing with this one.

## 7. In-app dialogs + toasts replace alert/confirm/prompt everywhere

`ConfirmDialog` (type-to-confirm for big decks) and `PromptDialog` cover every
destructive/input case; toasts carry all feedback. The desktop app
additionally installs a native JSDialogHandler (1.3.0) as a safety net for
third-party pages.

Why: `window.prompt/alert/confirm` never render in the JCEF webview without a
`JSDialogHandler` — the call hangs silently. Web code must not depend on the
Java side installing one.

## 8. Downloads via Java CefDownloadHandler + bridge events

Java owns the native Save-as (`DownloadBridge`, CefDownloadHandler) and pushes
`download` events (started/saving/progress/completed/failed) which become
toasts with an **Open folder** action (`openDownloadFolder`). The JCEF build
was verified to have CefDownloadHandler before building this.

Rejected alternative: transferring file chunks over the bridge and writing
them from JS — more moving parts (progress, cancellation, encoding, temp
files) for no user gain.

## 9. Popups → system browser via onBeforePopup

`target=_blank` / `window.open` are routed to the user's default browser
(Java `CefLifeSpanHandler.onBeforePopup`).

Why: JCEF has no popup chrome — a native popup window would be a borderless
webview orphaned from the app.

## 10. Blob-URL TTL of 10 minutes + pagehide flush

Export blob URLs are revoked after 10 min and on `pagehide`
(`client.ts scheduleObjectUrlRevoke`).

Why: a native Save-as dialog can stay open for minutes; a short timer would
revoke the URL out from under the pending download. Ten minutes is long enough
for any dialog, short enough that repeated exports don't accumulate memory.

## 11. Update notice, not a wall, when the desktop build lacks "fs"

Older desktop installs keep working: the app detects `cefQuery` without the
`fs` capability, shows a compact "Desktop app update available" notice, and
falls back to the browser store.

Why: the web app must never hard-fail on an old host; and silently using a
data-losing fallback (see #3) without telling the user is worse than the
notice.

## 12. Test strategy: contract mocks + E2E — not React unit tests

- `scripts/test-bridge-contract.mjs` (bun) — **35 assertions**: the real
  web-side desktop store/fs modules driven against a Java-contract mock on
  real disk. If it and Java's `FsServiceTest` (21 assertions, other repo) both
  pass, the two repos agree on the wire contract — the exact thing that broke
  saving when the sides drifted.
- `scripts/e2e-desktop-mock.mjs` (node/playwright-core) — **16 assertions**:
  the real app in Chromium with mocked `cefQuery` + a full Java mock on real
  disk (bridge detection, desktop-store activation, create → files, save
  queue → disk, reload persistence, PromptDialog, clean console).
- Java side: `FsServiceTest` — path confinement, symlink refusal, lifecycle,
  atomicity, limits, error codes.

Why not React unit tests for the hooks: the repo has no unit-test
infrastructure, and the risky logic (queue retry ladders, transport selection,
store dispatch) is exactly what the E2E exercises against the real modules —
unit tests would only restate the implementation.

## 13. Persisted browser profile (desktop 1.3.0) — not "always require a desktop folder"

Fixing only the fs bridge would still lose every deck created before a folder
is chosen. Java 1.3.0 sets a persistent `CefSettings.cache_path`
(`~/.chasse-studio/browser-profile`).

Why: first-run and fallback decks live in the webview's IndexedDB — they must
survive restarts too, and the browser store must be a real fallback, not a
trap.
