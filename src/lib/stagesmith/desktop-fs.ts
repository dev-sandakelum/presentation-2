"use client";

/**
 * Desktop fs bridge client — the JavaScript side of the "fs" capability
 * (Desktop Bridge Protocol v2, identical contract in chasse-desktop).
 *
 * Wire format: `{cmd, ...params}` JSON strings over the SAME
 * `window.cefQuery` CefMessageRouter channel the sync actions use. Responses
 * are the raw contract shapes (`fs.listDecks` answers the ARRAY itself,
 * `fs.getRoot` answers `{configured, path, valid}`), and every failure is
 * `{code, message}` with the contract's error codes — thrown here as
 * {@link DesktopFsError} so callers can branch on `err.code`.
 *
 * Older desktop releases (no hello → no "fs" capability) make every call
 * here refuse with `unavailable`, and the app falls back to browser storage.
 */

import { hasCefQuery } from "./desktop-bridge";

/* ------------------------------------------------------------------ */
/* types (protocol shapes — must match the Java side exactly)          */
/* ------------------------------------------------------------------ */

/** contract error codes + protocol-level extensions */
export type DesktopFsErrorCode =
  | "FOLDER_NOT_SET"
  | "FOLDER_MISSING"
  | "NO_OS_PERMISSION"
  | "NOT_FOUND"
  | "TOO_LARGE"
  | "IO_ERROR"
  | "ALREADY_EXISTS"
  | "BAD_REQUEST"
  | "BUSY"
  | "CANCELLED"
  | "FORBIDDEN"
  | "UNKNOWN_CMD";

/** Error with the contract's machine-readable code attached. */
export class DesktopFsError extends Error {
  readonly code: DesktopFsErrorCode | string;

  constructor(code: DesktopFsErrorCode | string, message: string) {
    super(message || code);
    this.name = "DesktopFsError";
    this.code = code;
  }
}

/** `{cmd:"hello"}` → `{app, version, capabilities}` */
export interface DesktopHello {
  app: string;
  version: string;
  capabilities: string[];
}

/** fs.getRoot result / fs.chooseRoot success result */
export interface DesktopRootInfo {
  configured: boolean;
  path: string;
  valid: boolean;
}

/** optional fs.chooseRoot params — the in-app dialog's copy for the native chooser */
export interface DesktopChooseRootOptions {
  /** the native chooser's dialog title */
  title?: string;
  /** open the chooser at this folder when it still exists (otherwise the
   *  desktop app falls back to the last used folder) */
  startPath?: string;
  /** one line of context shown inside the native chooser */
  hint?: string;
}

/** fs.chooseRoot cancel answer — a clean outcome, NOT an error */
export interface DesktopRootCancelled {
  cancelled: true;
}

/** fs.chooseRoot → {cancelled:true} | {configured, path, valid} */
export type DesktopChooseRootResult = DesktopRootInfo | DesktopRootCancelled;

/** narrows the cancel answer ({cancelled:true}) of a chooseRoot result */
export function isDesktopRootCancelled(r: DesktopChooseRootResult): r is DesktopRootCancelled {
  return (r as DesktopRootCancelled)?.cancelled === true;
}

/** one row of fs.listDecks */
export interface DesktopDeckInfo {
  id: string;
  title: string;
  folder: string;
  slides: number;
  modified: string;
}

/** one row of fs.listFiles */
export interface DesktopFileRow {
  name: string;
  size: number;
  modified: number;
  directory?: boolean;
}

/* ------------------------------------------------------------------ */
/* hello + capability gate                                             */
/* ------------------------------------------------------------------ */

let helloPromise: Promise<DesktopHello | null> | null = null;
const pendingFsCalls = new Map<string, { startedAt: number }>();
const FS_TIMEOUT_MS = 10_000;

/**
 * The hello handshake — null when there is no bridge (normal browser) or the
 * bridge is older than the fs capability. Successful results are cached for
 * the page lifetime (capabilities never change mid-session).
 */
