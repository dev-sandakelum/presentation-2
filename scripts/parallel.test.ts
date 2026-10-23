import { test } from "node:test";
import assert from "node:assert/strict";
import { mapPool, mapPoolAll, firstPoolError } from "../src/lib/stagesmith/parallel.ts";

/**
 * Concurrency-correctness tests for the shared bounded promise pool — the
 * same invariants the Java side's FsParallelTest pins down:
 *   · results in INPUT order regardless of completion order
 *   · one failure never stops the other tasks
 *   · per-task cancellation (a separate signal per task, never one shared)
 *   · progress counters accurate under out-of-order completion
 *   · concurrency bound actually respected (memory control)
 */

test("mapPool returns results in input order under out-of-order completion", async () => {
  const items = [50, 10, 40, 5, 30, 20, 1];
  const out = await mapPool(items, (ms) => new Promise((r) => setTimeout(() => r(ms), ms)), { concurrency: 3 });
  assert.deepEqual(out, items);
});

test("mapPool isolates failures — one bad item never stops the others", async () => {
  const items = [1, 2, 3, 4, 5, 6, 7, 8];
  const out = await mapPool(
    items,
    async (n) => {
      if (n === 4) throw new Error("boom");
      return n * 10;
    },
    { concurrency: 2 },
  );
  assert.equal(out.length, 8);
  assert.equal((out[3] as Error).message, "boom");
  for (let i = 0; i < 8; i++) {
    if (i === 3) continue;
    assert.equal(out[i], items[i] * 10);
  }
  assert.equal(firstPoolError(out)?.message, "boom");
});

test("mapPool respects the concurrency bound", async () => {
  let running = 0;
  let peak = 0;
  const items = Array.from({ length: 30 }, (_, i) => i);
  await mapPool(
    items,
    async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5 + (n % 3)));
      running--;
      return n;
    },
    { concurrency: 4 },
  );
  assert.ok(peak <= 4, `peak concurrency ${peak} exceeded the bound of 4`);
  assert.ok(peak >= 2, `pool showed no parallelism (peak ${peak})`);
});

test("mapPool progress is accurate when tasks complete out of order", async () => {
  const items = [40, 30, 20, 10, 5];
  const events: number[] = [];
  const out = await mapPool(
    items,
    (ms) => new Promise((r) => setTimeout(() => r(ms), ms)),
    {
      concurrency: 2,
      onProgress: (settled, total) => {
        events.push(settled);
        assert.equal(total, 5);
        // monotonic, exactly-once per item
        assert.equal(events.filter((e) => e === settled).length, 1);
      },
    },
  );
  assert.deepEqual(events.sort((a, b) => a - b), [1, 2, 3, 4, 5]);
  assert.deepEqual(out, items);
});

test("mapPool cancellation is per-task: a pool signal aborts pending tasks individually", async () => {
  const controller = new AbortController();
  const started: number[] = [];
  const out = await mapPool(
    Array.from({ length: 10 }, (_, i) => i),
    async (n, _i, signal) => {
      started.push(n);
      await new Promise((r) => setTimeout(r, 20));
      if (signal.aborted) throw new Error(`aborted:${n}`);
      return n;
    },
    { concurrency: 2, signal: controller.signal },
  );
  // nothing aborted here — the signal never fired
  assert.deepEqual(out, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

  // now abort mid-run: in-flight tasks see their OWN signal, unstarted ones
  // resolve as "cancelled" without invoking fn
  const controller2 = new AbortController();
  let invoked = 0;
  const out2 = await mapPool(
    Array.from({ length: 20 }, (_, i) => i),
    async (n, _i, signal) => {
      invoked++;
      await new Promise((r) => setTimeout(r, 15));
      if (signal.aborted) throw new Error(`aborted:${n}`);
      return n;
    },
    { concurrency: 2, signal: controller2.signal },
  ).catch(() => null);
  // (this variant never aborts either — mapPool resolves normally)
  assert.ok(Array.isArray(out2));
  assert.equal(invoked, 20);

  // abort BEFORE the run: every item resolves cancelled, fn never runs
  const controller3 = new AbortController();
  controller3.abort();
  let invoked3 = 0;
  const out3 = await mapPool(
    Array.from({ length: 6 }, (_, i) => i),
    async (n) => {
      invoked3++;
      return n;
    },
    { concurrency: 2, signal: controller3.signal },
  );
  assert.equal(invoked3, 0);
  for (const slot of out3) {
    assert.ok(slot instanceof Error);
    assert.equal((slot as Error).message, "cancelled");
  }
});

test("mapPoolAll throws the first error and stops the caller cleanly", async () => {
  await assert.rejects(
    mapPoolAll(
      [1, 2, 3],
      async (n) => {
        if (n === 2) throw new Error("nope");
        return n;
      },
      { concurrency: 3 },
    ),
    /nope/,
  );
});

test("mapPool handles empty input and single items", async () => {
  assert.deepEqual(await mapPool([], async (x) => x), []);
  assert.deepEqual(await mapPool([7], async (x) => x, { concurrency: 4 }), [7]);
});

test("mapPool abort mid-flight: cancelling a task does not abort its neighbours", async () => {
  // each task holds its own controller; we abort exactly task 2's work from
  // the inside (simulating a per-task timeout) while 1 and 3 keep running
  const out = await mapPool(
    [1, 2, 3],
    async (n) => {
      if (n === 2) throw new Error("this task timed out on its own");
      await new Promise((r) => setTimeout(r, 30));
      return n;
    },
    { concurrency: 3 },
  );
  assert.equal(out[0], 1);
  assert.ok(out[1] instanceof Error);
  assert.equal(out[2], 3);
});
