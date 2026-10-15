# Stagesmith: Final Plan

A code-first presentation studio. A deck is a folder of plain files, and the app is a live window onto that folder.

Plan v3.0 · 15 October 2026 · combines the v2 spec, the .smdeck project format and the stagelink presenter system, with the scope you ticked.

## 1. Idea in one minute

AI writes TSX very well, so Stagesmith does not try to be a visual editor. It is the fastest way to hold, fix, preview, present and remote-control a deck made of TSX slides.

```
Open or import a deck folder → dashboard shows live previews → fix any slide in the code pane
→ pick background, overlay and theme → present → scan QR → phone controls the deck
```

| Problem | Answer |
| --- | --- |
| Can't change pages one by one | Every slide is its own .tsx file with a code pane and a live preview |
| No server for QR | Built-in server, QR panel, phone remote |
| Can't control background or overlay | A common version for all slides plus a per-slide override; each can be code, HTML, image or none, and can be saved as a preset |
| One look for the whole deck | `theme.css` inside the deck folder |

Stack: Node 20+, TypeScript, esbuild, one HTTP + WebSocket server, React (Vite) UI, CodeMirror 6. Design surface 1280 × 720. Offline, LAN only. Start with `npx stagesmith`.

## 2. Governing rule: the folder is the project

1. The app opens a deck folder as the project. The folder holds everything: slides, theme, images, backgrounds, overlays, notes, fonts.
2. Every change made in the app is written into the folder. There is no separate save format and no hidden database.
3. Anything added from outside is copied into the folder first. The deck only references files inside it, never your Downloads, the preset library or a URL.
4. Edits made outside the app (VS Code, an AI tool, a script) appear live in the app.
5. `.smdeck`, `.deck.tsx` and PPTX are only ways to bring a deck in or send a copy out.

| You do this in the app | What happens in the folder |
| --- | --- |
| Add, edit, reorder or delete a slide | `slides/<id>.tsx` is written or removed, order changes in `deck.json` |
| Pick a background or overlay HTML file | Copied into `assets/bg/<name>/` (with its local files) and set in `deck.json` |
| Drop an image on the editor or Assets tab | Copied into `assets/`, a snippet is inserted |
| Change theme colours or fonts | `theme.css` is rewritten |
| Apply a preset or theme pack | Copied into `bg/`, `overlay/` or `theme.css` after a snapshot |
| Insert slides from another deck | Slide files, notes, overrides and the assets they use are copied in |
| Edit a file in VS Code | The app recompiles and shows it; a new slide file is added to `deck.json` |

`deck.json` is always written last when structure changes, so a crash never leaves the index pointing at missing files. All writes are atomic (temp file, then rename) after a short debounce.

## 3. Final scope

| Area | What ships |
| --- | --- |
| Engine | Deck folder, esbuild compile with single-slide hot-swap, sandboxed runtime iframe with strict CSP, error card per slide with the last good preview kept, one command / one port / LAN-only server |
| Dashboard | Filmstrip (live thumbnails, drag reorder, duplicate, delete), read-only preview with Final / BG / Content / Overlay switch, CodeMirror pane (Slide, BG, Overlay, Notes, Assets, Theme), autosave, 200-step undo, last 10 snapshots, library home, copy fix prompt button |
| Present and remote | 220 ms transitions, keys, swipe, 12% click zones, auto-hide chrome, progress bar, dot nav, overview grid, theme toggle, build steps, QR panel, token-protected phone remote with slide list, notes and status colours |
| Background and overlay | Common plus per-slide override (one unified feature), sources code / HTML / image / none, 1600 ms crossfade, presets (copied, not linked), theme packs, effects kit, BrandFrame / CornerMarks / SlideNumber |
| Import and export | `.smdeck`, `.deck.tsx`, AI prompt kit, named assets with hash de-dupe, import report and merge rules, folder watch, insert slides from another deck, PDF export, PPTX export (image-based), PPTX import (editable, best effort) |

## 4. Deck folder

