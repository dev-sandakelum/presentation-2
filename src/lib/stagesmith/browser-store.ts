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
const DB_VERSION = 2; // v2: asset blobs move into their own store (see below)
const STORE_DECKS = "decks"; // deckId → StoredDeckRecord (text files + meta, NO blobs)
const STORE_SNAPSHOTS = "snapshots"; // `${deckId}::${name}` → { files, assets }
const STORE_HANDLES = "handles"; // deckId → FileSystemDirectoryHandle
const STORE_BLOBS = "blobs"; // `${deckId}::${path}` → { blob: Blob, display?: string }

/* v2 migration note — WHY the split store exists:
 *
 * v1 kept every asset Blob INSIDE the deck record, so every save re-put the
 * whole record — all 26 slides AND every large PNG — through IndexedDB in ONE
 * transaction. That is exactly what triggers Chromium's "Failed to write
 * blobs (IOError)" on big decks and makes a one-character edit take minutes
 * (it also re-mirrored every file to the device folder on every save).
 *
 * v2 stores asset blobs one-per-key in STORE_BLOBS. The deck record becomes
 * a small text-only object, and saves write only what actually changed
 * (content-hash diff for text files, object-identity/size diff for blobs).
 * Records written by v1 (assets still inline) are migrated lazily: on load
 * their blobs are served from the inline copy; the first successful persist
 * writes each blob to STORE_BLOBS and then re-puts the record stripped —
 * blobs are always written BEFORE the record is stripped, so a failed
 * migration never loses data (it simply retries next time).
 */

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
      // v2: one key per asset blob (no data moves here — see the lazy
      // migration in loadRecordFromDb / persistRecord)
      if (!db.objectStoreNames.contains(STORE_BLOBS)) db.createObjectStore(STORE_BLOBS);
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
/* blob store helpers (v2)                                             */
/* ------------------------------------------------------------------ */

interface StoredBlob {
  blob: Blob;
  /** original upload file name — shown in the UI when it differs from the
   *  sanitized on-disk name (uploads get safe, space-free file names) */
  display?: string;
}

const blobKey = (deckId: string, path: string) => `${deckId}::${path}`;

function blobKeyRange(deckId: string): IDBKeyRange {
  return IDBKeyRange.bound(`${deckId}::`, `${deckId}::\uffff`);
}

async function putBlob(deckId: string, path: string, value: StoredBlob): Promise<void> {
  await idbPut(STORE_BLOBS, value, blobKey(deckId, path));
}

async function deleteBlob(deckId: string, path: string): Promise<void> {
  await idbDelete(STORE_BLOBS, blobKey(deckId, path));
}

/** every stored blob of a deck: path → { blob, display } */
async function getBlobIndex(deckId: string): Promise<Map<string, StoredBlob>> {
  const out = new Map<string, StoredBlob>();
  try {
    const db = await openDb();
    const rows = await new Promise<Array<[string, StoredBlob]>>((resolve, reject) => {
      const t = db.transaction(STORE_BLOBS, "readonly");
      const req = t.objectStore(STORE_BLOBS).getAll(blobKeyRange(deckId));
      // keys come in the same order — pair them up
      const keysReq = t.objectStore(STORE_BLOBS).getAllKeys(blobKeyRange(deckId));
      t.oncomplete = () =>
        resolve((req.result ?? []).map((v, i) => [String(keysReq.result?.[i] ?? "").slice(deckId.length + 2), v as StoredBlob]));
      t.onerror = () => reject(t.error ?? new Error("blob index read failed"));
      t.onabort = () => reject(t.error ?? new Error("blob index read aborted"));
    });
    for (const [p, v] of rows) if (v && v.blob) out.set(p, v);
  } catch {
    /* unreadable blob store → treat as empty (persist re-writes on demand) */
  }
  return out;
}

async function deleteAllBlobs(deckId: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction(STORE_BLOBS, "readwrite");
      const s = t.objectStore(STORE_BLOBS);
      const req = s.getAllKeys(blobKeyRange(deckId));
      req.onsuccess = () => {
        for (const k of req.result) s.delete(k);
      };
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error ?? new Error("blob delete failed"));
      t.onabort = () => reject(t.error ?? new Error("blob delete aborted"));
    });
  } catch {
    /* best effort */
  }
}

