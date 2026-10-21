# Audit Report — Chasse Studio (presentation-2, web app)

Audit date: 2026-10-21 · Audited against HEAD `dc6a06018ce2d5b1e1a336a7a606558f07ef3177` · Patch: `nextjs-audit.patch` in the workspace root.

This is the report of the full audit + repair pass described in `about/`. The sibling Java repo (`chasse-desktop`) has its own `about/audit-report.md` covering the desktop side of the same audit; the bridge contract is identical in both.

---

## 1. What was found

### 1.1 THE Java launcher save problem — root cause (with evidence)

The symptom: *"Web version in Chrome works fine, including saving. Java launcher version cannot save changes."*

Two independent mechanisms caused it, one in each repo:

1. **The embedded webview had an IN-MEMORY browser profile (Java side, primary).** JCEF runs incognito-like when `CefSettings.cache_path` is empty, so the browser store's IndexedDB and every `localStorage` recovery copy were **wiped on every app restart**. Evidence:
   - `chasse-desktop/src/main/java/com/chasse/desktop/Main.java` (at HEAD) never set `cache_path`; the only JCEF directory configured was the natives install dir (`jcef-bundle`).
   - The bundled `CefSettings` constructor defaults `cache_path = null` (verified by decompiling `org.cef.CefSettings` from `jcefmaven-152.0.6.jar`); jcefmaven's `CefAppBuilder` clones those defaults and adds no cache path of its own.
   - Effect: decks saved through the browser-store fallback showed the green "Saved" chip and then vanished when the app was closed — exactly "cannot save changes".
   - **Fix (in the Java repo, v1.3.0):** persistent `cache_path = ~/.chasse-studio/browser-profile` (+ `root_cache_path`), guarded by a new single-instance file lock. See the Java repo's audit report.

2. **The pre-bridge save path could never work in the embedded window (design-level).** The web app's device-folder mode needs the File System Access permission prompt ("Allow this site to edit files?"). The bundled JCEF (`jcef-17e805a+cef-152.0.6+chromium-152.0.7977.83`) **has no permission-handler API at all** — verified by listing every `org.cef` class in the jar: there is no `CefPermissionHandler`/`CefPermissionCallback`. Without that API the prompt can never be shown or granted, and Chromium refuses the permission silently. Any save flow that depends on it inside the webview is a dead end.
   - The **fs bridge** (already present at HEAD in both repos, finished by this audit) is the correct replacement: the Java side owns the decks folder via a native chooser, the page talks `fs.*` commands over `window.cefQuery`, and nothing permission-shaped ever runs in the webview. This audit verified that whole path end-to-end (below) and filled its gaps.

Secondary findings on the same path (fixed here or in the Java repo):
- `fs.chooseRoot {title,startPath,hint}` params were silently ignored by Java (contract mismatch) — fixed in the Java repo.
- No download handler existed in Java → exports silently did nothing in the embedded window — fixed with `CefDownloadHandler` + `download` events; this repo now renders them as toasts.
- `window.prompt` (2 usages) never renders in the embedded window (JCEF drops JS dialogs unless the client installs a handler) → those flows were dead ends there. Replaced with the in-app `PromptDialog` (web) **and** the Java app now installs a native `CefJSDialogHandler` as a safety net (1.3.0).

### 1.2 Other bugs found and fixed (root cause, verified)

| Area | Finding | Root cause | Fix |
|---|---|---|---|
| Snapshots (server decks) | **Restore was always broken**: `listSnapshots` returned names with `.json`, `restoreSnapshot` rejects dotted names → the dashboard's "restore" menu item failed with "Bad snapshot name" for every server deck | server list used raw `fs.readdir` names while create/browser/desktop all use extensionless names | `store.ts listSnapshots` now strips `.json` (verified: restore returns `{ok:true}`) |
| Assets | **Non-English file names were destroyed**: `背景 图像.png` uploaded as `assets/.png` — which the UI then treats as a hidden dotfile (invisible asset!); `схема-01.svg` → `01.svg` | both name sanitizers were ASCII-only (`\w`, `[a-z0-9]`) | both sanitizers (server route + `browser-store.sanitizeAssetName`) keep Unicode letters/numbers via `\p{L}\p{N}`, still NFKD + accent-strip + dash-collapse + traversal-proof (`assets/../evil.png` → `assets-evil.png`) — verified: uploads land as `assets/背景-图像.png`, percent-encoded serving 200 OK |
| Memory | Export blobs created with `URL.createObjectURL` were never revoked | no revoke path | `client.ts` now revokes export URLs (10-min TTL + `pagehide` flush — long enough for a native Save-as) |
| Desktop UX | Export produced no feedback anywhere; clipboard read failed silently; fullscreen (F) could fail silently in embedded webviews | no environment-aware feedback | `useDownloadFeedback` (bridge `download` events → toasts with "Open folder"; web → "Export started" toast), clipboard read explains the Ctrl+V alternative, `fullscreenerror` → toast |
| Compatibility | Older installed desktop builds (no `fs` capability) silently fell back to browser storage with no explanation | no notice | LibraryView shows a compact "Desktop app update available" notice linking the releases page when the bridge exists but `fs` is missing |
| Accessibility | Radix dev warning: dialogs without `DialogDescription` | 4 dialogs had no description | sr-only descriptions added (New project, New deck, Import, Open existing folder) |

