"use client";

import type { DeckJson, DeckBundle, DeckSummary, FileRow, Source, ThemeMode } from "./types";
import * as local from "./browser-store";
import * as desktop from "./desktop-store";
import * as transfer from "./transfer";
import { ensureWriteAccess, maybeRequestWriteAccess } from "./permission";

export type { DeckBundle };

/**
 * Typed data layer for the whole studio.
 *
 * Decks live in ONE of THREE stores and every call below dispatches on it:
 *   - "desktop" — the Chassé Studio desktop app's chosen folder, owned and
 *                 permissioned by the Java side through the fs bridge (the
 *                 "fs" capability). Wins over the others whenever it is
 *                 active, replacing the browser's File System Access API
 *                 (whose permission expires every restart inside JCEF).
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
/* object-URL hygiene (export blobs must not leak)                      */
/* ------------------------------------------------------------------ */

const EXPORT_URL_TTL_MS = 10 * 60 * 1000; // 10 min — survives even a slow native Save-as
const exportUrls = new Set<string>();
let unloadHookInstalled = false;

/**
 * Every object URL created for an export is eventually revoked: after 10
 * minutes at the latest (a native Save-as dialog can stay open for minutes),
 * and immediately when the page hides (an export URL is never needed again
 * after the click that consumed it).
 */