/* ------------------------------------------------------------------ */
/* save-error messages that explain the storage situation              */
/* ------------------------------------------------------------------ */

/** wrap a raw IndexedDB error with a human explanation + quota context.
 *  "Failed to write blobs (IOError)" is Chromium's quota/IO failure — the
 *  user needs to know it's the storage layer, and how full it is. */
async function describeStorageError(e: unknown): Promise<Error> {
  const err = e instanceof Error ? e : new Error(String(e));
  const msg = `${err.name || ""} ${err.message || err}`.trim();
  if (!/Failed to write blobs|IOError|QuotaExceeded|quota|AbortError/i.test(msg)) return err;
  let extra = "";
  try {
    if (typeof navigator !== "undefined" && navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      if (est.usage != null && est.quota != null) {
        const mb = (n: number) => `${Math.round(n / 1024 / 1024)} MB`;
        extra = ` — browser storage: ${mb(est.usage)} used of ${mb(est.quota)} available`;
      }
    }
  } catch {
    /* estimate unavailable */
  }
  const reason = /quota/i.test(msg) ? "Browser storage is full" : "The browser couldn't write its storage (disk IO error — check free disk space, antivirus locks, or other running instances)";
  const out = new Error(`${reason}${extra}. Your edits are kept — saving will retry.`);
  out.cause = err;
  return out;
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
  /** binary assets by path (assets/…) — RUNTIME map only since the v2 split:
   *  persisted one-per-key in the blob store, merged back on load. */
  assets: Record<string, Blob>;
  /** a device folder is attached (File System Access API) */
  device?: boolean;
}

/** what actually goes into STORE_DECKS — the record minus its blobs */
function stripAssets(rec: BrowserDeckRecord): BrowserDeckRecord {
  const { assets: _assets, ...rest } = rec;
  return rest as BrowserDeckRecord;
}

/* per-deck snapshot of the LAST PERSISTED state — the diff baseline that
 * makes saves write only what changed (files by content hash, blobs by
 * identity/size). Initialized on first load; updated by persistRecord. */
interface PersistedState {
  /** content hash per file path (of the persisted record) */
  files: Record<string, string>;
  /** `title|modified|created|device` of the persisted record */
  meta: string;
  /** blob-store index: path → { size, type, display } */
  blobs: Map<string, { size: number; type: string; display?: string }>;
  /** same-session identity of the last persisted blob — catches same-size
   *  replacements that the size+type compare would miss */
  blobObjects: Map<string, Blob>;
}
const persistedStates = new Map<string, PersistedState>();

function fileHash(content: string): string {
  return `${content.length}:${fnv1a(content)}`;
}

function metaKeyOf(rec: BrowserDeckRecord): string {
  return `${rec.title}|${rec.modified}|${rec.created}|${rec.device ? 1 : 0}`;
}

async function initPersistedState(deckId: string, raw: BrowserDeckRecord | null): Promise<PersistedState> {
  const files: Record<string, string> = {};
  if (raw) for (const p of Object.keys(raw.files)) files[p] = fileHash(raw.files[p]);
  const blobs = new Map<string, { size: number; type: string; display?: string }>();
  const blobObjects = new Map<string, Blob>();
  for (const [p, v] of await getBlobIndex(deckId)) {
    blobs.set(p, { size: v.blob.size, type: v.blob.type, display: v.display });
    blobObjects.set(p, v.blob);
    if (v.display) setDisplayName(deckId, p, v.display);
  }
  const st: PersistedState = { files, meta: raw ? metaKeyOf(raw) : "", blobs, blobObjects };
  persistedStates.set(deckId, st);
  return st;
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
  for (const p of Object.keys(rec.assets).sort()) parts.push(`${p}:${rec.assets[p].size}:${(rec.assets[p] as File).lastModified ?? 0}`);
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
  await persistRecord(rec);
  recordCache.set(rec.id, rec);
  if (mirror && deviceMirror) {
    // best-effort write-through — the mirror runs its own serialized queue and
    // reports failures through the mirror-status listener (never blocks saves)
    deviceMirror(rec, lastMirrorChanges.get(rec.id) ?? emptyChanges).catch(() => {});
  }
  return rec;
}

export interface MirrorChanges {
  files: string[];
  assets: string[];
  removedFiles: string[];
  removedAssets: string[];
}
const emptyChanges: MirrorChanges = { files: [], assets: [], removedFiles: [], removedAssets: [] };
const lastMirrorChanges = new Map<string, MirrorChanges>();

