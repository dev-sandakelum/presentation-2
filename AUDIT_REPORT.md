# Reload, save, upload, and image audit — 2026-10-22

## Fixes applied

- Replaced the one-shot save watcher flag with serialized polling, a 400 ms stability check, and comparison against the latest acknowledged signature. Own saves and asset uploads now update the acknowledged version without a deck reload.
- External changes now refresh changed text buffers only, preserve the editor buffer map and selected UI, and ask **Reload / Keep mine** when a changed file also has unsaved local edits. The old unconditional `setBuffers({})` / `setDirty({})` reload was removed.
- Editors do not mount on an unloaded `""` fallback. Edits are ignored until the buffer exists; replacing non-empty content with empty content requires confirmation. Save collection excludes unloaded buffers, and server/desktop/browser write layers enforce the confirmation flag.
- Desktop and server writes retain up to ten pre-save versions under `.history/`; browser-store saves retain up to ten IndexedDB snapshots. History folders are excluded from deck signatures.
- Preview compilation now uses live editor buffers with a content-derived compile key. Disk autosave remains separate, and compile failures retain the runtime's existing last-good render behavior.
- Asset upload refreshes the asset signature and list without triggering a folder reload. Upload failures include HTTP status/reason in the thrown error and are logged with file count and byte size.
- Added the shared store-aware `resolveImageUrl()` path for asset tiles, stage backgrounds/overlays (including thumbnails through StageFrame), and Present preloads. Runtime map cache signatures now derive from actual asset metadata/content signatures.
- Added `scripts/test-save-safety.test.ts` and `npm run test:save-safety` for the self-reload signature and empty-overwrite guards.

## Verification

- `npm run test:save-safety`: PASS (2/2).
- Targeted ESLint across changed TypeScript files: PASS.
- `git diff --check`: PASS.
- `npx tsc --noEmit`: changed files have no reported errors; blocked by three existing unrelated errors in `useDownloadFeedback.ts`, `useSync.ts`, and `lib/db.ts`.
- Java compilation was not run because Maven is not installed in this environment.
- Live desktop/web acceptance checks (0.5-second render timing, PNG/JPG upload, external-edit prompt, and restart persistence) still require running the app; the target deck and desktop runtime are unavailable in this workspace.

## Reload/save acceptance status

| Criterion | Status | Evidence |
|---|---|---|
| Save does not trigger a reload | PASS (regression) | Latest acknowledged signature is compared directly; regression test passes. |
| Empty content is not written without confirmation | PASS (regression/code) | Loaded-buffer check, confirmation flag, and store/API guards; regression test passes. |
| External edit prompts Reload / Keep mine | PASS (code) | Dirty changed files invoke an explicit choice before applying replacements. |
| External refresh preserves buffers and refreshes changed text only | PASS (code) | No full buffer reset; only changed source files are read into replacements. |
| Preview compiles unsaved memory | PASS (code) | `resolveModule` merges live overrides and keys cache by their content hash. |
| Upload refresh avoids a deck reload | PASS (code) | Upload acknowledges `api.poll()` signature and refreshes Assets panel locally. |
| Preview, thumbnails, and Present share image resolution | PASS (code) | Shared resolver plus StageFrame asset map, used by thumbnails and Present preloading. |
| Rolling history backups | PASS (code) | Ten versions for desktop/server folders; ten IndexedDB snapshots for browser decks. |
| End-to-end web and desktop acceptance | NOT VERIFIED | App runtime, exact target deck, and Maven are unavailable here. |

## Earlier image report

## Finding (static diagnosis; target runtime capture unavailable)

The desktop loopback file server is configured on `127.0.0.1` with a per-process token, percent-encodes each URL segment, and serves files with MIME type, length, range, cache validators, and CORS headers (`chasse-desktop/src/main/java/com/chasse/desktop/LoopbackFileServer.java`, `urlFor()` and `serveFile()`). No Java handler defect was found by inspection.

The deterministic consumer-side bug is in `src/components/stagesmith/CodePane.tsx` (`AssetsTab` URL-map effect): when `api.assetUrl()` rejected for a desktop asset, the catch block substituted `assetRouteUrl()`, a Next.js `/api/assets/<deckId>/...` route. Desktop assets live in the selected deck folder and are served by the tokenized loopback server; that route serves server-backed decks and cannot resolve the desktop folder. The tile therefore requested the wrong URL and showed no useful failure. Runtime slide assets normally use the desktop `assetMap`; however, desktop map construction silently skips URL failures (`desktop-store.ts:getAssetMap()`), while StageFrame's fallback for image backgrounds is also the server route (`StageFrame.tsx:imageSourceUrl()`). This can affect explicit image BG/overlay sources when loopback URL generation fails.

