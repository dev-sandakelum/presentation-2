/**
 * json-fetch.worker — fetches a URL and parses the JSON body OFF the main
 * thread. Used for /api/compile responses: a compiled slide module can be
 * hundreds of kilobytes, and JSON.parse of 26 of them during Present-mode
 * preparation is real main-thread work (the loading screen's animation and
 * status updates must keep running while compilation streams in).
 *
 * Each request has its OWN AbortController (a separate cancel signal per
 * task — cancelling one compile never aborts another). The worker is
 * single-threaded by nature, but fetches are async, so many compile requests
 * run concurrently inside it; only the (now off-main-thread) JSON.parse is
 * serialized, which is exactly the cost we want out of the UI thread.
 */

interface WorkerRequest {
  id: number;
  url: string;
  init?: { method?: string; headers?: Record<string, string>; body?: string };
  cancel?: boolean;
}

interface WorkerResponse {
  id: number;
  ok: boolean;
  status: number;
  body: unknown;
  error?: string;
}

const controllers = new Map<number, AbortController>();

// uncaught errors inside the worker surface here — log them so a broken
// worker is diagnosable from the page console instead of failing silently
self.addEventListener("error", (e) => {
  console.error("[json-fetch-worker] uncaught:", (e as ErrorEvent).message || e);
});
self.addEventListener("unhandledrejection", (e) => {
  console.error("[json-fetch-worker] unhandled rejection:", String((e as PromiseRejectionEvent).reason));
});

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const data = ev.data;
  if (!data || typeof data.id !== "number") return;

  if (data.cancel) {
    controllers.get(data.id)?.abort();
    controllers.delete(data.id);
    return;
  }

  const controller = new AbortController();
  controllers.set(data.id, controller);
  try {
    const res = await fetch(data.url, { ...data.init, signal: controller.signal });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    const out: WorkerResponse = { id: data.id, ok: res.ok, status: res.status, body };
    (self as unknown as Worker).postMessage(out);
  } catch (e) {
    const out: WorkerResponse = {
      id: data.id,
      ok: false,
      status: 0,
      body: null,
      error: (e as Error)?.message || String(e),
    };
    (self as unknown as Worker).postMessage(out);
  } finally {
    controllers.delete(data.id);
  }
};
