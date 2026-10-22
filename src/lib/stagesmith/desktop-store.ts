"use client";

/**
 * Desktop deck store — decks owned by the Chassé Studio desktop app through
 * the fs bridge (the "fs" capability).
 *
 * When the studio runs inside the desktop webview, THIS store replaces the
 * browser's File System Access API entirely: the Java side owns the folder
 * choice (native dialog, persisted in its config — nothing expires between
 * runs), the permission and every file operation. The folder is still the
 * project (deck.json + theme.css + slides/ + …), so decks created by the
 * browser version are adopted simply by picking the folder that holds them.
 *
 * Writes are minimal (only the file that changed, atomic on the Java side),
 * the deck list is served from the Java-side scan cache, and assets are
 * intercepted by JCEF at same-origin virtual asset paths; uploads use
 * bounded bridge chunks and never depend on the phone server.
 *
 * No fs capability (normal browser, older desktop release) → every entry
 * point here reports "not available" and the app uses the browser store.
 */

import type { DeckBundle, DeckCover, DeckJson, DeckSummary, FileRow, SlideEntry, Source, ThemeMode } from "./types";
import { starterDeckFiles, templateByKey } from "./templates";
import { mergeFileRows, type TreeRow } from "./file-tree";
import { sanitizeAssetName, slugify } from "./browser-store";
import {
  DesktopFsError,
  desktopFsCapability,
  desktopAssetUrlsCapability,
  compatibilityAssetBaseUrl,
  fsChooseRoot,
  fsCreateDeck,
  fsDelete,
  fsDeleteDeck,
  fsDuplicateDeck,
  fsRemoveDeck,
  fsAssetUrl,
  fsGetRoot,
  fsListDecks,
  fsListFiles,
  fsReadText,
  fsUploadFile,
  fsWriteText,
  isDesktopRootCancelled,
  type DesktopChooseRootOptions,
  type DesktopDeckInfo,
  type DesktopRootInfo,
} from "./desktop-fs";

/* ------------------------------------------------------------------ */
/* session state                                                       */
/* ------------------------------------------------------------------ */

export interface DesktopFsStatus {
  /** hello advertised the "fs" capability (desktop app present) */
  available: boolean;
  /** a decks folder has been chosen */
  configured: boolean;
  /** the folder exists and is writable */
  valid: boolean;
  /** absolute path of the chosen folder ("" when unconfigured) */
  path: string;
  /** error description when the folder is configured but unusable */
  problem: "none" | "missing" | "no-permission" | "unknown";
}

const NOT_AVAILABLE: DesktopFsStatus = {
  available: false,
  configured: false,
  valid: false,
  path: "",
  problem: "none",
};

let capabilityPromise: Promise<boolean> | null = null;
let rootInfo: DesktopRootInfo | null = null;

/** hello → "fs" capability presence (cached per session). */
export function desktopFsCapabilityCached(): Promise<boolean> {
  if (!capabilityPromise) {
    capabilityPromise = desktopFsCapability();
  }
  return capabilityPromise;
}

/** Re-reads the root state (cheap; called on library refresh). */
export async function refreshDesktopFsStatus(): Promise<DesktopFsStatus> {
  const available = await desktopFsCapabilityCached();
  if (!available) {
    rootInfo = null;
    return NOT_AVAILABLE;
  }
  try {
    rootInfo = await fsGetRoot();
  } catch {
    rootInfo = null;
    return { ...NOT_AVAILABLE, available: true };
  }
  const problem: DesktopFsStatus["problem"] = rootInfo.configured && !rootInfo.valid ? "missing" : "none";
  return { available: true, configured: rootInfo.configured, valid: rootInfo.valid, path: rootInfo.path, problem };
}

let statusPromise: Promise<DesktopFsStatus> | null = null;

/** Session status snapshot (coalesced; use refreshDesktopFsStatus to force). */
export function desktopFsStatus(): Promise<DesktopFsStatus> {
  if (!statusPromise) {
    statusPromise = refreshDesktopFsStatus();
  }
  return statusPromise;
}

/** Force a re-check next time (after chooseRoot, deletes, focus…). */
export function invalidateDesktopFsStatus(): void {
  statusPromise = null;
}

/** The desktop store takes over when the fs capability is present AND a
 *  valid root folder is configured. Otherwise: browser storage. */
export async function isDesktopFsActive(): Promise<boolean> {
  const s = await desktopFsStatus();
  return s.available && s.configured && s.valid;
}

/**
 * "Choose folder" action (native dialog on the Java side — user gesture).
 * Accepts the in-app dialog's copy: {title, startPath, hint}. A cancelled
 * chooser ({cancelled:true}, or the legacy CANCELLED error) and a BUSY answer
 * (a chooser is already open) keep the current state quietly; any other
 * failure (e.g. NO_OS_PERMISSION for a read-only or missing folder) is
 * re-thrown AFTER the state is refreshed, so the dialog can say what went
 * wrong while the banner still reflects reality.
 */
export async function chooseDesktopRoot(
  options: DesktopChooseRootOptions = {},
): Promise<DesktopFsStatus> {
  const available = await desktopFsCapabilityCached();
  if (!available) return NOT_AVAILABLE;
  let failure: unknown = null;
  try {
    const r = await fsChooseRoot(options);
    if (!isDesktopRootCancelled(r)) {
      rootInfo = r;
    }
  } catch (e) {
    if (e instanceof DesktopFsError && (e.code === "CANCELLED" || e.code === "BUSY")) {
      // cancelled, or a chooser is already open — keep whatever state we had
    } else {
      failure = e; // remembered — surfaced after the refresh below
      rootInfo = await fsGetRoot().catch(() => null);
    }
  }
  statusPromise = null;
  invalidateDeckIndex();
  const status = await refreshDesktopFsStatus();
  if (failure) throw failure;
  return status;
}