export function desktopHello(): Promise<DesktopHello | null> {
  if (!hasCefQuery()) return Promise.resolve(null);
  if (!helloPromise) {
    helloPromise = cmd<DesktopHello>("hello")
      .then((h) =>
        h && typeof h === "object" && h.app === "chasse-desktop" && Array.isArray(h.capabilities) ? h : null,
      )
      .catch(() => {
        helloPromise = null; // failure is not cached — allow a retry later
        return null;
      });
  }
  return helloPromise;
}

/**
 * True when the desktop app advertises the "fs" capability. Older releases
 * (or a normal browser) make the app fall back to browser storage.
 */
export async function desktopFsCapability(): Promise<boolean> {
  const hello = await desktopHello();
  return Boolean(hello?.capabilities.includes("fs"));
}

export async function desktopAssetUrlsCapability(): Promise<boolean> {
  const hello = await desktopHello();
  return Boolean(hello?.capabilities.includes("assetUrls"));
}

/** Virtual desktop asset URL support. */
export function virtualAssetUrl(deck: string, path: string): string {
  return `/__chasse_files__/${encodeURIComponent(deck)}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

export function compatibilityAssetBaseUrl(deck: string): string {
  return `/__chasse_files__/${encodeURIComponent(deck)}`;
}

/* ------------------------------------------------------------------ */
/* raw command transport                                               */
/* ------------------------------------------------------------------ */

function cmd<T = unknown>(name: string, params?: object): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (typeof window === "undefined" || typeof (window as any).cefQuery !== "function") {
      reject(new DesktopFsError("FORBIDDEN", "Desktop bridge unavailable"));
      return;
    }
    const id = `fs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    pendingFsCalls.set(id, { startedAt: Date.now() });
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pendingFsCalls.delete(id);
      fn();
    };
    let queryId: number | null = null;
    const timer = setTimeout(() => finish(() => {
      try {
        if (queryId !== null && typeof (window as any).cefQueryCancel === "function") (window as any).cefQueryCancel(queryId);
      } catch { /* timeout still settles even if native cancellation is unavailable */ }
      reject(new DesktopFsError("IO_ERROR", `Desktop ${name} timed out after ${FS_TIMEOUT_MS} ms`));
    }), FS_TIMEOUT_MS);
    const request = JSON.stringify({ cmd: name, ...(params ?? {}) });
    try {
      queryId = (window as any).cefQuery({
        request,
        persistent: false,
        onSuccess: (response: string) => {
          try {
            const body = JSON.parse(response) as Record<string, unknown>;
            // the contract's error shape — {code, message}
            if (
              body &&
              typeof body === "object" &&
              typeof body.code === "string" &&
              typeof body.message === "string" &&
              !("ok" in body)
            ) {
              finish(() => reject(new DesktopFsError(body.code as string, body.message as string)));
              return;
            }
            finish(() => resolve(body as T));
          } catch {
            finish(() => reject(new DesktopFsError("IO_ERROR", "Malformed bridge response")));
          }
        },
        onFailure: (errorCode: number, errorMessage: string) => {
          finish(() => reject(new DesktopFsError("IO_ERROR", errorMessage || `Bridge error ${errorCode}`)));
        },
      });
    } catch (e) {
      finish(() => reject(e instanceof Error ? e : new DesktopFsError("IO_ERROR", String(e))));
    }
  });
}

export function getPendingDesktopFsCalls(): Array<{ id: string; elapsedMs: number }> {
  const now = Date.now();
  return [...pendingFsCalls].map(([id, call]) => ({ id, elapsedMs: now - call.startedAt }));
}

/* ------------------------------------------------------------------ */
/* typed command wrappers (the fixed contract surface)                 */
/* ------------------------------------------------------------------ */

/** fs.getRoot → {configured, path, valid} */
export function fsGetRoot(): Promise<DesktopRootInfo> {
  return cmd<DesktopRootInfo>("fs.getRoot");
}

/**
 * fs.chooseRoot {title?, startPath?, hint?} → native folder dialog on the Java
 * side. Answers {cancelled:true} when the user closes or cancels the chooser
 * (not an error), or {configured, path, valid} after a successful pick.
 */
export function fsChooseRoot(
  options: DesktopChooseRootOptions = {},
): Promise<DesktopChooseRootResult> {
  return cmd<DesktopChooseRootResult>("fs.chooseRoot", options);
}

