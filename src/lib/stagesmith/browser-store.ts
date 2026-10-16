"use client";

/**
 * Browser deck store — decks kept in THIS browser's IndexedDB.
 *
 * The folder is still the project (deck.json + theme.css + slides/ + …), just
 * materialised as a file map instead of a disk folder. This is the storage
 * used when the server's file system is read-only (hosted/serverless
 * deployments) and for projects the user keeps on their own device via the
 * File System Access API (write-through mirror, see device.ts).
 *
 * No database, no backend storage — the deck never leaves the user's browser
 * except through .smdeck export / the device folder they picked.
 */

import type {
  DeckBundle,
  DeckCover,
  DeckJson,
  DeckSummary,
  FileRow,
  SlideEntry,
  Source,
  ThemeMode,
} from "./types";
import { starterDeckFiles, templateByKey } from "./templates";

/* ------------------------------------------------------------------ */
/* tiny IndexedDB wrapper (no deps)                                    */
/* ------------------------------------------------------------------ */

const DB_NAME = "chasse-studio";
const DB_VERSION = 1;
const STORE_DECKS = "decks"; // deckId → BrowserDeckRecord
const STORE_SNAPSHOTS = "snapshots"; // `${deckId}::${name}` → { files, assets }
const STORE_HANDLES = "handles"; // deckId → FileSystemDirectoryHandle

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_DECKS)) db.createObjectStore(STORE_DECKS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(STORE_SNAPSHOTS)) db.createObjectStore(STORE_SNAPSHOTS);
      if (!db.objectStoreNames.contains(STORE_HANDLES)) db.createObjectStore(STORE_HANDLES);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
  return dbPromise;
}

async function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> {
  const db = await openDb();
  return new Promise<T | undefined>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let request: IDBRequest<T> | void;
    try {
      request = fn(s);
    } catch (e) {
      reject(e);
      return;
    }
    t.oncomplete = () => resolve(request instanceof IDBRequest ? (request.result as T) : undefined);
    t.onerror = () => reject(t.error ?? new Error("IndexedDB transaction failed"));
    t.onabort = () => reject(t.error ?? new Error("IndexedDB transaction aborted"));
  });
}

function idbGet<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
  return tx<T>(store, "readonly", (s) => s.get(key) as IDBRequest<T>);
}
function idbGetAll<T>(store: string): Promise<T[]> {
  return (tx<T[]>(store, "readonly", (s) => s.getAll() as IDBRequest<T[]>) as Promise<T[] | undefined>).then(
    (r) => r ?? [],
  );
}
function idbPut(store: string, value: unknown, key?: IDBValidKey): Promise<unknown> {
  return tx(store, "readwrite", (s) => (key !== undefined ? s.put(value, key) : s.put(value)));
}
function idbDelete(store: string, key: IDBValidKey): Promise<void> {
  return tx(store, "readwrite", (s) => s.delete(key)).then(() => undefined);
}

/* ------------------------------------------------------------------ */
/* record shape + helpers                                              */
/* ------------------------------------------------------------------ */

export interface BrowserDeckRecord {
  id: string;
  title: string;
  created: string;
  modified: string;
  /** every text file of the project (deck.json, theme.css, slides/, …) */
  files: Record<string, string>;
  /** binary assets by path (assets/…) */
  assets: Record<string, Blob>;
  /** a device folder is attached (File System Access API) */
  device?: boolean;
}

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function validDeckId(id: string): boolean {
  return ID_RE.test(id);
}

export function slugify(label: string, fallback = "slide"): string {
  const s = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return s || fallback;
}

function validRelPath(p: string): boolean {
  if (!p || p.length > 200) return false;
  if (p.includes("\\") || p.includes("\0") || p.startsWith("/")) return false;
  const parts = p.split("/");
  return !parts.some((s) => s === "" || s === "." || s === "..");
}