The user's named 26-slide deck is not present in this workspace (`decks/` has no target deck), and no live desktop/CEF session or DevTools capture is available. Therefore the requested path → URL → HTTP status/type/length → `onload`/`onerror`/`naturalWidth` trace cannot be truthfully reported as measured. The static diagnosis identifies an incorrect fallback, not proof that the target run's initial `fs.fileUrl` call rejected. This uncertainty remains visible below.

## Image-path changes

- Removed the Assets panel's invalid server-route fallback after `api.assetUrl()` fails. Resolution errors are logged with the asset path; the tile now enters its named failure state and offers Retry, which resolves through the store-aware API again.
- The image `onError` handler continues to log the actual URL and path and displays a named failure instead of the browser's broken-image icon.

## Image acceptance status

| Criterion | Status | Evidence |
|---|---|---|
| Root cause identified with source location | PASS (static) | `CodePane.tsx` used server route as desktop fallback; see finding above. |
| Disk path → browser URL → HTTP metadata → naturalWidth captured for `bg.png` | NOT VERIFIED | Target deck and desktop CEF runtime unavailable. |
| Java loopback host/token/path/content serving | PASS (inspection only) | `LoopbackFileServer.java` binds `127.0.0.1`, URL includes token, segments are encoded, and file response sets type, length, range and validators. |
| Asset panel reports resolution and image failures with filename and Retry | PASS (code) | Updated `CodePane.tsx`; visual check not run. |
| One resolver works for all desktop/web consumers | PARTIAL | Assets panel uses `api.assetUrl`; StageFrame and Present retain their existing map then server-route fallback paths. |
| Assets, BG/Final/Overlay, slide images, thumbnails and Present | NOT VERIFIED | Target deck/runtime unavailable; explicit BG/overlay fallback remains a known risk if the desktop map lacks an entry. |
| PNG/JPG/SVG/WEBP, transparent, special-character and large images | NOT VERIFIED | Not run. |
| Missing/zero-byte/never-responding files and Retry | PARTIAL | Named tile image failure and retry are present; timeout/readiness behavior not verified or implemented comprehensively. |
| Upload/replacement/deletion invalidate previews and caches | NOT VERIFIED | Not exercised. |
| Open/close 20 times; object URL memory remains flat | NOT VERIFIED | Not run. |

# Deck loading audit

## Finding (code inspection; deck reproduction unavailable)

The available evidence does not identify one uniquely stuck runtime phase. The strongest code-level cause is desktop bundle acquisition: `src/lib/stagesmith/desktop-store.ts:getRecord()` walked the deck and awaited a separate `fs.readText` bridge call for every text file, sequentially, before `getBundle()` could return and before the editor could render slide 1. A 26-slide deck therefore delayed its first render behind all text files. Separately, `src/lib/stagesmith/desktop-fs.ts:cmd()` and `src/lib/stagesmith/desktop-bridge.ts:call()` had no timeout; if JCEF dropped a callback, the corresponding promise could remain pending indefinitely. `Filmstrip.tsx` also launched compile resolution for all slides at once, competing with the selected preview. These are reproducible structural hang/latency risks in code, but the particular phase that hung in the reported run cannot be confirmed without the deck, a desktop build, and its CEF logs.

## Changes made

- Added 10-second deadlines and pending-request snapshots to both desktop bridge transports. A missing JCEF callback now rejects with an operation-specific error and is removed from the pending set.
- Changed desktop record startup to read `deck.json`, theme CSS, and the first slide before returning. Remaining text files hydrate in the background with at most four reads in flight. A requested module missing from the initial cache is read on demand.
- Limited filmstrip diagnostic compilation to two concurrent slides and skipped the currently selected slide, allowing its preview to take priority.
- Added deadlines for asset-preloader tasks (10 seconds; fonts 3 seconds), image loading, and StageFrame module resolution. Module resolution timeout is surfaced as a slide error card by the existing runtime path.
- Added `[deck-load] START/END` log lines and `performance.mark/measure` entries for desktop file index, manifest read, first slide/theme read, background text hydration, and module compilation. Pending bridge calls can be inspected through exported diagnostic snapshots.
- Reduced the Present preloader's no-progress soft warning from 60 to 30 seconds.
- Removed the 12-second StageFrame module-resolution deadline that could produce `slides/end-copy.tsx timed out while loading` while the work was simply queued or slow. Slide module tasks in Present preloading are also no longer failed by the fixed task deadline.
- Added a four-job module-resolution queue. Selected preview requests have priority over normal and background thumbnail requests. `[slide-load]` logs record queued, started and finished events, queue wait, duration and the concurrency limit.
- Added soft preview notices after 30 seconds and 60 seconds without module/render progress. The watchdog starts only after the selected slide module actually starts; queued time does not count. Retry forces a fresh module resolve.
- Failed module results are no longer cached. Runtime and compile errors in the preview show a slide-specific card with the file and reason plus Retry. Thumbnail runtimes suppress the full error card; only that slide's corner warning badge is updated.
- Desktop duplication now ensures the source slide and code overrides have been read before copying, then awaits persisted writes before returning the new deck state. The editor selects the newly added id by comparing the pre/post slide lists, so repeated copies do not select an older copy.

