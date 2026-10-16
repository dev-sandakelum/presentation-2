import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import type { Browser, Page } from "playwright-core";
import { deckExists, deckPath, deckRoot, readDeck, validDeckId } from "./store";
import { compileFile, compileUrlFor } from "./compile";
import type { DeckJson, SlideEntry, Source, ThemeMode } from "./types";

/**
 * Auto thumbnail system — static, low-quality stills of slides.
 *
 * The still is produced by the SAME runtime that powers the live preview
 * (public/runtime.html + /api/compile modules), rendered once in a shared
 * headless Chromium at the requested width, then cached on disk under
 * <deck>/.stagesmith/thumbs/<key>.webp. The key covers everything that can
 * change the pixels (slide + layer module versions, theme.css, mode, size,
 * layer mask), so invalidation is exact and regeneration is automatic.
 *
 * Card / filmstrip / overview thumbnails are these images — the ONLY live
 * stage is the dashboard preview (and the presenter itself).
 */

/* ------------------------------------------------------------------ */
/* headless browser singleton                                          */
/* ------------------------------------------------------------------ */

const CHROME_CANDIDATES = [
  process.env.SS_CHROME_PATH,
  path.join(
    process.env.HOME || "/home/z",
    ".cache/ms-playwright/chromium_headless_shell-1200/chrome-headless-shell-linux64/chrome-headless-shell",
  ),
  path.join(process.env.HOME || "/home/z", ".cache/ms-playwright/chromium-1200/chrome-linux64/chrome"),
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
].filter(Boolean) as string[];

async function findChrome(): Promise<string | null> {
  for (const c of CHROME_CANDIDATES) {
    try {
      const st = await fs.stat(c);
      if (st.isFile()) return c;
    } catch {
      /* next */
    }
  }
  return null;
}

let browserPromise: Promise<Browser | null> | null = null;

async function getBrowser(): Promise<Browser | null> {
  if (browserPromise) return browserPromise;
  browserPromise = (async () => {
    const exe = await findChrome();
    if (!exe) return null;
    const { chromium } = await import("playwright-core");
    return chromium.launch({
      executablePath: exe,
      args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--hide-scrollbars"],
    });
  })();
  try {
    const b = await browserPromise;
    if (!b) browserPromise = null;
    return b;
  } catch {
    browserPromise = null; // allow a later retry
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* render queue (bounded concurrency)                                  */
/* ------------------------------------------------------------------ */

const MAX_CONCURRENT = 3;
let active = 0;
const waiting: Array<() => void> = [];

async function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active++;
    return;
  }
  await new Promise<void>((resolve) => waiting.push(resolve));
  active++;
}

function release(): void {
  active = Math.max(0, active - 1);
  const next = waiting.shift();
  if (next) next();
}

/** in-flight renders by key — coalesces duplicate requests */
const inflight = new Map<string, Promise<Buffer | null>>();

/* ------------------------------------------------------------------ */
/* still description                                                   */
/* ------------------------------------------------------------------ */

export interface StillOptions {
  /** pixel width of the 16:9 still (default 480 — cards / filmstrip) */
  width?: number;
  /** theme mode (default: slide override ?? deck default) */
  mode?: ThemeMode;
  /**
   * full    → bg + content + effective overlay (cards, filmstrip, overview)
   * content → content + per-slide overlay ONLY, transparent background,
   *           no deck common overlay (presenter transition ghosts)
   */
  layers?: "full" | "content";
}

interface StillPlan {
  key: string;
  width: number;
  height: number;
  mode: ThemeMode;
  layers: "full" | "content";
  slideUrl: string | null;
  slideError: string | null;
  bgUrl: string | null;
  bgImage: object | null;
  overlayUrl: string | null;
  overlayImage: object | null;
  commonOverlayUrl: string | null;
  themeCss: string;
  slideLabel: string;
  slideIndex: number;
  slideTotal: number;
  placeholder: "error" | null;
}

/** rewrite ./… url() refs in theme.css to same-origin asset URLs (mirror of the deck route) */
export function rewriteThemeCss(css: string, deckId: string): string {
  return css.replace(/url\(\s*['"]?(\.\/|\.\.\/)([^'")]+)['"]?\s*\)/g, (_m, _prefix, rest) => {
    return `url('/api/assets/${deckId}/assets/${String(rest).replace(/^assets\//, "")}')`;
  });
}

async function fileHash(absPath: string): Promise<string> {
  try {
    const buf = await fs.readFile(absPath);
    return crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16);
  } catch {
    return "none";
  }
}

async function codeVer(deckId: string, source: Source | undefined | null): Promise<{ ver: string | null; url: string | null; error: string | null }> {
  if (!source || source.type !== "code" || !source.path) return { ver: null, url: null, error: null };
  try {
    const entry = await compileFile(deckId, source.path);
    if (entry.error) return { ver: null, url: null, error: null };
    return { ver: entry.ver, url: compileUrlFor(deckId, source.path, entry.ver), error: null };
  } catch {
    return { ver: null, url: null, error: null };
  }
}

