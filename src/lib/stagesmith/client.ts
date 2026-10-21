"use client";

import type { DeckJson, DeckBundle, DeckSummary, FileRow, Source, ThemeMode } from "./types";
import * as local from "./browser-store";
import * as transfer from "./transfer";

export type { DeckBundle };

/**
 * Typed data layer for the whole studio.
 *
 * Decks live in ONE of two stores and every call below dispatches on it:
 *   - "server"  — the app's decks/ folder (only possible when the server's
 *                 file system is writable, i.e. local runs)
 *   - "browser" — THIS browser's IndexedDB (hosted/read-only deployments and
 *                 device-folder projects). No database, no backend storage.
 */

async function j<T>(res: Response): Promise<T> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    throw new Error((body as { error?: string } | null)?.error || `Request failed (${res.status})`);
  }
  if (body === null || typeof body !== "object") {
    throw new Error("Malformed response from server");
  }
  return body as T;
}

/* ------------------------------------------------------------------ */
/* capabilities                                                        */
/* ------------------------------------------------------------------ */

export interface Capabilities {
  /** can the server store decks in its own decks/ folder? (local runs: yes) */
  fsWritable: boolean;
}

let capsPromise: Promise<Capabilities> | null = null;

export function getCapabilities(): Promise<Capabilities> {
  if (!capsPromise) {
    capsPromise = fetch("/api/capabilities", { cache: "no-store" })
      .then((r) => j<Capabilities>(r))
      .catch(() => ({ fsWritable: false })); // unreachable server → browser store
  }
  return capsPromise;
}

/** where NEW decks go when the caller doesn't specify */
export async function defaultStore(): Promise<"server" | "browser"> {
  const caps = await getCapabilities();
  return caps.fsWritable ? "server" : "browser";
}

async function isLocalDeck(deckId: string): Promise<boolean> {
  return local.hasDeck(deckId);
}

/** THE one asset-URL builder for route-served decks — every path segment is
 *  percent-encoded, so file names with spaces, brackets, #, % and non-English
 *  letters all work ("Minimal Blue and Pastel Ribbon Background.png" →
 *  "Minimal%20Blue%20and%20Pastel%20Ribbon%20Background.png"). */
export function assetRouteUrl(deckId: string, path: string): string {
  return `/api/assets/${encodeURIComponent(deckId)}/${path
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/")}`;
}

/* ------------------------------------------------------------------ */
/* module resolution (StageFrame)                                      */
/* ------------------------------------------------------------------ */

/** deck asset data-URL map for the runtime config (browser decks only) */
export async function getAssetMap(deckId: string, version: string | number): Promise<Record<string, string> | null> {
  if (await isLocalDeck(deckId)) return local.getAssetMap(deckId, version);
  return null;
}

export interface ModuleInfo {
  /** compile URL (server decks) */
  url: string | null;
  /** inline compiled ESM (browser decks) */
  code: string | null;
  /** version key — output hash */
  ver: string;
  steps: number;
  error: string | null;
}

const moduleCache = new Map<string, ModuleInfo>();
/** tracks the last-seen version per deckId — when it changes, stale entries
 *  for that deck are evicted so a reopened deck never serves old compiled
 *  modules from a previous session version. */
const deckVersionSeen = new Map<string, string | number>();

/** concurrent resolveModule calls for the same key share ONE request — the
 *  present-mode preloader and StageFrame's own resolution race for the same
 *  modules; without this both would compile/fetch the file twice. */
const inflightModules = new Map<string, Promise<ModuleInfo>>();

/**
 * Resolve a deck layer (slide/bg/overlay) to a loadable module.
 * Server decks → compile URL (GET /api/compile?meta=1).
 * Browser decks → stateless POST /api/compile with the whole file map;
 * the returned bundle is self-contained and is imported by the runtime
 * from a blob URL.
 */