```
my-talk/
├─ deck.json        index: title, settings, slide order, common bg/overlay, overrides
├─ theme.css        the deck theme: tokens, fonts, light and dark values
├─ slides/          one .tsx per slide
├─ bg/              background code (common.tsx and per-slide overrides)
├─ overlay/         overlay code
├─ shared/          helpers imported as '@/shared'
├─ notes/           one .md per slide
├─ assets/          every image, html file, font and frame sequence
│   ├─ bg/<name>/   HTML backgrounds with their local files
│   ├─ fonts/
│   └─ frames/
└─ .stagesmith/     local cache, never zipped, safe to delete
```

`deck.json` holds wiring and settings only:

| Field | Meaning |
| --- | --- |
| `format`, `format_version`, `id`, `title`, `created`, `modified` | Identity and version |
| `settings` | size, default mode (dark / light), `transitionMs` (220), `bgCrossfadeMs` (1600) |
| `bg`, `overlay` | The common sources. Missing means none |
| `slides[]` | Order of the deck. Each entry has `id`, `label`, optional `theme` mode, optional `bg` / `overlay` override |

A source is one of `none`, `code` (file path), `html` (asset path and options) or `image` (asset path and options). An override replaces the common source on that slide and the common one is not mounted there. Colours `acc` and `acc2` no longer live in `deck.json`; they live in `theme.css`. The remote token, port and LAN IP are never stored in the deck, so sharing a deck never shares remote access.

Path rules: forward slashes, UTF-8, no `..`, no absolute paths, unique ignoring case, 200 characters maximum.

## 5. Architecture

### 5.1 Compile and runtime

- The server compiles each file with esbuild and recompiles only what changed.
- Slides, backgrounds and overlays render inside one sandboxed Stage Runtime iframe (`sandbox='allow-scripts'`, no same-origin, CSP blocking remote URLs). AI-written code cannot reach your files or the API.
- The runtime hot-swaps one slide's module and keeps the current position. A compile error shows in the code pane and the filmstrip badge while the preview keeps the last good version. A runtime error shows an error card on that slide only.
- Allowed imports: `react`, `stagesmith`, `lucide-react`, `@/...` (project root), and relative files inside the project.
- Thumbnails are the same React components rendered small and lazily, at the final step, with animation frozen.

### 5.2 Stage and theme

- The stage is a fixed 1280 × 720 canvas scaled to fit the window with a CSS transform. Inside it `--u` is 12.8px, so `calc(var(--u) * N)` layouts from stagelink carry over unchanged and pixel layouts also work.
- `theme.css` carries the tokens `--acc --acc2 --ink --ink2 --mut --line --card --fd --fb --fm`, light and dark blocks, and `@font-face` rules that point at `./assets/fonts/...`. The server rewrites those paths when serving, so the file stays portable.
- It is injected before slide styles in the preview, thumbnails, display and export. A deck without one gets the built-in default.
- Per-deck default mode and per-slide mode stay in `deck.json`.

### 5.3 Build steps

- A slide calls `useStep(n)` or wraps parts in `<Step at={k}>`. Step 0 shows the base slide and step n shows everything.
- The compile step reads literal step counts and caches them; a dynamic count is reported by the display when the slide mounts.
- Next on the remote, keyboard, swipe or click zone advances a step first, then the slide. Previous goes back a step, then to the previous slide at its last step. Jumping from the overview or the remote list starts at step 0.

### 5.4 Server and WebSocket

One port (default 4821, `--port`). One room per deck. Server state: `{ slideId, index, step, steps, updatedAt }`.

| Message | Direction | Effect |
| --- | --- | --- |
| (on connect) | server → client | Sends current state |
| `set-slide` {slideId, step?} | remote / display → server | Updates state, ack to sender, state broadcast |
| `nav` {dir: next or prev} | remote / display → server | Server resolves step or slide movement |
| `report-steps` {slideId, steps} | display → server | Fills in a dynamic step count |
| `set-ui` {qr?, overview?} | remote → server | Toggles panels on the display |
| `state` | server → room | Everyone moves to that slide and step |
| `deck-updated` | server → room | Reload the changed slide |
| `ping` / `pong` | both | Keep-alive every 25 s |

