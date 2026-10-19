"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, getAssetMap, resolveModule } from "@/lib/stagesmith/client";
import type { DeckJson, FileRow, Source } from "@/lib/stagesmith/types";

/**
 * useAssetPreloader — Present mode's "load everything before the first slide
 * is shown" gate (drives the loading screen's real progress bar).
 *
 * For EVERY slide in the deck it preloads:
 *   · the slide TSX module        — resolveModule (compile) + fetch() so the
 *                                   runtime's `import(url)` is HTTP-cache warm
 *   · its effective background    — TSX modules are fetched warm; image
 *                                   backgrounds are `new Image()` + decoded
 *                                   via `img.decode()`
 *   · its effective overlay       — same treatment
 * plus the deck-common layers, every raster asset in assets/ (logos, images
 * used by slides) and `document.fonts.ready`.
 *
 * A note on "mount a background once, offscreen": compiled slide/bg modules
 * run inside the sandboxed runtime (opaque-origin import map — react, the
 * stagesmith API, lucide), so they cannot execute in the host page. The
 * hidden StageFrame that PresentView mounts underneath the loading overlay
 * IS the offscreen mount: it imports and mounts the first background/slide
 * while covered, and the overlay is only lifted once both the preloader AND
 * the runtime's first `rendered` message agree — so the first real slide and
 * every later transition start from a fully warm cache.
 *
 * Failure policy (error state + Retry):
 *   · an image that fails to load        → fatal  ("missing asset")
 *   · a module that fails to resolve     → fatal  ("module error")
 *   · a warm fetch that answers !ok      → fatal
 *   · nothing settles within timeoutMs   → fatal  ("timeout")
 *
 * Progress is honest: completed jobs / total jobs, and the message counts
 * fully-prepared slides ("Preparing slide N of M").
 *
 * The gate runs ONCE per mount (and per explicit retry). Live edits change
 * the deck object but must NOT cancel the run halfway — so the effect reads
 * the deck/options through refs and only re-runs for a new deckId, a retry,
 * or the deck arriving after a client-side fetch.
 */

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|avif|svg|bmp|ico)$/i;

export interface AssetPreloaderOptions {
  /** overall watchdog — defaults to ~15 s */
  timeoutMs?: number;
  /** concurrent warm jobs — defaults to 6 */
  concurrency?: number;
  /** slide index to prioritize first (the one present mode opens on) */
  startIndex?: number;
}

export interface AssetPreloaderResult {
  /** 0..1 while preloading; null → indeterminate (deck not loaded yet) */
  progress: number | null;
  /** status line, e.g. "Preparing slide 3 of 17" */
  message: string;
  /** all jobs settled successfully */
  ready: boolean;
  /** fatal error text (drives the Retry state) */
  error: string | null;
  /** re-run the whole preload (resets progress + watchdog) */
  retry: () => void;
}

interface PreloadState {
  progress: number | null;
  message: string;
  ready: boolean;
  error: string | null;
}

const IDLE: PreloadState = { progress: null, message: "Preparing presentation", ready: false, error: null };

/** decode an image and reject when it's genuinely missing */
async function decodeImage(url: string): Promise<void> {
  if (/^(data|blob):/i.test(url)) return; // browser-deck data URLs are already local
  await new Promise<void>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      if (typeof img.decode === "function") {
        // decode() failing after onload is cosmetic — treat as loaded
        img.decode().then(() => resolve(), () => resolve());
      } else resolve();
    };
    img.onerror = () => reject(new Error(url));
    img.src = url;
  });
}

/** resolve + warm a deck module; rejects on resolve/fetch failure (the task
 *  label already names the file — messages stay single-pathed) */
