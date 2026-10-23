/**
 * Shared bounded-concurrency primitives for every loading path.
 *
 * Design contract (mirrors the desktop app's WorkerPools.parallelMap):
 *   · BOUNDED — at most `concurrency` items are in flight; more parallelism
 *     is not always faster (network, disk, antivirus and the CPU all have
 *     limits), so the pool is the single place to tune.
 *   · ORDER-SAFE — results come back in INPUT order no matter the completion
 *     order; callers apply them deterministically.
 *   · FAILURE-ISOLATED — one failing item never stops the others: the slot
 *     holds the Error instead of the value.
 *   · PER-TASK CANCELLATION — every item gets its OWN AbortController; a
 *     pool-level signal (the user left the deck) fans out to individual
 *     controllers instead of being one shared signal.
 *   · ACCURATE PROGRESS — `onProgress` fires exactly once per settled item,
 *     so counters stay correct when tasks finish out of order.
 *   · MEASURED — optional label wraps the run in performance marks.
 */

export interface MapPoolOptions {
  /** max items in flight (default: derived from hardware, capped) */
  concurrency?: number;
  /** pool-level abort (component unmounted / run superseded). Fans out to
   *  each task's OWN controller — never one shared signal. */
  signal?: AbortSignal;
  /** fires once per settled item, in settlement order (settled counts are
   *  accurate regardless of completion order) */
  onProgress?: (settled: number, total: number) => void;
  /** perf-mark label; also used for the diagnostic log line */
  label?: string;
}

/** A pool result slot: the value, or the Error that item failed with. */
export type PoolSlot<R> = R | Error;

function defaultConcurrency(): number {
  if (typeof navigator !== "undefined" && navigator.hardwareConcurrency) {
    return Math.max(2, Math.min(8, Math.floor(navigator.hardwareConcurrency / 2)));
  }
  return 4;
}

/**
 * Runs `fn` over `items` with bounded concurrency.
 *
 * Returns one slot per input item, in input order: the resolved value, or the
 * Error that item failed with (a failed item never poisons its neighbours).
 * Items whose per-task signal aborted before start resolve with an Error
 * ("cancelled") without invoking `fn`.
 */
export async function mapPool<T, R>(
  items: readonly T[],
  fn: (item: T, index: number, signal: AbortSignal) => Promise<R>,
  opts: MapPoolOptions = {},
): Promise<PoolSlot<R>[]> {
  const total = items.length;
  if (total === 0) return [];
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? defaultConcurrency(), total));
  const results: PoolSlot<R>[] = new Array(total);
  const controllers: AbortController[] = new Array(total);
  for (let i = 0; i < total; i++) controllers[i] = new AbortController();

  // pool-level abort fans out to every task's OWN controller
  const poolSignal = opts.signal;
  const onPoolAbort = () => {
    for (const c of controllers) c.abort();
  };
  if (poolSignal) {
    if (poolSignal.aborted) onPoolAbort();
    else poolSignal.addEventListener("abort", onPoolAbort, { once: true });
  }

  const startMark = opts.label ? `stagesmith:pool:${opts.label}:start` : null;
  if (startMark && typeof performance !== "undefined") performance.mark(startMark);

  let settled = 0;
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < total) {
      const index = cursor++;
      const signal = controllers[index].signal;
      if (signal.aborted) {
        // cancelled before it started — counts as settled (accurate progress)
        results[index] = new Error("cancelled");
        settled++;
        opts.onProgress?.(settled, total);
        continue;
      }
      try {
        results[index] = await fn(items[index], index, signal);
      } catch (error) {
        results[index] = error instanceof Error ? error : new Error(String(error));
      }
      settled++;
      opts.onProgress?.(settled, total);
    }
  };
  try {
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
  } finally {
    if (poolSignal) poolSignal.removeEventListener("abort", onPoolAbort);
    if (startMark && typeof performance !== "undefined") {
      const endMark = `stagesmith:pool:${opts.label}:end`;
      performance.mark(endMark);
      try {
        performance.measure(`stagesmith:pool:${opts.label}`, startMark, endMark);
      } catch {
        /* marks may be cleared during navigation */
      }
    }
  }
  return results;
}

/** convenience: mapPool that throws the FIRST error instead of slotting it */
export async function mapPoolAll<T, R>(
  items: readonly T[],
  fn: (item: T, index: number, signal: AbortSignal) => Promise<R>,
  opts: MapPoolOptions = {},
): Promise<R[]> {
  const slots = await mapPool(items, fn, opts);
  const firstError = slots.find((s): s is Error => s instanceof Error);
  if (firstError) throw firstError;
  return slots as R[];
}

/** first error in the slots, if any (for fail-fast callers) */
export function firstPoolError<R>(slots: readonly PoolSlot<R>[]): Error | null {
  const found = slots.find((s): s is Error => s instanceof Error);
  return found ?? null;
}
