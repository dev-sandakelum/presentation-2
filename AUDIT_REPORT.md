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