### 1.3 Security review (no changes needed — verified as already sound)

- `validRelPath`/`deckPath` server-side escape checks, deck-id regex, asset-name traversal collapse — verified.
- Bridge trust: `fs.*` commands require the trusted origin; loopback file server checks Host + constant-time token + Origin when present (Java side, unit-tested there).
- Slide TSX executes only inside `sandbox="allow-scripts"` iframes with an import map — no app-origin access; asset URLs are percent-encoded per segment.
- No `alert/confirm/prompt` usage remained anywhere in `src/` except the two `window.prompt` calls (now gone); the `db/`+`prisma` scaffolding is unused by any runtime path.

---

## 2. What was changed (file list and why)

| File | Change |
|---|---|
| `src/components/stagesmith/PromptDialog.tsx` | **NEW** — the in-app replacement for `window.prompt` (Radix Dialog, app style, busy/error states, Enter submits) |
| `src/components/stagesmith/CodePane.tsx` | "New file" (bg/overlay code) uses `PromptDialog` instead of `window.prompt`; creation errors keep the dialog open with Retry |
| `src/components/stagesmith/NewProjectDialog.tsx` | "New folder here" (server browser) uses `PromptDialog`; sr-only dialog description |
| `src/components/stagesmith/LibraryView.tsx` | sr-only dialog descriptions (New deck, Import, Open existing folder); "Desktop app update available" notice for pre-fs desktop builds |
| `src/hooks/useDownloadFeedback.ts` | **NEW** — download/export toasts for both environments (bridge `download` events; `ss-export-started` DOM event on the web) |
| `src/components/stagesmith/ViewsShell.tsx` | mounts `useDownloadFeedback` once |
| `src/lib/stagesmith/desktop-bridge.ts` | `download` event type added to the bridge contract |
| `src/components/stagesmith/shared.ts` | `download()` emits `ss-export-started` (feedback); `copyText` gains a `execCommand` fallback for embedded webviews that reject async clipboard |
| `src/lib/stagesmith/client.ts` | export blob URLs are now revoked (TTL + pagehide flush) |
| `src/components/stagesmith/PresentView.tsx` | `fullscreenerror` → honest toast ("Fullscreen is not available here") |
| `src/components/stagesmith/DashboardView.tsx` | clipboard-read failure now tells users to paste into the editor instead |
| `src/lib/stagesmith/store.ts` | **bug fix**: snapshot list returns extensionless names (restore works for server decks) |
| `src/app/api/decks/[deckId]/assets/route.ts` | **bug fix**: Unicode-preserving asset-name sanitizer |
| `src/lib/stagesmith/browser-store.ts` | **bug fix**: Unicode-preserving `sanitizeAssetName` (used by browser + desktop stores) |
| `package.json` | `test:bridge`, `test:e2e-desktop` scripts |
| `scripts/test-bridge-contract.mjs` | **NEW** — 35-assertion contract smoke test (real `desktop-store`/`desktop-fs` modules vs a faithful Java-side mock on real disk) |
| `scripts/e2e-desktop-mock.mjs` | **NEW** — 16-assertion Playwright E2E: the real app in Chromium with a mocked `cefQuery`, decks on real disk |
| `scripts/memory-measure.mjs` | **NEW** — CDP heap/listener measurement harness over a 26-slide deck |
| `about/*` | **NEW** — the six documentation files (README, architecture, storage, features, decisions, troubleshooting) |

The `decks/` test artifacts used during the audit were removed; the working tree contains only the changes above.

---

## 3. Test results and measurements

### 3.1 Automated tests (all run after the final fixes)