function imageCfg(deckId: string, source: Source | undefined | null): object | null {
  if (!source || source.type !== "image") return null;
  return { url: `/api/assets/${deckId}/${source.path}`, ...source };
}

function thumbDir(deckId: string): string {
  return path.join(deckRoot(deckId), ".stagesmith", "thumbs");
}

/**
 * Resolve everything needed to render a slide still + its cache key.
 * slideId "cover" resolves to the deck's first slide.
 */
export async function planStill(deckId: string, slideId: string, opts: StillOptions = {}): Promise<StillPlan | null> {
  if (!validDeckId(deckId) || !(await deckExists(deckId))) return null;
  const deck: DeckJson = await readDeck(deckId);
  const idx = deck.slides.findIndex((s) => s.id === slideId);
  const index = idx >= 0 ? idx : slideId === "cover" ? 0 : -1;
  if (index < 0) return null;
  const slide: SlideEntry = deck.slides[index];

  const layers = opts.layers ?? "full";
  const mode: ThemeMode = opts.mode ?? slide.theme ?? deck.settings.defaultMode;
  const width = Math.max(160, Math.min(1920, Math.round(opts.width ?? 480)));
  const height = Math.round((width * 720) / 1280);

  // effective sources: slide override ?? deck common
  const bgSource = slide.bg !== undefined ? slide.bg : deck.bg;
  const overlaySource = slide.overlay !== undefined ? slide.overlay : deck.overlay;

  const slideRes = await (async () => {
    try {
      const entry = await compileFile(deckId, `slides/${slide.id}.tsx`);
      if (entry.error) return { url: null as string | null, ver: entry.ver, error: entry.error };
      return { url: compileUrlFor(deckId, `slides/${slide.id}.tsx`, entry.ver), ver: entry.ver, error: null as string | null };
    } catch (e) {
      return { url: null as string | null, ver: "err", error: (e as Error).message };
    }
  })();

  // content ghosts exclude the deck common overlay entirely
  const overlayTarget = layers === "content" ? (slide.overlay !== undefined ? slide.overlay : undefined) : overlaySource;
  const commonTarget = layers === "content" ? undefined : deck.overlay;

  const bg = await codeVer(deckId, bgSource);
  const ov = await codeVer(deckId, overlayTarget);
  const common = await codeVer(deckId, commonTarget);

  let themeCss = "";
  try {
    themeCss = rewriteThemeCss(await fs.readFile(deckPath(deckId, "theme.css"), "utf8"), deckId);
  } catch {
    themeCss = "";
  }
  const themeHash = await fileHash(deckPath(deckId, "theme.css"));
  const assetHash = await (async () => {
    // any image sources feeding this still (bg/overlay images change pixels)
    const parts: string[] = [];
    for (const s of [bgSource, overlayTarget]) {
      if (s && s.type === "image") parts.push(await fileHash(deckPath(deckId, s.path)));
    }
    return parts.length ? parts.join("+") : "none";
  })();

  const h = crypto.createHash("sha256");
  h.update([deckId, slide.id, slideRes.ver, bg.ver ?? "-", ov.ver ?? "-", common.ver ?? "-", themeHash, assetHash, mode, String(width), layers, "v1"].join("|"));
  const key = h.digest("hex").slice(0, 32);

  return {
    key,
    width,
    height,
    mode,
    layers,
    slideUrl: slideRes.url,
    slideError: slideRes.error,
    bgUrl: bg.url,
    bgImage: imageCfg(deckId, bgSource),
    overlayUrl: ov.url,
    overlayImage: imageCfg(deckId, overlayTarget),
    commonOverlayUrl: common.url,
    themeCss,
    slideLabel: slide.label,
    slideIndex: index,
    slideTotal: deck.slides.length,
    placeholder: slideRes.error ? "error" : null,
  };
}

/* ------------------------------------------------------------------ */
/* placeholder (no chromium / broken slide / cold-failure)             */
/* ------------------------------------------------------------------ */

export function placeholderSvg(plan: { width: number; height: number; slideLabel: string; slideIndex: number; kind?: "error" }): string {
  const { width: w, height: hgt } = plan;
  const err = plan.kind === "error";
  const stroke = err ? "rgba(255,140,140,.35)" : "rgba(148,180,255,.16)";
  const text = err ? "compile error" : String(plan.slideIndex + 1).padStart(2, "0");
  const fill = err ? "#ff9d9d" : "#8a94ac";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${hgt}" viewBox="0 0 ${w} ${hgt}">
  <rect width="${w}" height="${hgt}" fill="#070b16"/>
  <rect x=".5" y=".5" width="${w - 1}" height="${hgt - 1}" fill="none" stroke="${stroke}"/>
  <text x="50%" y="52%" text-anchor="middle" dominant-baseline="middle"
    font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace" font-size="${Math.max(13, w * 0.05)}" letter-spacing="3" fill="${fill}">${text}</text>
</svg>`;
}

/* ------------------------------------------------------------------ */
/* render + cache                                                      */
/* ------------------------------------------------------------------ */

function origin(): string {
  const port = process.env.PORT || "3000";
  return `http://127.0.0.1:${port}`;
}

