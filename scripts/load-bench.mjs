#!/usr/bin/env node
/**
 * Loading-path benchmark — measures the REAL app in a real Chromium.
 *
 * Scenarios (each run cold in a fresh context and warm in a reused context):
 *   1. LIBRARY  /                          → first paint of the deck list
 *   2. EDITOR   /?deck=<id>                → dashboard boot (SSR bundle + slide 1 compile)
 *   3. PRESENT  /?deck=<id>&present=1      → the whole-deck preload gate → reveal
 *
 * Metrics:
 *   · wall-clock per scenario (navigation start → app-ready signal)
 *   · the app's own performance marks (stagesmith:compile:*, stagesmith:pool:*)
 *   · main-thread LONG TASKS during Present load (>50 ms) — the loading
 *     screen must keep animating while work happens
 *
 * Run:    node scripts/load-bench.mjs
 * Env:    BENCH_BASE_URL (default http://localhost:3100), BENCH_DECK (default perf-large)
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

const BASE_URL = process.env.BENCH_BASE_URL || "http://localhost:3100";
const DECK = process.env.BENCH_DECK || "perf-large";
const RUNS = Number(process.env.BENCH_RUNS || 3);

// pick whichever chromium the machine actually has (playwright-core pins a
// version that may not match the browsers installed on this host)
const CHROME_CANDIDATES = [
  `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1200/chrome-headless-shell-linux64/chrome-headless-shell`,
  `${process.env.HOME}/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome`,
];
const EXECUTABLE = CHROME_CANDIDATES.find((p) => existsSync(p));

const results = { library: [], editor: [], present: [], presentLongTasks: [], presentMarks: {} };

function fmt(list) {
  if (!list.length) return "n/a";
  const sorted = [...list].sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)];
  const min = sorted[0];
  return `${Math.round(med)} ms (min ${Math.round(min)})`;
}

async function freshContext(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  return { context, page };
}

async function measureLibrary(browser) {
  const { context, page } = await freshContext(browser);
  const t0 = Date.now();
  await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
  // library home is server-rendered: wait for the deck cards to appear
  await page.waitForSelector("text=Parallel Loading Benchmark", { timeout: 60_000 });
  const ms = Date.now() - t0;
  await context.close();
  return ms;
}

async function measureEditor(browser) {
  const { context, page } = await freshContext(browser);
  const t0 = Date.now();
  await page.goto(`${BASE_URL}/?deck=${DECK}`, { waitUntil: "domcontentloaded" });
  // the editor boot gate: the preview pane's stage iframe appears and every
  // splash is hidden (the inline one stays in the DOM as display:none)
  await page.waitForSelector("iframe[src*='/runtime']", { timeout: 60_000 });
  await page
    .waitForFunction(
      () => [...document.querySelectorAll(".ss-splash")].every((el) => getComputedStyle(el).display === "none"),
      null,
      { timeout: 60_000 },
    )
    .catch(() => {});
  // plus: wait until the first slide module compiled (app perf measures exist)
  await page
    .waitForFunction(
      () => performance.getEntriesByType("measure").some((m) => m.name.startsWith("stagesmith:compile:")),
      null,
      { timeout: 60_000 },
    )
    .catch(() => {});
  const ms = Date.now() - t0;
  const marks = await page.evaluate(() =>
    performance.getEntriesByType("measure").filter((m) => m.name.startsWith("stagesmith:")).map((m) => ({ name: m.name, duration: Math.round(m.duration) })),
  );
  await context.close();
  return { ms, marks };
}

async function measurePresent(browser) {
  const { context, page } = await freshContext(browser);
  // count long tasks on the MAIN thread while Present loads — the loading
  // screen's animation must keep running while compilation streams in
  await page.addInitScript(() => {
    window.__longTasks = 0;
    try {
      new PerformanceObserver((list) => {
        window.__longTasks += list.getEntries().length;
      }).observe({ entryTypes: ["longtask"] });
    } catch { /* older browser */ }
  });
  const t0 = Date.now();
  await page.goto(`${BASE_URL}/?deck=${DECK}&present=1`, { waitUntil: "domcontentloaded" });
  // the present gate's veil shows the per-slide status line first (fast loads
  // may skip straight past it)
  await page.waitForSelector("text=Preparing slide", { timeout: 20_000 }).catch(() => {});
  // the reveal: the whole-deck preload gate settled. The PRE-HYDRATION splash
  // (#ss-splash) is kept in the DOM forever as display:none, so "revealed"
  // means every .ssplash is invisible (the veil unmounts, the inline hides).
  await page.waitForFunction(
    () => [...document.querySelectorAll(".ss-splash")].every((el) => getComputedStyle(el).display === "none"),
    null,
    { timeout: 120_000 },
  );
  const ms = Date.now() - t0;
  const longTasks = await page.evaluate(() => window.__longTasks ?? -1);
  const marks = await page.evaluate(() =>
    performance.getEntriesByType("measure")
      .filter((m) => m.name.startsWith("stagesmith:"))
      .reduce((acc, m) => {
        const key = m.name.split(":").slice(0, 2).join(":");
        acc[key] = acc[key] || { count: 0, total: 0 };
        acc[key].count++;
        acc[key].total += m.duration;
        return acc;
      }, {}),
  );
  await context.close();
  return { ms, longTasks, marks };
}

const browser = await chromium.launch({ headless: true, ...(EXECUTABLE ? { executablePath: EXECUTABLE } : {}) });
try {
  // ── cold runs (fresh context each time = cold HTTP cache) ──
  for (let i = 0; i < RUNS; i++) results.library.push(await measureLibrary(browser));
  for (let i = 0; i < RUNS; i++) {
    const { ms, marks } = await measureEditor(browser);
    results.editor.push(ms);
    if (i === 0) results.presentMarks.editor = marks;
  }
  for (let i = 0; i < RUNS; i++) {
    const { ms, longTasks, marks } = await measurePresent(browser);
    results.present.push(ms);
    results.presentLongTasks.push(longTasks);
    if (i === 0) results.presentMarks.present = marks;
  }

  console.log(`\n=== Load benchmark (${BASE_URL}, deck=${DECK}, ${RUNS} cold runs each) ===`);
  console.log(`library  first card visible : ${fmt(results.library)}`);
  console.log(`editor   boot + slide 1     : ${fmt(results.editor)}`);
  console.log(`present  whole-deck reveal  : ${fmt(results.present)}`);
  console.log(`present  main-thread long tasks (>50ms): ${results.presentLongTasks.join(", ")}`);
  console.log(`perf marks (first run):`, JSON.stringify(results.presentMarks, null, 1));
} finally {
  await browser.close();
}
