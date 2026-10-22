"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { RuntimeMessage, SlideEntry, Source, ThemeMode } from "@/lib/stagesmith/types";
import { resolveModule, getAssetMap, assetRouteUrl, getModuleRequestState, type ModuleInfo } from "@/lib/stagesmith/client";

/**
 * The sandboxed Stage Runtime wrapper (plan §5.1).
 * Fixed 1280×720 stage scaled to the container. Layers arrive either as a
 * compile URL (server decks) or as inline compiled code + version hash
 * (browser decks, POST /api/compile) — both hot-swap on change.
 *
 * Present mode passes `transition` timings: the first config posted for a
 * NEW slide then carries a transition directive and the runtime runs the
 * choreographed exit → background crossfade → enter sequence. Configs are
 * HELD until the new slide's modules resolved (and the asset map loaded),
 * so a slide change never posts an intermediate "no content" frame — the
 * outgoing slide stays on screen until the real transition begins.
 */

export interface TransitionTiming {
  /** content fade-out, ms */
  exitMs: number;
  /** background crossfade, ms */
  bgMs: number;
  /** content fade-in, ms */
  enterMs: number;
  /** the parent page reports prefers-reduced-motion — the runtime honours
   *  its own matchMedia OR this flag (covers sandboxed iframes whose media
   *  state may not track the OS setting) */
  reduced?: boolean;
}

export interface StageFrameProps {
  deckId: string;
  slide?: SlideEntry | null;
  deckBg?: Source;
  deckOverlay?: Source;
  /** optional independent common-overlay source for <Common/> (defaults to deckOverlay) */
  commonOverlay?: Source;
  themeCss: string;
  mode: ThemeMode;
  show?: { bg: boolean; content: boolean; overlay: boolean };
  staticMode?: boolean;
  /** thumbnail frames report failures to their corner badge, never a full error card */
  thumbnail?: boolean;
  loadPriority?: "selected" | "normal" | "background";
  /** bump to force re-resolution (folder poll signature or explicit flush) */
  version: string | number;
  step?: number;
  slideIndex?: number;
  slideTotal?: number;
  className?: string;
  interactive?: boolean;
  /** present-mode transition timings — omitted/undefined in editor previews */
  transition?: TransitionTiming | null;
  onSteps?: (steps: number) => void;
  onRuntimeError?: (err: { phase: string; message: string }) => void;
}

export type MetaInfo = ModuleInfo;

/** resolve a deck layer to a loadable module (URL or inline code) */
export async function resolveCode(deckId: string, path: string, version: string | number, priority: "selected" | "normal" | "background" = "normal", force = false): Promise<MetaInfo> {
  return resolveModule(deckId, path, version, priority, force);
}

/** image layer source URL — always percent-encoded per segment so names with
 *  spaces, brackets, # and unicode all load (used for bg/overlay images when
 *  the deck's assetMap has no data-URL entry). */
export function imageSourceUrl(deckId: string, source: Extract<Source, { type: "image" }>): string {
  return assetRouteUrl(deckId, source.path);
}

/** resolution is settled for exactly this set of sources at this version */
function tagOf(version: string | number, sig: string) {
  return `${version}|${sig}`;
}

export function useResolvedSources(
  deckId: string,
  version: string | number,
  entries: Array<{ kind: "slide" | "bg" | "overlay" | "commonOverlay"; source: Source | null | undefined }>,
  retryNonce = 0,
  priority: "selected" | "normal" | "background" = "normal",
) {
  const [state, setState] = useState<{ metas: Record<string, MetaInfo>; tag: string | null }>({ metas: {}, tag: null });
  const sig = entries.map((e) => `${e.kind}:${e.source ? JSON.stringify(e.source) : "none"}`).join("|");
  useEffect(() => {
    let cancelled = false;
    setState((prev) => ({ ...prev, tag: null }));
    (async () => {
      const out: Record<string, MetaInfo> = {};
      for (const e of entries) {
        if (e.source && e.source.type === "code") {
          out[e.kind] = await resolveCode(deckId, e.source.path, version, priority, retryNonce > 0);
        } else {
          out[e.kind] = { url: null, code: null, ver: "", steps: 1, error: null };
        }
      }
      if (!cancelled) setState({ metas: out, tag: tagOf(version, sig) });
    })();
    return () => {
      cancelled = true;
    };
  }, [deckId, version, sig, retryNonce]);
  return state;
}

