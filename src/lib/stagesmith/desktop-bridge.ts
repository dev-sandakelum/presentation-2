"use client";

/**
 * Desktop bridge — the JavaScript ↔ Java transport used when the studio runs
 * inside the Chassé Studio desktop app (a JCEF/Chromium webview).
 *
 * Detection: the app injects `window.cefQuery` via JCEF's CefMessageRouter.
 * Requests are one-shot (`persistent: false`) JSON strings of
 * `{id, action, payload}`; the Java side answers on success with a JSON
 * string `{id, ok: true, data}` or `{id, ok: false, error}`.
 *
 * Java → web pushes arrive as
 * `window.__chasseDesktop && window.__chasseDesktop._handleEvent(<json>)`
 * where <json> is a DesktopBridgeEvent — this module installs that hook
 * lazily on first use (guarded, SSR-safe, no-op in a normal browser).
 *
 * Protocol: see "DESIGN CONTRACT — DESKTOP BRIDGE PROTOCOL v1" (worklog).
 * Everything here must stay byte-compatible with the Java implementation.
 */

/* ------------------------------------------------------------------ */
/* Types (protocol shapes — must match the Java side exactly)          */
/* ------------------------------------------------------------------ */

/** Snapshot of the embedded LAN sync server (action `getServerStatus`,
 *  event `server-status`). `error` is only set when status === "error".
 *  `display` (friendly adapter name) and `virtual` (looks like a VM/VPN/
 *  Docker/WSL adapter — usually can't reach a phone) are optional extras. */
export interface DesktopServerStatus {
  status: "stopped" | "starting" | "running" | "error";
  port: number;
  addresses: Array<{ address: string; iface: string; display?: string; virtual?: boolean }>;
  selectedAddress: string | null;
  error: string | null;
}

/**
 * Room state — structurally identical to useSync's SyncState (kept as a
 * separate definition on purpose: the bridge lib must not import from the
 * React hook, and structural typing keeps the two compatible).
 */
export interface SyncState {
  deckId: string;
  slideId: string | null;
  index: number;
  step: number;
  steps: number;
  order: Array<{ id: string; label: string }>;
  updatedAt: number;
}

/** getBridgeInfo result — `trusted` is true only for the configured app URL */
export interface DesktopBridgeInfo {
  trusted: boolean;
  version: string;
  platform: string;
  appUrl: string;
}

/** Events pushed by the Java side through __chasseDesktop._handleEvent */
export type DesktopBridgeEvent =
  | ({ type: "server-status" } & DesktopServerStatus)
  | { type: "server-log"; ts: number; level: "info" | "warn" | "error"; text: string }
  | { type: "sync-state"; deckId: string; state: SyncState }
  | { type: "sync-presence"; deckId: string; remotes: number }
  | { type: "sync-token"; deckId: string; token: string }
  /** Native download pipeline (desktop ≥1.3.0): every stage of a download
   *  the user started from the page (exports, .smdeck, .deck.tsx…). */
  | {
      type: "download";
      stage: "started" | "saving" | "progress" | "completed" | "failed";
      id: number;
      fileName: string;
      path?: string;
      error?: string;
      percent?: number;
      receivedBytes?: number;
      totalBytes?: number;
    };

/* ------------------------------------------------------------------ */
/* Singleton state                                                     */
/* ------------------------------------------------------------------ */

type EventHandler = (e: DesktopBridgeEvent) => void;

const subscribers = new Set<EventHandler>();
let callSeq = 0;
/** cached getBridgeInfo — info never changes for a page lifetime; failures stay uncached */
let infoPromise: Promise<DesktopBridgeInfo | null> | null = null;

/** synchronous bridge presence check (cheap gate; trust is confirmed async) */
export function hasCefQuery(): boolean {
  return typeof window !== "undefined" && typeof (window as any).cefQuery === "function";
}

/** alias kept for readability at call sites */
export function isDesktopBridgeAvailable(): boolean {
  return hasCefQuery();
}

/**
 * Install the event hook the Java side calls. Lazy (first use), guarded
 * against double-install, and inert in normal browsers / during SSR.
 *
 * The Java side passes ONE argument: a JSON STRING (per protocol v1.1 —
 * PROBLEM 09: older builds passed a raw object literal, so the handler
 * accepts both and never lets a shape mismatch drop events silently again).
 */
function ensureBridge(): void {
  if (typeof window === "undefined") return;
  const w = window as any;
  if (w.__chasseDesktop) return;
  w.__chasseDesktop = {
    _handleEvent: (json: unknown) => {
      let ev: DesktopBridgeEvent | null = null;
      try {
        ev = (typeof json === "string" ? JSON.parse(json) : json) as DesktopBridgeEvent | null;
      } catch {
        return; // malformed push — ignore silently
      }
      if (!ev || typeof ev !== "object" || typeof ev.type !== "string") return;
      for (const fn of subscribers) {
        try {
          fn(ev);
        } catch {
          /* one broken subscriber must not break the others */
        }
      }
    },
  };
}

/** Subscribe to bridge events. Returns an unsubscribe function. */
export function subscribe(fn: EventHandler): () => void {
  ensureBridge();
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

/**
 * Call a bridge action. Resolves with `.data` on `{ok:true}`, rejects with
 * `new Error(.error)` otherwise (including onFailure and a missing bridge).
 */
export function call<T = any>(action: string, payload?: object): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (typeof window === "undefined" || typeof (window as any).cefQuery !== "function") {
      reject(new Error("Desktop bridge unavailable"));
      return;
    }
    ensureBridge();
    const id = `ss-${Date.now().toString(36)}-${(++callSeq).toString(36)}`;
    const request = JSON.stringify({ id, action, payload: payload ?? {} });
    try {
      (window as any).cefQuery({
        request,
        persistent: false,
        onSuccess: (response: string) => {
          try {
            const body = JSON.parse(response) as { ok?: boolean; data?: T; error?: string };
            if (body && body.ok) {
              resolve((body.data ?? null) as T);
            } else {
              reject(new Error(body?.error || "Bridge call failed"));
            }
          } catch {
            reject(new Error("Malformed bridge response"));
          }
        },
        onFailure: (errorCode: number, errorMessage: string) => {
          reject(new Error(errorMessage || `Bridge error ${errorCode}`));
        },
      });
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

/**
 * Trust handshake — null when there is no bridge (normal browser) or when
 * the call fails (bridge died; not cached so a later call can retry).
 * Successful results are cached for the page lifetime.
 */
export function getBridgeInfo(): Promise<DesktopBridgeInfo | null> {
  if (!hasCefQuery()) return Promise.resolve(null);
  if (!infoPromise) {
    infoPromise = call<DesktopBridgeInfo>("getBridgeInfo")
      .then((info) => (info && typeof info === "object" && typeof info.trusted === "boolean" ? info : null))
      .catch(() => {
        infoPromise = null; // failure is not cached — allow a retry later
        return null;
      });
  }
  return infoPromise;
}