Control messages without the deck token are rejected. The dashboard and `/api` accept localhost only. Phones may use `/remote`, `/display` (view), `/media` and `/ws`.

LAN IP detection scans all interfaces, keeps private IPv4 addresses (192.168.x, 10.x, 172.16-31.x) and ranks virtual adapters (VMware, VirtualBox, Hyper-V, WSL, Docker) last. If several remain, the QR panel offers a dropdown. The client hook reconnects after 3 s and after two failures swaps between the LAN and localhost URLs.

## 6. Dashboard

- Top bar: brand (back to library), deck title, saved chip, undo and redo, Import, Export, QR (shows connected phones), Present (F5 from start, Shift+F5 from current).
- Filmstrip (left): live thumbnails, number chip, red badge on compile error, drag reorder with drop line, duplicate and delete on hover, `+ Slide` from a starter template, right-click rename.
- Preview (centre): read-only 16:9, updates about 150 ms after typing. Mode switch: Final, BG, Content, Overlay.
- Code pane (bottom or right, `Ctrl+E` toggles): tabs Slide, BG, Overlay, Notes, Assets, Theme. CodeMirror 6 with TSX highlighting, search, Format button and error gutter. No type-checking, so it stays instant. Dropping an image on the editor copies it into `assets/` and inserts `<Img name='...' />`. The Assets tab can upload, rename, delete, copy a snippet and remove unused files.
- Copy fix prompt: one button that puts the slide code and its current error on the clipboard, written for an AI tool.
- Save and history: autosave after about 400 ms, `Ctrl+S` just flushes, 200-step undo (code edits use CodeMirror history plus a per-slide stack; slide and layer changes are separate steps), snapshots before import, delete or apply preset (last 10 per deck, restore from the library menu).
- Library home: grid of deck cards with live preview of slide 1, plus Open, Present, QR, Duplicate, Delete, Export, New deck, Import and Open folder. Decks live in `~/Stagesmith/decks/`; a folder dropped there appears automatically. A Presets section lists saved backgrounds, overlays and themes.

## 7. Present and phone remote

**Display.** Layers from back to front: background (incoming below, outgoing fading above), slide, overlay (pointer events off), corner marks, auto-hiding chrome, progress bar, panels. Only one slide is mounted at a time.

- Transition: fade, 12 px blur and a 7vh move, 220 ms, direction-aware; reduced-motion collapses it.
- Keys: Right, Space, PageDown next; Left, PageUp previous; Home and End; `F` fullscreen; `G` or `O` overview grid with live thumbnails; `Q` QR panel; `T` theme toggle; `Esc` closes panels. Swipe left or right (60 px) and invisible click zones on the left and right 12%.
- Chrome hides after 3 s of inactivity: top bar (brand, theme, overview, fullscreen), bottom bar (slide label, live clock, prev / counter / next, QR), right-edge dot nav with labels, gradient progress bar.
- `T` changes the mode for the session only and does not write to the folder. A slide with its own `theme` mode ignores it.
- Live edit while presenting is allowed: when a file changes, only that slide hot-swaps and the display stays where it is. A per-machine setting can freeze the display instead.

**QR panel.** Backdrop with blur, a 220 × 220 QR of the remote URL, the URL with a copy button, connected-phone count. Closes on `Esc`, backdrop or the button.

**Phone remote.** Dark and mobile-first: status badge (red offline, amber pulsing connecting, green live), current slide label and counter, progress bar, large Prev and Next, scrollable slide list from each slide's label with the active one tinted and scrolled into view, collapsible notes for the current slide, footer with all decks and the address.

## 8. Background and overlay

Both behave the same way: common scope for all slides, one override per slide.