async function renderInBrowser(plan: StillPlan): Promise<Buffer | null> {
  const browser = await getBrowser();
  if (!browser) return null;
  let page: Page | null = null;
  try {
    page = await browser.newPage({
      viewport: { width: plan.width, height: plan.height },
      deviceScaleFactor: 1,
    });
    await page.goto(`${origin()}/runtime?f=thumb-${plan.key.slice(0, 12)}`, { waitUntil: "domcontentloaded", timeout: 20_000 });

    const config = {
      type: "render",
      frameId: `thumb-${plan.key.slice(0, 12)}`,
      css: plan.themeCss + (plan.layers === "content" ? "\n#root{background:transparent!important}.ss-stage{background:transparent!important}" : ""),
      mode: plan.mode,
      static: true,
      scale: plan.width / 1280,
      assetBase: "",
      slide: plan.slideUrl,
      slideError: plan.slideError,
      bg: plan.bgUrl,
      bgImage: plan.bgImage,
      overlay: plan.overlayUrl,
      overlayImage: plan.overlayImage,
      commonOverlay: plan.commonOverlayUrl,
      show:
        plan.layers === "content"
          ? { bg: false, content: true, overlay: true }
          : { bg: true, content: true, overlay: true },
      slideIndex: plan.slideIndex,
      slideTotal: plan.slideTotal,
    };

    // post the render config from inside the page (same-origin message)
    await page.evaluate((cfg) => {
      window.postMessage(cfg, "*");
    }, config);

    // wait for the runtime to report a completed render
    await page.waitForFunction(
      () => (window as unknown as { __ssRendered?: number }).__ssRendered !== undefined && (window as unknown as { __ssRendered?: number }).__ssRendered! > 0,
      { timeout: 15_000 },
    );
    // let fonts + images settle
    await page.evaluate(() => Promise.all([(document as Document & { fonts?: FontFaceSet }).fonts?.ready ?? Promise.resolve(), new Promise((r) => setTimeout(r, 120))]));

    return await page.screenshot({
      type: "webp",
      quality: 58,
      omitBackground: plan.layers === "content",
      clip: { x: 0, y: 0, width: plan.width, height: plan.height },
    });
  } catch {
    return null;
  } finally {
    await page?.close().catch(() => {});
  }
}

/**
 * Generate (or fetch from cache) a slide still.
 * Returns the image bytes + content type; never throws.
 */
export async function renderStill(deckId: string, slideId: string, opts: StillOptions = {}): Promise<{ buf: Buffer | null; contentType: string; key: string | null; hit: boolean }> {
  const plan = await planStill(deckId, slideId, opts);
  if (!plan) return { buf: null, contentType: "", key: null, hit: false };

  if (plan.placeholder === "error") {
    return { buf: Buffer.from(placeholderSvg({ ...plan, kind: "error" })), contentType: "image/svg+xml", key: plan.key, hit: false };
  }

  const file = path.join(thumbDir(deckId), `${plan.key}.webp`);
  try {
    const cached = await fs.readFile(file);
    return { buf: cached, contentType: "image/webp", key: plan.key, hit: true };
  } catch {
    /* generate */
  }

  const existing = inflight.get(plan.key);
  if (existing) {
    const buf = await existing;
    return { buf, contentType: buf ? "image/webp" : "", key: plan.key, hit: false };
  }

  const job = (async () => {
    await acquire();
    try {
      const buf = await renderInBrowser(plan);
      if (buf) {
        await fs.mkdir(thumbDir(deckId), { recursive: true });
        const tmp = `${file}.tmp-${crypto.randomBytes(3).toString("hex")}`;
        await fs.writeFile(tmp, buf);
        await fs.rename(tmp, file);
      }
      return buf;
    } finally {
      release();
      inflight.delete(plan.key);
    }
  })();
  inflight.set(plan.key, job);

  const buf = await job;
  return { buf, contentType: buf ? "image/webp" : "", key: plan.key, hit: false };
}

/** generate all slide stills of a deck in the background (warm-up) */
export async function warmDeck(deckId: string, opts: StillOptions = {}): Promise<number> {
  if (!validDeckId(deckId) || !(await deckExists(deckId))) return 0;
  const deck = await readDeck(deckId);
  let n = 0;
  for (const s of deck.slides) {
    renderStill(deckId, s.id, opts)
      .then((r) => {
        if (r.buf) n++;
      })
      .catch(() => {});
    // don't flood the queue — fire sequentially in the background chain
    await new Promise((r) => setTimeout(r, 30));
  }
  return n;
}
