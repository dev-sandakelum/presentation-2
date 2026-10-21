# Chassé Studio (presentation-2) — README

A code-first presentation studio: a deck is a plain folder of files, slides are
TSX components, and the app compiles and renders them live. There is **no
database** — the folder *is* the project.

## What a deck is

```
<decks-root>/<deck-id>/
  deck.json          # manifest: id, title, slides[] order, settings, bg/overlay defaults
  theme.css          # CSS custom properties + url(./assets/…) in portable form
  slides/*.tsx       # one component per slide (steps via useStep()/<Step>)
  bg/                # optional shared background modules (code) or images
  overlay/           # optional overlay modules (code) or images
  notes/<slide>.md   # presenter notes per slide
  assets/            # images, fonts, media (referenced as url(./assets/…) / <Img/>)
```

Allowed slide imports: `react`, `react-dom/client`, `react/jsx-runtime`,
`stagesmith`, `lucide-react`, `@/…` (deck files) and relative paths inside the
deck. Everything else fails the compile with a clear message (compile.ts).

## One route, query-driven views

The whole app lives on `/` (`src/app/page.tsx`, server-rendered initial data):

| URL | View |
| --- | --- |
| `/` | Library (deck list, create/import/export, desktop-folder banner) |
| `/?deck=<id>` | Dashboard (editor) |
| `/?deck=<id>&present=1` | Present mode (full-screen stage) |
| `/?remote=<id>&t=<token>` | Phone remote (token-gated control) |

## Run

```bash
bun install
bun run dev        # next dev -p 3000
```

Other scripts (package.json):

| Script | What it does |
| --- | --- |
| `bun run lint` | eslint over the repo |
| `bun run test:bridge` | `scripts/test-bridge-contract.mjs` — 35 assertions driving the real desktop-store/desktop-fs modules against a Java-contract mock on real disk (hello gating, root, create/list/read/write, diff-only saves, signature/poll agreement, `{code,message}` errors, traversal refusal, loopback URL/upload/token-404, duplicate, delete, theme.css portability, v1.1 event push) |
| `bun run test:e2e-desktop` | `scripts/e2e-desktop-mock.mjs` — 16 assertions: the REAL app in Chromium (playwright-core) with mocked `cefQuery` + a full Java mock on real disk. Needs a dev server on `E2E_BASE_URL` (default `http://localhost:3100`). Verifies bridge detection, desktop-store activation, New deck → files on disk, save queue Unsaved→Saved, reload persistence, PromptDialog, clean console |
| `bun run build` | `next build` + copies `.next/static` and `public/` into `.next/standalone/` (standalone output, next.config.ts) |
| `bun run start` | runs the standalone server (`bun .next/standalone/server.js`) |
| `bun run db:*` | Prisma scaffolding — **unused** (see below) |

Dev-only helper: `node scripts/build-vendor.mjs` (add `--all`) rebuilds the ESM
vendor bundles in `public/vendor/` that the sandboxed Stage Runtime imports via
`/api/vendor/*.js`. `playwright-core` is a dependency only so the dev/test
scripts can drive a real Chromium; the app itself never uses it at runtime.

## Build & release

- `bun run build` → Next.js **standalone** output (`.next/standalone`).
- Release to Vercel: `git push` — Vercel deploys the web app. Hosted/serverless
  file systems are read-only, so the app probes `GET /api/capabilities`
  (`fsWritable`) and falls back to browser storage (IndexedDB). Set
  `SS_FORCE_READONLY=1` to force that read-only mode even where the FS is
  writable (e.g. a self-hosted server you want deck-less).

## Tech

- Next.js 16 App Router, React 19, TypeScript.
- Tailwind CSS 4 + shadcn/ui (Radix primitives) for the editor UI.
- esbuild as the slide compiler behind `/api/compile` (`src/lib/stagesmith/compile.ts`):
  server decks compile from disk (GET, cache keyed by content hash), browser/
  desktop decks POST the whole file map for a stateless, self-contained ESM
  bundle (internal deps inlined, bare imports left to the runtime import map).
- Sandboxed stage runtime: `public/runtime.html` served at `/runtime` inside a
  `sandbox="allow-scripts"` iframe per StageFrame.
- socket.io (client) + `mini-services/stagesmith-sync` (server, port 3003) for
  the local phone-remote transport; the desktop app replaces that with its own
  embedded server driven over the Java bridge.

## No database

`prisma/schema.prisma`, `db/custom.db` and `src/lib/db.ts` are **unused
scaffolding** — nothing in `src/` imports `@/lib/db`. All deck data lives in
files (server/desktop) or IndexedDB (browser). Ignore the `db:*` scripts.

## The desktop app (chasse-desktop)

A separate Java/JCEF app (`chasse-desktop`) embeds this web app. When it is
present it injects `window.cefQuery` and the app talks to it over a versioned
bridge contract (v1 sync actions + v2 fs commands, same CefMessageRouter
channel) — see [architecture.md](architecture.md) for the reference tables.
The desktop app loads this app's deployed URL (`app.url` in
`~/.chasse-studio/app.properties`); the bridge contract is the only coupling
between the two repos.

## Where to look next

- [architecture.md](architecture.md) — modules, data flow, the bridge contract
- [storage.md](storage.md) — every place data is stored, with owner + lifetime
- [features.md](features.md) — feature inventory with status after the audit
- [decisions.md](decisions.md) — design decisions and the ones they replaced
- [troubleshooting.md](troubleshooting.md) — common errors and fixes
