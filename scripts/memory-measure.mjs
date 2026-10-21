#!/usr/bin/env node
/**
 * Memory/stability measurement (Task 4): opens a 26-slide deck, returns to the
 * library, repeats — sampling the JS heap and the module-cache size at each
 * step. A leak shows up as monotonic growth across cycles.
 *
 * Run with the dev server up:  node scripts/memory-measure.mjs
 */
import { chromium } from "playwright-core";

const BASE_URL = process.env.E2E_BASE_URL || "http://localhost:3100";
const CHROME = process.env.CHROME_BIN ||
  process.env.HOME + "/.cache/ms-playwright/chromium_headless_shell-1200/chrome-headless-shell-linux64/chrome-headless-shell";
const CYCLES = Number(process.env.CYCLES || 6);

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox", "--disable-gpu"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
// CDP metrics: performance.memory only refreshes on GC; Performance.getMetrics is exact
const cdp = await page.context().newCDPSession(page);
await cdp.send("Performance.enable");

async function heap() {
  const m = await cdp.send("Performance.getMetrics");
  const used = m.metrics.find((x) => x.name === "JSHeapUsedSize")?.value ?? -1;
  const nodes = m.metrics.find((x) => x.name === "Nodes")?.value ?? -1;
  const listeners = m.metrics.find((x) => x.name === "JSEventListeners")?.value ?? -1;
  return { used, nodes, listeners };
}

const samples = [];
for (let i = 0; i < CYCLES; i++) {
  // open the dashboard
  await page.goto(`${BASE_URL}/?deck=perf-test-26`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".cm-content", { timeout: 20000 });
  await page.waitForTimeout(2500); // let thumbnails + modules settle
  const dash = { ...(await heap()), thumbs: await page.evaluate(() => document.querySelectorAll("iframe").length) };
  // present mode (heaviest: preload window + one live frame)
  if (i === 0) {
    await page.goto(`${BASE_URL}/?deck=perf-test-26&present=1`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(6000);
    const present = await heap();
    samples.push({ cycle: i, view: "present", ...present });
  }
  // back to the library (unmounts the dashboard)
  await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const lib = await heap();
  samples.push({ cycle: i, view: "dashboard", ...dash });
  samples.push({ cycle: i, view: "library-after", ...lib });
}

await browser.close();

console.log("\ncycle,view,usedMB,domNodes,eventListeners,thumbs");
for (const s of samples) {
  console.log(`${s.cycle},${s.view},${(s.used / 1048576).toFixed(1)},${s.nodes},${s.listeners},${s.thumbs ?? ""}`);
}

// growth analysis (last dashboard vs first dashboard)
const dashs = samples.filter((s) => s.view === "dashboard");
if (dashs.length >= 2) {
  const first = dashs[0].used / 1048576;
  const last = dashs[dashs.length - 1].used / 1048576;
  console.log(`\ndashboard heap: first ${first.toFixed(1)} MB → last ${last.toFixed(1)} MB (Δ ${(last - first).toFixed(1)} MB over ${dashs.length} open/close cycles)`);
}
const libs = samples.filter((s) => s.view === "library-after");
if (libs.length >= 2) {
  const first = libs[0].used / 1048576;
  const last = libs[libs.length - 1].used / 1048576;
  console.log(`library heap: first ${first.toFixed(1)} MB → last ${last.toFixed(1)} MB (Δ ${(last - first).toFixed(1)} MB)`);
}