/* ------------------------------------------------------------------ */
/* record shape + caches                                               */
/* ------------------------------------------------------------------ */

export interface DesktopDeckRecord {
  id: string;
  title: string;
  /** text files of the project (deck.json, theme.css, slides/, …) */
  files: Record<string, string>;
  /** binary files by path — metadata only, served by the desktop asset handler */
  assets: Record<string, { size: number; modified: number }>;
  modified: string;
  /** every non-hidden file the folder WALK saw — the tree is complete while
   *  text contents still hydrate in the background, so file lists built from
   *  this record (bundle rows, dropdowns) are never a partial view */
  tree: Record<string, TreeRow>;
  /** disk-walk signature (path:size:mtime) — the SAME basis api.poll uses,
   *  so saves and polls agree and the dashboard never false-reloads */
  sig: string;
}

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** same split the browser store uses — binary extensions are assets */
const BINARY_EXT = /\.(png|jpe?g|svg|webp|gif|avif|bmp|ico|mp4|webm|mp3|wav|ogg|woff2?|ttf|otf|zip)$/i;

const records = new Map<string, DesktopDeckRecord>();
const pendingTextReads = new Map<string, Promise<string>>();
let deckIndex: DesktopDeckInfo[] | null = null;
let deckIndexAt = 0;
const summaryCache = new Map<string, DeckSummary>();
/** deck+path URL cache (virtual same-origin paths or legacy small-image blobs) */
const urlCache = new Map<string, string>();
/** original upload display names (sanitized names stay disk/URL-safe) */
const displayNames = new Map<string, Map<string, string>>();

function loadPhase(name: string, phase: "start" | "end", details?: Record<string, unknown>): void {
  const mark = `stagesmith:desktop:${name}:${phase}`;
  if (typeof performance !== "undefined") {
    if (phase === "start") performance.clearMarks(`stagesmith:desktop:${name}:start`);
    performance.mark(mark);
    if (phase === "end") {
      try {
        performance.measure(`stagesmith:desktop:${name}`, `stagesmith:desktop:${name}:start`, mark);
      } catch {
        // A matching start may not exist when a cached phase is skipped.
      }
    }
  }
  console.info(`[deck-load] ${phase.toUpperCase()} ${name}`, details ?? "");
}

export function validDeckId(id: string): boolean {
  return ID_RE.test(id);
}

function isHidden(rel: string): boolean {
  return rel.split("/").some((seg) => seg.startsWith("."));
}

function fileDisplayName(deckId: string, path: string): string | undefined {
  return displayNames.get(deckId)?.get(path);
}

function setFileDisplayName(deckId: string, path: string, display: string): void {
  let m = displayNames.get(deckId);
  if (!m) {
    m = new Map();
    displayNames.set(deckId, m);
  }
  m.set(path, display);
}

/* ---------------- signature (same fnv as the other stores) ---------- */

function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** content signature of the in-memory record (used for asset-map caching) */
export function signatureOf(rec: DesktopDeckRecord): string {
  const parts: string[] = [];
  for (const p of Object.keys(rec.files).sort()) parts.push(`${p}:${fnv1a(rec.files[p])}`);
  for (const p of Object.keys(rec.assets).sort()) parts.push(`${p}:${rec.assets[p].size}:${rec.assets[p].modified}`);
  return fnv1a(parts.join("|"));
}

/** disk-walk signature — path:size:mtime over every non-hidden file. This
 *  is what api.poll compares and what saves return, so any change (ours or
 *  an external editor's) moves it, and unchanged state always matches. */
function signatureFromRows(rows: WalkRow[]): string {
  const parts = rows
    .filter((r) => !isHidden(r.path))
    .map((r) => `${r.path}:${r.size}:${r.modified}`)
    .sort();
  return fnv1a(parts.join("|"));
}

async function diskSignature(deckId: string): Promise<string> {
  return signatureFromRows(await walkFiles(deckId));
}

/* ------------------------------------------------------------------ */
/* deck index (fs.listDecks — Java scans + caches)                     */
/* ------------------------------------------------------------------ */

function invalidateDeckIndex(): void {
  deckIndex = null;
  deckIndexAt = 0;
}

async function ensureDeckIndex(force = false): Promise<DesktopDeckInfo[]> {
  const available = await isDesktopFsActive();
  if (!available) return [];
  if (!force && deckIndex && Date.now() - deckIndexAt < 2000) return deckIndex;
  deckIndex = await fsListDecks();
  deckIndexAt = Date.now();
  return deckIndex;
}

export async function hasDeck(deckId: string): Promise<boolean> {
  if (records.has(deckId)) return true;
  if (!(await isDesktopFsActive())) return false;
  const index = await ensureDeckIndex();
  return index.some((d) => d.id === deckId);
}

export async function uniqueDeckId(base: string): Promise<string> {
  const b = slugify(base, "deck");
  const taken = new Set((await ensureDeckIndex()).map((d) => d.id));
  let id = b;
  let n = 2;
  while (taken.has(id)) {
    id = `${b}-${n}`;
    n++;
  }
  return id;
}

/* ------------------------------------------------------------------ */
/* loading records (folder walk — the folder IS the project)            */
/* ------------------------------------------------------------------ */