async function warmModule(deckId: string, path: string, version: string | number): Promise<void> {
  const m = await resolveModule(deckId, path, version);
  if (m.error) throw new Error(m.error);
  if (m.url) {
    const res = await fetch(m.url, { cache: "force-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }
}

export function useAssetPreloader(
  deck: DeckJson | null,
  deckId: string,
  version: string | number,
  opts: AssetPreloaderOptions = {},
): AssetPreloaderResult {
  const [state, setState] = useState<PreloadState>(IDLE);
  const [retryToken, setRetryToken] = useState(0);

  /** one run per mount (and per explicit retry) — keyed, so unrelated
   *  re-renders (live edits) never restart or cancel the gate */
  const startKeyRef = useRef<string | null>(null);

  const deckRef = useRef(deck);
  deckRef.current = deck;
  const optsRef = useRef({ version, ...opts });
  optsRef.current = { version, ...opts };

  const hasDeck = Boolean(deck);

  useEffect(() => {
    if (!hasDeck) return;
    const d = deckRef.current;
    if (!d) return;
    const { version: ver, timeoutMs = 15_000, concurrency = 6, startIndex = 0 } = optsRef.current;

    const startKey = `${deckId}#${retryToken}`;
    if (startKeyRef.current === startKey) return;
    startKeyRef.current = startKey;

    let cancelled = false;
    const slides = d.slides;
    const slideCount = slides.length;

    setState({
      progress: slideCount > 0 ? 0 : null,
      message: slideCount > 0 ? `Preparing slide 1 of ${slideCount}` : "Preparing presentation",
      ready: false,
      error: null,
    });

    (async () => {
      /* phase 0 — the asset map (browser decks resolve bg images to data
       * URLs through it; server decks return null and keep /api/assets) */
      const assetMap = await getAssetMap(deckId, ver).catch(() => null);
      if (cancelled) return;

      /* phase 1 — enumerate every warm job */
      const assetFiles: FileRow[] = await api.listAssets(deckId).catch(() => []);
      if (cancelled) return;
      const urlOf = (path: string): string => assetMap?.[path] ?? `/api/assets/${deckId}/${path}`;

      interface Task {
        slide: number; // -1 for deck-global jobs
        label: string;
        run: () => Promise<void>;
      }
      const tasks: Task[] = [];

      const warmSource = (slide: number, source: Source | undefined) => {
        if (!source || source.type === "none") return;
        if (source.type === "code") {
          tasks.push({ slide, label: source.path, run: () => warmModule(deckId, source.path, ver) });
        } else if (source.type === "image") {
          const path = source.path;
          tasks.push({ slide, label: path, run: () => decodeImage(urlOf(path)) });
        }
      };

      // slide order: current → next → previous → the rest
      const order: number[] = [];
      if (slideCount > 0) {
        const cur = Math.min(Math.max(0, startIndex), slideCount - 1);
        order.push(cur);
        if (cur + 1 < slideCount) order.push(cur + 1);
        if (cur - 1 >= 0) order.push(cur - 1);
        for (let i = 0; i < slideCount; i++) if (!order.includes(i)) order.push(i);
      }
      for (const i of order) {
        const s = slides[i];
        tasks.push({
          slide: i,
          label: `slides/${s.id}.tsx`,
          run: () => warmModule(deckId, `slides/${s.id}.tsx`, ver),
        });
        warmSource(i, s.bg !== undefined ? s.bg : d.bg);
        warmSource(i, s.overlay !== undefined ? s.overlay : d.overlay);
      }

      // deck-global: fonts + every raster asset (logos, images slides <Img/>)
      tasks.push({
        slide: -1,
        label: "fonts",
        run: async () => {
          try {
            if (document.fonts?.ready) await document.fonts.ready;
          } catch {
            /* fonts api unavailable — nothing to wait for */
          }
        },
      });
      for (const f of assetFiles) {
        if (!IMAGE_EXT.test(f.path)) continue;
        const path = f.path;
        tasks.push({ slide: -1, label: path, run: () => decodeImage(urlOf(path)) });
      }

      const total = tasks.length;
      if (total === 0) {
        if (!cancelled) setState({ progress: 1, message: "Ready", ready: true, error: null });
        return;
      }

      /* phase 2 — run the pool with progress + a fatal-error short-circuit */
      let done = 0;
      let prepared = 0;
      let fatal: string | null = null;
      let finished = false;
      const remaining = slides.map(() => 0);
      for (const t of tasks) if (t.slide >= 0) remaining[t.slide] += 1;

      const watchdog = setTimeout(() => {
        if (finished || cancelled) return;
        cancelled = true; // stop the workers
        setState({
          progress: null,
          message: "",
          ready: false,
          error: `Still loading after ${Math.round(timeoutMs / 1000)} s — the deck may be unreachable or too large.`,
        });
      }, timeoutMs);

      let cursor = 0;
      const worker = async () => {
        while (!fatal && !cancelled && cursor < tasks.length) {
          const task = tasks[cursor++];
          try {
            await task.run();
          } catch (e) {
            fatal = `Couldn't load ${task.label} — ${(e as Error).message}`;
            return;
          }
          if (cancelled || fatal) return;
          done += 1;
          if (task.slide >= 0) {
            remaining[task.slide] -= 1;
            if (remaining[task.slide] === 0) prepared += 1;
          }
          setState({
            progress: done / total,
            message: slideCount > 0 ? `Preparing slide ${Math.min(prepared + 1, slideCount)} of ${slideCount}` : "Preparing",
            ready: false,
            error: null,
          });
        }
      };
      await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, total)) }, () => worker()));
      finished = true;
      clearTimeout(watchdog);

      if (cancelled) return; // superseded (unmount / retry / timeout)
      if (fatal) {
        setState({ progress: null, message: "", ready: false, error: fatal });
        return;
      }
      setState({ progress: 1, message: "Ready", ready: true, error: null });
    })();

    return () => {
      cancelled = true;
    };
  }, [deckId, retryToken, hasDeck]);

  const retry = useCallback(() => {
    setRetryToken((t) => t + 1);
  }, []);

  return { ...state, retry };
}