/** the diff-based write path — THE fix for slow / failed saves:
 *  1. write each CHANGED asset blob (own small transaction, no giant put)
 *  2. delete removed blob keys
 *  3. put the small text-only deck record if meta/files changed
 *  Nothing is written at all when nothing changed. Blobs are written before
 *  the record is stripped, so a v1 record with inline assets can never lose
 *  them to a failed migration. */
async function persistRecord(rec: BrowserDeckRecord): Promise<void> {
  let st = persistedStates.get(rec.id);
  if (!st) st = await initPersistedState(rec.id, null);

  const changedFiles: string[] = [];
  const removedFiles: string[] = [];
  for (const p of Object.keys(rec.files)) {
    if (st.files[p] !== fileHash(rec.files[p])) changedFiles.push(p);
  }
  for (const p of Object.keys(st.files)) if (rec.files[p] === undefined) removedFiles.push(p);
  const metaChanged = st.meta !== metaKeyOf(rec);

  const changedAssets: string[] = [];
  const removedAssets: string[] = [];
  for (const p of Object.keys(rec.assets)) {
    const blob = rec.assets[p];
    const prev = st.blobs.get(p);
    if (!prev) {
      changedAssets.push(p); // new, or a v1 inline blob pending migration
    } else {
      const persistedObj = st.blobObjects.get(p);
      // identity compare when we know the persisted object (same session);
      // size+type compare across sessions (fresh objects from IDB)
      const same = persistedObj ? persistedObj === blob : prev.size === blob.size && prev.type === blob.type;
      if (!same) changedAssets.push(p);
    }
  }
  for (const p of Object.keys(st.blobs)) if (rec.assets[p] === undefined) removedAssets.push(p);

  const nothingChanged =
    !changedFiles.length && !removedFiles.length && !changedAssets.length && !removedAssets.length && !metaChanged;

  if (nothingChanged) {
    lastMirrorChanges.set(rec.id, emptyChanges);
    return;
  }

  try {
    // 1) changed blobs — each its own small transaction
    for (const p of changedAssets) {
      await putBlob(rec.id, p, { blob: rec.assets[p], display: getDisplayName(rec.id, p) });
    }
    // 2) removals
    for (const p of removedAssets) await deleteBlob(rec.id, p);
    // 3) the small record (never carries blobs)
    if (metaChanged || changedFiles.length || removedFiles.length) {
      await idbPut(STORE_DECKS, stripAssets(rec));
    }
  } catch (e) {
    throw await describeStorageError(e);
  }

  // advance the diff baseline
  for (const p of changedFiles) st.files[p] = fileHash(rec.files[p]);
  for (const p of removedFiles) delete st.files[p];
  st.meta = metaKeyOf(rec);
  for (const p of changedAssets) {
    const blob = rec.assets[p];
    st.blobs.set(p, { size: blob.size, type: blob.type, display: getDisplayName(rec.id, p) });
    st.blobObjects.set(p, blob);
  }
  for (const p of removedAssets) {
    st.blobs.delete(p);
    st.blobObjects.delete(p);
    clearDisplayName(rec.id, p);
  }

  lastMirrorChanges.set(rec.id, {
    files: changedFiles,
    assets: changedAssets,
    removedFiles,
    removedAssets,
  });
}

/** device write-through hook (set by device.ts — avoids a cyclic import).
 *  Receives the CHANGED paths so the mirror can skip unchanged files. */
type DeviceMirror = (rec: BrowserDeckRecord, changes: MirrorChanges) => Promise<void>;
let deviceMirror: DeviceMirror | null = null;
export function setDeviceMirror(fn: DeviceMirror | null): void {
  deviceMirror = fn;
}

/* in-memory record cache (compile + UI hit this a lot) */
const recordCache = new Map<string, BrowserDeckRecord>();

export async function hasDeck(deckId: string): Promise<boolean> {
  if (recordCache.has(deckId)) return true;
  try {
    // NOTE: never cache the raw record here — it hasn't been through
    // loadRecordFromDb (blob-store merge + v1 migration handling) yet
    const rec = await idbGet<BrowserDeckRecord>(STORE_DECKS, deckId);
    return Boolean(rec);
  } catch {
    /* ignore */
  }
  return false;
}