/** fast content signature — changes when any file or asset changes */
function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function signatureOf(rec: BrowserDeckRecord): string {
  const parts: string[] = [];
  for (const p of Object.keys(rec.files).sort()) parts.push(`${p}:${fnv1a(rec.files[p])}`);
  for (const p of Object.keys(rec.assets).sort()) parts.push(`${p}:${rec.assets[p].size}`);
  return fnv1a(parts.join("|"));
}

function parseDeck(rec: BrowserDeckRecord): DeckJson {
  const deck = JSON.parse(rec.files["deck.json"]) as DeckJson;
  if (deck.format !== "smdeck") throw new Error("Not a Stagesmith deck");
  return deck;
}

function writeDeck(rec: BrowserDeckRecord, deck: DeckJson): void {
  deck.modified = new Date().toISOString();
  rec.title = deck.title;
  rec.modified = deck.modified;
  rec.files["deck.json"] = JSON.stringify(deck, null, 2) + "\n";
}

export async function putRecord(rec: BrowserDeckRecord, mirror = true): Promise<BrowserDeckRecord> {
  await idbPut(STORE_DECKS, rec);
  recordCache.set(rec.id, rec);
  if (mirror && deviceMirror) deviceMirror(rec).catch(() => {}); // best-effort write-through
  return rec;
}

/** device write-through hook (set by device.ts — avoids a cyclic import) */
type DeviceMirror = (rec: BrowserDeckRecord) => Promise<void>;
let deviceMirror: DeviceMirror | null = null;
export function setDeviceMirror(fn: DeviceMirror | null): void {
  deviceMirror = fn;
}

/* in-memory record cache (compile + UI hit this a lot) */
const recordCache = new Map<string, BrowserDeckRecord>();

export async function hasDeck(deckId: string): Promise<boolean> {
  if (recordCache.has(deckId)) return true;
  try {
    const rec = await idbGet<BrowserDeckRecord>(STORE_DECKS, deckId);
    if (rec) {
      recordCache.set(deckId, rec);
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

export async function getRecord(deckId: string): Promise<BrowserDeckRecord | null> {
  const cached = recordCache.get(deckId);
  if (cached) return cached;
  try {
    const rec = await idbGet<BrowserDeckRecord>(STORE_DECKS, deckId);
    if (rec) recordCache.set(deckId, rec);
    return rec ?? null;
  } catch {
    return null;
  }
}

export async function uniqueDeckId(base: string, taken?: Set<string>): Promise<string> {
  const b = slugify(base, "deck");
  let id = b;
  let n = 2;
  while ((taken ? taken.has(id) : false) || (await hasDeck(id))) {
    id = `${b}-${n}`;
    n++;
  }
  return id;
}

/* ------------------------------------------------------------------ */
/* summaries + bundles                                                 */
/* ------------------------------------------------------------------ */

/** rewrite url(./assets/…) in theme.css to data URLs (browser decks have no
 *  /api/assets route — the sandboxed runtime can't fetch parent blobs) */
export function rewriteThemeCssLocal(css: string, assets: Record<string, Blob>): Promise<string> {
  const re = /url\(\s*['"]?(\.\/|\.\.\/)([^'")]+)['"]?\s*\)/g;
  const matches = [...css.matchAll(re)];
  if (!matches.length) return Promise.resolve(css);
  return Promise.all(
    matches.map(async (m) => {
      const rest = String(m[2]).replace(/^assets\//, "");
      const key = rest.startsWith("assets/") ? rest : `assets/${rest}`;
      const blob = assets[key] ?? assets[rest];
      if (!blob) return null;
      return { m: m[0], url: await blobToDataUrl(blob) } as const;
    }),
  ).then((repls) => {
    let out = css;
    for (const r of repls) if (r) out = out.replace(r.m, `url('${r.url}')`);
    return out;
  });
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error ?? new Error("read failed"));
    fr.readAsDataURL(blob);
  });
}

function fileRowsOf(rec: BrowserDeckRecord): FileRow[] {
  const mt = Date.parse(rec.modified) || Date.now();
  const rows: FileRow[] = Object.keys(rec.files)
    .sort()
    .map((p) => ({ path: p, mtime: mt, size: rec.files[p].length }));
  for (const p of Object.keys(rec.assets).sort()) {
    rows.push({ path: p, mtime: mt, size: rec.assets[p].size });
  }
  return rows;
}

function coverOf(deck: DeckJson, rec: BrowserDeckRecord, themeCss: string): DeckCover {
  const coverSlide = deck.slides[0] ?? null;
  return {
    slideId: coverSlide?.id ?? null,
    mode: coverSlide?.theme ?? deck.settings.defaultMode,
    bg: coverSlide?.bg !== undefined ? coverSlide.bg : deck.bg,
    overlay: coverSlide?.overlay !== undefined ? coverSlide.overlay : deck.overlay,
    themeCss,
  };
}

async function summaryOf(rec: BrowserDeckRecord): Promise<DeckSummary> {
  let deck: DeckJson | null = null;
  try {
    deck = parseDeck(rec);
  } catch {
    /* corrupted record — still list it minimally */
  }
  const themeCss = await rewriteThemeCssLocal(rec.files["theme.css"] ?? "", rec.assets);
  return {
    id: rec.id,
    title: rec.title,
    slideCount: deck?.slides.length ?? 0,
    modified: rec.modified,
    signature: signatureOf(rec),
    store: "browser",
    device: rec.device,
    cover: deck ? coverOf(deck, rec, themeCss) : undefined,
  };
}

export async function listDecks(): Promise<DeckSummary[]> {
  const recs = await idbGetAll<BrowserDeckRecord>(STORE_DECKS);
  const out: DeckSummary[] = [];
  for (const rec of recs) {
    if (!validDeckId(rec.id)) continue;
    recordCache.set(rec.id, rec);
    out.push(await summaryOf(rec));
  }
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
    signature: signatureOf(rec),
    themeCss: await rewriteThemeCssLocal(rec.files["theme.css"] ?? "", rec.assets),
    store: "browser",
    device: rec.device,
  };
}

