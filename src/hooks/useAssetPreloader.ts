"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, getAssetMap, resolveAssetUrl, resolveModule } from "@/lib/stagesmith/client";
import type { DeckJson, FileRow, Source } from "@/lib/stagesmith/types";

/**
 * useAssetPreloader — Present mode's preload gate.
 *
 * NO TIME LIMIT: elapsed time alone never produces an error. Big decks
 * (21–26 slides, large backgrounds) legitimately take longer than any fixed
 * budget, especially on slow disk / antivirus-scanned desktop webviews — the
 * previous ~15 s watchdog turned a healthy load into a red error state.
 *
 * Instead:
 *   · PRIORITY — the first few slides (startIndex window), their backgrounds
 *     and fonts load FIRST; the reveal gate opens as soon as they're ready,
 *     while everything else keeps loading in the background
 *   · PARTIAL START — `ready` means "the deck can start"; `allDone` reports
 *     when the background load finished (PresentView shows a tiny
 *     non-blocking "Loading more slides" chip meanwhile)
 *   · REAL FAILURES ONLY — a task that fails is retried automatically
 *     (3 attempts), then recorded in `failures` with its label + reason.
 *     Nothing else is cancelled; the user sees which item failed with Retry
 *     and "Continue anyway" (the deck starts, the missing item renders as
 *     the runtime's placeholder card)
 *   · STALL ≠ SLOW — if NOTHING settles for 30 s while work remains, a soft
 *     "seems stuck" notice appears (never the red error state); it clears
 *     itself the moment progress resumes
 *   · SHARED WORK — identical backgrounds (same bgKey) load once, modules
 *     reuse the app-wide compile cache, already-decoded data-URL images are
 *     skipped, and images decode via img.decode()
 */

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|avif|svg|bmp|ico)$/i;
const TASK_ATTEMPTS = 3;
const TASK_RETRY_DELAYS = [400, 1200];
/** no progress for this long → soft "seems stuck" notice (not an error) */
const STALL_MS = 30_000;
/** concurrent warm jobs — keeps the browser responsive on big decks */
const CONCURRENCY = 4;
/** how many slides must be ready before the deck reveals (spec: ~first 3) */
const CRITICAL_WINDOW = 3;
const TASK_TIMEOUT_MS = 10_000;
const FONT_TIMEOUT_MS = 3_000;

