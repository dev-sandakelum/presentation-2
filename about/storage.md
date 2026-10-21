# Storage — every place data lives

Who OWNS each item, and how long it lives. "Owner" is the component that
writes/validates it; "lifetime" is when it disappears.

## Web app (this repo)

| Item | Where | Owner | Lifetime |
| --- | --- | --- | --- |
| Browser-store decks | IndexedDB `chasse-studio` **v2**, store `decks`: `deckId` → text-only record (`files` map, title, created/modified, `device?` flag) | browser-store.ts | Until the user clears site data / the browser evicts it (a `navigator.storage.persist()` request fires once when a device handle is stored) |
| Browser-store asset blobs | IndexedDB store `blobs`: `` `${deckId}::${path}` `` → `{blob, display?}` (one key per asset — the v2 split that fixed "Failed to write blobs (IOError)") | browser-store.ts | Same as decks; dropped per-key on asset delete, all keys on deck delete |
| Snapshots (browser decks) | IndexedDB store `snapshots`: `` `${deckId}::${name}` `` → `{files, assets}`; **last 10 per deck** (older pruned on create) | browser-store.ts | Same as decks; explicit restore/deck delete |
| Device-folder handles | IndexedDB store `handles`: `deckId` → `FileSystemDirectoryHandle`, plus composite key `__parent__::<deckId>` → `{parent, childName}` (the picked root when the deck sits in a subfolder — one permission click on the parent re-derives every child) | browser-store.ts (stored) + permission.ts (lifecycle) | The HANDLE survives restarts forever; its **write permission does not** — Chromium silently lapses to `prompt` each restart (granted/prompt/denied/missing lifecycle in permission.ts). NOT usable inside the embedded desktop webview (JCEF has no permission-handler API — `offersPersistentGrant()` returns false when `cefQuery` is present) |
| UI prefs | localStorage `ss-ui-theme` (theme, applied pre-hydration in layout.tsx), `ss-code-minimized`, `ss-code-side`, `ss-code-side-w` (code pane layout in DashboardView) | the web app | Forever (until cleared) |
| Crash-recovery copies | localStorage `ss-recovery::<deckId>` — dirty text buffers, ≤ 2 MB total | useSaveQueue | Until the next successful save (cleared) or restore; written on tab hide/close and on save failure |
| Export blob URLs | Origin-private `URL.createObjectURL` blobs (`.smdeck`/`.deck.tsx` exports) | client.ts `scheduleObjectUrlRevoke` | **10 min max + revoked on `pagehide`** — a native Save-as dialog can outlive short timers |
| Editor preview object URLs | object URLs for IndexedDB blobs (Assets panel, `<img>` previews) | browser-store.ts objectUrlCache | Session; revoked/re-created when the blob changes |
| Compiled slide modules (client) | In-memory map keyed `deckId:path:version` + per-deck version seen + inflight coalescing; browser-deck modules also become short-lived blob URLs in the sandbox | client.ts `resolveModule` | Session (memory); evicted when the deck version advances |
| Compiled modules (server) | In-memory cache per Node process keyed `deckId:file`, value has source hash + output hash + dep versions | compile.ts | Server process lifetime; invalidates when a dep's version drifts |
| Decoded data-URL images | In-memory set (present-mode preloader dedupe) | useAssetPreloader | Session (cleared past 500 entries) |
| Server decks | `decks/<deckId>/` folders on the Next.js server (only when `GET /api/capabilities` → `fsWritable`; disabled with `SS_FORCE_READONLY=1`) | store.ts + /api/decks routes | Forever |
| External project links | `decks/.registry.json` — `{links: {<deckId>: "<absolute folder>"}}`, written atomically (temp + rename) | registry.ts | Forever; only directories are ever registered |
| Snapshots (server decks) | `<deck>/.stagesmith/snapshots/*.json` inside the deck folder — text files only, **last 10** | store.ts | With the deck folder |
| Desktop-deck snapshots | Same `.stagesmith/snapshots/` convention, written through the fs bridge | desktop-store.ts | With the deck folder (Java side) |

## Desktop mode (owned by the Java app — `~/.chasse-studio/`)

| Item | Where | Owner | Lifetime |
| --- | --- | --- | --- |
| Decks folder choice | `~/.chasse-studio/config.json` — `{decksRoot, confirmedRoot}` | Java `FsService` | Forever (survives restarts — nothing expires, unlike browser handles) |
| Web-app URL (`app.url`) | `~/.chasse-studio/app.properties` (user file layered over the bundled one) | Java `AppConfig` | Forever; editable via File → Change app URL |
| Downloads dir choice | Java AppConfig (`downloads.dir` persistence) | Java `DownloadBridge` | Forever |
| Loopback file server token | `http://127.0.0.1:<port>/<token>/…` URL segment; per-session random token, Host/Origin-checked | Java `LoopbackFileServer` | Session (app run) |
| **JCEF browser profile** | `~/.chasse-studio/browser-profile` (persistent `CefSettings.cache_path`) | Java `Main` | **Since desktop app 1.3.0: persists** — the IndexedDB/localStorage of the embedded webview survive restarts. **Before 1.3.0 it was IN-MEMORY and everything vanished on close** — the root cause of the "cannot save" bug (audit-phase-0 in the worklog) |
| Sync rooms | Java process memory (`SyncRooms`); room token is 12 hex chars (6 random bytes); **rooms with no phones and no activity for 2 h are evicted** | Java | Process lifetime / 2 h idle |
| Phone remote page | Java-embedded server (Javalin on `0.0.0.0:8765`, WS handler) | Java | App run |

## Phone remote

| Item | Where | Owner | Lifetime |
| --- | --- | --- | --- |
| Room state — desktop transport | Desktop app memory (above) | Java SyncRooms | App run / 2 h idle eviction |
| Room state — socket transport | `mini-services/stagesmith-sync` process memory (`rooms` map); token = 12 hex chars minted at room creation | mini-service (port 3003) | Process lifetime (no idle eviction — rooms die with the service) |
| Control token | Minted server-side, delivered to the dashboard/QR, checked on every mutating action; phone links carry `?t=` | sync server (Java or mini-service) | Room lifetime; **phone links expire when the app/server closes** — restart the server and re-scan |

## Rules of thumb

- The folder is the truth: server and desktop decks are fully materialized on
  disk (deck.json last, atomic writes); IndexedDB and localStorage are caches,
  preferences and recovery aids only.
- `theme.css` on disk and in IndexedDB always keeps the portable
  `url(./assets/…)` form; rewritten URLs exist only in memory at load time.
- Nothing the web app persists is required to survive a server restart except
  the server `decks/` tree itself; every browser-side item is per-origin.