export async function getRecord(deckId: string): Promise<BrowserDeckRecord | null> {
  const cached = recordCache.get(deckId);
  if (cached) return cached;
  try {
    const rec = await loadRecordFromDb(deckId);
    if (rec) recordCache.set(deckId, rec);
    return rec ?? null;
  } catch {
    return null;
  }
}

/** read a deck record + merge its blob-store assets back into the runtime
 *  map. v1 records (assets inline) are served from the inline copy first;
 *  the next successful persist migrates them into the blob store. */
async function loadRecordFromDb(deckId: string): Promise<BrowserDeckRecord | null> {
  const raw = (await idbGet<BrowserDeckRecord>(STORE_DECKS, deckId)) ?? null;
  if (!raw) return null;
  const inline = (raw as BrowserDeckRecord & { assets?: Record<string, Blob> }).assets ?? {};
  const rec = stripAssets(raw);
  rec.assets = {};
  const blobs = await getBlobIndex(deckId);
  for (const [p, v] of blobs) rec.assets[p] = v.blob;
  // legacy v1 blobs that were never migrated still win (they're the copy the
  // record actually carries) — persist will move them into the blob store
  for (const p of Object.keys(inline)) if (!rec.assets[p]) rec.assets[p] = inline[p];
  // seed the diff baseline: files/meta from the raw record; the blob index
  // deliberately EXCLUDES not-yet-migrated inline assets → they count as
  // "changed" on the next persist, which completes the migration safely
  const st = await initPersistedState(deckId, raw);
  for (const p of Object.keys(inline)) st.blobs.delete(p);
  return rec;
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
    folderName: await deviceFolderNameOf(rec),
    cover: deck ? coverOf(deck, rec, themeCss) : undefined,
  };
}

/** best-effort device folder name for summaries (delete-confirmation needs
 *  it — decks can share a title, folders can't) */
async function deviceFolderNameOf(rec: BrowserDeckRecord): Promise<string | undefined> {
  if (!rec.device) return undefined;
  try {
    const { getDeviceHandle } = await import("./device");
    const handle = await getDeviceHandle(rec.id);
    return handle?.name ?? undefined;
  } catch {
    return undefined;
  }
}

export async function listDecks(): Promise<DeckSummary[]> {
  const raws = await idbGetAll<BrowserDeckRecord>(STORE_DECKS);
  const out: DeckSummary[] = [];
  for (const raw of raws) {
    if (!validDeckId(raw.id)) continue;
    // merge blob-store assets + v1 inline handling before using the record
    // (raw records from STORE_DECKS carry no assets since the v2 split)
    const rec = await getRecord(raw.id);
    if (!rec) continue;
    out.push(await summaryOf(rec));
  }
  out.sort((a, b) => (a.modified < b.modified ? 1 : -1));
  return out;
}

export async function getBundle(deckId: string): Promise<DeckBundle | null> {
  const rec = await getRecord(deckId);
  if (!rec) return null;
  if (rec.device) await syncDeviceAssets(deckId, rec); // pick up hand-copied files
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
  await idbDelete(STORE_HANDLES, `__parent__::${deckId}`);
  await deleteAllBlobs(deckId);
  recordCache.delete(deckId);
  persistedStates.delete(deckId);
  displayNames.delete(deckId);
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
  return saveFiles(deckId, [{ path: rel, content }]);
}

/** batch save — the editor's save queue writes all dirty buffers in ONE
 *  record mutation + ONE diff-based persist (previously each file saved
 *  re-put the whole deck — N files × full-deck write). */
