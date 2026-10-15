# Worklog

---
Task ID: 1
Agent: main (Super Z)
Task: Build Stagesmith (code-first presentation studio, per "Stagesmith Final Plan.md") as a Next.js 16 app; seed it with the "Next.js Unlocked" deck from upload/2.html.

Work Log:
- Read /home/z/my-project/upload/Stagesmith Final Plan.md (full spec: folder-is-project, esbuild, sandbox runtime, dashboard, present+remote, bg/overlay, import/export)
- Read /home/z/my-project/upload/2.html fully (17 slides, Geist type system, dark/light tokens, keyboard/overview/typing, postMessage bridge)
- Initialized fullstack env (init-fullstack.sh), dev server on :3000
- Installed deps: esbuild@0.28.2, socket.io@4.8.4, socket.io-client, qrcode, jszip, @uiw/react-codemirror + codemirror langs/themes

Stage Summary:
- Architecture decided:
  * Decks live as folders under /home/z/my-project/decks/<id>/ (deck.json, theme.css, slides/*.tsx, bg/, overlay/, notes/, assets/) — no DB, per plan §2
  * Slides compiled TSX→ESM by esbuild in /api/compile (cache keyed by content hash); `@/`+relative imports rewritten to compile URLs; react/stagesmith/lucide-react stay bare → import map in sandboxed runtime.html (opaque origin, CORS on API-served assets)
  * Stage Runtime: public/runtime.html, sandbox="allow-scripts", fixed 1280×720 stage scaled via transform, theme.css injected by postMessage, error cards, static/thumbnail freeze mode, step protocol
  * Sync: mini-service stagesmith-sync (socket.io :3003), rooms per deck, nav/steps resolved server-side, token-gated control, fs.watch → deck-updated
  * Single route / with query-based views: ?view=library | ?deck=<id> (dashboard) | ?deck=<id>&present=1 | ?remote=<id>&t=<token>
- Next: engine layer (types, deck store, compile, runtime module, vendor bundles), then WS service, then UI views, then seed deck conversion (17 TSX slides).

---
Task ID: 2
Agent: main (Super Z)
Task: Build + verify the Stagesmith Next.js app and seed deck (continuation of Task 1)

Work Log:
- Engine: src/lib/stagesmith/{types,store,compile,templates}.ts — folder-is-project store (atomic writes, path rules, snapshots), esbuild compile with output-hash versioning (transitive dep changes propagate via embedded dep URLs), @/ + relative import resolution to compile URLs, import allow-list (react, react-dom/client, stagesmith, lucide-react, @/…)
- Runtime: public/runtime.html sandbox (allow-scripts, opaque origin) + /api/runtime route with version-stamped import map; layers bg/slide/overlay, error cards, static/thumbnail freeze, step protocol; boot watchdog + double-execution guard; POST /runtime heals missed configs (onLoad + ready re-post, idempotent)
- Vendor: scripts/build-vendor.mjs — ESM shims with named exports; react-dom banner require-shim (single React instance); served via /api/vendor/[file] with CORS
- APIs: decks CRUD, files (theme.css url rewrite), poll, slides ops, reorder, duplicate, export (.smdeck zip w/ stored mimetype+manifest, .deck.tsx), import (zip with bomb limits, @file text, bare slide), assets upload, snapshots, QR PNG
- Sync: mini-services/stagesmith-sync (socket.io :3003) — deck rooms, server-resolved nav (steps then slides), report-steps, set-ui, token-gated control, presence, fs.watch → deck-updated
- UI on /: library (deck cards + live thumbs), dashboard (filmstrip dnd-kit, preview modes + step stepper, CodeMirror pane w/ tabs, autosave 320ms, undo, fix-prompt, snapshots menu, QR), present (chrome auto-hide, dot nav, overview, transitions 220ms, bg crossfade 1600ms, T theme, LIVE/FROZEN), phone remote (status, list, notes)
- Seed deck: decks/nextjs-unlocked — 17 TSX slides ported from upload/2.html, theme.css ported to fixed 1280×720 stage, shared/icons.tsx (@/ import demo), bg/common.tsx (GridLines), overlay/common.tsx (CornerMarks), notes, aurora bg override demo on slide 02
- Fixed during verification: jsx-runtime/react named-export shims, react-dom CJS require, stale-chunk caching (versioned vendor URLs), StageFrame zero-size container, last-good slide URL as state (config never posted), API json-parse fallback returning undefined (snapshots crash), single-flight ensureBuffer, CodeMirror height (flex), localhost sync fallback (gateway absent on direct browsing)
- Verified via agent-browser + VLM: library thumb renders; dashboard (17 thumbs, selection, step stepper 2/4, code edit → autosave → disk write → live preview update); present (chrome, clock, dot nav, overview jump, keys, steps-then-slides nav 06→07, theme T light, QR panel, 1-remote presence); phone remote (LIVE with token, Next walks steps, invalid token rejected); live edit while presenting (disk edit → hot-swap on display); bg override w/ amber badge; import/export roundtrip; lint 0 problems; dev.log clean

Stage Summary:
- Stagesmith M1–M4 core + M5 import/export shipped as a Next.js 16 app, seeded with the "Next.js Unlocked" deck (17 slides, steps on CSR/SSR/Demo slides)
- Key artifacts: /home/z/my-project/decks/nextjs-unlocked/, src/lib/stagesmith/, src/components/stagesmith/, mini-services/stagesmith-sync/, public/vendor/ (built), scripts/{build-vendor,test-compile}.mjs
- Cut vs plan (documented): PPTX import/export (M6/M7), HTML bg source, strict CSP meta, Format button, 200-step cross-file undo (per-file undo + snapshots shipped)
