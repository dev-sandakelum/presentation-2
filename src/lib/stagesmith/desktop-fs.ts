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
 * fs.fileUrl {deck, path} → {url} — the loopback-only URL
 * (http://127.0.0.1:<port>/<token>/…). Safe for `<img src>`, CSS `url()` and
 * fetch() from the app origin; uploads PUT to the same URL.
 */
export async function fsFileUrl(deck: string, path: string): Promise<string> {
  const r = await cmd<{ url?: string }>("fs.fileUrl", { deck, path });
  if (typeof r?.url !== "string" || !r.url.startsWith("http://127.0.0.1:")) {
    throw new DesktopFsError("IO_ERROR", "fileUrl returned an unexpected URL");
  }
  return r.url;
}

/** Upload bytes to a deck path through the loopback server (PUT). */
export async function fsUploadFile(
  deck: string,
  path: string,
  data: Blob | ArrayBuffer | string,
  type?: string,
): Promise<{ ok: boolean; size: number }> {
  const url = await fsFileUrl(deck, path);
  const res = await fetch(url, {
    method: "PUT",
    headers: type ? { "Content-Type": type } : undefined,
    body: data,
  });
  if (!res.ok) {
    let code = "IO_ERROR";
    let message = `Upload failed (${res.status})`;
    try {
      const body = (await res.json()) as { code?: string; message?: string };
      if (body?.code) code = body.code;
      if (body?.message) message = body.message;
    } catch {
      /* keep the default */
    }
    throw new DesktopFsError(code, message);
  }
  return res.json().catch(() => ({ ok: true, size: 0 }));
}