export async function saveFiles(deckId: string, entries: Array<{ path: string; content: string; allowEmptyOverwrite?: boolean }>): Promise<string> {
  const rec = await getRecord(deckId);
  if (!rec) throw new Error("Deck not found");
  if (!entries.length) return signatureOf(rec);
  for (const e of entries) {
    if (e.content === "" && !e.allowEmptyOverwrite && (rec.files[e.path] ?? "").length) {
      throw new Error(`Refusing to replace non-empty ${e.path} with empty content without confirmation`);
    }
  }
  await snapshotDeck(deckId, "before-save");
  for (const e of entries) {
    if (!validRelPath(e.path)) throw new Error(`Illegal path: ${e.path}`);
    rec.files[e.path] = e.content;
  }
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

/* original upload display names (sanitized file names stay URL/disk-safe;
 * the UI shows what the user actually uploaded). Persisted alongside each
 * blob in the blob store; held here for fast access. */
const displayNames = new Map<string, Map<string, string>>();

function setDisplayName(deckId: string, path: string, display: string): void {
  let m = displayNames.get(deckId);
  if (!m) {
    m = new Map();
    displayNames.set(deckId, m);
  }
  m.set(path, display);
}
function getDisplayName(deckId: string, path: string): string | undefined {
  return displayNames.get(deckId)?.get(path);
}
function clearDisplayName(deckId: string, path: string): void {
  displayNames.get(deckId)?.delete(path);
}

/** make an upload file name disk/URL-safe: spaces/punctuation → dashes,
 *  Unicode letters and numbers KEPT (CJK, Cyrillic, …) — the ORIGINAL name is
 *  kept as the display label. ASCII-only stripping used to collapse names
 *  like "背景 图像.png" to a bare ".png" (a hidden dotfile). */
export function sanitizeAssetName(original: string): string {
  const dot = original.lastIndexOf(".");
  const ext = dot > 0 ? original.slice(dot).toLowerCase().replace(/[^.a-z0-9]/g, "") : "";
  const base = (dot > 0 ? original.slice(0, dot) : original)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents left by NFKD
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const safeBase = base || "asset";
  return ext && /^\.[a-z0-9]+$/.test(ext) ? `${safeBase}${ext}` : safeBase;
}

export async function listAssets(deckId: string): Promise<FileRow[]> {
  const rec = await getRecord(deckId);
  if (!rec) return [];
  if (rec.device) await syncDeviceAssets(deckId, rec); // pick up hand-copied files
  const mt = Date.parse(rec.modified) || Date.now();
  return Object.keys(rec.assets)
    // hidden segments (.stagesmith/ legacy thumb caches, .DS_Store…) are
    // internal junk, not deck content — never show them in the Assets panel
    .filter((p) => !p.split("/").some((seg) => seg.startsWith(".")))
    .sort()
    .map((p) => ({ path: p, mtime: mt, size: rec.assets[p].size, display: getDisplayName(deckId, p) }));
}

/** scan the device folder's assets/ dir and import files that aren't in the
 *  browser store yet (hand-copied images appear after a refresh/reopen).
 *  Throttled — the scan costs a folder iteration + cheap file stats. */
const deviceScanAt = new Map<string, number>();
let deviceScanInFlight: Promise<void> = Promise.resolve();

export async function syncDeviceAssets(deckId: string, rec: BrowserDeckRecord): Promise<void> {
  const last = deviceScanAt.get(deckId) ?? 0;
  if (Date.now() - last < 3000) return;
  deviceScanAt.set(deckId, Date.now());
  // serialize scans (folder iteration isn't free) and coalesce bursts
  const run = deviceScanInFlight.then(async () => {
    try {
      const { scanDeviceAssets } = await import("./device");
      const found = await scanDeviceAssets(deckId);
      if (!found || !found.length) return;
      let added = false;
      for (const f of found) {
        if (rec.assets[f.path] === undefined) {
          rec.assets[f.path] = f.file;
          added = true;
        }
      }
      if (added) await putRecord(rec, true); // diff persist: only the NEW blobs
    } catch {
      /* no permission / no handle — the studio keeps working from the store */
    }
  });
  deviceScanInFlight = run.catch(() => {});
  await run;
}

export async function uploadAssets(deckId: string, files: File[]): Promise<Array<{ path: string; display: string }>> {
  const rec = await getRecord(deckId);
  if (!rec) throw new Error("Deck not found");
  const uploaded: Array<{ path: string; display: string }> = [];
  for (const f of files) {
    // sanitized, URL/disk-safe file name; original kept as the display label
    let name = sanitizeAssetName(f.name) || "asset";
    let p = `assets/${name}`;
    let n = 2;
    while (rec.assets[p] !== undefined || rec.files[p] !== undefined) {
      const dot = name.lastIndexOf(".");
      p = dot > 0 ? `assets/${name.slice(0, dot)}-${n}${name.slice(dot)}` : `assets/${name}-${n}`;
      n++;
    }
    rec.assets[p] = f;
    setDisplayName(deckId, p, f.name);
    uploaded.push({ path: p, display: f.name });
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
/** concurrent getAssetMap calls share ONE conversion run (StageFrame, the
 *  present-mode preloader and the neighbour warmer all ask at boot — without
 *  this, big browser decks would convert every blob to a data URL 3×) */
const assetMapInflight = new Map<string, Promise<Record<string, string> | null>>();

/** deck assets as name → data-URL map for the runtime config (local decks).
 *  Cached per signature — converted blobs are reused across slides/frames. */
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
  })();
  assetMapInflight.set(deckId, p);
  try {
    return await p;
  } finally {
    assetMapInflight.delete(deckId);
  }
}

