/**
 * fetch-worker — the main-thread client for the JSON fetch worker.
 *
 * Moves fetch bookkeeping AND JSON parsing of large compile responses off the
 * main thread so the loading screen keeps animating while slide modules
 * stream in. Every in-flight request owns a separate cancel handle
 * (`cancelJsonFetch`), and the whole thing degrades to a plain `fetch` when
 * Workers are unavailable (SSR, ancient webviews) — callers cannot tell the
 * difference beyond the responsiveness.
 */

export interface JsonFetchResult<T> {
  ok: boolean;
  status: number;
  body: T | null;
  /** transport-level failure message (status 0) — mirrors a rejected fetch */
  error?: string;
}

interface Pending {
  resolve: (r: JsonFetchResult<unknown>) => void;
}

let worker: Worker | null = null;
let workerBroken = false;
let seq = 0;
const pending = new Map<number, Pending>();

function ensureWorker(): Worker | null {
  if (workerBroken) return null;
  if (worker) return worker;
  if (typeof window === "undefined" || typeof Worker === "undefined") return null;
  try {
    worker = new Worker(new URL("./json-fetch.worker.ts", import.meta.url));
    worker.onmessage = (ev: MessageEvent<{ id: number; ok: boolean; status: number; body: unknown; error?: string }>) => {
      const p = pending.get(ev.data?.id);
      if (!p) return;
      pending.delete(ev.data.id);
      p.resolve({ ok: ev.data.ok, status: ev.data.status, body: ev.data.body, error: ev.data.error });
    };
    worker.onerror = (e) => {
      // the worker failed to start / crashed — fail every pending request
      // over to the fallback and stop using it for the session
      console.error("[json-fetch] worker error:", (e as ErrorEvent).message || e);
      for (const p of pending.values()) p.resolve({ ok: false, status: 0, body: null, error: "worker crashed" });
      pending.clear();
      try { worker?.terminate(); } catch { /* already gone */ }
      worker = null;
      workerBroken = true;
    };
    return worker;
  } catch {
    workerBroken = true;
    return null;
  }
}

async function fetchJsonInline<T>(url: string, init?: RequestInit): Promise<JsonFetchResult<T>> {
  try {
    const res = await fetch(url, init);
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { ok: res.ok, status: res.status, body: body as T | null };
  } catch (e) {
    return { ok: false, status: 0, body: null, error: (e as Error)?.message || String(e) };
  }
}

/**
 * fetch + JSON.parse, off the main thread when possible.
 * Mirrors `fetch(url, init).then(r => r.json())` semantics: a non-2xx
 * response still resolves with `ok: false` and the parsed error body.
 *
 * The URL is ABSOLUTIZED against the document before posting: bundlers emit
 * the worker as a blob: URL in production builds, and a blob worker cannot
 * resolve RELATIVE URLs (its base is opaque) — `fetch("/api/x")` inside it
 * throws "Failed to parse URL". Sending an absolute URL sidesteps that.
 */
export function fetchJsonViaWorker<T>(url: string, init?: RequestInit): Promise<JsonFetchResult<T>> {
  const w = ensureWorker();
  if (!w) return fetchJsonInline<T>(url, init);
  const id = ++seq;
  const absolute = (() => {
    try {
      const base = typeof document !== "undefined" ? document.baseURI : (typeof location !== "undefined" ? location.href : undefined);
      return base ? new URL(url, base).href : url;
    } catch {
      return url;
    }
  })();
  return new Promise<JsonFetchResult<T>>((resolve) => {
    pending.set(id, { resolve: (r) => resolve(r as JsonFetchResult<T>) });
    try {
      w.postMessage({
        id,
        url: absolute,
        init: init
          ? { method: init.method, headers: init.headers as Record<string, string> | undefined, body: init.body as string | undefined }
          : undefined,
      });
    } catch (e) {
      pending.delete(id);
      resolve({ ok: false, status: 0, body: null, error: (e as Error)?.message || String(e) });
    }
  });
}

/** Cancels ONE in-flight worker fetch (its own signal — never a shared one). */
export function cancelJsonFetch(handle: number): void {
  if (!worker || !pending.has(handle)) return;
  try {
    worker.postMessage({ id: handle, cancel: true });
  } catch {
    /* worker gone — the onerror path already settled the request */
  }
}

/** Takes the next request handle (for callers that want cancel handles). */
export function nextJsonFetchHandle(): number {
  return seq + 1;
}