/* ------------------------------------------------------------------ */
/* create / delete / duplicate                                         */
/* ------------------------------------------------------------------ */

export async function createDeck(
  title: string,
  files: Record<string, string>,
  opts: { id?: string; assets?: Record<string, Blob>; device?: boolean } = {},
): Promise<{ deck: DeckJson; deckId: string }> {
  const deckId = opts.id && validDeckId(opts.id) && !(await hasDeck(opts.id)) ? opts.id : await uniqueDeckId(title);
  const deck = JSON.parse(files["deck.json"]) as DeckJson;
  deck.id = deckId;
  deck.title = title || deck.title;
  deck.created = new Date().toISOString();
  files = { ...files, "deck.json": JSON.stringify(deck, null, 2) + "\n" };
  const now = new Date().toISOString();
  const rec: BrowserDeckRecord = {
    id: deckId,
    title: deck.title,
    created: now,
    modified: now,
    files,
    assets: opts.assets ?? {},
    device: opts.device,
  };
  await putRecord(rec, true);
  return { deck, deckId };
}

export async function createStarterDeck(title: string): Promise<{ deck: DeckJson; deckId: string }> {
  return createDeck(title, starterDeckFiles(title));
}

export async function deleteDeck(deckId: string): Promise<void> {
  await idbDelete(STORE_DECKS, deckId);
  await idbDelete(STORE_HANDLES, deckId);
  recordCache.delete(deckId);
  // drop snapshots
  try {
    const db = await openDb();
    const t = db.transaction(STORE_SNAPSHOTS, "readwrite");
    const s = t.objectStore(STORE_SNAPSHOTS);
    const keysReq = s.getAllKeys();
    keysReq.onsuccess = () => {
      for (const k of keysReq.result) {
        if (String(k).startsWith(`${deckId}::`)) s.delete(k);
      }
    };
  } catch {
    /* best effort */
  }
}