export async function getAssetDataUrl(deckId: string, path: string): Promise<string | null> {
  const rec = await getRecord(deckId);
  const blob = rec?.assets[path];
  return blob ? blobToDataUrl(blob) : null;
}

/* ------------------------------------------------------------------ */
/* asset preview URLs (editor Assets panel — Problem 06 + spaces fix)   */
/* ------------------------------------------------------------------ */

const objectUrlCache = new Map<string, { url: string; size: number; type: string; lastModified: number }>();

/** a deck asset as a loadable URL for UI previews (browser decks have no
 *  /api/assets route — serve the IndexedDB blob as an object URL).
 *  Cached per deck+path; re-created when the stored blob changes.
 *  Device decks ALSO fall back to the file on disk, so a file copied into
 *  the folder by hand still previews even before the folder scan imports it. */
export async function getAssetUrl(deckId: string, path: string): Promise<string | null> {
  const rec = await getRecord(deckId);
  if (!rec) return null;
  const key = `${deckId}::${path}`;
  let blob: Blob | null = rec.assets[path] ?? null;
  let lastModified = 0;
  if (!blob && rec.device) {
    // not in the store (yet) — read it straight from the device folder
    try {
      const { readDeviceAsset } = await import("./device");
      const file = await readDeviceAsset(deckId, path);
      if (file) {
        blob = file;
        lastModified = file.lastModified;
      }
    } catch {
      /* no handle / no permission */
    }
  }
  if (!blob) return null;
  const hit = objectUrlCache.get(key);
  if (hit && hit.size === blob.size && hit.type === blob.type && hit.lastModified === lastModified) return hit.url;
  if (hit) URL.revokeObjectURL(hit.url);
  const url = URL.createObjectURL(blob);
  objectUrlCache.set(key, { url, size: blob.size, type: blob.type, lastModified });
  return url;
}

/* ------------------------------------------------------------------ */
/* device folder handles (File System Access API)                      */
/* ------------------------------------------------------------------ */

export type DirHandle = any; // FileSystemDirectoryHandle — typed loosely for TS<->lib compat

export type HandleAccessState = "granted" | "prompt" | "denied" | "missing";

/** ask the browser whether THIS handle may be written — no prompt, no gesture.
 *  Returns the raw queryPermission state ("denied" also covers broken handles). */
export async function handlePermission(handle: DirHandle): Promise<PermissionState> {
  if (!handle?.queryPermission) return "denied";
  try {
    return await handle.queryPermission({ mode: "readwrite" });
  } catch {
    return "denied";
  }
}

/** true when the folder the handle points at still exists on disk.
 *  Probes by reading the FIRST directory entry (cheap, permission-gated);
 *  a moved / renamed / deleted folder rejects with NotFoundError. */
export async function folderUsable(handle: DirHandle): Promise<boolean> {
  try {
    const it = handle.entries();
    await it.next();
    return true;
  } catch (e) {
    return (e as Error)?.name === "NotFoundError" ? false : true;
  }
}

/** The full truth about one handle, used everywhere a write is about to run:
 *  queryPermission first (free), then — because a handle derived from a
 *  granted PARENT folder can report "prompt" while actually working — a
 *  one-entry probe as the tie-breaker. "granted" also verifies the folder
 *  still exists, so a moved folder surfaces as "missing" instead of
 *  failing half-way through a save. */
export async function handleAccessState(handle: DirHandle): Promise<HandleAccessState> {
  if (!handle) return "missing";
  const queried = await handlePermission(handle);
  if (queried === "granted") {
    return (await folderUsable(handle)) ? "granted" : "missing";
  }
  // query says prompt/denied — the derived-handle case may still work
  try {
    await handle.entries().next();
    return "granted";
  } catch (e) {
    if ((e as Error)?.name === "NotFoundError") return "missing";
    return queried === "denied" ? "denied" : "prompt";
  }
}

