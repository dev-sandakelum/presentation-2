/**
 * dataurl.worker — converts a Blob to a data URL using FileReaderSync, which
 * only exists inside workers. Browser-stored decks ship their assets to the
 * sandboxed stage runtime as data URLs; converting every asset with the
 * main-thread FileReader used to be one of the biggest costs of opening a big
 * browser deck (26 slides × large PNGs → megabytes of base64 churn on the UI
 * thread). Here the conversion happens entirely off the main thread.
 *
 * Each conversion is a separate message — one blob per task, so a deck's
 * assets convert in parallel across the small worker pool and one bad blob
 * never stops the others.
 */

/** FileReaderSync exists only inside workers; typed locally because the app's
 *  tsconfig lib set does not include the WebWorker globals. */
interface SyncFileReader {
  readAsDataURL(blob: Blob): string;
}
declare const FileReaderSync: { new (): SyncFileReader };

self.onmessage = (ev: MessageEvent<{ id: number; blob: Blob }>) => {
  const { id, blob } = ev.data ?? {};
  if (typeof id !== "number" || !blob) return;
  try {
    const reader = new FileReaderSync();
    const url = reader.readAsDataURL(blob);
    (self as unknown as Worker).postMessage({ id, ok: true, url });
  } catch (e) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: (e as Error)?.message || String(e) });
  }
};