async function withTimeout<T>(promise: Promise<T>, label: string, ms = TASK_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface PreloadFailure {
  label: string;
  error: string;
}

export interface AssetPreloaderOptions {
  /** slide index to prioritize first (the one present mode opens on) */
  startIndex?: number;
  concurrency?: number;
  criticalWindow?: number;
}

export interface AssetPreloaderResult {
  /** 0..1 while preloading; null → indeterminate (deck not loaded yet) */
  progress: number | null;
  /** status line, e.g. "Preparing slide 3 of 17" */
  message: string;
  /** the critical window settled → deck can start (see also failuresAcknowledged) */
  ready: boolean;
  /** every background task settled too */
  allDone: boolean;
  /** tasks that failed after their retries — each shows Retry + Continue anyway */
  failures: PreloadFailure[];
  /** the user clicked "Continue anyway" — failures become placeholders */
  failuresAcknowledged: boolean;
  /** nothing has settled for a long time — soft notice, never an error */
  stalled: boolean;
  /** re-run the whole preload (full Retry) */
  retry: () => void;
  /** re-run ONLY the failed tasks */
  retryFailed: () => void;
  /** "Continue anyway" — start the deck with failed items as placeholders */
  acknowledgeFailures: () => void;
}

interface PreloadState {
  progress: number | null;
  message: string;
  ready: boolean;
  allDone: boolean;
  failures: PreloadFailure[];
  failuresAcknowledged: boolean;
  stalled: boolean;
}

const IDLE: PreloadState = {
  progress: null,
  message: "Preparing presentation",
  ready: false,
  allDone: false,
  failures: [],
  failuresAcknowledged: false,
  stalled: false,
};

type TaskStatus = "pending" | "running" | "ok" | "failed";

interface Task {
  key: string;
  /** slide index, or -1 for deck-global jobs (fonts, raster assets) */
  slide: number;
  critical: boolean;
  label: string;
  status: TaskStatus;
  error?: string;
  run: () => Promise<void>;
}

/* data-URL images already decoded this session (browser-deck assets are big
 * base64 strings — decoding them twice is pure waste) */
const decodedDataUrls = new Set<string>();
function rememberDecoded(url: string): void {
  if (!/^data:/i.test(url)) return;
  if (decodedDataUrls.size > 500) decodedDataUrls.clear();
  decodedDataUrls.add(url);
}

/** decode an image via img.decode(); rejects with the failing URL */
async function decodeImage(url: string): Promise<void> {
  if (/^(data|blob):/i.test(url)) {
    if (decodedDataUrls.has(url)) return; // already decoded this session
    await withTimeout(new Promise<void>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        if (typeof img.decode === "function") img.decode().then(() => resolve(), () => resolve());
        else resolve();
      };
      img.onerror = () => reject(new Error("the image didn't load"));
      img.src = url;
    }), "Image load");
    rememberDecoded(url);
    return;
  }
  await withTimeout(new Promise<void>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      if (typeof img.decode === "function") {
        // decode() failing after onload is cosmetic — treat as loaded
        img.decode().then(() => resolve(), () => resolve());
      } else resolve();
    };
    img.onerror = () => reject(new Error("the image didn't load"));
    img.src = url;
  }), "Image load");
}