/** requestPermission on a handle — ONLY meaningful inside a user gesture
 *  (banner/card button, Ctrl+S, a confirmed delete). Without one Chromium
 *  rejects with SecurityError, which is a TEMPORARY "still prompt", never a
 *  hard "denied" — mapping it there would pin the deck in the wrong state. */
export async function requestHandlePermission(handle: DirHandle): Promise<PermissionState> {
  if (!handle?.requestPermission) return "denied";
  try {
    return await handle.requestPermission({ mode: "readwrite" });
  } catch (e) {
    return (e as Error)?.name === "SecurityError" ? "prompt" : "denied";
  }
}

/* ---- durable storage for handles ---------------------------------- */

let persistAsked = false;

/** ask the browser to keep our IndexedDB (and thus the stored handles)
 *  out of automatic eviction — called once per session when a handle is
 *  stored (Chrome shows no UI for this unless it decides to). */
async function askPersistOnce(): Promise<void> {
  if (persistAsked) return;
  persistAsked = true;
  try {
    await navigator.storage?.persist?.();
  } catch {
    /* unsupported / private mode — handles still work, just less durable */
  }
}

export async function setDeviceHandle(deckId: string, handle: DirHandle): Promise<void> {
  await idbPut(STORE_HANDLES, handle, deckId);
  void askPersistOnce();
}

/** dev-only simulated handles (see permission.ts __ssAccessSim) — IndexedDB
 *  can't structured-clone functions, so simulated FolderHandles live in
 *  memory instead of STORE_HANDLES. The map is only ever populated by the
 *  dev simulation hook; production builds never touch it. */
const devHandleOverrides = new Map<string, DirHandle>();

export function setDevHandleOverride(deckId: string, handle: DirHandle | null): void {
  if (handle === null) devHandleOverrides.delete(deckId);
  else devHandleOverrides.set(deckId, handle);
}

export async function getDeviceHandle(deckId: string): Promise<DirHandle | null> {
  if (devHandleOverrides.size) {
    const override = devHandleOverrides.get(deckId);
    if (override) return override;
  }
  try {
    const h = await idbGet<DirHandle>(STORE_HANDLES, deckId);
    return h ?? null;
  } catch {
    return null;
  }
}

/** ids of every deck that mirrors to a device folder (permission checks,
 *  the access banner, one-click re-grants). Lightweight — no blob merges. */
export async function listDeviceDeckIds(): Promise<string[]> {
  try {
    const raws = await idbGetAll<BrowserDeckRecord>(STORE_DECKS);
    return raws.filter((r) => r && r.device && validDeckId(r.id)).map((r) => r.id);
  } catch {
    return [];
  }
}

/* ---- shared parent folders (one click re-grants every deck inside) --
 *
 * When "New project…"/"Open folder…" put the deck in a SUBFOLDER of the
 * picked root, the picked root is ALSO remembered (composite key inside
 * STORE_HANDLES — no DB migration needed). Requesting permission on that
 * one parent and re-deriving every child handle from it restores access to
 * all of the decks it contains with a single permission click. */

const PARENT_KEY = (deckId: string) => `__parent__::${deckId}`;

export interface DeviceParentInfo {
  parent: DirHandle;
  childName: string;
}

export async function setDeviceParent(deckId: string, parent: DirHandle, childName: string): Promise<void> {
  await idbPut(STORE_HANDLES, { parent, childName } satisfies DeviceParentInfo, PARENT_KEY(deckId));
  void askPersistOnce();
}

export async function getDeviceParent(deckId: string): Promise<DeviceParentInfo | null> {
  try {
    const v = await idbGet<DeviceParentInfo>(STORE_HANDLES, PARENT_KEY(deckId));
    return v && v.parent && typeof v.childName === "string" ? v : null;
  } catch {
    return null;
  }
}

export async function clearDeviceParent(deckId: string): Promise<void> {
  await idbDelete(STORE_HANDLES, PARENT_KEY(deckId));
}

export async function removeDeviceHandle(deckId: string): Promise<void> {
  await idbDelete(STORE_HANDLES, deckId);
  await idbDelete(STORE_HANDLES, PARENT_KEY(deckId));
  const rec = await getRecord(deckId);
  if (rec) {
    rec.device = false;
    await putRecord(rec);
  }
}
