import { performance } from "node:perf_hooks";
// @ts-expect-error — direct source import for the benchmark
import { deckFiles, deckSignature, listDecks } from "../src/lib/stagesmith/store.ts";
// @ts-expect-error — direct source import for the benchmark
import { getDeckBundle } from "../src/lib/stagesmith/bundle.ts";

/**
 * Server-side loading-path micro-benchmark (run from the repo root so
 * DECKS_ROOT resolves):
 *
 *   node --experimental-strip-types scripts/store-bench.ts
 *
 * Measures the /?deck= SSR bundle build, the folder walk, the signature and
 * the library listing on the real decks/ corpus (add a large deck with
 * scripts/make-large-deck.mjs first).
 */

const DECK = process.env.BENCH_DECK || "perf-large";
const RUNS = Number(process.env.BENCH_RUNS || 5);

function time(name, fn) {
  const samples = [];
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  const med = samples[Math.floor(samples.length / 2)];
  console.log(`${name.padEnd(38)} median ${Math.round(med)} ms   (min ${Math.round(samples[0])})`);
  return med;
}

async function timeAsync(name, fn) {
  const samples = [];
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    await fn();
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  const med = samples[Math.floor(samples.length / 2)];
  console.log(`${name.padEnd(38)} median ${Math.round(med)} ms   (min ${Math.round(samples[0])})`);
  return med;
}

console.log(`\n=== store micro-benchmark (deck=${DECK}, ${RUNS} runs, cwd=${process.cwd()}) ===`);
await timeAsync("getDeckBundle (SSR /?deck= build)", () => getDeckBundle(DECK));
await timeAsync("deckFiles (folder walk)", () => deckFiles(DECK));
await timeAsync("deckSignature (walk + hash)", () => deckSignature(DECK));
await timeAsync("listDecks (whole library)", () => listDecks());
