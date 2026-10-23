/**
 * dataurl-worker — main-thread client for the blob → data-URL conversion
 * workers. A SMALL pool (2 workers) converts a deck's assets in parallel,
 * entirely off the main thread, with a main-thread FileReader fallback when
 * Workers are unavailable. The pool is deliberately tiny: the output is a
 * multi-megabyte string per large asset, and bounding the conversions keeps
 * peak memory under control (only N giant base64 strings exist at once).
 */

import { mapPool, type PoolSlot } from "./parallel";

interface Pending {
  resolve: (url: string) => void;
  reject: (e: Error) => void;
}

const POOL_SIZE = 2;
let workers: Worker[] | null = null;
let workersBroken = false;
let seq = 0;
let nextWorker = 0;
const pending = new Map<number, Pending>();

function ensureWorkers(): Worker[] | null {
  if (workersBroken) return null;
  if (workers) return workers;
  if (typeof window === "undefined" || typeof Worker === "undefined") return null;
  try {
    workers = Array.from({ length: POOL_SIZE }, () => {
      const w = new Worker(new URL("./dataurl.worker.ts", import.meta.url));
      w.onmessage = (ev: MessageEvent<{ id: number; ok: boolean; url?: string; error?: string }>) => {
        const p = pending.get(ev.data?.id);
        if (!p) return;
        pending.delete(ev.data.id);
        if (ev.data.ok && typeof ev.data.url === "string") p.resolve(ev.data.url);
        else p.reject(new Error(ev.data?.error || "conversion failed"));
      };
      return w;
    });
    return workers;
  } catch {
    workersBroken = true;
    return null;
  }
}

function blobToDataUrlInWorker(blob: Blob): Promise<string> {
  const pool = ensureWorkers();
  if (!pool) return Promise.reject(new Error("no-worker"));
  const id = ++seq;
  return new Promise<string>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    const w = pool[nextWorker++ % pool.length];
    try {
      w.postMessage({ id, blob });
    } catch (e) {
      pending.delete(id);
      reject(e as Error);
    }
  });
}

/**
 * Converts many blobs to data URLs with bounded, off-main-thread
 * parallelism. Results come back in input order; a failed conversion is an
 * Error slot (callers decide whether to skip it). Falls back to converting
 * on the main thread (still bounded) when workers are unavailable.
 */
export function blobsToDataUrls(blobs: readonly Blob[], label?: string): Promise<PoolSlot<string>[]> {
  return mapPool(
    blobs,
    (blob) => blobToDataUrlInWorker(blob).catch((e) => {
      if (workersBroken || (e as Error)?.message === "no-worker") {
        // main-thread fallback (FileReader) — still bounded by the pool
        return new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error("conversion failed"));
          reader.readAsDataURL(blob);
        });
      }
      throw e;
    }),
    { concurrency: POOL_SIZE, label },
  );
}