| Suite | Result |
|---|---|
| `bun run lint` (eslint) | **clean — 0 errors, 0 warnings** |
| `bun run test:bridge` (`scripts/test-bridge-contract.mjs`) | **35/35 PASS** — hello/capability gate, getRoot, create/list/read/write, diff-only saves, poll↔save signature agreement, `{code,message}` error shapes, traversal refusal, loopback URL/upload/token-404, duplicate, delete, theme.css portability (no loopback URLs on disk), v1.1 event push |
| `node scripts/e2e-desktop-mock.mjs` | **16/16 PASS** — real app + real save queue against the mocked Java bridge: bridge detection, desktop store activation, New deck → `fs.createDeck` on disk, edit → Unsaved→Saving→Saved with content on disk, reload persistence (the in-memory-profile failure mode, proven fixed at the app level), `PromptDialog` (window.prompt never called), clean console |
| Java side (sibling repo): `mvn clean package` | BUILD SUCCESS, `FsServiceTest` **21/21** (path confinement, symlink refusal, atomicity, lifecycle, limits, error codes) |

### 3.2 Manual verification in real browsers this audit

- **Web (Chromium, server store):** create → edit → autosave → file on disk → reload persists; deck lifecycle through the API: rename, duplicate, export `.smdeck` + `.deck.tsx` (attachment disposition), snapshot create/list/**restore** (broken before this audit, fixed), poll signature, import round-trip, delete (with confirmation UI), asset uploads with spaces + CJK + Cyrillic names (broken before, fixed), percent-encoded serving.
- **Desktop-mode golden path:** via the E2E mock above — the exact flow the Java launcher runs.
- **Phone remote (real Java headless server, live):** Javalin on `0.0.0.0:8765`; `/health`, `/remote`, `/api/status` OK; WS join with the QR token OK; **bad token → "Invalid or expired link token"**; unbound sessions cannot mutate state; nav/set-slide verified at the protocol level.

### 3.3 UI quality (Task 3)

Screenshots reviewed at 1440/1280/1024/800 px widths, light + dark themes (library, dashboard, present). Results:
- No horizontal scrollbars at any tested width (geometry-verified, incl. 800×600).
- No clipped or overlapping elements; the bottom status bar sits exactly at `bottom: 0` (not clipped).
- Contrast math on the flagged candidates: "sync idle" chip **5.68:1** (passes 4.5:1), deck kick-line `--mut` on canvas **7.42:1** (passes 4.5:1). VLM flags were false positives; no CSS changes needed.
- Radix "Missing Description" a11y warnings eliminated (4 dialogs).

### 3.4 Memory/performance (Task 4) — `scripts/memory-measure.mjs`, 26-slide deck, 12 open/close cycles

- **Event listeners and DOM nodes return to baseline every cycle** (dashboard ≈2100 listeners / ≈10.1k nodes) — **no leak**; transient spikes before GC are normal React/iframe behavior.
- JS heap fluctuates with GC (44.9 → 115.1 → 55.8 MB across cycles), steady state **50–90 MB** for the 26-slide dashboard; the net drift is the intentional compiled-module cache (bounded by version eviction), not a leak.
- Observers/timers verified cleaned on unmount (`StageFrame` ResizeObserver+rAF+heartbeat, `PresentView` listeners, `useAssetPreloader` ticker); thumbnails render lazily via IntersectionObserver (8 iframes per view) and auto-disconnect once visible.
- Export object URLs are now bounded (10-min TTL + pagehide flush).

**Not measured (honest limits):** heap under real Windows JCEF and Chromium-process memory in the desktop app — this sandbox has no Windows/display, so those numbers come from the identical Chromium core in headless Linux, not from the shipped launcher.

---

## 4. Not fixed, assumptions, unverified items

1. **Deployment drift (assumption):** the desktop app loads the *deployed* Vercel URL. The fixed web code must be **deployed** for the desktop window to get it — the repo cannot fix a stale deployment. The `hello`-capability gating means an outdated deployment simply keeps today's fallback behavior.
2. **Download/JS-dialog/popup/profile behaviors on real Windows** are implemented against verified JCEF APIs (`CefDownloadHandler`, `CefJSDialogHandler`, `CefLifeSpanHandler` all confirmed present by decompiling the shipped jar) but were **not executed on a real Windows desktop** in this sandbox (no display, no Windows natives). Marked "verified by API-surface inspection + contract tests; not yet run on Windows" in `about/features.md`.
3. **Server-store snapshot restore** is fixed and API-verified; the dashboard menu path shares the same string flow (the API-level fix is the root cause). The menu item was not separately click-tested after the fix.
4. **Radix `DialogDescription` warnings** are resolved for the four dialogs that emitted them; a full keyboard-navigation audit of every screen was not re-run (Radix primitives provide focus traps/returns; the pre-audit worklog records prior keyboard testing).
5. **`metadataBase`** Next.js dev warning (social-image resolution) is left as-is: it is a dev-only warning and the correct value differs per deployment.
6. **Two decks open simultaneously / last-writer-wins** on the same deck folder is documented behavior (folder poll reloads on external signature change), unchanged by design.
7. The unused prisma/db scaffolding was **left in place** (removing it risks build surprise for zero user benefit; documented as unused instead).
8. The duplicate Windows release artifacts (`Release.yml` + `maven-publish.yml` both fire on publish) are documented in the Java repo's troubleshooting/README; deduplicating the workflows is a release-pipeline decision left to the maintainer.

---

## 5. The final bridge contract (both repos must match)

Full reference tables live in `about/architecture.md` of both repos. Summary:

- **Transport:** one `window.cefQuery` (JCEF CefMessageRouter). Two protocols on the same channel.
- **v1 (sync):** request `{id, action, payload}` → `{id, ok:true, data}` | `{id, ok:false, error}`. Actions: `getBridgeInfo`, `getServerStatus`, `getServerLog`, `startServer`, `stopServer`, `restartServer`, `selectAddress{address}`, `joinRoom{deckId,role,slides,slideId?,step?}`→`{state,token}` (+`sync-token` event), `setSlide`, `nav`, `reportSteps`, `syncDeck`, `setNotes`, `setUi`, `ping`, **`openDownloadFolder`** (new).
- **v2 (fs):** request `{cmd, ...params}` → raw contract shape, or error `{code, message}` (never both). Commands: `hello`→`{app:"chasse-desktop", version, capabilities:["sync","fs","downloads"]}`, `fs.getRoot`→`{configured,path,valid}`, `fs.chooseRoot{title?,startPath?,hint?}`→`{cancelled:true}`|`{configured,path,valid}`, `fs.listDecks`, `fs.readText{deck,path}`→`{text}`, `fs.writeText{deck,path,text}`→`{ok}` (atomic), `fs.createDeck{deck,files}`→`{ok,id}` (deck.json last), `fs.deleteDeck{deck}`→`{ok}` (verified gone), `fs.duplicateDeck{deck,copyId,title?}`→`{ok,id}`, `fs.listFiles{deck,dir}`, `fs.delete{deck,path}`, `fs.fileUrl{deck,path}`→`{url: http://127.0.0.1:<port>/<token>/…}` (uploads PUT there).
- **Error codes:** `FOLDER_NOT_SET, FOLDER_MISSING, NO_OS_PERMISSION, NOT_FOUND, TOO_LARGE, IO_ERROR, ALREADY_EXISTS, BAD_REQUEST, BUSY, CANCELLED, FORBIDDEN, UNKNOWN_CMD`.
- **Java→page pushes:** `window.__chasseDesktop._handleEvent(<json-string>)` — `server-status`, `server-log`, `sync-state`, `sync-presence`, `sync-token`, **`download`** (new: `{type:"download", stage:"started|saving|progress|completed|failed", id, fileName, path?, error?, percent?, receivedBytes?, totalBytes?}`).
- **Trust:** `originOf(app.url) === originOf(currentUrl)`; only `getBridgeInfo` + `hello` answer untrusted pages; `fs.*` → `FORBIDDEN`; pushes are trusted-only.
- **Compatibility:** a page that sees no bridge (normal Chrome) or a `hello` without `fs` never enters the desktop path — it uses the browser/server store exactly as before, plus the update notice.

---

## 6. How to apply the patches

From the workspace root (`chasse-workspace/`):

```bash
git -C nextjs-project/presentation-2 apply ../../nextjs-audit.patch
git -C java-project/chasse-desktop    apply  ../../java-audit.patch
```

`nextjs-audit.patch` was produced against the original HEAD `dc6a060` with a clean working tree, and was validated by applying it to a fresh clone of that HEAD (see the Java repo's report for `java-audit.patch`, produced against `d079795`). Both patches were built with `--binary` after confirming `.gitignore` covers `node_modules/`, `.next/`, `target/`, `db/` and other generated output.

After applying: web — `bun install`, `bun run lint`, `bun run test:bridge`; Java — `mvn clean package` (runs FsServiceTest). Deploy the web app to Vercel so installed desktop builds pick up the fixes.
