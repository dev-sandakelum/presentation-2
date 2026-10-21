# Features — inventory and status after the audit

Status values: **verified** = covered by a passing automated test or checked in
a real browser session during the audit (test names cited); **verified-in-code**
= read and traced through the source + contract, not exercised on real
hardware; **known-limit** = documented limitation. Audit results referenced
below (worklog, web-fixes / audit-phase-0): `bun run lint` clean;
`scripts/test-bridge-contract.mjs` **35/35 PASS**; `scripts/e2e-desktop-mock.mjs`
**16/16 PASS** (real app in Chromium with a mocked cefQuery + Java mock on real
disk); Java `FsServiceTest` **21/21 PASS**.

## Deck lifecycle — verified

- Create (starter deck or template), rename, duplicate (same store or
  cross-store into the desktop folder), delete.
- Delete guard: `ConfirmDialog` with **type-to-confirm** — decks with
  ≥ 20 slides require typing the exact deck title before Delete unlocks
  (`LibraryView`: `deck.slideCount >= 20 ? deck.title : null`).
- Export `.smdeck` (zip, `mimetype` + `manifest.json` + files) and
  `.deck.tsx` (single-file TSX) — `transfer.ts`, `/api/decks/[deckId]/export`
  for server decks; blob URLs revoked after 10 min (client.ts).
- Import `.smdeck`, `.zip`, `.deck.tsx`, single `.tsx` and pasted TSX text —
  `transfer.ts` (`importFileToBrowser/importFileToDesktop`),
  `/api/import`; the library's "Load .smdeck…" picker accepts many files at once.
- Key files: `LibraryView.tsx`, `transfer.ts`, `src/app/api/decks/**`,
  `src/app/api/import/route.ts`, `ConfirmDialog.tsx`.
- Verified by: e2e-desktop-mock (New deck → `fs.createDeck` on disk),
  test-bridge-contract (create/duplicate/delete/list, deck.json manifest).

## Editing — verified

- Slide code editor on CodeMirror (`CodePane.tsx`, `editor/CmEditor.tsx`,
  `editor/chasseTheme.ts`), one undoable edit per paste/format.
- Add / delete / duplicate / reorder slides; reorder is drag & drop via
  dnd-kit (`Filmstrip.tsx` SortableContext). Deleting a slide takes a
  `before-delete` snapshot first.
- Theme per slide + deck default mode (dark/light), bg/overlay sources
  common (deck-level) and per-slide overrides — `DashboardView.tsx`,
  `PreviewPane.tsx`.
- Assets: upload (sanitized on-disk names, original kept as *display name*),
  preview (store-aware URLs), delete; bg/overlay code files upload/delete —
  `CodePane.tsx` + `uploadAssets/uploadCodeFile` in the api facade.
- Notes per slide (`notes/<id>.md`).
- Format file via Prettier (`formatTsx`, `lib/stagesmith/format.ts`), on-demand
  (Shift+Alt+F) and on paste.
- Undo/redo: 200-step buffer of file edits (Ctrl+Z / Ctrl+Shift+Z).
- Key files: `DashboardView.tsx`, `CodePane.tsx`, `Filmstrip.tsx`,
  `PreviewPane.tsx`, `CmEditor.tsx`.
- Verified by: e2e-desktop-mock (typing → save queue → file on disk), the
  web Chrome session during the audit.

## Saving — verified

- ONE serialized save queue: 600 ms debounced autosave, Ctrl+S flush,
  30 s timeout, retry ladder 1 s/3 s/10 s, per-file logging (`[save] …`).
- Crash recovery: `ss-recovery::<deckId>` localStorage snapshot (≤ 2 MB),
  restored on next open.
- Device-folder decks: diff-based, serialized write-through mirror
  (`device.ts` MirrorQueue) — mirror failures are a non-blocking warning with
  Retry; the IndexedDB copy is always primary.
- Signature-verified reload: dashboard polls every 1.5 s and reloads only when
  the folder signature changed (external edits appear live).
- Key files: `src/hooks/useSaveQueue.ts`, `device.ts`, `DashboardView.tsx`.
- Verified by: test-bridge-contract (diff-only saves, poll/signature
  agreement), e2e-desktop-mock (Unsaved → Saving… → Saved → file on disk →
  reload persistence).
- Known limit: a deck open in two places at once is last-writer-wins per file
  (the poll reloads on external signature changes; both windows keep working).

## Thumbnails — verified

- Live thumbnails are the same sandboxed StageFrame in static mode
  (`LiveThumb.tsx`) — no server-side headless Chromium, works on hosted
  deployments.
- Lazy rendering with IntersectionObserver (library rows ~160 px root margin;
  present-mode overview ~200 px).
- Refresh after ANY change — module versions are part of the render config, so
  edits, undo/redo, theme and bg changes repaint thumbs with nothing stored
  server-side.
- Verified in the web Chrome session (audit "web baseline").

## Present mode — verified

