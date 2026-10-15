"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { RuntimeMessage, SlideEntry, Source, ThemeMode } from "@/lib/stagesmith/types";

/**
 * The sandboxed Stage Runtime wrapper (plan §5.1).
 * Fixed 1280×720 stage scaled to the container; module URLs are pre-flighted
 * through /api/compile?meta=1 so compile errors keep the last good preview.
 */

export interface StageFrameProps {
  deckId: string;
  slide?: SlideEntry | null;
  deckBg?: Source;
  deckOverlay?: Source;
  themeCss: string;
  mode: ThemeMode;
  show?: { bg: boolean; content: boolean; overlay: boolean };
  staticMode?: boolean;
  /** bump to force re-resolution (folder poll signature or explicit flush) */
  version: string | number;
  step?: number;
  slideIndex?: number;
  slideTotal?: number;
  className?: string;
  interactive?: boolean;
  onSteps?: (steps: number) => void;
  onRuntimeError?: (err: { phase: string; message: string }) => void;
}

interface MetaInfo {
  url: string | null;
  steps: number;
  error: string | null;
}

const metaCache = new Map<string, MetaInfo>();

export async function resolveCode(deckId: string, path: string, version: string | number): Promise<MetaInfo> {
  const key = `${deckId}:${path}:${version}`;
  const hit = metaCache.get(key);
  if (hit) return hit;
  try {
    const res = await fetch(`/api/compile?deck=${encodeURIComponent(deckId)}&file=${encodeURIComponent(path)}&meta=1`);
    const data = (await res.json()) as { ok: boolean; url?: string; steps?: number; error?: string };
    const info: MetaInfo = { url: data.ok ? data.url! : null, steps: data.steps || 1, error: data.ok ? null : data.error || "Compile failed" };
    metaCache.set(key, info);
    if (metaCache.size > 500) {
      const first = metaCache.keys().next().value;
      if (first) metaCache.delete(first);
    }
    return info;
  } catch (e) {
    return { url: null, steps: 1, error: (e as Error).message };
  }
}

export function imageSourceUrl(deckId: string, source: Extract<Source, { type: "image" }>): string {
  return `/api/assets/${deckId}/${source.path}`;
}

export function useResolvedSources(
  deckId: string,
  version: string | number,
  entries: Array<{ kind: "slide" | "bg" | "overlay" | "commonOverlay"; source: Source | null | undefined }>,
) {
  const [metas, setMetas] = useState<Record<string, MetaInfo>>({});
  const sig = entries.map((e) => `${e.kind}:${e.source ? JSON.stringify(e.source) : "none"}`).join("|");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const out: Record<string, MetaInfo> = {};
      for (const e of entries) {
        if (e.source && e.source.type === "code") {
          out[e.kind] = await resolveCode(deckId, e.source.path, version);
        } else {
          out[e.kind] = { url: null, steps: 1, error: null };
        }
      }
      if (!cancelled) setMetas(out);
    })();
    return () => {
      cancelled = true;
    };
     
  }, [deckId, version, sig]);
  return metas;
}