| Slide state | Shown | Common mounted |
| --- | --- | --- |
| No override | Common | Yes |
| Override | Override only | No |
| Override is none | Nothing | No |

Common stays mounted across consecutive slides, so a running effect never restarts.

| Source | What it is |
| --- | --- |
| Code | A TSX file with a default-exported component |
| HTML | An HTML file shown in its own sandboxed iframe, with fit, opacity and dim. Picking it copies the file and any local images, CSS or scripts beside it into `assets/bg/<name>/`. Remote references are blocked by the CSP and listed in the import report |
| Image | An asset plus number fields. Backgrounds: fit, position, zoom, blur, dim, opacity, adapt to dark. Overlays: x, y, width, rotation, opacity, anchor |
| None | Nothing |

- Crossfade: when the background changes between slides, the outgoing layer fades out while the incoming one fades in with a small zoom (1.045 to 1), 1600 ms, `cubic-bezier(0.16, 1, 0.3, 1)`. No change, no fade. It works between any two source types.
- Effects kit (React components, frozen in thumbnails, reduced-motion aware): NeuralNet, Aurora, GridLines, CursorGlow, FilmNoise, Vignette, Spotlight.
- Brand components: BrandFrame, CornerMarks, SlideNumber. An overlay override can render the common overlay too with `<Common />`.
- Presets: any background, overlay or theme can be saved to `~/Stagesmith/library/{bg,overlay,theme}/<name>/`. Applying copies the preset into the deck, never links it. Theme packs are presets of kind theme: a `theme.css` plus its fonts. Starters: Clean, Tech, Aurora, Brand frame, Page number, Watermark, and a dark and a light theme.

## 9. Import and export

**Assets.** Every image, HTML file, font and frame sequence lives under `assets/` and is referenced by path (`<Img name='...' />`, `asset('...')`, `<HtmlFrame src='...' />`, `<FrameSequence dir='...' />`). Never base64 in code. The same bytes are detected by SHA-256. Remote URLs are blocked at runtime; an optional helper downloads them into `assets/` while online.

| You bring in | Result |
| --- | --- |
| `.smdeck` or `.zip` with `deck.json` | Extracted as a new project folder |
| Folder with `deck.json` | Opened in place or copied into the library |
| `.deck.tsx` or pasted AI text | New deck; `// @file <path>` sections become files |
| One `.tsx` | New slide |
| Slides from another `.smdeck` | Chosen slides are copied in with notes, overrides and assets |
| Preset | Added as common or as this slide's override (a theme pack replaces `theme.css` after a snapshot) |
| Loose images or HTML | Copied into `assets/` |
| PPTX | New deck, see below |

Merge rules: an existing slide id gets a suffix (`csr-2`) and its files follow; the same path and bytes reuse the file; the same path with different bytes renames the incoming file and rewrites exact references in the incoming files only; an override file clash renames the incoming file. Inserted slides take the target deck's theme and never bring in a `theme.css`; a mismatch is listed in the report. One import report lists slides found, skipped files, missing or renamed assets, disallowed imports, hash warnings and unsupported PPTX objects.

| You send out | Content |
| --- | --- |
| `.smdeck` | Zip of the folder: `mimetype` first and stored, then `manifest.json` with SHA-256 per file. Deterministic, atomic, never written into the original |
| Single `.deck.tsx` | One text file; optional embedded images with a size warning |
| One slide or selected slides | `.tsx` or a trimmed `.smdeck` |
| Preset | `.smpreset` zip |
| PDF | One page per slide at 16:9 |
| PPTX | One image per slide, 16:9, with the notes as speaker notes |

**Load safety.** Every load rejects `..`, absolute paths, symlinks and zip bombs (at most 10 000 entries, 2 GiB total, 200 MB per entry). Slide code never runs during load.

**Export engine (PDF and PPTX).** Uses the Chrome, Edge or Chromium already installed, through `puppeteer-core`, with nothing downloaded. Each slide is captured at its final step with effects settled, at 1920 × 1080 for PPTX. If no browser is found, the app says so and shows where to set the path. An option exports one slide per step.