interface WalkRow {
  path: string;
  size: number;
  modified: number;
}

async function walkFiles(deckId: string, dir = "", acc: WalkRow[] = [], depth = 0): Promise<WalkRow[]> {
  if (depth > 8) return acc; // deck folders are shallow; never spiral
  let rows;
  try {
    rows = await fsListFiles(deckId, dir);
  } catch (e) {
    // the deck ROOT missing is a real error; a missing SUBDIR (notes/,
    // assets/ on a fresh deck) simply has nothing to walk
    if (dir === "" || !(e instanceof DesktopFsError) || e.code !== "NOT_FOUND") throw e;
    return acc;
  }
  for (const r of rows) {
    const path = dir ? `${dir}/${r.name}` : r.name;
    if (r.directory) {
      await walkFiles(deckId, path, acc, depth + 1);
    } else {
      acc.push({ path, size: r.size, modified: r.modified });
    }
  }
  return acc;
}

function parseDeck(rec: DesktopDeckRecord): DeckJson {
  const deck = JSON.parse(rec.files["deck.json"]) as DeckJson;
  if (deck.format !== "smdeck") throw new Error("Not a Stagesmith deck");
  return deck;
}

function writeDeckJson(rec: DesktopDeckRecord, deck: DeckJson): void {
  deck.modified = new Date().toISOString();
  rec.title = deck.title;
  rec.modified = deck.modified;
  rec.files["deck.json"] = JSON.stringify(deck, null, 2) + "\n";
}

export async function getRecord(deckId: string): Promise<DesktopDeckRecord | null> {
  const cached = records.get(deckId);
  if (cached) return cached;
  if (!(await hasDeck(deckId))) return null;
  loadPhase("deck-file-index", "start", { deckId });
  const rows = (await walkFiles(deckId)).filter((r) => !isHidden(r.path));
  loadPhase("deck-file-index", "end", { deckId, files: rows.length });
  const files: Record<string, string> = {};
  const assets: Record<string, { size: number; modified: number }> = {};
  const textRows = rows.filter((r) => !BINARY_EXT.test(r.path) && r.size <= 1_500_000);
  for (const r of rows) {
    if (BINARY_EXT.test(r.path) || r.size > 1_500_000) assets[r.path] = { size: r.size, modified: r.modified };
  }
  // The first editor paint only needs the manifest, theme and selected slide.
  // Read these ahead of the rest so a large deck cannot hold slide 1 hostage.
  let deckJsonRaw: string | null = null;
  const firstDeckRead = textRows.find((r) => r.path === "deck.json");
  if (firstDeckRead) {
    loadPhase("deck-manifest-read", "start", { path: firstDeckRead.path });
    deckJsonRaw = await fsReadText(deckId, "deck.json");
    files["deck.json"] = deckJsonRaw;
    loadPhase("deck-manifest-read", "end", { bytes: deckJsonRaw.length });
  }
  const deck = deckJsonRaw ? (JSON.parse(deckJsonRaw) as DeckJson) : null;
  // the full walk tree — file lists must reflect every file on disk even
  // while their contents are still hydrating in the background
  const tree: Record<string, TreeRow> = {};
  for (const r of rows) tree[r.path] = { size: r.size, modified: r.modified };
  const initialPaths = new Set(["theme.css"]);
  if (deck?.slides?.[0]?.id) initialPaths.add(`slides/${deck.slides[0].id}.tsx`);
  loadPhase("first-slide-and-theme-read", "start", { paths: [...initialPaths] });
  await Promise.all([...initialPaths].map(async (path) => {
    if (!textRows.some((r) => r.path === path)) return;
    try {
      files[path] = await fsReadText(deckId, path);
    } catch {
      // A missing first slide is left absent and will surface as a compile error.
    }
  }));
  loadPhase("first-slide-and-theme-read", "end", { files: [...initialPaths].filter((path) => files[path] !== undefined) });
  if (deckJsonRaw === null) throw new Error("Deck not found (no readable deck.json)");
  const rec: DesktopDeckRecord = {
    id: deckId,
    title: deckId,
    files,
    assets,
    modified: new Date().toISOString(),
    tree,
    sig: signatureFromRows(rows),
  };
  try {
    const deck = parseDeck(rec);
    rec.title = deck.title;
    rec.modified = deck.modified;
  } catch {
    /* tolerate a slightly off deck.json — reads surface the real error */
  }
  records.set(deckId, rec);
  // Return the first slide now. Hydrate the remaining text cache in a small
  // pool; individual read failures stay retryable through api.readFile().
  const remaining = textRows.filter((r) => files[r.path] === undefined && r.path !== "deck.json");
  void (async () => {
    loadPhase("background-text-hydration", "start", { files: remaining.length, concurrency: Math.min(4, remaining.length) });
    let next = 0;
    const readWorker = async () => {
      while (next < remaining.length) {
        const r = remaining[next++];
        try {
          rec.files[r.path] = await fsReadText(deckId, r.path);
        } catch {
          // Keep unreadable files absent; the editor can report/retry on demand.
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, remaining.length) }, () => readWorker()));
    loadPhase("background-text-hydration", "end", { files: remaining.length });
  })();
  return rec;
}

/* ------------------------------------------------------------------ */
/* persist (diff writes — only the file that changed)                  */
/* ------------------------------------------------------------------ */

/**
 * Writes the DIFF between the record's current files and the given baseline:
 * changed/new files via fs.writeText (atomic on the Java side), removed
 * files via fs.delete. Never rewrites the whole deck.
 */