/** fs.listDecks → [{id, title, folder, slides, modified}] */
export function fsListDecks(): Promise<DesktopDeckInfo[]> {
  return cmd<DesktopDeckInfo[]>("fs.listDecks");
}

/** fs.readText {deck, path} → {text} */
export async function fsReadText(deck: string, path: string): Promise<string> {
  const r = await cmd<{ text?: string }>("fs.readText", { deck, path });
  if (typeof r?.text !== "string") throw new DesktopFsError("IO_ERROR", "readText returned no text");
  return r.text;
}

/** fs.writeText {deck, path, text} → {ok} (atomic write, only this file) */
export function fsWriteText(deck: string, path: string, text: string): Promise<{ ok: boolean }> {
  return cmd<{ ok: boolean }>("fs.writeText", { deck, path, text });
}

/** fs.createDeck {deck, files} → {ok, id} (deck.json written last) */
export function fsCreateDeck(deck: string, files: Record<string, string>): Promise<{ ok: boolean; id: string }> {
  return cmd<{ ok: boolean; id: string }>("fs.createDeck", { deck, files });
}

/** fs.deleteDeck {deck} → {ok} (success only after the folder is gone) */
export function fsDeleteDeck(deck: string): Promise<{ ok: boolean }> {
  return cmd<{ ok: boolean }>("fs.deleteDeck", { deck });
}

/** fs.removeDeck {id} → {ok, filesKept, path} — removes the deck from the
 *  library ONLY: the folder and every file in it stay on disk (tombstoned so
 *  the next scan doesn't re-adopt it). */
export function fsRemoveDeck(id: string): Promise<{ ok: boolean; filesKept: boolean; path: string }> {
  return cmd<{ ok: boolean; filesKept: boolean; path: string }>("fs.removeDeck", { id });
}

/** one candidate deck folder found inside a folder picked via fsChooseDeckFolder */
export interface DesktopDeckCandidate {
  token: string;
  title: string;
  folder: string;
  slides: number;
}

/** fs.chooseDeckFolder result — {cancelled} | {ok, added:[…]} |
 *  {needsConfirm, candidates} | {alreadyInLibrary} (Java opens a NATIVE
 *  folder chooser — this is how "Open folder…" works inside the desktop app). */
export type FsChooseDeckFolderResult =
  | { cancelled: true }
  | { ok: true; added: Array<{ id: string; title: string; folder: string; path: string; slides: number }> }
  | { needsConfirm: true; candidates: DesktopDeckCandidate[] }
  | { alreadyInLibrary: true };

/** fs.chooseDeckFolder {title?, startPath?} → native folder chooser */
export function fsChooseDeckFolder(options: { title?: string; startPath?: string } = {}): Promise<FsChooseDeckFolderResult> {
  return cmd<FsChooseDeckFolderResult>("fs.chooseDeckFolder", options);
}

/** fs.confirmAddDecks {tokens:[…]} → {ok, added:[…]} (short-lived tokens from
 *  a needsConfirm answer — valid 5 minutes) */
export function fsConfirmAddDecks(tokens: string[]): Promise<{ ok: boolean; added: Array<{ id: string; title: string; folder: string; path: string; slides: number }> }> {
  return cmd<{ ok: boolean; added: Array<{ id: string; title: string; folder: string; path: string; slides: number }> }>("fs.confirmAddDecks", { tokens });
}

/** fs.relinkDeck {id, title?, startPath?} → re-link an existing library id to a
 *  freshly picked folder (native chooser). */
export function fsRelinkDeck(id: string, options: { title?: string; startPath?: string } = {}): Promise<FsChooseDeckFolderResult> {
  return cmd<FsChooseDeckFolderResult>("fs.relinkDeck", { id, ...options });
}

/** fs.duplicateDeck {deck, copyId, title?} → {ok, id} */
export function fsDuplicateDeck(
  deck: string,
  copyId: string,
  title?: string,
): Promise<{ ok: boolean; id: string }> {
  return cmd<{ ok: boolean; id: string }>("fs.duplicateDeck", { deck, copyId, title });
}