**PPTX import (best effort).** Written in Node with a zip and XML parser. Each PPTX slide becomes a generated `slides/<id>.tsx` with absolutely positioned elements in the 1280 × 720 stage.

| Tier | Converts |
| --- | --- |
| 1 | Text boxes with run formatting, pictures (copied to `assets/`), rectangles, ellipses, lines, solid fills, notes (to `notes/*.md`), master background (to a bg), theme colours and fonts (to `theme.css`) |
| 2 | Tables, groups, gradients, bullets and numbering |
| Not converted | SmartArt, charts, animations, WordArt, embedded video. Shown as a labelled placeholder and listed in the report |

Non-16:9 files are letterboxed into the stage with a warning.

## 10. Decisions locked

| Topic | Decision |
| --- | --- |
| Project model | The folder is the project; every change writes into it; outside files are copied in |
| Theme | `theme.css` in the deck folder; `acc` and `acc2` leave `deck.json` |
| Light and dark | `T` toggle kept, session-only |
| Scaling | Fixed 1280 × 720 stage, `--u` is 12.8px inside it |
| Steps | Step and step count live in the server state; Next and Previous are resolved by the server |
| Export rasteriser | Installed Chrome, Edge or Chromium via `puppeteer-core` |
| PPTX import | Generated TSX, tiers 1 and 2, 4:3 letterboxed |
| Live edit while presenting | Allowed, with a freeze setting |
| Inserting slides | Target deck's theme wins |
| Backgrounds | HTML is a fourth source; its local files are copied beside it |

## 11. Build order

| # | Milestone | Done when |
| --- | --- | --- |
| M1 | Core: folder schema, path rules, server, esbuild, sandbox runtime, fixed stage, `theme.css` injection, error cards | A folder opens, slides render, an edit updates one slide |
| M2 | Dashboard: filmstrip, preview, CodeMirror tabs including Theme, atomic autosave, undo, snapshots, library, folder watch with auto-adopt, copy fix prompt | A deck can be built and fixed without leaving the dashboard, and VS Code edits show live |
| M3 | Present and remote: display, chrome, keys, WebSocket with the step protocol, token, QR, phone remote, `useStep()`, theme toggle | A phone runs a whole deck and Next walks through steps and then slides |
| M4 | Background and overlay: common and override, four sources, crossfade, effects kit, brand components, preview mode switch, presets, theme packs | Any slide can have its own background or overlay and a look can be reused |
| M5 | Exchange: `.smdeck`, manifest, hardening, `.deck.tsx`, prompt kit, asset rules, merge rules, import report, insert slides | A pasted AI answer becomes a deck and decks move between machines |
| M6 | Export: PDF, then PPTX (image-based) on the same capture engine | Both export from the dashboard |
| M7 | PPTX import: tier 1, then tier 2 | A real PPTX opens as a deck with an honest report |

Testing: golden-file tests for the folder and zip formats from the start, hostile-zip tests, and a small set of real PPTX files as fixtures for M7.

## 12. Cut for now

Rust core, Tauri shell, standalone HTML export, visual editing of slide content, notes card on the display, presenter view on a second screen, timers, laser pointer and blank screen, rehearsal mode, type-check diagnostics, starter snippets, PIN or `.local` fallback join, accessibility checker, auto git commits, audience follow link, automatic image optimisation.

## 13. Limits and risks

1. Fixed 16:9 design surface; single user, local only, no cloud or collaboration.
2. TSX is real code: only the allowed imports work, and a failing slide shows an error card without stopping the deck.
3. No visual editing of slide content, by design. Fixes are made in code, usually by asking AI and re-importing the slide.
4. Thumbnails freeze animation and effects.
5. The phone remote needs the server running, and a first-run firewall prompt may need approval.
6. Image export depends on an installed Chromium-based browser.
7. PPTX import is the largest risk. Expect good text, picture and shape fidelity and clearly reported gaps, not a perfect copy.