/** resolve + warm a deck module; rejects on resolve/fetch failure */
async function warmModule(deckId: string, path: string, version: string | number): Promise<void> {
  const m = await withTimeout(resolveModule(deckId, path, version), path);
  if (m.error) throw new Error(m.error);
  if (m.url) {
    const res = await withTimeout(fetch(m.url, { cache: "force-cache" }), path);
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

  /** the live task list of the current run (mutable; state is derived) */
  const tasksRef = useRef<Task[]>([]);
  const runRef = useRef<{
    cancelled: boolean;
    acknowledged: boolean;
    lastProgressAt: number;
    slideCount: number;
  } | null>(null);

  /** recompute the public state from the task list */
  const publish = useCallback((): void => {
    const run = runRef.current;
    const tasks = tasksRef.current;
    if (!run) return;
    const total = tasks.length;
    const settled = tasks.filter((t) => t.status === "ok" || t.status === "failed");
    const done = settled.length;
    const failures: PreloadFailure[] = tasks
      .filter((t) => t.status === "failed")
      .map((t) => ({ label: t.label, error: t.error ?? "load failed" }));
    const criticalBlocked = tasks.some((t) => t.critical && (t.status === "pending" || t.status === "running"));
    const criticalFailed = tasks.some((t) => t.critical && t.status === "failed");
    const allDone = total > 0 && done === total;
    // slides whose tasks are ALL settled → the "Preparing slide N of M" count
    const slideRemaining = new Map<number, number>();
    for (const t of tasks) {
      if (t.slide >= 0 && (t.status === "pending" || t.status === "running")) {
        slideRemaining.set(t.slide, (slideRemaining.get(t.slide) ?? 0) + 1);
      }
    }
    let prepared = 0;
    for (let i = 0; i < run.slideCount; i++) if (!(slideRemaining.get(i) ?? 0)) prepared++;
    // stall = NOTHING settling for a long time, regardless of how much is
    // left — this also covers “everything preloaded but the stage never
    // rendered” (the old 15 s stage watchdog is gone by design)
    const stalled = Date.now() - run.lastProgressAt > STALL_MS;
    setState({
      progress: total > 0 ? done / total : null,
      message:
        run.slideCount > 0
          ? `Preparing slide ${Math.min(prepared + (allDone ? 0 : 1), Math.max(run.slideCount, 1))} of ${run.slideCount}`
          : "Preparing presentation",
      // nothing to preload (edge: a deck with no slides) → don't block the gate
      ready: total > 0 ? !criticalBlocked && (!criticalFailed || run.acknowledged) : true,
      allDone,
      failures,
      failuresAcknowledged: run.acknowledged,
      stalled,
    });
  }, []);

  /** run a pool over the given tasks, updating statuses + progress */
  const runPool = useCallback(
    async (subset: Task[]): Promise<void> => {
      const run = runRef.current;
      if (!run) return;
      const concurrency = Math.max(1, Math.min(optsRef.current.concurrency ?? CONCURRENCY, subset.length || 1));
      let cursor = 0;
      const worker = async (): Promise<void> => {
        while (!run.cancelled && cursor < subset.length) {
          const task = subset[cursor++];
          task.status = "running";
          publish();
          let lastErr: unknown = null;
          for (let attempt = 0; attempt < TASK_ATTEMPTS; attempt++) {
            if (run.cancelled) return;
            try {
              const taskPromise = task.run();
              // A slide module may be queued behind compilation or desktop
              // disk/bridge work. Elapsed time alone is not a slide failure.
              if (task.label.startsWith("slides/")) await taskPromise;
              else await withTimeout(taskPromise, task.label, task.label === "fonts" ? FONT_TIMEOUT_MS : TASK_TIMEOUT_MS);
              lastErr = null;
              break;
            } catch (e) {
              lastErr = e;
              if (attempt < TASK_ATTEMPTS - 1) {
                await new Promise((r) => setTimeout(r, TASK_RETRY_DELAYS[attempt] ?? 1200));
                if (run.cancelled) return;
              }
            }
          }
          task.status = lastErr ? "failed" : "ok";
          task.error = lastErr ? `${(lastErr as Error)?.message ?? "load failed"}` : undefined;
          run.lastProgressAt = Date.now();
          publish();
        }
      };
      await Promise.all(Array.from({ length: concurrency }, () => worker()));
    },
    [publish],
  );

  useEffect(() => {
    if (!hasDeck) return;
    const d = deckRef.current;
    if (!d) return;
    const { version: ver, startIndex = 0, criticalWindow = CRITICAL_WINDOW } = optsRef.current;

    const startKey = `${deckId}#${retryToken}`;
    if (startKeyRef.current === startKey) return;
    startKeyRef.current = startKey;

    let cancelled = false;
    const slides = d.slides;
    const slideCount = slides.length;

    runRef.current = { cancelled: false, acknowledged: false, lastProgressAt: Date.now(), slideCount };

    (async () => {
      setState({
        progress: slideCount > 0 ? 0 : null,
        message: slideCount > 0 ? `Preparing slide 1 of ${slideCount}` : "Preparing presentation",
        ready: false,
        allDone: false,
        failures: [],
        failuresAcknowledged: false,
        stalled: false,
      });

      /* the asset map (browser decks resolve bg images to data URLs through
       * it; server decks return null and keep /api/assets) */
      const assetMap = await getAssetMap(deckId, ver).catch(() => null);
      if (cancelled) return;
      if (runRef.current) runRef.current.lastProgressAt = Date.now();
      const assetFiles: FileRow[] = await api.listAssets(deckId).catch(() => []);
      if (cancelled) return;
      if (runRef.current) runRef.current.lastProgressAt = Date.now();
      const urlOf = (path: string): Promise<string> => resolveAssetUrl(deckId, path, assetMap);

      const byKey = new Map<string, Task>();
      const addTask = (t: Task): void => {
        if (!byKey.has(t.key)) byKey.set(t.key, t);
      };
      const warmSource = (slide: number, critical: boolean, source: Source | undefined): void => {
        if (!source || source.type === "none") return;
        if (source.type === "code") {
          // shared bg/overlay modules load once — same key, one task
          addTask({
            key: `code:${source.path}`,
            slide,
            critical,
            label: source.path,
            status: "pending",
            run: () => warmModule(deckId, source.path, ver),
          });
        } else if (source.type === "image") {
          addTask({
            key: `img:${source.path}`,
            slide,
            critical,
            label: source.path,
            status: "pending",
            run: async () => decodeImage(await urlOf(source.path)),
          });
        }
      };

      // slide order: startIndex window first (critical), then the rest
      const order: number[] = [];
      if (slideCount > 0) {
        const cur = Math.min(Math.max(0, startIndex), slideCount - 1);
        for (let i = cur; i < Math.min(cur + criticalWindow, slideCount); i++) order.push(i);
        if (cur > 0) order.push(cur - 1);
        for (let i = 0; i < slideCount; i++) if (!order.includes(i)) order.push(i);
      }
      const criticalSet = new Set(order.slice(0, Math.min(criticalWindow, slideCount)));

      const tasks: Task[] = [];
      // fonts are critical — the first slides need them
      tasks.push({
        key: "fonts",
        slide: -1,
        critical: true,
        label: "fonts",
        status: "pending",
        run: async () => {
          try {
            if (document.fonts?.ready) await withTimeout(document.fonts.ready.then(() => undefined), "fonts", FONT_TIMEOUT_MS);
          } catch {
            /* fonts api unavailable — nothing to wait for */
          }
        },
      });
      for (const i of order) {
        const s = slides[i];
        const critical = criticalSet.has(i);
        addTask({
          key: `slide:${s.id}`,
          slide: i,
          critical,
          label: `slides/${s.id}.tsx`,
          status: "pending",
          run: () => warmModule(deckId, `slides/${s.id}.tsx`, ver),
        });
        warmSource(i, critical, s.bg !== undefined ? s.bg : d.bg);
        warmSource(i, critical, s.overlay !== undefined ? s.overlay : d.overlay);
      }
      // deck-global raster assets (logos, images slides <Img/>) — background
      for (const f of assetFiles) {
        if (!IMAGE_EXT.test(f.path)) continue;
        addTask({
          key: `img:${f.path}`,
          slide: -1,
          critical: false,
          label: f.path,
          status: "pending",
          run: async () => decodeImage(await urlOf(f.path)),
        });
      }

      tasksRef.current = [...tasks];
      publish();
      if (cancelled) return;

      // critical first, then the background remainder
      const criticalTasks = tasksRef.current.filter((t) => t.critical);
      const restTasks = tasksRef.current.filter((t) => !t.critical);
      await runPool(criticalTasks);
      if (!cancelled) await runPool(restTasks);
      publish();
    })().catch(() => {
      /* the run itself failed to enumerate (e.g. asset map read error) —
       * publish whatever settled; the stage gate still reveals when ready */
      publish();
    });

    /* stall watch — based on NO PROGRESS, never on total elapsed time */
    const ticker = setInterval(() => {
      const run = runRef.current;
      if (!run || run.cancelled) return;
      publish();
    }, 2500);

    return () => {
      cancelled = true;
      clearInterval(ticker);
      if (runRef.current) runRef.current.cancelled = true;
    };
  }, [deckId, retryToken, hasDeck, publish, runPool]);

  const retry = useCallback(() => {
    setRetryToken((t) => t + 1);
  }, []);

  const retryFailed = useCallback(() => {
    const run = runRef.current;
    if (!run) return;
    const failed = tasksRef.current.filter((t) => t.status === "failed");
    if (!failed.length) return;
    for (const t of failed) {
      t.status = "pending";
      t.error = undefined;
    }
    run.lastProgressAt = Date.now();
    publish();
    void runPool(failed).then(() => publish());
  }, [publish, runPool]);

  const acknowledgeFailures = useCallback(() => {
    const run = runRef.current;
    if (!run) return;
    run.acknowledged = true;
    publish();
  }, [publish]);

  return { ...state, retry, retryFailed, acknowledgeFailures };
}