export async function duplicateDeck(sourceId: string, title: string): Promise<{ deck: DeckJson; deckId: string }> {
  const src = await getRecord(sourceId);
  if (!src) throw new Error("Source deck not found");
  const deckId = await uniqueDeckId(title);
  const deck = parseDeck(src);
  deck.id = deckId;
  deck.title = title;
  const now = new Date().toISOString();
  const rec: BrowserDeckRecord = {
    id: deckId,
    title,
    created: now,
    modified: now,
    files: { ...src.files, "deck.json": JSON.stringify(deck, null, 2) + "\n" },
    assets: { ...src.assets },
  };
  await putRecord(rec);
  return { deck, deckId };
}

/* ------------------------------------------------------------------ */
/* files                                                               */
/* ------------------------------------------------------------------ */

export async function readFile(deckId: string, rel: string): Promise<string> {
  const rec = await getRecord(deckId);
  if (!rec) throw new Error("Deck not found");
  const content = rec.files[rel];
  if (content === undefined) throw new Error(`File not found: ${rel}`);
  // NOTE: theme.css is returned in its PORTABLE form (url(./assets/…)). The
  // data-URL rewrite for the runtime happens in getBundle — the editor keeps
  // seeing the small, editable portable form.
  return content;
}

export async function saveFile(deckId: string, rel: string, content: string): Promise<string> {
  const rec = await getRecord(deckId);
  if (!rec) throw new Error("Deck not found");
  if (!validRelPath(rel)) throw new Error(`Illegal path: ${rel}`);
  rec.files[rel] = content;
  rec.modified = new Date().toISOString();
  await putRecord(rec, true);
  return signatureOf(rec);
}

export async function deleteFile(deckId: string, rel: string): Promise<void> {
  const rec = await getRecord(deckId);
  if (!rec) throw new Error("Deck not found");
  if (!(rel.startsWith("assets/") || rel.startsWith("notes/"))) {
    throw new Error("Only assets/ and notes/ files can be deleted here");
  }
  delete rec.files[rel];
  delete rec.assets[rel];
  rec.modified = new Date().toISOString();
  await putRecord(rec, true);
}

/* ------------------------------------------------------------------ */
/* slides                                                              */
/* ------------------------------------------------------------------ */

async function mutateDeck(deckId: string, fn: (rec: BrowserDeckRecord, deck: DeckJson) => void): Promise<DeckJson> {
  const rec = await getRecord(deckId);
  if (!rec) throw new Error("Deck not found");
  const deck = parseDeck(rec);
  fn(rec, deck);
  writeDeck(rec, deck);
  await putRecord(rec, true);
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
    for (const f of [`slides/${slideId}.tsx`, `notes/${slideId}.md`]) delete rec.files[f];
    // remove override files only this slide used
    for (const src of [entry.bg, entry.overlay]) {
      if (src && (src.type === "code" || src.type === "html" || src.type === "image")) {
        const p = src.path;
        const usedElsewhere = deck.slides.some(
          (s) => (s.bg && "path" in s.bg && s.bg.path === p) || (s.overlay && "path" in s.overlay && s.overlay.path === p),
        );
        if (!usedElsewhere && (p.startsWith("bg/") || p.startsWith("overlay/"))) {
          delete rec.files[p];
          delete rec.assets[p];
        }
      }
    }
  });
}