async function persistDiff(deckId: string, rec: DesktopDeckRecord, baseline: Record<string, string>): Promise<void> {
  for (const p of Object.keys(rec.files)) {
    if (baseline[p] !== rec.files[p]) {
      await fsWriteText(deckId, p, rec.files[p]);
    }
  }
  for (const p of Object.keys(baseline)) {
    if (rec.files[p] === undefined) {
      await fsDelete(deckId, p).catch(() => {
        /* already gone — fine */
      });
    }
  }
  invalidateDeckIndex();
}

/* ------------------------------------------------------------------ */
/* theme.css url() rewrite → same-origin virtual asset URLs             */
/* ------------------------------------------------------------------ */

async function assetFileUrl(deckId: string, path: string): Promise<string> {
  const key = `${deckId}::${path}`;
  const hit = urlCache.get(key);
  if (hit) return hit;
  const url = await fsAssetUrl(deckId, path);
  urlCache.set(key, url);
  return url;
}

/** rewrite relative theme CSS asset refs through the same desktop resolver. */
export async function rewriteThemeCssDesktop(css: string, deckId: string): Promise<string> {
  const re = /url\(\s*['"]?(\.\/|\.\.\/)([^'")]+)['"]?\s*\)/g;
  const matches = [...css.matchAll(re)];
  if (!matches.length) return css;
  const repls = await Promise.all(
    matches.map(async (m) => {
      const rest = String(m[2]).replace(/^assets\//, "");
      const key = rest.startsWith("assets/") ? rest : `assets/${rest}`;
      try {
        return { m: m[0], url: await assetFileUrl(deckId, key) } as const;
      } catch {
        return null;
      }
    }),
  );
  let out = css;
  for (const r of repls) if (r) out = out.replace(r.m, `url('${r.url}')`);
  return out;
}

/* ------------------------------------------------------------------ */
/* summaries + bundles                                                 */
/* ------------------------------------------------------------------ */

function fileRowsOf(rec: DesktopDeckRecord): FileRow[] {
  // hydrated files + walk-tree rows + assets — see file-tree.ts. Without the
  // tree merge, a freshly walked record lists only the eagerly-read boot
  // files (deck.json, theme.css, first slide) and the BG/Overlay dropdown
  // renders empty while the editor shows the open file's code.
  return mergeFileRows(rec.files, rec.tree, rec.assets, rec.modified);
}

/** walk-tree rows for exactly the files a record knows about (files + assets) */
function treeOfRecord(rec: Pick<DesktopDeckRecord, "files" | "assets">): Record<string, TreeRow> {
  const mt = Date.now();
  const tree: Record<string, TreeRow> = {};
  for (const p of Object.keys(rec.files)) tree[p] = { size: rec.files[p].length, modified: mt };
  for (const p of Object.keys(rec.assets)) tree[p] = { size: rec.assets[p].size, modified: rec.assets[p].modified };
  return tree;
}

function coverOf(deck: DeckJson, themeCss: string): DeckCover {
  const coverSlide = deck.slides[0] ?? null;
  return {
    slideId: coverSlide?.id ?? null,
    mode: coverSlide?.theme ?? deck.settings.defaultMode,
    bg: coverSlide?.bg !== undefined ? coverSlide.bg : deck.bg,
    overlay: coverSlide?.overlay !== undefined ? coverSlide.overlay : deck.overlay,
    themeCss,
  };
}

export async function listDecks(): Promise<DeckSummary[]> {
  if (!(await isDesktopFsActive())) return [];
  const index = await ensureDeckIndex(true);
  const out: DeckSummary[] = [];
  for (const info of index) {
    if (!validDeckId(info.id)) continue;
    const cached = summaryCache.get(info.id);
    if (cached && cached.modified === info.modified) {
      out.push(cached);
      continue;
    }
    try {
      const [deckRaw, themeCssRaw] = await Promise.all([
        fsReadText(info.id, "deck.json"),
        fsReadText(info.id, "theme.css").catch(() => ""),
      ]);
      const deck = JSON.parse(deckRaw) as DeckJson;
      const themeCss = await rewriteThemeCssDesktop(themeCssRaw, info.id);
      const summary: DeckSummary = {
        id: info.id,
        title: deck.title || info.title,
        slideCount: deck.slides?.length ?? info.slides,
        modified: deck.modified || info.modified,
        signature: fnv1a(`${info.id}|${deck.modified}|${deck.slides?.length ?? 0}`),
        store: "desktop",
        folderName: info.folder,
        cover: coverOf(deck, themeCss),
      };
      summaryCache.set(info.id, summary);
      out.push(summary);
    } catch {
      // unreadable deck.json — list it minimally from the Java-side scan
      out.push({
        id: info.id,
        title: info.title,
        slideCount: info.slides,
        modified: info.modified,
        signature: fnv1a(`${info.id}|${info.modified}`),
        store: "desktop",
        folderName: info.folder,
      });
    }
  }
  // drop cached summaries of decks that vanished
  const ids = new Set(index.map((d) => d.id));
  for (const id of [...summaryCache.keys()]) if (!ids.has(id)) summaryCache.delete(id);
  out.sort((a, b) => (a.modified < b.modified ? 1 : -1));
  return out;
}

export async function getBundle(deckId: string): Promise<DeckBundle | null> {
  const rec = await getRecord(deckId);
  if (!rec) return null;
  const deck = parseDeck(rec);
  return {
    deck,
    files: fileRowsOf(rec),
    signature: rec.sig,
    themeCss: await rewriteThemeCssDesktop(rec.files["theme.css"] ?? "", deckId),
    store: "desktop",
  };
}

/* ------------------------------------------------------------------ */
/* create / delete / duplicate                                         */
/* ------------------------------------------------------------------ */

export async function createDeck(
  title: string,
  files: Record<string, string>,
  opts: { id?: string } = {},
): Promise<{ deck: DeckJson; deckId: string }> {
  if (!(await isDesktopFsActive())) throw new Error("Desktop decks folder is not available");
  const deckId = opts.id && validDeckId(opts.id) ? opts.id : await uniqueDeckId(title);
  const deck = JSON.parse(files["deck.json"]) as DeckJson;
  deck.id = deckId;
  deck.title = title || deck.title;
  deck.created = new Date().toISOString();
  files = { ...files, "deck.json": JSON.stringify(deck, null, 2) + "\n" };
  await fsCreateDeck(deckId, files);
  invalidateDeckIndex();
  records.set(deckId, {
    id: deckId,
    title: deck.title,
    files,
    assets: {},
    modified: deck.modified ?? new Date().toISOString(),
    tree: Object.fromEntries(Object.entries(files).map(([p, c]) => [p, { size: c.length, modified: Date.now() }])),
    sig: "",
  });
  const stored = records.get(deckId)!;
  stored.sig = await diskSignature(deckId).catch(() => signatureOf(stored));
  summaryCache.delete(deckId);
  return { deck, deckId };
}

export async function createStarterDeck(title: string): Promise<{ deck: DeckJson; deckId: string }> {
  return createDeck(title, starterDeckFiles(title));
}

export async function deleteDeck(deckId: string): Promise<void> {
  await fsDeleteDeck(deckId);
  records.delete(deckId);
  summaryCache.delete(deckId);
  displayNames.delete(deckId);
  invalidateDeckIndex();
}

/** Removes the deck from the library WITHOUT touching its files — the folder
 *  stays on disk (tombstoned on the Java side so the next scan doesn't
 *  re-adopt it). This is what "Delete" in the UI means now. */
export async function removeFromLibrary(deckId: string): Promise<{ path: string }> {
  let r: { ok: boolean; filesKept: boolean; path: string };
  try {
    r = await fsRemoveDeck(deckId);
  } catch (e) {
    // desktop builds before 1.5.0 only know fs.deleteDeck (which deletes the
    // FILES) — never fall back to that; ask for the update instead
    if (e instanceof DesktopFsError && e.code === "UNKNOWN_CMD") {
      throw new Error(
        "This desktop app version can only delete deck files. Update the Chassé Studio desktop app (1.5 or newer) to remove decks from the library while keeping their files.",
      );
    }
    throw e;
  }
  records.delete(deckId);
  summaryCache.delete(deckId);
  displayNames.delete(deckId);
  for (const key of [...urlCache.keys()]) {
    if (key.startsWith(`${deckId}::`)) urlCache.delete(key);
  }
  invalidateDeckIndex();
  return { path: r?.path ?? "" };
}

export async function duplicateDeck(sourceId: string, title: string): Promise<{ deck: DeckJson; deckId: string }> {
  const src = await getRecord(sourceId);
  if (!src) throw new Error("Source deck not found");
  const deckId = await uniqueDeckId(title);
  // Java copies the folder (assets included) and patches deck.json — one op
  await fsDuplicateDeck(sourceId, deckId, title);
  invalidateDeckIndex();
  records.delete(deckId);
  summaryCache.delete(deckId);
  const rec = await getRecord(deckId).catch(() => null);
  const deck = rec ? parseDeck(rec) : { ...(await parseDeck(src)), id: deckId, title };
  return { deck, deckId };
}

/* ------------------------------------------------------------------ */
/* files                                                               */
/* ------------------------------------------------------------------ */

function validRelPath(p: string): boolean {
  if (!p || p.length > 200) return false;
  if (p.includes("\\") || p.includes("\0") || p.startsWith("/")) return false;
  const parts = p.split("/");
  return !parts.some((s) => s === "" || s === "." || s === "..");
}

export async function readFile(deckId: string, rel: string): Promise<string> {
  const rec = await getRecord(deckId);
  if (!rec) throw new Error("Deck not found");
  const cached = rec.files[rel];
  if (cached !== undefined) return cached; // portable form (url(./assets/…) stays as-is)
  const key = `${deckId}:${rel}`;
  let pending = pendingTextReads.get(key);
  if (!pending) {
    pending = fsReadText(deckId, rel).then((content) => {
      rec.files[rel] = content;
      return content;
    }).finally(() => pendingTextReads.delete(key));
    pendingTextReads.set(key, pending);
  }
  return pending;
}

export async function saveFile(deckId: string, rel: string, content: string): Promise<string> {
  return saveFiles(deckId, [{ path: rel, content }]);
}

export async function saveFiles(deckId: string, entries: Array<{ path: string; content: string; allowEmptyOverwrite?: boolean }>): Promise<string> {
  const rec = await getRecord(deckId);
  if (!rec) throw new Error("Deck not found");
  if (!entries.length) return rec.sig;
  const baseline = { ...rec.files };
  for (const e of entries) {
    if (!validRelPath(e.path)) throw new Error(`Illegal path: ${e.path}`);
    if (e.content === "" && !e.allowEmptyOverwrite) {
      const previous = rec.files[e.path] ?? await fsReadText(deckId, e.path).catch(() => "");
      if (previous.length) throw new Error(`Refusing to replace non-empty ${e.path} with empty content without confirmation`);
    }
    rec.files[e.path] = e.content;
  }
  rec.modified = new Date().toISOString();
  await persistDiff(deckId, rec, baseline);
  // the same disk-walk basis api.poll uses — saves and polls must agree
  rec.sig = await diskSignature(deckId).catch(() => signatureOf(rec));
  return rec.sig;
}

export async function deleteFile(deckId: string, rel: string): Promise<void> {
  const rec = await getRecord(deckId);
  if (!rec) throw new Error("Deck not found");
  if (!(rel.startsWith("assets/") || rel.startsWith("notes/"))) {
    throw new Error("Only assets/ and notes/ files can be deleted here");
  }
  delete rec.files[rel];
  delete rec.assets[rel];
  delete rec.tree[rel];
  rec.modified = new Date().toISOString();
  await fsDelete(deckId, rel);
  invalidateDeckIndex();
}

/* ------------------------------------------------------------------ */
/* slides                                                              */
/* ------------------------------------------------------------------ */

async function mutateDeck(
  deckId: string,
  fn: (rec: DesktopDeckRecord, deck: DeckJson) => void,
): Promise<DeckJson> {
  const rec = await getRecord(deckId);
  if (!rec) throw new Error("Deck not found");
  const deck = parseDeck(rec);
  const baseline = { ...rec.files };
  fn(rec, deck);
  writeDeckJson(rec, deck);
  await persistDiff(deckId, rec, baseline);
  summaryCache.delete(deckId);
  return deck;
}

function uniqueSlideId(deck: DeckJson, base: string): string {
  const taken = new Set(deck.slides.map((s) => s.id));
  let id = base;
  let n = 2;
  while (taken.has(id)) {
    id = `${base}-${n}`;
    n++;
  }
  return id;
}

export async function addSlide(
  deckId: string,
  opts: { template?: string; label?: string; position?: number; code?: string },
): Promise<DeckJson> {
  const label = opts.label || (opts.code ? "Imported slide" : "Slide");
  const code =
    typeof opts.code === "string" && opts.code.trim()
      ? opts.code
      : (() => {
          const t = templateByKey(opts.template || "section");
          if (!t) throw new Error("Unknown template");
          return t.code;
        })();
  return mutateDeck(deckId, (rec, deck) => {
    const id = uniqueSlideId(deck, slugify(label, "slide"));
    const entry: SlideEntry = { id, label };
    rec.files[`slides/${id}.tsx`] = code;
    const idx = opts.position === undefined ? deck.slides.length : Math.max(0, Math.min(opts.position, deck.slides.length));
    deck.slides.splice(idx, 0, entry);
  });
}

export async function deleteSlide(deckId: string, slideId: string): Promise<DeckJson> {
  await snapshotDeck(deckId, `before-delete-${slideId}`);
  return mutateDeck(deckId, (rec, deck) => {
    const idx = deck.slides.findIndex((s) => s.id === slideId);
    if (idx < 0) throw new Error("Slide not found");
    const entry = deck.slides[idx];
    deck.slides.splice(idx, 1);
    for (const f of [`slides/${slideId}.tsx`, `notes/${slideId}.md`]) {
      delete rec.files[f];
      delete rec.tree[f];
    }
    for (const src of [entry.bg, entry.overlay]) {
      if (src && (src.type === "code" || src.type === "html" || src.type === "image")) {
        const p = src.path;
        const usedElsewhere = deck.slides.some(
          (s) => (s.bg && "path" in s.bg && s.bg.path === p) || (s.overlay && "path" in s.overlay && s.overlay.path === p),
        );
        if (!usedElsewhere && (p.startsWith("bg/") || p.startsWith("overlay/"))) {
          delete rec.files[p];
          delete rec.assets[p];
          delete rec.tree[p];
        }
      }
    }
  });
}

export async function duplicateSlide(deckId: string, slideId: string): Promise<DeckJson> {
  // A desktop record may still be hydrating background slide sources. Fetch
  // the source (and code overrides) before mutating so a quick duplicate can
  // never write an empty TSX file or omit a copied layer.
  const before = await getRecord(deckId);
  if (!before) throw new Error("Deck not found");
  const source = parseDeck(before).slides.find((s) => s.id === slideId);
  if (!source) throw new Error("Slide not found");
  await readFile(deckId, `slides/${slideId}.tsx`);
  for (const layer of [source.bg, source.overlay]) {
    if (layer?.type === "code") await readFile(deckId, layer.path);
  }
  return mutateDeck(deckId, (rec, deck) => {
    const idx = deck.slides.findIndex((s) => s.id === slideId);
    if (idx < 0) throw new Error("Slide not found");
    const src = deck.slides[idx];
    const newId = uniqueSlideId(deck, `${src.id}-copy`);
    rec.files[`slides/${newId}.tsx`] = rec.files[`slides/${src.id}.tsx`] ?? "";
    if (rec.files[`notes/${src.id}.md`] !== undefined) {
      rec.files[`notes/${newId}.md`] = rec.files[`notes/${src.id}.md`];
    }
    const copy: SlideEntry = { ...src, id: newId, label: `${src.label} (copy)` };
    for (const key of ["bg", "overlay"] as const) {
      const o = copy[key] as Source | undefined;
      if (o && o.type === "code") {
        const dot = o.path.lastIndexOf(".");
        const newPath = `${o.path.slice(0, o.path.lastIndexOf("/", dot))}/${newId}${o.path.slice(dot)}`;
        if (rec.files[o.path] !== undefined) {
          rec.files[newPath] = rec.files[o.path];
          (copy[key] as Source) = { type: "code", path: newPath };
        }
      }
    }
    deck.slides.splice(idx + 1, 0, copy);
  });
}

export async function reorderSlides(deckId: string, order: string[]): Promise<DeckJson> {
  return mutateDeck(deckId, (_rec, deck) => {
    const have = new Set(deck.slides.map((s) => s.id));
    if (order.length !== deck.slides.length || order.some((id) => !have.has(id))) {
      throw new Error("Order must be a permutation of current slide ids");
    }
    const map = new Map(deck.slides.map((s) => [s.id, s]));
    deck.slides = order.map((id) => map.get(id)!);
  });
}

export async function patchSlide(
  deckId: string,
  slideId: string,
  patch: { label?: string; theme?: ThemeMode | null; bg?: Source | null; overlay?: Source | null },
): Promise<DeckJson> {
  return mutateDeck(deckId, (_rec, deck) => {
    const idx = deck.slides.findIndex((s) => s.id === slideId);
    if (idx < 0) throw new Error("Slide not found");
    const next = { ...deck.slides[idx], ...patch } as Record<string, unknown>;
    for (const key of ["bg", "overlay", "theme"]) {
      if (next[key] === null) delete next[key];
    }
    deck.slides[idx] = next as unknown as SlideEntry;
  });
}

export async function patchDeck(
  deckId: string,
  patch: { title?: string; bg?: Source; overlay?: Source; settings?: Partial<DeckJson["settings"]> },
): Promise<DeckJson> {
  return mutateDeck(deckId, (_rec, deck) => {
    if (patch.title !== undefined) deck.title = patch.title;
    if (patch.settings) deck.settings = { ...deck.settings, ...patch.settings };
    if (patch.bg !== undefined) deck.bg = patch.bg;
    if (patch.overlay !== undefined) deck.overlay = patch.overlay;
  });
}

/* ------------------------------------------------------------------ */
/* snapshots (last 10, stored IN the deck folder)                      */
/* ------------------------------------------------------------------ */

const SNAP_DIR = ".stagesmith/snapshots";

export async function snapshotDeck(deckId: string, tag: string): Promise<string> {
  const rec = await getRecord(deckId);
  if (!rec) throw new Error("Deck not found");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const name = `${stamp}--${tag.replace(/[^a-z0-9-]/gi, "-").slice(0, 40)}.json`;
  // text files only — assets stay untouched on disk (they rarely change)
  const payload = JSON.stringify({ deckId, files: { ...rec.files } });
  await fsWriteText(deckId, `${SNAP_DIR}/${name}`, payload);
  const all = await listSnapshots(deckId);
  for (const old of all.slice(10)) {
    await fsDelete(deckId, `${SNAP_DIR}/${old}`).catch(() => {});
  }
  return name.replace(/\.json$/, "");
}

export async function listSnapshots(deckId: string): Promise<string[]> {
  if (!(await hasDeck(deckId))) return [];
  try {
    const rows = await fsListFiles(deckId, SNAP_DIR);
    return rows
      .map((r) => r.name)
      .filter((n) => n.endsWith(".json"))
      .map((n) => n.replace(/\.json$/, ""))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

export async function restoreSnapshot(deckId: string, name: string): Promise<void> {
  if (!/^[0-9TZ-]+--[a-z0-9-]+$/i.test(name)) throw new Error("Bad snapshot name");
  const raw = await fsReadText(deckId, `${SNAP_DIR}/${name}.json`);
  const data = JSON.parse(raw) as { files?: Record<string, string> };
  const rec = await getRecord(deckId);
  if (!rec) throw new Error("Deck not found");
  const baseline = { ...rec.files };
  rec.files = { ...(data.files ?? {}) };
  rec.modified = new Date().toISOString();
  await persistDiff(deckId, rec, baseline);
  // the tree must match what is on disk now (persistDiff removed the
  // baseline-only files) — otherwise deleted files resurrect in file lists
  rec.tree = treeOfRecord(rec);
}

/* ------------------------------------------------------------------ */
/* assets + code files                                                 */
/* ------------------------------------------------------------------ */

export async function listAssets(deckId: string): Promise<FileRow[]> {
  const rec = await getRecord(deckId);
  if (!rec) return [];
  return Object.keys(rec.assets)
    .filter((p) => !p.split("/").some((seg) => seg.startsWith(".")))
    .sort()
    .map((p) => ({
      path: p,
      mtime: rec.assets[p].modified,
      size: rec.assets[p].size,
      display: fileDisplayName(deckId, p),
    }));
}

export async function uploadAssets(
  deckId: string,
  files: File[],
): Promise<Array<{ path: string; display: string }>> {
  const rec = await getRecord(deckId);
  if (!rec) throw new Error("Deck not found");
  const uploaded: Array<{ path: string; display: string }> = [];
  for (const f of files) {
    let name = sanitizeAssetName(f.name) || "asset";
    let p = `assets/${name}`;
    let n = 2;
    while (rec.assets[p] !== undefined || rec.files[p] !== undefined) {
      const dot = name.lastIndexOf(".");
      p = dot > 0 ? `assets/${name.slice(0, dot)}-${n}${name.slice(dot)}` : `assets/${name}-${n}`;
      n++;
    }
    await fsUploadFile(deckId, p, f, f.type || undefined);
    rec.assets[p] = { size: f.size, modified: Date.now() };
    setFileDisplayName(deckId, p, f.name);
    uploaded.push({ path: p, display: f.name });
  }
  rec.modified = new Date().toISOString();
  invalidateDeckIndex();
  return uploaded;
}

export async function listCodeFiles(deckId: string, dir: "overlay" | "bg"): Promise<FileRow[]> {
  const rec = await getRecord(deckId);
  if (!rec) return [];
  // merged rows (hydrated + walk tree): a freshly opened deck whose text
  // contents are still hydrating must still list every file of the layer
  return fileRowsOf(rec)
    .filter((f) => f.path.startsWith(`${dir}/`) && /\.(tsx|ts|jsx|js)$/.test(f.path))
    .sort((a, b) => (a.path < b.path ? -1 : 1));
}

export async function uploadCodeFile(
  deckId: string,
  dir: "overlay" | "bg",
  files: File[],
): Promise<Array<{ path: string }>> {
  const rec = await getRecord(deckId);
  if (!rec) throw new Error("Deck not found");
  const uploaded: Array<{ path: string }> = [];
  const baseline = { ...rec.files };
  for (const f of files) {
    const text = await f.text();
    let name = f.name.replace(/[/\\]/g, "-").replace(/\.(tsx|ts|jsx|js)$/i, "");
    const ext = (f.name.match(/\.(tsx|ts|jsx|js)$/i)?.[1] ?? "tsx").toLowerCase();
    let p = `${dir}/${name}.${ext}`;
    let n = 2;
    while (rec.files[p] !== undefined) {
      p = `${dir}/${name}-${n}.${ext}`;
      n++;
    }
    rec.files[p] = text;
    uploaded.push({ path: p });
  }
  rec.modified = new Date().toISOString();
  await persistDiff(deckId, rec, baseline);
  return uploaded;
}

export async function deleteCodeFile(deckId: string, path: string): Promise<void> {
  const rec = await getRecord(deckId);
  if (!rec) throw new Error("Deck not found");
  if (!path.startsWith("bg/") && !path.startsWith("overlay/")) throw new Error("Only bg/ and overlay/ files");
  delete rec.files[path];
  delete rec.tree[path];
  rec.modified = new Date().toISOString();
  await fsDelete(deckId, path);
  invalidateDeckIndex();
}

/* ------------------------------------------------------------------ */
/* desktop asset URLs                                                   */
/* ------------------------------------------------------------------ */

const assetMapCache = new Map<string, { sig: string; map: Record<string, string> }>();
const assetMapInflight = new Map<string, Promise<Record<string, string> | null>>();

/** deck assets as path → resolved URL for the runtime config. Cached per signature. */
export async function getAssetMap(deckId: string, version: string | number): Promise<Record<string, string> | null> {
  const hit = assetMapInflight.get(deckId);
  if (hit) return hit;
  const p = (async () => {
    const rec = await getRecord(deckId);
    if (!rec) return null;
    const sig = signatureOf(rec);
    const cached = assetMapCache.get(deckId);
    if (cached && cached.sig === sig) return cached.map;
    const keys = Object.keys(rec.assets);
    const map: Record<string, string> = {};
    for (const k of keys) {
      try {
        map[k] = await assetFileUrl(deckId, k);
      } catch {
        /* skip unreachable asset */
      }
    }
    assetMapCache.set(deckId, { sig, map });
    return map;
  })();
  assetMapInflight.set(deckId, p);
  try {
    return await p;
  } finally {
    assetMapInflight.delete(deckId);
  }
}

/** preview URL for the editor — virtual path or compatibility blob URL. */
export async function getAssetUrl(deckId: string, path: string): Promise<string | null> {
  if (!(await hasDeck(deckId))) return null;
  return assetFileUrl(deckId, path);
}

/** Runtime base for `asset()` fallback paths within this desktop deck. */
export async function getAssetBaseUrl(deckId: string): Promise<string> {
  if (!(await hasDeck(deckId))) throw new Error(`Deck not found: ${deckId}`);
  if (!(await desktopAssetUrlsCapability())) return "";
  return compatibilityAssetBaseUrl(deckId);
}

/** upload arbitrary bytes at an explicit deck path (used by import/duplicate) */
export async function putAssetBytes(deckId: string, path: string, data: Blob): Promise<void> {
  await fsUploadFile(deckId, path, data);
  const rec = records.get(deckId);
  if (rec) rec.assets[path] = { size: data.size, modified: Date.now() };
  invalidateDeckIndex();
}

/** every asset path of a deck (for cross-store duplication) */
export async function listAssetPaths(deckId: string): Promise<string[]> {
  const rec = await getRecord(deckId);
  return rec ? Object.keys(rec.assets) : [];
}

/* ------------------------------------------------------------------ */
/* polling (external-change detection)                                 */
/* ------------------------------------------------------------------ */

/** fresh signature from the DISK (walk) — catches edits made outside this
 *  app (another window, a text editor, …). Same basis as saveFiles returns.
 *  Deliberately NOT cached: the editor's poll runs a 400 ms stability
 *  double-check that compares two consecutive signatures — a cached answer
 *  would make mid-write states look stable. */
export async function poll(deckId: string): Promise<string> {
  if (!(await hasDeck(deckId))) return "";
  try {
    return await diskSignature(deckId);
  } catch {
    return "";
  }
}

/** drop all caches for a deck (used after external-change confirmations) */
export function dropCaches(deckId: string): void {
  records.delete(deckId);
  summaryCache.delete(deckId);
  displayNames.delete(deckId);
  for (const key of [...urlCache.keys()]) {
    if (key.startsWith(`${deckId}::`)) urlCache.delete(key);
  }
  invalidateDeckIndex();
}