## Evidence and limitations

- Machine: not run on the user's desktop machine; current workspace is a development checkout.
- Target deck: absent from this workspace (`decks/` contains only `README.md`).
- Desktop runtime/CEF console, loopback request capture, and heap snapshots: unavailable in this session.
- The Java desktop bridge's `fsWorker` uses `Executors.newCachedThreadPool`; source inspection did not show a fixed-pool exhaustion limit. Its file commands do catch exceptions and answer the callback.
- No before/after timing values are available. No instrumentation capture was provided, so the precise runtime phase cannot be assigned as a measured fact.

## Acceptance status

| Criterion | Status | Evidence |
|---|---|---|
| Slide 1 visible in about 1 second | NOT VERIFIED | Target deck and desktop runtime unavailable. Startup reads are now prioritized. |
| Editor usable in about 3 seconds | NOT VERIFIED | No timing capture. |
| All thumbnails finish shortly after | NOT VERIFIED | Filmstrip work is bounded; no target deck run. |
| No bridge step waits forever | PASS (code path) | Both bridge transports reject after 10 seconds. |
| No blank thumbnail without loading state | NOT VERIFIED | Runtime UI instrumentation and visual reproduction unavailable. |
| Stalled load is reported within about 30 seconds | PARTIAL | Preview uses 30/60-second soft notices based on active module/render work; not verified on the target desktop deck. Present uses a 30-second no-progress notice. |
| Failed item shows name/reason and Retry | PARTIAL | Preview has per-slide error details and Retry. Thumbnail badge behavior is implemented; visual target-deck verification remains. |
| Slow/queued slide never becomes a timeout error | PASS (code path) | Removed the StageFrame 12-second deadline and slide-task fixed timeout. |
| Selected slide outranks background thumbnail work | PASS (code path) | Selected requests have highest priority in the shared four-job compile queue. |
| Duplicate source is fully written before it is opened | PASS (code path) | Desktop duplicate preloads source files and awaits `mutateDeck` persistence before return. |
| Desktop and web mode runs | NOT VERIFIED | No target deck/runtime session. |
| Missing file, hung image, throwing slide, hung bridge fault injection | NOT VERIFIED | Not run. |
| Open/close 20 times with heap/listener/object URL check | NOT VERIFIED | Not run. |

## Phase timings

| Phase | Before | After |
|---|---:|---:|
| Deck walk and text reads | Not captured | Not captured; first render no longer awaits all text reads |
| Slide 1 compile and render | Not captured | Not captured |
| Background/assets/fonts | Not captured | Not captured; preloader work is bounded |
| Thumbnail compilation | Not captured | Not captured; two concurrent workers |
| Editor interactive | Not captured | Not captured |
| All thumbnails | Not captured | Not captured |

## Task 14 checks

- Targeted ESLint on the modified TypeScript files: PASS.
- `git diff --check`: PASS.
- `npx tsc --noEmit`: the modified files have no reported type errors; the command remains blocked by three unrelated existing errors in `useDownloadFeedback.ts`, `useSync.ts`, and `lib/db.ts`.
- `npm run test:bridge`: NOT RUN; Bun is not installed in this environment.
- `npm run test:e2e-desktop`: NOT RUN; Playwright Chromium executable is missing from the configured cache.
- The 21-slide deck is not in this workspace, so throttled desktop timing, multi-duplicate, slow-compile-over-60-seconds, real hang, syntax-error isolation and far-slide selection checks remain unverified.
- No actual queue/load timings for `slides/end-copy.tsx` are available; runtime logs now capture those timings on the next desktop reproduction.

## Local checks

- Targeted ESLint on all modified TypeScript files: PASS.
- `npx tsc --noEmit`: BLOCKED by three existing errors outside the modified files: `src/hooks/useDownloadFeedback.ts` (ToastAction prop type), `src/hooks/useSync.ts` (download bridge event has no `deckId`), and `src/lib/db.ts` (generated `@prisma/client` lacks `PrismaClient`).