export async function duplicateSlide(deckId: string, slideId: string): Promise<DeckJson> {
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
    // explicit null = "remove this override" — mirrors the server store
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
/* snapshots (last 10)                                                 */
/* ------------------------------------------------------------------ */

export async function snapshotDeck(deckId: string, tag: string): Promise<string> {
  const rec = await getRecord(deckId);
  if (!rec) throw new Error("Deck not found");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const name = `${stamp}--${tag.replace(/[^a-z0-9-]/gi, "-").slice(0, 40)}`;
  await idbPut(STORE_SNAPSHOTS, { files: { ...rec.files }, assets: { ...rec.assets } }, `${deckId}::${name}`);
  // keep last 10
  const all = await listSnapshots(deckId);
  for (const old of all.slice(10)) await idbDelete(STORE_SNAPSHOTS, `${deckId}::${old}`);
  return name;
}

export async function listSnapshots(deckId: string): Promise<string[]> {
  try {
    const db = await openDb();
    return await new Promise<string[]>((resolve, reject) => {
      const t = db.transaction(STORE_SNAPSHOTS, "readonly");
      const req = t.objectStore(STORE_SNAPSHOTS).getAllKeys();
      req.onsuccess = () =>
        resolve(
          req.result
            .map(String)
            .filter((k) => k.startsWith(`${deckId}::`))
            .map((k) => k.slice(deckId.length + 2))
            .sort()
            .reverse(),
        );
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function restoreSnapshot(deckId: string, name: string): Promise<void> {
  if (!/^[0-9TZ-]+--[a-z0-9-]+$/i.test(name)) throw new Error("Bad snapshot name");
  const snap = await idbGet<{ files: Record<string, string>; assets: Record<string, Blob> }>(
    STORE_SNAPSHOTS,
    `${deckId}::${name}`,
  );
  if (!snap) throw new Error("Snapshot not found");
  const rec = await getRecord(deckId);
  if (!rec) throw new Error("Deck not found");
  rec.files = { ...snap.files };
  rec.assets = { ...snap.assets };
  rec.modified = new Date().toISOString();
  await putRecord(rec, true);
}

/* ------------------------------------------------------------------ */
/* assets + code files                                                 */
/* ------------------------------------------------------------------ */

export async function listAssets(deckId: string): Promise<FileRow[]> {
  const rec = await getRecord(deckId);
  if (!rec) return [];
  const mt = Date.parse(rec.modified) || Date.now();
  return Object.keys(rec.assets)
    // hidden segments (.stagesmith/ legacy thumb caches, .DS_Store…) are
    // internal junk, not deck content — never show them in the Assets panel
    .filter((p) => !p.split("/").some((seg) => seg.startsWith(".")))
    .sort()
    .map((p) => ({ path: p, mtime: mt, size: rec.assets[p].size }));
}

export async function uploadAssets(deckId: string, files: File[]): Promise<Array<{ path: string }>> {
  const rec = await getRecord(deckId);
  if (!rec) throw new Error("Deck not found");
  const uploaded: Array<{ path: string }> = [];
  for (const f of files) {
    let name = f.name.replace(/[/\\]/g, "-");
    let p = `assets/${name}`;
    let n = 2;
    while (rec.assets[p] !== undefined || rec.files[p] !== undefined) {
      const dot = name.lastIndexOf(".");
      p = dot > 0 ? `assets/${name.slice(0, dot)}-${n}${name.slice(dot)}` : `assets/${name}-${n}`;
      n++;
    }
    rec.assets[p] = f;
    uploaded.push({ path: p });
  }
  rec.modified = new Date().toISOString();
  await putRecord(rec, true);
  return uploaded;
}

export async function listCodeFiles(deckId: string, dir: "overlay" | "bg"): Promise<FileRow[]> {
  const rec = await getRecord(deckId);
  if (!rec) return [];
  const mt = Date.parse(rec.modified) || Date.now();
  return Object.keys(rec.files)
    .filter((p) => p.startsWith(`${dir}/`) && /\.(tsx|ts|jsx|js)$/.test(p))
    .sort()
    .map((p) => ({ path: p, mtime: mt, size: rec.files[p].length }));
}

export async function uploadCodeFile(deckId: string, dir: "overlay" | "bg", files: File[]): Promise<Array<{ path: string }>> {
  const rec = await getRecord(deckId);
  if (!rec) throw new Error("Deck not found");
  const uploaded: Array<{ path: string }> = [];
  for (const f of files) {
    const text = await f.text();
    let name = f.name.replace(/[/\\]/g, "-").replace(/\.(tsx|ts|jsx|js)$/i, "");
    let ext = (f.name.match(/\.(tsx|ts|jsx|js)$/i)?.[1] ?? "tsx").toLowerCase();
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
  await putRecord(rec, true);
  return uploaded;
}

export async function deleteCodeFile(deckId: string, path: string): Promise<void> {
  const rec = await getRecord(deckId);
  if (!rec) throw new Error("Deck not found");
  if (!path.startsWith("bg/") && !path.startsWith("overlay/")) throw new Error("Only bg/ and overlay/ files");
  delete rec.files[path];
  rec.modified = new Date().toISOString();
  await putRecord(rec, true);
}

/* ------------------------------------------------------------------ */
/* runtime asset map (data URLs for the sandboxed stage)               */
/* ------------------------------------------------------------------ */

const assetMapCache = new Map<string, { sig: string; map: Record<string, string> }>();

/** deck assets as name → data-URL map for the runtime config (local decks).
 *  Cached per signature — converted blobs are reused across slides/frames. */
export async function getAssetMap(deckId: string, version: string | number): Promise<Record<string, string> | null> {
  const rec = await getRecord(deckId);
  if (!rec) return null;
  const sig = String(version) || signatureOf(rec);
  const hit = assetMapCache.get(deckId);
  if (hit && hit.sig === sig) return hit.map;
  const keys = Object.keys(rec.assets);
  if (!keys.length) {
    assetMapCache.set(deckId, { sig, map: {} });
    return {};
  }
  const map: Record<string, string> = {};
  for (const k of keys) {
    try {
      map[k] = await blobToDataUrl(rec.assets[k]);
    } catch {
      /* skip broken asset */
    }
  }
  assetMapCache.set(deckId, { sig, map });
  return map;
}

/* ------------------------------------------------------------------ */
/* asset preview URLs (editor Assets panel — Problem 06)               */
/* ------------------------------------------------------------------ */

const objectUrlCache = new Map<string, { url: string; size: number; type: string }>();

/** a deck asset as a loadable URL for UI previews (browser decks have no
 *  /api/assets route — serve the IndexedDB blob as an object URL).
 *  Cached per deck+path; re-created when the stored blob changes. */
export async function getAssetUrl(deckId: string, path: string): Promise<string | null> {
  const rec = await getRecord(deckId);
  if (!rec) return null;
  const blob = rec.assets[path];
  if (!blob) return null;
  const key = `${deckId}::${path}`;
  const hit = objectUrlCache.get(key);
  if (hit && hit.size === blob.size && hit.type === blob.type) return hit.url;
  if (hit) URL.revokeObjectURL(hit.url);
  const url = URL.createObjectURL(blob);
  objectUrlCache.set(key, { url, size: blob.size, type: blob.type });
  return url;
}

/* ------------------------------------------------------------------ */
/* device folder handles (File System Access API)                      */
/* ------------------------------------------------------------------ */

type DirHandle = any; // FileSystemDirectoryHandle — typed loosely for TS<->lib compat

export async function setDeviceHandle(deckId: string, handle: DirHandle): Promise<void> {
  await idbPut(STORE_HANDLES, handle, deckId);
}

export async function getDeviceHandle(deckId: string): Promise<DirHandle | null> {
  try {
    const h = await idbGet<DirHandle>(STORE_HANDLES, deckId);
    return h ?? null;
  } catch {
    return null;
  }
}

export async function removeDeviceHandle(deckId: string): Promise<void> {
  await idbDelete(STORE_HANDLES, deckId);
  const rec = await getRecord(deckId);
  if (rec) {
    rec.device = false;
    await putRecord(rec);
  }
}

/** permission helpers (must run on a user gesture for "prompt" → grant) */
export async function handlePermission(handle: DirHandle): Promise<PermissionState> {
  if (!handle?.queryPermission) return "denied";
  try {
    return await handle.queryPermission({ mode: "readwrite" });
  } catch {
    return "denied";
  }
}

export async function requestHandlePermission(handle: DirHandle): Promise<PermissionState> {
  if (!handle?.requestPermission) return "denied";
  try {
    return await handle.requestPermission({ mode: "readwrite" });
  } catch {
    return "denied";
  }
}