export function StageFrame(props: StageFrameProps) {
  const {
    deckId, slide, deckBg, deckOverlay, commonOverlay: commonOverlayProp, themeCss, mode,
    show = { bg: true, content: true, overlay: true },
    staticMode = false, thumbnail = false, loadPriority, version, step, slideIndex, slideTotal,
    className, interactive = false, transition = null, onSteps, onRuntimeError,
  } = props;

  const frameId = useId().replace(/[^a-zA-Z0-9-]/g, "");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [scale, setScale] = useState(0.25);
  const loadedRef = useRef(false);

  const bgSource = slide?.bg !== undefined ? slide.bg : deckBg;
  const overlaySource = slide?.overlay !== undefined ? slide.overlay : deckOverlay;
  // the common overlay for <Common/>: dedicated prop ?? deckOverlay
  const commonOverlaySource = commonOverlayProp !== undefined ? commonOverlayProp : deckOverlay;

  const sources = useMemo(
    () => [
      { kind: "slide" as const, source: slide ? { type: "code" as const, path: `slides/${slide.id}.tsx` } : null },
      { kind: "bg" as const, source: bgSource && bgSource.type === "code" ? bgSource : null },
      { kind: "overlay" as const, source: overlaySource && overlaySource.type === "code" ? overlaySource : null },
      { kind: "commonOverlay" as const, source: commonOverlaySource && commonOverlaySource.type === "code" ? commonOverlaySource : null },
    ],
    [slide, bgSource, overlaySource, commonOverlaySource],
  );
  const sig = sources.map((e) => `${e.kind}:${e.source ? JSON.stringify(e.source) : "none"}`).join("|");
  const currentTag = tagOf(version, sig);
  const [retryNonce, setRetryNonce] = useState(0);
  const [stallLevel, setStallLevel] = useState<0 | 1 | 2>(0);
  const [runtimeFailure, setRuntimeFailure] = useState<string | null>(null);
  const [runtimeReady, setRuntimeReady] = useState(false);
  const reportedThumbErrorRef = useRef<string | null>(null);
  const { metas, tag: metasTag } = useResolvedSources(deckId, version, sources, retryNonce, loadPriority ?? (thumbnail ? "background" : "selected"));
  /** true when `metas` were resolved for exactly the current slide + sources */
  const settled = metasTag === currentTag;

  useEffect(() => {
    setRuntimeFailure(null);
    setRuntimeReady(false);
  }, [currentTag, retryNonce]);

  const slidePath = slide ? `slides/${slide.id}.tsx` : "";
  useEffect(() => {
    if (thumbnail || !slidePath || runtimeReady || runtimeFailure || (settled && metas.slide?.error)) {
      setStallLevel(0);
      return;
    }
    setStallLevel(0);
    let slow: ReturnType<typeof setTimeout> | undefined;
    let stuck: ReturnType<typeof setTimeout> | undefined;
    const clearWatch = () => {
      if (slow) clearTimeout(slow);
      if (stuck) clearTimeout(stuck);
      slow = undefined;
      stuck = undefined;
    };
    const startWatch = () => {
      clearWatch();
      slow = setTimeout(() => setStallLevel(1), 30_000);
      stuck = setTimeout(() => setStallLevel(2), 60_000);
    };
    const key = `${deckId}:${slidePath}:${version}`;
    const onModuleState = (event: Event) => {
      const detail = (event as CustomEvent<{ key: string; status: string }>).detail;
      if (detail?.key !== key) return;
      if (detail.status === "started" || detail.status === "finished") startWatch();
      if (detail.status === "cancelled") clearWatch();
    };
    window.addEventListener("stagesmith-module-state", onModuleState);
    const existing = getModuleRequestState(deckId, slidePath, version);
    if (existing?.status === "started" || existing?.status === "finished") startWatch();
    return () => {
      clearWatch();
      window.removeEventListener("stagesmith-module-state", onModuleState);
    };
  }, [deckId, slidePath, version, thumbnail, runtimeReady, runtimeFailure, settled, metas.slide?.error]);

  // browser decks ship assets as data URLs (the sandbox can't fetch /api/assets)
  const [assetMap, setAssetMap] = useState<Record<string, string> | null>(null);
  const [assetsLoaded, setAssetsLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setAssetsLoaded(false);
    getAssetMap(deckId, version)
      .then((m) => {
        if (!cancelled) {
          setAssetMap(m);
          setAssetsLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) setAssetsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [deckId, version]);

  // last-good slide module keyed by slide id (plan §5.1): compile errors keep
  // the preview. Must be STATE: a ref updated in an effect would never re-render
  // the config memo, so the slide module would never be posted. The key means
  // an UNRESOLVED new slide keeps the previous slide's module in the config —
  // and since the config post is held until resolution settles, that stale
  // module is never shown for the new slide.
  const slideId = slide?.id;
  const [lastGood, setLastGood] = useState<{ slideId: string; meta: MetaInfo } | null>(null);
  const slideMeta = metas.slide;
  useEffect(() => {
    if (!thumbnail || !settled || !slideMeta?.error) {
      if (settled) reportedThumbErrorRef.current = null;
      return;
    }
    const key = `${currentTag}:${slideMeta.error}`;
    if (reportedThumbErrorRef.current === key) return;
    reportedThumbErrorRef.current = key;
    onRuntimeError?.({ phase: "compile", message: slideMeta.error });
  }, [thumbnail, settled, slideMeta?.error, onRuntimeError, currentTag]);
  useEffect(() => {
    if (settled && slideId && (slideMeta?.url || slideMeta?.code)) {
      setLastGood({ slideId, meta: slideMeta });
    }
  }, [settled, slideId, slideMeta]);
  // DERIVED, not state: when resolution settled for this slide, its module is
  // available in the SAME render. Reading it from lastGood alone would lag one
  // render behind `settled` and post an intermediate "no content" config first
  // (which the runtime would treat as a transition to an empty slide).
  // lastGood remains as the keep-last-good fallback for live-edit compile
  // errors on the SAME slide.
  const resolvedSlideMod = settled && (slideMeta?.url || slideMeta?.code) ? slideMeta : null;
  const slideMod = resolvedSlideMod ?? (lastGood && slideId && lastGood.slideId === slideId ? lastGood.meta : null);
  const slideCompileFailure = slideMeta?.error && !resolvedSlideMod && !(lastGood && slideId && lastGood.slideId === slideId)
    ? slideMeta.error
    : null;

  // simple memo deps (lint requires plain expressions)
  const bgKey = JSON.stringify(bgSource);
  const overlayKey = JSON.stringify(overlaySource);
  const showKey = JSON.stringify(show);
  const bgMod = metas.bg;
  const overlayMod = metas.overlay;
  const commonOverlayMod = metas.commonOverlay;

  /* ---------- posting bookkeeping ----------
     postedSlideIdRef: the slide the last POSTED config belongs to. A slide
     change is "pending" until a config carrying the new slide's RESOLVED
     module posts — and THAT config is the one carrying the transition
     directive (injected at post time, not build time: building it into the
     memo would flip a dep right after the post and re-post a directive-less
     clone, which the runtime would treat as a chrome refresh that kills the
     running transition). prevPostedIndexRef gives the travel direction. */
  const postedSlideIdRef = useRef<string | null>(null);
  const prevPostedIndexRef = useRef<number | null>(null);
  const lastDirRef = useRef<"next" | "prev">("next");

  const configJson = useMemo(() => {
    const bgSrc = bgSource && bgSource.type === "image" ? bgSource : null;
    const ovSrc = overlaySource && overlaySource.type === "image" ? overlaySource : null;
    const bgImage = bgSrc ? { url: assetMap?.[bgSrc.path] ?? imageSourceUrl(deckId, bgSrc), ...bgSrc } : null;
    const overlayImage = ovSrc ? { url: assetMap?.[ovSrc.path] ?? imageSourceUrl(deckId, ovSrc), ...ovSrc } : null;
    return JSON.stringify({
      type: "render",
      frameId,
      css: themeCss,
      mode,
      static: staticMode,
      thumbnail,
      managedErrors: true,
      scale,
      assetBase: `/api/assets/${deckId}`,
      assetMap: assetMap && Object.keys(assetMap).length ? assetMap : undefined,
      slide: slideMod?.url || null,
      slideCode: slideMod?.code || null,
      slideVer: slideMod?.ver || null,
      // the target slide itself failed to resolve (its own module absent) →
      // the runtime shows the error card, even though a last-good module of
      // another slide may still be mounted underneath
      slideError: null,
      bg: bgMod?.url || null,
      bgCode: bgMod?.code || null,
      bgVer: bgMod?.ver || null,
      bgImage,
      overlay: overlayMod?.url || null,
      overlayCode: overlayMod?.code || null,
      overlayVer: overlayMod?.ver || null,
      overlayImage,
      commonOverlay: commonOverlayMod?.url || null,
      commonOverlayCode: commonOverlayMod?.code || null,
      commonOverlayVer: commonOverlayMod?.ver || null,
      show,
      slideIndex,
      slideTotal,
    });
  }, [
    frameId, themeCss, mode, staticMode, thumbnail, scale, deckId,
    slideId, slideMod, slideMeta?.error, bgMod, overlayMod, commonOverlayMod,
    bgKey, overlayKey, showKey, slideIndex, slideTotal, assetMap,
  ]);

  // direction of travel for the next pending transition (index delta)
  const dir = (() => {
    const prev = prevPostedIndexRef.current;
    if (typeof slideIndex === "number" && typeof prev === "number" && slideIndex !== prev) {
      return slideIndex > prev ? "next" : "prev";
    }
    return lastDirRef.current;
  })();
  lastDirRef.current = dir;

  // measure container → scale
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let raf = 0;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0].contentRect.width;
      // debounce via rAF — avoids a setState per pixel during resize drags
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (w > 0) setScale((prev) => {
          const next = w / 1280;
          // skip trivial sub-pixel jitter (< 0.5px change in stage width)
          return Math.abs(next - prev) * 1280 > 0.5 ? next : prev;
        });
      });
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);

  // post config when ready / changed — latest config kept in a ref so the
  // iframe can be healed by re-posting on load or 'ready' (idempotent).
  // Posts are HELD until the current sources resolved (and the asset map
  // loaded): a slide change then posts ONE settled config that carries the
  // transition directive — the runtime never sees a blank intermediate
  // frame, and rapid A→B→A navigation never posts the middle slide at all.
  const latestCfgRef = useRef<string | null>(null);
  const postable = settled && assetsLoaded;
  const postableRef = useRef(false);
  postableRef.current = postable;

  const postLatest = useCallback(() => {
    const win = iframeRef.current?.contentWindow;
    const cfg = latestCfgRef.current;
    if (!win || !cfg || !postableRef.current) return;
    win.postMessage(JSON.parse(cfg), "*");
  }, []);

  const transitionRef = useRef(transition);
  transitionRef.current = transition;

  useEffect(() => {
    if (!postable) return;
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    let cfgObj: Record<string, unknown>;
    try {
      cfgObj = JSON.parse(configJson);
    } catch {
      return;
    }
    // inject the transition directive AT POST TIME — only for the config
    // that applies a resolved NEW slide (never for live edits, scale/mode
    // refreshes or heal re-posts of the same slide)
    const isSlideChange = (slideId ?? null) !== postedSlideIdRef.current;
    const timing = transitionRef.current;
    if (isSlideChange && timing) {
      cfgObj.transition = { ...timing, dir: lastDirRef.current };
    }
    win.postMessage(cfgObj, "*");
    latestCfgRef.current = JSON.stringify(cfgObj); // heal re-posts replay exactly this
    postedSlideIdRef.current = slideId ?? null;
    if (typeof slideIndex === "number") prevPostedIndexRef.current = slideIndex;
  }, [configJson, postable, slideId, slideIndex]);

  // iframe onLoad: module may have registered before we attached; re-post
  const onIframeLoad = useCallback(() => {
    loadedRef.current = true;
    // the runtime's own 'ready' may beat onLoad; posting twice is idempotent
    setTimeout(postLatest, 60);
    setTimeout(postLatest, 350);
  }, [postLatest]);

  // heal heartbeat — an SSR-rendered iframe can finish loading BEFORE React
  // attaches onLoad (missed load event), and the runtime's boot-ok can arrive
  // before this component's message listener attaches. Posting the config is
  // idempotent, so re-post periodically until the runtime answers back.
  useEffect(() => {
    const t = setInterval(() => {
      if (!loadedRef.current) postLatest();
    }, 700);
    const stop = setTimeout(() => clearInterval(t), 30_000);
    return () => {
      clearInterval(t);
      clearTimeout(stop);
    };
  }, [postLatest]);

  // step updates — held alongside the config for a pending slide change so
  // a step never lands on the outgoing slide
  useEffect(() => {
    const win = iframeRef.current?.contentWindow;
    if (win && loadedRef.current && step !== undefined && postableRef.current) {
      win.postMessage({ type: "set-step", step }, "*");
    }
  }, [step, configJson]);

  // messages from the runtime
  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      const m = ev.data as RuntimeMessage & { frameId?: string };
      if (!m || typeof m !== "object" || m.frameId !== frameId) return;
      if (m.type === "ready" || m.type === "boot-ok" || m.type === "rendered") {
        loadedRef.current = true;
      }
      if (m.type === "ready" || m.type === "boot-ok") {
        postLatest();
      } else if (m.type === "rendered" && onSteps) {
        onSteps(m.steps ?? 1);
      } else if (m.type === "error" && onRuntimeError) {
        onRuntimeError({ phase: m.phase, message: m.message });
      }
      if (m.type === "rendered") setRuntimeReady(true);
      if (m.type === "error") setRuntimeFailure(m.message || "Slide failed while rendering");
      if ((m as any).type === "boot-error") {
        const message = (m as any).message || "Slide runtime failed to start";
        setRuntimeFailure(message);
        onRuntimeError?.({ phase: "boot", message });
      }
      // "transition" phase events are observability only — nothing to do
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [frameId, onSteps, onRuntimeError, postLatest]);

  const src = useMemo(() => `/runtime?f=${frameId}`, [frameId]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", ...(!interactive ? { pointerEvents: "none" } : {}) }}
    >
      <iframe
        ref={iframeRef}
        src={src}
        title={`Stage ${frameId}`}
        sandbox="allow-scripts"
        onLoad={onIframeLoad}
        style={{ width: "100%", height: "100%", border: 0, display: "block", background: "transparent" }}
      />
      {!thumbnail && settled && (slideCompileFailure || runtimeFailure) && (
        <div role="alert" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", zIndex: 6, background: "rgba(12,12,14,.92)", color: "#f5dada", padding: 36, textAlign: "center" }}>
          <div style={{ maxWidth: 720 }}>
            <strong style={{ display: "block", color: "#ff8a8a", marginBottom: 14, letterSpacing: ".1em" }}>SLIDE ERROR · slides/{slideId}.tsx</strong>
            <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", font: "13px/1.6 ui-monospace, monospace", margin: "0 0 18px" }}>{slideCompileFailure || runtimeFailure}</pre>
            <button className="ss-btn" onClick={() => { setRuntimeFailure(null); setRetryNonce((n) => n + 1); }}>Retry</button>
          </div>
        </div>
      )}
      {!thumbnail && !settled && stallLevel > 0 && (
        <div role="status" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "rgba(12,12,14,.88)", color: "#eee", zIndex: 5, padding: 24, textAlign: "center" }}>
          <div>
            <div style={{ marginBottom: 12 }}>{stallLevel === 1 ? "Still loading this slide… it is taking longer than usual." : "This slide seems stuck."}</div>
            <button className="ss-btn" onClick={() => { setRetryNonce((n) => n + 1); setStallLevel(0); }}>Retry</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** effective source for a layer: slide override ?? deck common (plan §8) */
export function effectiveSource(override: Source | undefined, common: Source | undefined): Source | undefined {
  return override !== undefined ? override : common;
}