export function StageFrame(props: StageFrameProps) {
  const {
    deckId, slide, deckBg, deckOverlay, themeCss, mode,
    show = { bg: true, content: true, overlay: true },
    staticMode = false, version, step, slideIndex, slideTotal,
    className, interactive = false, onSteps, onRuntimeError,
  } = props;

  const frameId = useId().replace(/[^a-zA-Z0-9-]/g, "");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [scale, setScale] = useState(0.25);
  const loadedRef = useRef(false);
  const pendingRef = useRef<string | null>(null);

  const effective = (o?: Source): Source | undefined | null => {
    if (o === undefined) return undefined;
    return o;
  };
  const bgSource = slide?.bg !== undefined ? slide.bg : deckBg;
  const overlaySource = slide?.overlay !== undefined ? slide.overlay : deckOverlay;
  const commonOverlaySource = deckOverlay;

  const metas = useResolvedSources(deckId, version, [
    { kind: "slide", source: slide ? { type: "code", path: `slides/${slide.id}.tsx` } : null },
    { kind: "bg", source: bgSource && bgSource.type === "code" ? bgSource : null },
    { kind: "overlay", source: overlaySource && overlaySource.type === "code" ? overlaySource : null },
    { kind: "commonOverlay", source: commonOverlaySource && commonOverlaySource.type === "code" ? commonOverlaySource : null },
  ]);

  // last-good slide URL: compile errors keep the preview (plan §5.1).
  // Must be STATE: a ref updated in an effect would never re-render the
  // config memo, so the slide URL would never be posted.
  const [lastGoodSlide, setLastGoodSlide] = useState<string | null>(null);
  const slideMeta = metas.slide;
  useEffect(() => {
    if (slide?.id) setLastGoodSlide(null);
  }, [slide?.id]);
  useEffect(() => {
    if (slideMeta?.url) setLastGoodSlide(slideMeta.url);
  }, [slideMeta]);

  // simple memo deps (lint requires plain expressions)
  const bgKey = JSON.stringify(bgSource);
  const overlayKey = JSON.stringify(overlaySource);
  const showKey = JSON.stringify(show);
  const slideUrl = slide ? lastGoodSlide : null;
  const bgUrl = metas.bg?.url;
  const overlayUrl = metas.overlay?.url;
  const commonOverlayUrl = metas.commonOverlay?.url;
  const slideId = slide?.id;

  const configJson = useMemo(() => {
    const bgSrc = bgSource && bgSource.type === "image" ? bgSource : null;
    const ovSrc = overlaySource && overlaySource.type === "image" ? overlaySource : null;
    const bgImage = bgSrc ? { url: imageSourceUrl(deckId, bgSrc), ...bgSrc } : null;
    const overlayImage = ovSrc ? { url: imageSourceUrl(deckId, ovSrc), ...ovSrc } : null;
    return JSON.stringify({
      type: "render",
      frameId,
      css: themeCss,
      mode,
      static: staticMode,
      scale,
      assetBase: `/api/assets/${deckId}`,
      slide: slideUrl || null,
      // no last-good version to keep → the runtime shows the error card
      slideError: slideId && !slideUrl && slideMeta?.error ? slideMeta.error : null,
      bg: bgUrl || null,
      bgImage,
      overlay: overlayUrl || null,
      overlayImage,
      commonOverlay: commonOverlayUrl || null,
      show,
      slideIndex,
      slideTotal,
    });
  }, [
    frameId, themeCss, mode, staticMode, scale, deckId,
    slideId, slideUrl, slideMeta?.error, bgUrl, overlayUrl, commonOverlayUrl,
    bgKey, overlayKey, showKey, slideIndex, slideTotal,
  ]);

  // measure container → scale
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0].contentRect.width;
      if (w > 0) setScale(w / 1280);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // post config when ready / changed — latest config kept in a ref so the
  // iframe can be healed by re-posting on load or 'ready' (idempotent)
  const latestCfgRef = useRef<string | null>(null);
  latestCfgRef.current = configJson;

  const postLatest = useCallback(() => {
    const win = iframeRef.current?.contentWindow;
    const cfg = latestCfgRef.current;
    if (!win || !cfg) return;
    win.postMessage(JSON.parse(cfg), "*");
  }, []);

  useEffect(() => {
    if (loadedRef.current) {
      postLatest();
    } else {
      pendingRef.current = configJson;
    }
  }, [configJson, postLatest]);

  // iframe onLoad: module may have registered before we attached; re-post
  const onIframeLoad = useCallback(() => {
    loadedRef.current = true;
    // the runtime's own 'ready' may beat onLoad; posting twice is idempotent
    setTimeout(postLatest, 60);
    setTimeout(postLatest, 350);
  }, [postLatest]);

  // step updates
  useEffect(() => {
    const win = iframeRef.current?.contentWindow;
    if (win && loadedRef.current && step !== undefined) {
      win.postMessage({ type: "set-step", step }, "*");
    }
  }, [step, configJson]);

  // messages from the runtime
  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      const m = ev.data as RuntimeMessage & { frameId?: string };
      if (!m || typeof m !== "object" || m.frameId !== frameId) return;
      if (m.type === "ready" || m.type === "boot-ok") {
        loadedRef.current = true;
        postLatest();
      } else if (m.type === "rendered" && onSteps) {
        onSteps(m.steps ?? 1);
      } else if (m.type === "error" && onRuntimeError) {
        onRuntimeError({ phase: m.phase, message: m.message });
      }
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
    </div>
  );
}

/** effective source for a layer: slide override ?? deck common (plan §8) */
export function effectiveSource(override: Source | undefined, common: Source | undefined): Source | undefined {
  return override !== undefined ? override : common;
}