function scheduleObjectUrlRevoke(url: string): void {
  exportUrls.add(url);
  setTimeout(() => {
    exportUrls.delete(url);
    URL.revokeObjectURL(url);
  }, EXPORT_URL_TTL_MS);
  if (!unloadHookInstalled && typeof window !== "undefined") {
    unloadHookInstalled = true;
    const flush = () => {
      for (const u of [...exportUrls]) URL.revokeObjectURL(u);
      exportUrls.clear();
    };
    window.addEventListener("pagehide", flush);
  }
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
export async function defaultStore(): Promise<DeckStore> {
  // the desktop app owns the decks folder whenever the fs capability is
  // active — new decks belong there, not in a browser that can't keep access
  if (await desktop.isDesktopFsActive()) return "desktop";
  const caps = await getCapabilities();
  return caps.fsWritable ? "server" : "browser";
}

/** where does THIS deck live? desktop (when active) > browser > server */
async function deckStoreOf(deckId: string): Promise<DeckStore> {
  if (await desktop.isDesktopFsActive()) {
    if (await desktop.hasDeck(deckId)) return "desktop";
  }
  return (await local.hasDeck(deckId)) ? "browser" : "server";
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

/** deck asset URL map for the runtime config (browser + desktop decks) */
export async function getAssetMap(deckId: string, version: string | number): Promise<Record<string, string> | null> {
  const store = await deckStoreOf(deckId);
  if (store === "desktop") return desktop.getAssetMap(deckId, version);
  if (store === "browser") return local.getAssetMap(deckId, version);
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
  const compilePhase = `stagesmith:compile:${deckId}:${path}:${version}`;
  if (typeof performance !== "undefined") performance.mark(`${compilePhase}:start`);
  console.info(`[deck-load] START compile-module`, { deckId, path, version });
  const p = (async () => {
    try {
      let info: ModuleInfo;
      const store = await deckStoreOf(deckId);
      if (store === "desktop" || store === "browser") {
        const rec = store === "desktop" ? await desktop.getRecord(deckId) : await local.getRecord(deckId);
        if (!rec) throw new Error("Deck not found");
        if (store === "desktop" && rec.files[path] === undefined) {
          // Desktop records stream their noncritical source files after the
          // first slide. Resolve a requested module on demand instead of
          // compiling against an incomplete startup snapshot.
          rec.files[path] = await desktop.readFile(deckId, path);
        }
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
  })().finally(() => {
    if (typeof performance !== "undefined") {
      performance.mark(`${compilePhase}:end`);
      try { performance.measure(compilePhase, `${compilePhase}:start`, `${compilePhase}:end`); } catch { /* mark may be cleared during navigation */ }
    }
    console.info(`[deck-load] END compile-module`, { deckId, path, version });
    inflightModules.delete(key);
  });
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
  /** nothing was deleted: the device folder's write permission lapsed (or
   *  the folder is gone) and couldn't be restored with the delete click's
   *  gesture. The UI offers "Allow access" and re-runs the delete after
   *  the grant — "Deck deleted" is never claimed while the files remain. */
  needsAccess?: boolean;
  accessState?: "prompt" | "denied" | "missing";
}

/** import result row */
export interface ImportReport {
  deckId: string;
  slides: number;
  files: number;
  warnings: string[];
}

export type DeckStore = "server" | "browser" | "desktop";

/* ------------------------------------------------------------------ */
/* the api facade                                                      */
/* ------------------------------------------------------------------ */

export const api = {
  /* ---------------- listing / bundles ---------------- */

  listDecks: async (): Promise<DeckSummary[]> => {
    const [serverDecks, browserDecks, desktopDecks] = await Promise.all([
      fetch("/api/decks", { cache: "no-store" })
        .then((r) => j<{ decks?: DeckSummary[] }>(r))
        .then((b) => (b.decks ?? []).map((d) => ({ ...d, store: "server" as DeckStore })))
        .catch(() => [] as DeckSummary[]),
      local.listDecks().catch(() => [] as DeckSummary[]),
      desktop.listDecks().catch(() => [] as DeckSummary[]),
    ]);
    // newer, writable copies win on id collisions: desktop > browser > server
    const seen = new Set([...desktopDecks.map((d) => d.id), ...browserDecks.map((d) => d.id)]);
    return [...desktopDecks, ...browserDecks, ...serverDecks.filter((d) => !seen.has(d.id))].sort((a, b) =>
      a.modified < b.modified ? 1 : -1,
    );
  },

  getDeck: async (deckId: string): Promise<DeckBundle> => {
    const store = await deckStoreOf(deckId);
    if (store === "desktop") {
      const b = await desktop.getBundle(deckId);
      if (b) return b;
    } else if (store === "browser") {
      const b = await local.getBundle(deckId);
      if (b) return b;
    }
    const res = await fetch(`/api/decks/${deckId}`);
    return j<DeckBundle>(res);
  },

  /** where does this deck live? (used by UI chips + routing) */
  storeOf: async (deckId: string): Promise<DeckStore> => {
    return deckStoreOf(deckId);
  },

  /* ---------------- create / delete ---------------- */

  /** duplicate a deck from ANY other store into the desktop store (assets
   *  are fetched and re-uploaded through the loopback server) */
  duplicateIntoDesktop: async (sourceId: string, title: string): Promise<{ deck: DeckJson; deckId: string }> => {
    const b = await api.getDeck(sourceId);
    const assetRows = await api.listAssets(sourceId);
    const assetPaths = new Set(assetRows.map((a) => a.path));
    const files: Record<string, string> = {};
    for (const f of b.files) {
      if (assetPaths.has(f.path)) continue;
      try {
        files[f.path] = await api.readFile(sourceId, f.path);
      } catch {
        /* skip unreadable */
      }
    }
    if (!files["deck.json"]) throw new Error("Source deck could not be read");
    const { deck, deckId } = await desktop.createDeck(title, files);
    for (const a of assetRows) {
      try {
        const url = await api.assetUrl(sourceId, a.path);
        const res = await fetch(url);
        if (res.ok) await desktop.putAssetBytes(deckId, a.path, await res.blob());
      } catch {
        /* best effort — a missing asset shouldn't fail the copy */
      }
    }
    return { deck, deckId };
  },

  createDeck: async (
    title: string,
    opts: { duplicateOf?: string; store?: DeckStore } = {},
  ): Promise<DeckJson> => {
    const store = opts.store ?? (await defaultStore());
    if (store === "desktop") {
      if (opts.duplicateOf) {
        const srcStore = await deckStoreOf(opts.duplicateOf);
        if (srcStore === "desktop") {
          return (await desktop.duplicateDeck(opts.duplicateOf, title)).deck;
        }
        return (await api.duplicateIntoDesktop(opts.duplicateOf, title)).deck;
      }
      return (await desktop.createStarterDeck(title)).deck;
    }
    if (store === "browser") {
      if (opts.duplicateOf) {
        if ((await deckStoreOf(opts.duplicateOf)) === "browser") {
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
    const store = await deckStoreOf(deckId);
    if (store === "desktop") {
      // Java removes the files and verifies they are gone — a locked or
      // missing folder surfaces as a clear code+message error
      const status = await desktop.desktopFsStatus();
      const root = status.path || "the desktop decks folder";
      await desktop.deleteDeck(deckId);
      return { ok: true, removed: true, external: false, root };
    }
    if (store === "browser") {
      const rec = await local.getRecord(deckId);
      let root = "this browser";
      if (rec?.device) {
        // deleting a device deck must also remove its FILES — that needs the
        // folder's write permission. Try to restore it while the confirm
        // click's gesture is live; if it can't be restored, NOTHING is
        // deleted (neither files nor the browser copy) and the reason is
        // returned so the UI can offer "Allow access" and finish the delete.
        const { cleanupDeviceProject, deviceFolderName } = await import("./device");
        root = (await deviceFolderName(deckId)) ?? deckId;
        const state = await ensureWriteAccess(deckId);
        if (state !== "granted") {
          return {
            ok: false,
            removed: false,
            external: false,
            root,
            needsAccess: true,
            accessState: state === "missing" ? "missing" : state,
          };
        }
        const cleanup = await cleanupDeviceProject(deckId);
        await local.deleteDeck(deckId);
        return { ok: true, removed: true, external: false, root, folderCleanupError: cleanup.error };
      }
      await local.deleteDeck(deckId);
      return { ok: true, removed: true, external: false, root };
    }
    const res = await fetch(`/api/decks/${deckId}`, { method: "DELETE" });
    return j<DeleteDeckResult>(res);
  },

  /* ---------------- files ---------------- */

  readFile: async (deckId: string, path: string): Promise<string> => {
    const store = await deckStoreOf(deckId);
    if (store === "desktop") return desktop.readFile(deckId, path);
    if (store === "browser") return local.readFile(deckId, path);
    const res = await fetch(`/api/decks/${deckId}/files?path=${encodeURIComponent(path)}`, { cache: "no-store" });
    const body = await j<{ content?: string }>(res);
    if (typeof body.content !== "string") throw new Error("Empty file response");
    return body.content;
  },

  saveFile: async (deckId: string, path: string, content: string): Promise<string> => {
    const store = await deckStoreOf(deckId);
    if (store === "desktop") return desktop.saveFile(deckId, path, content);
    if (store === "browser") {
      maybeRequestWriteAccess(deckId);
      return local.saveFile(deckId, path, content);
    }
    const res = await fetch(`/api/decks/${deckId}/files`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, content }),
    });
    return (await j<{ signature: string }>(res)).signature;
  },

  /** batch save — the editor's save queue writes all dirty buffers in one
   *  call (one record mutation for browser/desktop decks, sequential atomic
   *  PUTs for server decks). Returns the deck's new signature. */
  saveFiles: async (deckId: string, entries: Array<{ path: string; content: string }>): Promise<string> => {
    if (!entries.length) return api.poll(deckId);
    const store = await deckStoreOf(deckId);
    if (store === "desktop") {
      // diff writes — only the files that actually changed touch the disk
      return desktop.saveFiles(deckId, entries);
    }
    if (store === "browser") {
      // gesture-gated: an explicit save (Ctrl+S / Save button) whose folder
      // permission lapsed shows the permission sheet NOW; autosave without
      // a gesture is a no-op here and simply keeps the folder mirror queued
      maybeRequestWriteAccess(deckId);
      return local.saveFiles(deckId, entries);
    }
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
    const store = await deckStoreOf(deckId);
    if (store === "desktop") return desktop.deleteFile(deckId, path);
    if (store === "browser") {
      maybeRequestWriteAccess(deckId);
      return local.deleteFile(deckId, path);
    }
    const res = await fetch(`/api/decks/${deckId}/files?path=${encodeURIComponent(path)}`, { method: "DELETE" });
    await j(res);
  },

  /* ---------------- slides ---------------- */

  addSlide: async (
    deckId: string,
    opts: { template?: string; label?: string; position?: number; code?: string },
  ): Promise<DeckJson> => {
    const store = await deckStoreOf(deckId);
    if (store === "desktop") return desktop.addSlide(deckId, opts);
    if (store === "browser") {
      maybeRequestWriteAccess(deckId);
      return local.addSlide(deckId, opts);
    }
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
    const store = await deckStoreOf(deckId);
    if (store === "desktop") return desktop.patchSlide(deckId, slideId, patch);
    if (store === "browser") {
      maybeRequestWriteAccess(deckId);
      return local.patchSlide(deckId, slideId, patch);
    }
    const res = await fetch(`/api/decks/${deckId}/slides/${slideId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    return (await j<{ deck: DeckJson }>(res)).deck;
  },

  deleteSlide: async (deckId: string, slideId: string): Promise<DeckJson> => {
    const store = await deckStoreOf(deckId);
    if (store === "desktop") return desktop.deleteSlide(deckId, slideId);
    if (store === "browser") {
      maybeRequestWriteAccess(deckId);
      return local.deleteSlide(deckId, slideId);
    }
    const res = await fetch(`/api/decks/${deckId}/slides/${slideId}`, { method: "DELETE" });
    return (await j<{ deck: DeckJson }>(res)).deck;
  },

  duplicateSlide: async (deckId: string, slideId: string): Promise<DeckJson> => {
    const store = await deckStoreOf(deckId);
    if (store === "desktop") return desktop.duplicateSlide(deckId, slideId);
    if (store === "browser") {
      maybeRequestWriteAccess(deckId);
      return local.duplicateSlide(deckId, slideId);
    }
    const res = await fetch(`/api/decks/${deckId}/slides/${slideId}/duplicate`, { method: "POST" });
    return (await j<{ deck: DeckJson }>(res)).deck;
  },

  reorder: async (deckId: string, order: string[]): Promise<DeckJson> => {
    const store = await deckStoreOf(deckId);
    if (store === "desktop") return desktop.reorderSlides(deckId, order);
    if (store === "browser") {
      maybeRequestWriteAccess(deckId);
      return local.reorderSlides(deckId, order);
    }
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
    const store = await deckStoreOf(deckId);
    if (store === "desktop") return desktop.patchDeck(deckId, patch);
    if (store === "browser") {
      maybeRequestWriteAccess(deckId);
      return local.patchDeck(deckId, patch);
    }
    const res = await fetch(`/api/decks/${deckId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    return (await j<{ deck: DeckJson }>(res)).deck;
  },

  /* ---------------- polling ---------------- */

  poll: async (deckId: string): Promise<string> => {
    const store = await deckStoreOf(deckId);
    if (store === "desktop") return desktop.poll(deckId);
    if (store === "browser") {
      const rec = await local.getRecord(deckId);
      return rec ? local.signatureOf(rec) : "";
    }
    const res = await fetch(`/api/decks/${deckId}/poll`, { cache: "no-store" });
    return (await j<{ signature?: string }>(res)).signature ?? "";
  },

  /* ---------------- assets + code files ---------------- */

  /** preview URL for a deck asset — store-aware (Problem 06): browser decks
   *  have no /api/assets route, so their IndexedDB blobs (or device-folder
   *  files) are served as object URLs; desktop decks get the loopback file
   *  URL from fs.fileUrl; server decks keep the /api/assets route (always
   *  percent-encoded — spaces, # and unicode all work). */
  assetUrl: async (deckId: string, path: string): Promise<string> => {
    const store = await deckStoreOf(deckId);
    if (store === "desktop") {
      const url = await desktop.getAssetUrl(deckId, path);
      if (url) return url;
      throw new Error(`Asset not found: ${path}`);
    }
    if (store === "browser") {
      const url = await local.getAssetUrl(deckId, path);
      if (url) return url;
    }
    return assetRouteUrl(deckId, path);
  },

  listAssets: async (deckId: string): Promise<FileRow[]> => {
    const store = await deckStoreOf(deckId);
    if (store === "desktop") return desktop.listAssets(deckId);
    if (store === "browser") return local.listAssets(deckId);
    const res = await fetch(`/api/decks/${deckId}/assets`, { cache: "no-store" });
    return (await j<{ assets?: FileRow[] }>(res)).assets ?? [];
  },

  uploadAssets: async (deckId: string, files: File[]): Promise<Array<{ path: string; display: string }>> => {
    const store = await deckStoreOf(deckId);
    if (store === "desktop") return desktop.uploadAssets(deckId, files);
    if (store === "browser") {
      maybeRequestWriteAccess(deckId);
      return local.uploadAssets(deckId, files);
    }
    const form = new FormData();
    for (const f of files) form.append("file", f);
    const res = await fetch(`/api/decks/${deckId}/assets`, { method: "POST", body: form });
    const rows = (await j<{ uploaded: Array<{ path: string }> }>(res)).uploaded;
    // server decks keep the original on-disk name — the display name is the file name
    return rows.map((r) => ({ path: r.path, display: r.path.replace("assets/", "") }));
  },

  listCodeFiles: async (deckId: string, dir: "overlay" | "bg"): Promise<FileRow[]> => {
    const store = await deckStoreOf(deckId);
    if (store === "desktop") return desktop.listCodeFiles(deckId, dir);
    if (store === "browser") return local.listCodeFiles(deckId, dir);
    const res = await fetch(`/api/decks/${deckId}/code-files?dir=${dir}`, { cache: "no-store" });
    return (await j<{ files?: FileRow[] }>(res)).files ?? [];
  },

  uploadCodeFile: async (deckId: string, dir: "overlay" | "bg", files: File[]): Promise<Array<{ path: string }>> => {
    const store = await deckStoreOf(deckId);
    if (store === "desktop") return desktop.uploadCodeFile(deckId, dir, files);
    if (store === "browser") {
      maybeRequestWriteAccess(deckId);
      return local.uploadCodeFile(deckId, dir, files);
    }
    const form = new FormData();
    for (const f of files) form.append("file", f);
    const res = await fetch(`/api/decks/${deckId}/code-files?dir=${dir}`, { method: "POST", body: form });
    return (await j<{ uploaded: Array<{ path: string }> }>(res)).uploaded;
  },

  deleteCodeFile: async (deckId: string, path: string): Promise<void> => {
    const store = await deckStoreOf(deckId);
    if (store === "desktop") return desktop.deleteCodeFile(deckId, path);
    if (store === "browser") {
      maybeRequestWriteAccess(deckId);
      return local.deleteCodeFile(deckId, path);
    }
    const res = await fetch(`/api/decks/${deckId}/code-files?path=${encodeURIComponent(path)}`, { method: "DELETE" });
    await j(res);
  },

  /* ---------------- snapshots ---------------- */

  listSnapshots: async (deckId: string): Promise<string[]> => {
    const store = await deckStoreOf(deckId);
    if (store === "desktop") return desktop.listSnapshots(deckId);
    if (store === "browser") return local.listSnapshots(deckId);
    const res = await fetch(`/api/decks/${deckId}/snapshots`, { cache: "no-store" });
    return (await j<{ snapshots?: string[] }>(res)).snapshots ?? [];
  },

  snapshot: async (deckId: string, tag: string): Promise<string> => {
    const store = await deckStoreOf(deckId);
    if (store === "desktop") return desktop.snapshotDeck(deckId, tag);
    if (store === "browser") return local.snapshotDeck(deckId, tag);
    const res = await fetch(`/api/decks/${deckId}/snapshots`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create", tag }),
    });
    return (await j<{ name: string }>(res)).name;
  },

  restoreSnapshot: async (deckId: string, name: string): Promise<void> => {
    const store = await deckStoreOf(deckId);
    if (store === "desktop") return desktop.restoreSnapshot(deckId, name);
    if (store === "browser") {
      maybeRequestWriteAccess(deckId);
      return local.restoreSnapshot(deckId, name);
    }
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
    if (store === "desktop") return transfer.importFileToDesktop(file);
    if (store === "browser") return transfer.importFileToBrowser(file);
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/import", { method: "POST", body: form });
    return (await j<{ report: ImportReport }>(res)).report;
  },

  importText: async (text: string, name: string, opts: { store?: DeckStore } = {}): Promise<ImportReport> => {
    const store = opts.store ?? (await defaultStore());
    if (store === "desktop") return transfer.importTextToDesktop(text, name);
    if (store === "browser") return transfer.importTextToBrowser(text, name);
    const res = await fetch("/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, name }),
    });
    return (await j<{ report: ImportReport }>(res)).report;
  },

  /** export a deck from any store as a downloadable object URL */
  exportDeck: async (deckId: string, format: "smdeck" | "deck.tsx"): Promise<{ url: string; filename: string }> => {
    let blob: Blob;
    let filename: string;
    const store = await deckStoreOf(deckId);
    if (store === "desktop") {
      const rec = await desktop.getRecord(deckId);
      if (!rec) throw new Error("Deck not found");
      // pull the binary assets through the loopback server for the zip
      const assets: Record<string, Blob> = {};
      for (const p of Object.keys(rec.assets)) {
        try {
          const url = await desktop.getAssetUrl(deckId, p);
          if (url) {
            const r = await fetch(url);
            if (r.ok) assets[p] = await r.blob();
          }
        } catch {
          /* skip unreachable asset */
        }
      }
      if (format === "deck.tsx") {
        const out = await transfer.exportDeck(
          { id: rec.id, title: rec.title, created: "", modified: rec.modified, files: rec.files, assets: {} },
          format,
        );
        blob = out.blob;
        filename = out.filename;
      } else {
        blob = await transfer.exportFilesAsZip(rec.files, assets, rec.title);
        filename = `${deckId}.smdeck`;
      }
    } else if (store === "browser") {
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
    // object URL hygiene (Task: memory): revoked after a generous window —
    // long enough that even a desktop Save-as dialog can't outlive it, short
    // enough that repeated exports never accumulate. Also flushed on unload.
    const url = URL.createObjectURL(blob);
    scheduleObjectUrlRevoke(url);
    return { url, filename };
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