/** fs.listFiles {deck, dir} → [{name, size, modified, directory?}] */
export function fsListFiles(deck: string, dir?: string): Promise<DesktopFileRow[]> {
  return cmd<DesktopFileRow[]>("fs.listFiles", { deck, dir: dir ?? "" });
}

/** fs.delete {deck, path} → {ok} */
export function fsDelete(deck: string, path: string): Promise<{ ok: boolean }> {
  return cmd<{ ok: boolean }>("fs.delete", { deck, path });
}

/**
 * Same-origin virtual asset URL. Older desktop builds fall back to a small
 * bridge read and object URL, with an explicit size limit.
 */
export async function fsAssetUrl(deck: string, path: string): Promise<string> {
  if (await desktopAssetUrlsCapability()) {
    return virtualAssetUrl(deck, path);
  }
  const key = `${deck}::${path}`;
  const cached = legacyAssetUrls.get(key);
  if (cached) return cached;
  let result: { base64?: string };
  try { result = await cmd<{ base64?: string }>("fs.readAssetBase64", { deck, path }); }
  catch (e) {
    const code = (e as DesktopFsError)?.code;
    if (code === "TOO_LARGE") throw new DesktopFsError("TOO_LARGE", "Update the desktop app to preview images larger than 8 MiB.");
    if (code === "UNKNOWN_CMD") {
      // Compatibility for older desktop builds: the bridge can mint its
      // legacy file URL. This is used only for the small-image blob fallback.
      const legacy = await cmd<{ url?: string }>("fs.fileUrl", { deck, path });
      if (!legacy.url) throw new DesktopFsError("IO_ERROR", `Could not read ${path}`);
      const response = await fetch(legacy.url);
      if (!response.ok) throw new DesktopFsError(response.status === 404 ? "NOT_FOUND" : "IO_ERROR", `Could not load ${path} (${response.status})`);
      const blob = await response.blob();
      if (blob.size > 8 * 1024 * 1024) throw new DesktopFsError("TOO_LARGE", "Update the desktop app to preview images larger than 8 MiB.");
      const blobUrl = URL.createObjectURL(blob);
      legacyAssetUrls.set(key, blobUrl);
      return blobUrl;
    }
    throw e;
  }
  if (!result?.base64 || typeof URL.createObjectURL !== "function") throw new DesktopFsError("IO_ERROR", `Could not read ${path}`);
  const binary = atob(result.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const type = mimeType(path);
  const blobUrl = URL.createObjectURL(new Blob([bytes], { type }));
  legacyAssetUrls.set(key, blobUrl);
  return blobUrl;
}

const legacyAssetUrls = new Map<string, string>();
function mimeType(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  return ({ png:"image/png", jpg:"image/jpeg", jpeg:"image/jpeg", webp:"image/webp", gif:"image/gif", svg:"image/svg+xml", avif:"image/avif" } as Record<string,string>)[ext ?? ""] ?? "application/octet-stream";
}

/** Stream writes to Java in bounded base64 chunks; no local HTTP server. */
export async function fsUploadFile(
  deck: string,
  path: string,
  data: Blob | ArrayBuffer | string,
  type?: string,
): Promise<{ ok: boolean; size: number }> {
  const blob = data instanceof Blob ? data : new Blob([data], type ? { type } : undefined);
  const { uploadId } = await cmd<{ uploadId: string }>("fs.beginAssetUpload", { deck, path });
  try {
    const chunkSize = 256 * 1024;
    for (let start = 0; start < blob.size; start += chunkSize) {
      const bytes = new Uint8Array(await blob.slice(start, start + chunkSize).arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      await cmd("fs.writeAssetChunk", { uploadId, base64: btoa(binary) });
    }
    const result = await cmd<{ ok: boolean; size: number }>("fs.finishAssetUpload", { uploadId });
    const old = legacyAssetUrls.get(`${deck}::${path}`); if (old) URL.revokeObjectURL(old);
    legacyAssetUrls.delete(`${deck}::${path}`);
    return result;
  } catch (error) {
    await cmd("fs.abortAssetUpload", { uploadId }).catch(() => {});
    throw error;
  }
}