export function resolveModule(deckId: string, path: string, version: string | number): Promise<ModuleInfo> {
  // when the version advances for this deck, drop all stale cache entries for
  // it — ensures a reopened (or live-edited) deck always recompiles its modules
  const lastVersion = deckVersionSeen.get(deckId);
  if (lastVersion !== undefined && lastVersion !== version) {
    for (const k of [...moduleCache.keys()]) {
      if (k.startsWith(`${deckId}:`)) moduleCache.delete(k);
    }
  }
  deckVersionSeen.set(deckId, version);

  const key = `${deckId}:${path}:${version}`;
  const hit = moduleCache.get(key);
  if (hit) return Promise.resolve(hit);
  const pending = inflightModules.get(key);
  if (pending) return pending;
  const p = (async () => {
    try {
      let info: ModuleInfo;
      if (await isLocalDeck(deckId)) {
        const rec = await local.getRecord(deckId);
        if (!rec) throw new Error("Deck not found");
        const res = await fetch("/api/compile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ files: rec.files, entry: path }),
        });
        const data = (await j<{ ok: boolean; js?: string; steps?: number; ver?: string; error?: string }>(res)) as {
          ok: boolean;
          js?: string;
          steps?: number;
          ver?: string;
          error?: string;
        };
        info = data.ok
          ? { url: null, code: data.js ?? "", ver: data.ver ?? String(data.js?.length ?? 0), steps: data.steps || 1, error: null }
          : { url: null, code: null, ver: "err", steps: 1, error: data.error || "Compile failed" };
      } else {
        const res = await fetch(
          `/api/compile?deck=${encodeURIComponent(deckId)}&file=${encodeURIComponent(path)}&meta=1`,
        );
        const data = (await j<{ ok: boolean; url?: string; steps?: number; error?: string; hash?: string }>(res)) as {
          ok: boolean;
          url?: string;
          steps?: number;
          error?: string;
          hash?: string;
        };
        info = data.ok
          ? { url: data.url ?? null, code: null, ver: data.hash ?? "", steps: data.steps || 1, error: null }
          : { url: null, code: null, ver: "err", steps: 1, error: data.error || "Compile failed" };
      }
      moduleCache.set(key, info);
      return info;
    } catch (e) {
      return { url: null, code: null, ver: "err", steps: 1, error: (e as Error).message };
    }
  })().finally(() => inflightModules.delete(key));
  inflightModules.set(key, p);
  return p;
}

/* ------------------------------------------------------------------ */
/* view types                                                          */
/* ------------------------------------------------------------------ */

export type DeckBundleView = DeckBundle;

/** /api/fs — directory browser row */
export interface FsBrowse {
  path: string;
  parent: string | null;
  home: string;
  decksRoot: string;
  writable: boolean;
  dirs: string[];
  truncated?: boolean;
}

/** /api/projects — create-project result */
export interface CreateProjectResult {
  deck: DeckJson;
  deckId: string;
  root: string;
  external: boolean;
}

/** /api/network — phone-reachable URL candidates for the QR panel */
export interface NetworkInfo {
  mode: "lan" | "origin";
  origin: string;
  hostname: string;
  port: number;
  urls: Array<{ url: string; ip: string; iface: string }>;
  hint: string;
}

/** DELETE /api/decks/<id> result */
export interface DeleteDeckResult {
  ok: boolean;
  removed: boolean;
  external: boolean;
  root: string;
  /** device-folder cleanup couldn't remove the files (permission/IO) —
   *  shown in the delete toast instead of being swallowed */
  folderCleanupError?: string;
}

/** import result row */
export interface ImportReport {
  deckId: string;
  slides: number;
  files: number;
  warnings: string[];
}

export type DeckStore = "server" | "browser";

/* ------------------------------------------------------------------ */
/* the api facade                                                      */
/* ------------------------------------------------------------------ */