- ONE live StageFrame; preload gate `useAssetPreloader`: **no time-based
  error** — priority window (~first 3 slides + fonts) opens the reveal,
  background loading continues (`allDone` chip), real failures only
  (3 attempts → Retry / "Continue anyway"), 60 s no-progress stall is a soft
  notice, never an error.
- Transitions inside the runtime (bg crossfade → content exit/enter state
  machine); rapid input never queues (see architecture.md).
- Keyboard map (PresentView): `→ / Space / PageDown` next, `← / PageUp` prev,
  `Home/End` first/last, `F` fullscreen, `G` or `O` overview grid, `Q` QR
  panel, `T` theme toggle, `Esc` close panels → back to dashboard. Swipe on
  touch. Chrome auto-hides after 3 s.
- Overview grid (lazy StageFrames), notes push to the phone remote
  (`setNotes`, desktop transport only).
- LIVE/FROZEN live-edit toggle: LIVE hot-swaps slides when files change
  (signature poll / deck-updated); FROZEN pins the deck until unfrozen.
- Fullscreen refusal surfaces as an honest toast (`fullscreenerror` listener)
  — embedded webviews can refuse F.
- Key files: `PresentView.tsx`, `StageFrame.tsx`, `useAssetPreloader.ts`,
  `public/runtime.html`.
- Verified in the web Chrome session (audit "web baseline" + present scripts).

## Phone remote — verified against the real Java headless server

- QrPanel: embedded-server Start / Stop / Restart, interface picker with
  **virtual-adapter de-prioritization** (VMware/WSL/Docker adapters greyed,
  labelled "usually can't reach a phone"), QR + copy link, phone count,
  collapsible server log tail — `QrPanel.tsx`, `useDesktopServer.ts`,
  `/api/network` (LAN candidates for local runs), `/api/qr`.
- RemoteView: mobile-first page — status badge, current slide, big Prev/Next,
  slide list, collapsible notes, live reload every 2.5 s; control requires the
  room token — `RemoteView.tsx`.
- Transports: desktop bridge (trusted) or socket.io mini-service (:3003,
  gateway `?XTransformPort=3003`); hosted deployments report "needs the
  desktop app" instead of reconnecting forever (`useSync.ts`).
- Verified by: the audit's live headless Java sync server (Javalin on
  `0.0.0.0:8765`: `/health`, `/remote`, WS join with valid token OK, bad
  token → "Invalid or expired link token", unbound sessions cannot mutate
  state) — real-Wi-Fi/real-phone behaviour is **not** covered by those tests.

## Desktop integration — verified (contract + E2E); downloads verified-in-code

- fs bridge store (see architecture.md): hello gating, folder choice via
  `fs.chooseRoot` with in-app title/startPath/hint, diff writes, disk-walk
  signatures — `desktop-fs.ts`, `desktop-store.ts`.
- Library desktop banner + "Choose folder" (`useDesktopFs.ts`,
  `chooseDesktopRoot`), FOLDER_MISSING re-pick, NO_OS_PERMISSION explanation.
- Update notice: older desktop builds (bridge but no `fs`) get a compact
  "Desktop app update available" notice and fall back to the browser store
  (`LibraryView.tsx`).
- Downloads: desktop ≥ 1.3.0 pushes `download` events → toasts
  ("Exporting…", "Saved to \<path\>" with **Open folder** via
  `openDownloadFolder`, failed with reason) — `useDownloadFeedback.ts`,
  `desktop-bridge.ts`. Normal browsers get a quiet "Export started" toast
  (`ss-export-started` DOM event from `shared.ts download()`).
- In-app dialogs replace native prompts everywhere: `PromptDialog.tsx`
  (CodePane "New file", NewProjectDialog new folder) — `window.prompt` never
  renders in the JCEF webview without a JSDialogHandler; e2e-desktop-mock
  asserts window.prompt is never called and the dialog opens.
- Clipboard fallback for the embedded window: `shared.ts copyText` uses
  execCommand when async clipboard is rejected; copy failures explain the
  Ctrl+V alternative (`DashboardView`).
- Fullscreen fallback toast (above).
- Verified by: test-bridge-contract 35/35 (hello gating, root, CRUD,
  errors, loopback upload/token-404, theme.css portability, v1.1 events),
  e2e-desktop-mock 16/16 (detection → activation → create → edit → save →
  reload → PromptDialog → clean console), Java FsServiceTest 21/21.
- Honest limitation: the Java download handler (`DownloadBridge`,
  CefDownloadHandler — verified present in the `jcef-17e805a` jar) is
  verified in code and in the contract shape, but was **not exercised on a
  real Windows machine** during this audit.

## Also worth knowing

- SSR first paint: `page.tsx` fetches deck list/bundle server-side; the app
  also runs hosted/read-only (browser store + `SS_FORCE_READONLY=1`).
- Snapshots: last 10 per deck, stored in the deck folder (server/desktop) or
  IndexedDB (browser); restore via the snapshots menu.
- Accessibility pass from the audit: DialogDescription on every Radix dialog
  (warning gone), toasts/veils labelled.