export const api = {
  /* ---------------- listing / bundles ---------------- */

  listDecks: async (): Promise<DeckSummary[]> => {
    const [serverDecks, browserDecks] = await Promise.all([
      fetch("/api/decks", { cache: "no-store" })
        .then((r) => j<{ decks?: DeckSummary[] }>(r))
        .then((b) => (b.decks ?? []).map((d) => ({ ...d, store: "server" as DeckStore })))
        .catch(() => [] as DeckSummary[]),
      local.listDecks().catch(() => [] as DeckSummary[]),
    ]);
    // browser decks win on id collisions (they're the newer, writable copy)
    const seen = new Set(browserDecks.map((d) => d.id));
    return [...browserDecks, ...serverDecks.filter((d) => !seen.has(d.id))].sort((a, b) =>
      a.modified < b.modified ? 1 : -1,
    );
  },

  getDeck: async (deckId: string): Promise<DeckBundle> => {
    if (await isLocalDeck(deckId)) {
      const b = await local.getBundle(deckId);
      if (b) return b;
    }
    const res = await fetch(`/api/decks/${deckId}`);
    return j<DeckBundle>(res);
  },

  /** where does this deck live? (used by UI chips + routing) */
  storeOf: async (deckId: string): Promise<DeckStore> => {
    return (await isLocalDeck(deckId)) ? "browser" : "server";
  },

  /* ---------------- create / delete ---------------- */

  createDeck: async (
    title: string,
    opts: { duplicateOf?: string; store?: DeckStore } = {},
  ): Promise<DeckJson> => {
    const store = opts.store ?? (await defaultStore());
    if (store === "browser") {
      if (opts.duplicateOf) {
        if (await isLocalDeck(opts.duplicateOf)) {
          return (await local.duplicateDeck(opts.duplicateOf, title)).deck;
        }
        // duplicate a server deck into the browser store
        const b = await api.getDeck(opts.duplicateOf);
        const files: Record<string, string> = {};
        for (const f of b.files) {
          try {
            files[f.path] = await api.readFile(opts.duplicateOf, f.path);
          } catch {
            /* skip unreadable */
          }
        }
        if (!files["deck.json"]) throw new Error("Source deck could not be read");
        return (await local.createDeck(title, files)).deck;
      }
      return (await local.createStarterDeck(title)).deck;
    }
    const res = await fetch("/api/decks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, duplicateOf: opts.duplicateOf }),
    });
    return (await j<{ deck: DeckJson }>(res)).deck;
  },

  deleteDeck: async (deckId: string): Promise<DeleteDeckResult> => {
    if (await isLocalDeck(deckId)) {
      const rec = await local.getRecord(deckId);
      let root = "this browser";
      let folderCleanupError: string | undefined;
      if (rec?.device) {
        // best-effort: also remove the deck's files from the device folder
        // (permission may have lapsed — the browser-store copy is deleted
        // regardless, and the reason is surfaced instead of swallowed)
        const { cleanupDeviceProject, deviceFolderName } = await import("./device");
        root = (await deviceFolderName(deckId)) ?? deckId;
        const cleanup = await cleanupDeviceProject(deckId);
        folderCleanupError = cleanup.error;
      }
      await local.deleteDeck(deckId);
      return { ok: true, removed: true, external: false, root, folderCleanupError };
    }
    const res = await fetch(`/api/decks/${deckId}`, { method: "DELETE" });
    return j<DeleteDeckResult>(res);
  },

  /* ---------------- files ---------------- */

  readFile: async (deckId: string, path: string): Promise<string> => {
    if (await isLocalDeck(deckId)) return local.readFile(deckId, path);
    const res = await fetch(`/api/decks/${deckId}/files?path=${encodeURIComponent(path)}`, { cache: "no-store" });
    const body = await j<{ content?: string }>(res);
    if (typeof body.content !== "string") throw new Error("Empty file response");
    return body.content;
  },

  saveFile: async (deckId: string, path: string, content: string): Promise<string> => {
    if (await isLocalDeck(deckId)) return local.saveFile(deckId, path, content);
    const res = await fetch(`/api/decks/${deckId}/files`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, content }),
    });
    return (await j<{ signature: string }>(res)).signature;
  },

  /** batch save — the editor's save queue writes all dirty buffers in one
   *  call (one record mutation for browser decks, sequential atomic PUTs
   *  for server decks). Returns the deck's new signature. */
  saveFiles: async (deckId: string, entries: Array<{ path: string; content: string }>): Promise<string> => {
    if (!entries.length) return api.poll(deckId);
    if (await isLocalDeck(deckId)) return local.saveFiles(deckId, entries);
    let sig = "";
    for (const e of entries) {
      const res = await fetch(`/api/decks/${deckId}/files`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: e.path, content: e.content }),
      });
      sig = (await j<{ signature: string }>(res)).signature;
    }
    return sig;
  },

  deleteFile: async (deckId: string, path: string): Promise<void> => {
    if (await isLocalDeck(deckId)) return local.deleteFile(deckId, path);
    const res = await fetch(`/api/decks/${deckId}/files?path=${encodeURIComponent(path)}`, { method: "DELETE" });
    await j(res);
  },

  /* ---------------- slides ---------------- */

  addSlide: async (
    deckId: string,
    opts: { template?: string; label?: string; position?: number; code?: string },
  ): Promise<DeckJson> => {
    if (await isLocalDeck(deckId)) return local.addSlide(deckId, opts);
    const res = await fetch(`/api/decks/${deckId}/slides`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts),
    });
    return (await j<{ deck: DeckJson }>(res)).deck;
  },

  patchSlide: async (
    deckId: string,
    slideId: string,
    patch: { label?: string; theme?: ThemeMode | null; bg?: Source | null; overlay?: Source | null },
  ): Promise<DeckJson> => {
    if (await isLocalDeck(deckId)) return local.patchSlide(deckId, slideId, patch);
    const res = await fetch(`/api/decks/${deckId}/slides/${slideId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    return (await j<{ deck: DeckJson }>(res)).deck;
  },

  deleteSlide: async (deckId: string, slideId: string): Promise<DeckJson> => {
    if (await isLocalDeck(deckId)) return local.deleteSlide(deckId, slideId);
    const res = await fetch(`/api/decks/${deckId}/slides/${slideId}`, { method: "DELETE" });
    return (await j<{ deck: DeckJson }>(res)).deck;
  },

  duplicateSlide: async (deckId: string, slideId: string): Promise<DeckJson> => {
    if (await isLocalDeck(deckId)) return local.duplicateSlide(deckId, slideId);
    const res = await fetch(`/api/decks/${deckId}/slides/${slideId}/duplicate`, { method: "POST" });
    return (await j<{ deck: DeckJson }>(res)).deck;
  },

  reorder: async (deckId: string, order: string[]): Promise<DeckJson> => {
    if (await isLocalDeck(deckId)) return local.reorderSlides(deckId, order);
    const res = await fetch(`/api/decks/${deckId}/reorder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order }),
    });
    return (await j<{ deck: DeckJson }>(res)).deck;
  },

  patchDeck: async (
    deckId: string,
    patch: { title?: string; bg?: Source; overlay?: Source; settings?: Partial<DeckJson["settings"]> },
  ): Promise<DeckJson> => {
    if (await isLocalDeck(deckId)) return local.patchDeck(deckId, patch);
    const res = await fetch(`/api/decks/${deckId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    return (await j<{ deck: DeckJson }>(res)).deck;
  },

  /* ---------------- polling ---------------- */

  poll: async (deckId: string): Promise<string> => {
    if (await isLocalDeck(deckId)) {
      const rec = await local.getRecord(deckId);
      return rec ? local.signatureOf(rec) : "";
    }
    const res = await fetch(`/api/decks/${deckId}/poll`, { cache: "no-store" });
    return (await j<{ signature?: string }>(res)).signature ?? "";
  },

  /* ---------------- assets + code files ---------------- */

  /** preview URL for a deck asset — store-aware (Problem 06): browser decks
   *  have no /api/assets route, so their IndexedDB blobs (or device-folder
   *  files) are served as object URLs; server decks keep the /api/assets
   *  route (always percent-encoded — spaces, # and unicode all work). */
  assetUrl: async (deckId: string, path: string): Promise<string> => {
    if (await isLocalDeck(deckId)) {
      const url = await local.getAssetUrl(deckId, path);
      if (url) return url;
    }
    return assetRouteUrl(deckId, path);
  },

  listAssets: async (deckId: string): Promise<FileRow[]> => {
    if (await isLocalDeck(deckId)) return local.listAssets(deckId);
    const res = await fetch(`/api/decks/${deckId}/assets`, { cache: "no-store" });
    return (await j<{ assets?: FileRow[] }>(res)).assets ?? [];
  },

  uploadAssets: async (deckId: string, files: File[]): Promise<Array<{ path: string; display: string }>> => {
    if (await isLocalDeck(deckId)) return local.uploadAssets(deckId, files);
    const form = new FormData();
    for (const f of files) form.append("file", f);
    const res = await fetch(`/api/decks/${deckId}/assets`, { method: "POST", body: form });
    const rows = (await j<{ uploaded: Array<{ path: string }> }>(res)).uploaded;
    // server decks keep the original on-disk name — the display name is the file name
    return rows.map((r) => ({ path: r.path, display: r.path.replace("assets/", "") }));
  },

  listCodeFiles: async (deckId: string, dir: "overlay" | "bg"): Promise<FileRow[]> => {
    if (await isLocalDeck(deckId)) return local.listCodeFiles(deckId, dir);
    const res = await fetch(`/api/decks/${deckId}/code-files?dir=${dir}`, { cache: "no-store" });
    return (await j<{ files?: FileRow[] }>(res)).files ?? [];
  },

  uploadCodeFile: async (deckId: string, dir: "overlay" | "bg", files: File[]): Promise<Array<{ path: string }>> => {
    if (await isLocalDeck(deckId)) return local.uploadCodeFile(deckId, dir, files);
    const form = new FormData();
    for (const f of files) form.append("file", f);
    const res = await fetch(`/api/decks/${deckId}/code-files?dir=${dir}`, { method: "POST", body: form });
    return (await j<{ uploaded: Array<{ path: string }> }>(res)).uploaded;
  },

  deleteCodeFile: async (deckId: string, path: string): Promise<void> => {
    if (await isLocalDeck(deckId)) return local.deleteCodeFile(deckId, path);
    const res = await fetch(`/api/decks/${deckId}/code-files?path=${encodeURIComponent(path)}`, { method: "DELETE" });
    await j(res);
  },

  /* ---------------- snapshots ---------------- */

  listSnapshots: async (deckId: string): Promise<string[]> => {
    if (await isLocalDeck(deckId)) return local.listSnapshots(deckId);
    const res = await fetch(`/api/decks/${deckId}/snapshots`, { cache: "no-store" });
    return (await j<{ snapshots?: string[] }>(res)).snapshots ?? [];
  },

  snapshot: async (deckId: string, tag: string): Promise<string> => {
    if (await isLocalDeck(deckId)) return local.snapshotDeck(deckId, tag);
    const res = await fetch(`/api/decks/${deckId}/snapshots`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create", tag }),
    });
    return (await j<{ name: string }>(res)).name;
  },

  restoreSnapshot: async (deckId: string, name: string): Promise<void> => {
    if (await isLocalDeck(deckId)) return local.restoreSnapshot(deckId, name);
    const res = await fetch(`/api/decks/${deckId}/snapshots`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "restore", name }),
    });
    await j(res);
  },

  /* ---------------- import / export ---------------- */

  importFile: async (file: File, opts: { store?: DeckStore } = {}): Promise<ImportReport> => {
    const store = opts.store ?? (await defaultStore());
    if (store === "browser") return transfer.importFileToBrowser(file);
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/import", { method: "POST", body: form });
    return (await j<{ report: ImportReport }>(res)).report;
  },

  importText: async (text: string, name: string, opts: { store?: DeckStore } = {}): Promise<ImportReport> => {
    const store = opts.store ?? (await defaultStore());
    if (store === "browser") return transfer.importTextToBrowser(text, name);
    const res = await fetch("/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, name }),
    });
    return (await j<{ report: ImportReport }>(res)).report;
  },

  /** export a deck from either store as a downloadable object URL */
  exportDeck: async (deckId: string, format: "smdeck" | "deck.tsx"): Promise<{ url: string; filename: string }> => {
    let blob: Blob;
    let filename: string;
    if (await isLocalDeck(deckId)) {
      const rec = await local.getRecord(deckId);
      if (!rec) throw new Error("Deck not found");
      const out = await transfer.exportDeck(rec, format);
      blob = out.blob;
      filename = out.filename;
    } else {
      const res = await fetch(`/api/decks/${deckId}/export?format=${encodeURIComponent(format)}`);
      if (!res.ok) throw new Error("Export failed");
      blob = await res.blob();
      filename = `${deckId}.${format === "smdeck" ? "smdeck" : "deck.tsx"}`;
    }
    return { url: URL.createObjectURL(blob), filename };
  },

  /* ---------------- server-only helpers ---------------- */

  browseFs: async (dirPath?: string): Promise<FsBrowse> => {
    const q = dirPath ? `?path=${encodeURIComponent(dirPath)}` : "";
    const res = await fetch(`/api/fs${q}`, { cache: "no-store" });
    return j<FsBrowse>(res);
  },

  createFolder: async (dirPath: string): Promise<{ ok: boolean; path: string }> => {
    const res = await fetch("/api/fs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: dirPath }),
    });
    return j<{ ok: boolean; path: string }>(res);
  },

  createProject: async (name: string, location: string): Promise<CreateProjectResult> => {
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, location }),
    });
    return j<CreateProjectResult>(res);
  },

  networkInfo: async (): Promise<NetworkInfo> => {
    const res = await fetch("/api/network", { cache: "no-store" });
    return j<NetworkInfo>(res);
  },
};
