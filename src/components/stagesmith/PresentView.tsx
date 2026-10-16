"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Grid2X2, Maximize2, Moon, QrCode, Sun, X } from "lucide-react";
import { api } from "@/lib/stagesmith/client";
import type { DeckBundle } from "@/lib/stagesmith/client";
import type { DeckJson, Source, ThemeMode } from "@/lib/stagesmith/types";
import { StageFrame } from "./StageFrame";
import { QrPanel } from "./QrPanel";
import { ThumbImg } from "./ThumbImg";
import { useDeckUpdated, useSync } from "@/hooks/useSync";
import { BrandLogo } from "./LibraryView";
import type { SsNav } from "./shared";

/**
 * The presenter display (plan §7) — layered for buttery transitions:
 *
 *   z0  background   live StageFrame, 1600 ms crossfade on change
 *   z2  content      live StageFrame (slide + per-slide overlay override),
 *                    animated on every slide change, with a static "ghost"
 *                    still of the OUTGOING slide gliding out on top
 *   z4  deck overlay a SEPARATE persistent StageFrame that never mounts
 *                    inside the animated wrapper — slide changes don't
 *                    re-render, re-animate or refresh it
 *
 * Server-resolved nav via WS; live edit hot-swap; keyboard / swipe /
 * click zones / overview / QR.
 */

/** transition defaults (deck settings override the duration) */
const T_EASE = "cubic-bezier(.22,1,.36,1)";
const T_MS = 430;
const GHOST_MS = 460;

export function PresentView({
  deckId,
  fromParam,
  nav,
  initialBundle,
}: {
  deckId: string;
  fromParam: string | null;
  nav: SsNav;
  initialBundle: DeckBundle | null;
}) {
  const [bundle, setBundle] = useState<DeckBundle | null>(initialBundle ?? null);
  const [version, setVersion] = useState(initialBundle?.signature ?? "boot");
  const [sessionMode, setSessionMode] = useState<ThemeMode | null>(null);
  const [ui, setUi] = useState({ qr: false, overview: false });
  const [chromeHidden, setChromeHidden] = useState(false);
  const [freeze, setFreeze] = useState(false);
  // client-only clock — a server-rendered time would always differ from
  // hydration time (hydration mismatch)
  const [now, setNow] = useState<Date | null>(null);
  const [dir, setDir] = useState<"next" | "prev">("next");

  const deck: DeckJson | null = bundle?.deck ?? null;
  const slides = useMemo(() => deck?.slides ?? [], [deck]);

  // sync — the display is the presenter: it owns the token
  const sync = useSync(deckId, "display", null, slides);
  const state = sync.state;
  const index = Math.max(0, Math.min(state?.index ?? 0, Math.max(0, slides.length - 1)));
  const step = state?.step ?? 0;
  const current = slides[index] ?? null;

  // SSR delivered the bundle — only fetch when missing or stale
  useEffect(() => {
    if (initialBundle?.deck && initialBundle.deck.id === deckId) return;
    api.getDeck(deckId).then((b) => {
      setBundle(b);
      setVersion(b.signature);
    });
  }, [deckId, initialBundle]);

  // jump into position when the room state is missing (fresh room)
  const didInitRef = useRef(false);
  const start = fromParam ? Math.max(0, Number(fromParam) || 0) : 0;
  useEffect(() => {
    if (!sync.connected || !state || didInitRef.current) return;
    didInitRef.current = true;
    if (fromParam !== null && slides[start]?.id) {
      sync.sendSlide(slides[start].id, 0);
    }
  }, [sync.connected, state, slides, fromParam]);

  // clock
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // warm the stills of the current + adjacent slides (transition ghosts)
  useEffect(() => {
    if (!current) return;
    const around = [slides[index - 1]?.id, current.id, slides[index + 1]?.id].filter(Boolean);
    for (const id of around) {
      const s = slides.find((x) => x.id === id);
      if (!s) continue;
      const img = new Image();
      img.src = api.thumbUrl(deckId, id, {
        w: 1280,
        layers: "content",
        mode: s.theme ?? deck?.settings.defaultMode,
        v: version,
        np: true,
      });
    }
  }, [deckId, current?.id, version, deck?.settings.defaultMode, index, slides, current]);

  // live edit (plan: hot-swap the changed slide, stay in place)
  useDeckUpdated(sync.socket, useCallback(() => {
    if (freeze) return;
    api.getDeck(deckId).then((b) => {
      setBundle(b);
      setVersion(b.signature);
      sync.syncDeck(b.deck.slides.map((s) => ({ id: s.id, label: s.label })));
    }).catch(() => {});
  }, [deckId, freeze, sync]));

  const lastIndexRef = useRef(index);
  const navNext = useCallback(() => {
    setDir("next");
    sync.sendNav("next");
  }, [sync]);
  const navPrev = useCallback(() => {
    setDir("prev");
    sync.sendNav("prev");
  }, [sync]);

  const goSlide = useCallback((slideId: string) => {
    const to = slides.findIndex((s) => s.id === slideId);
    if (to >= 0) setDir(to > lastIndexRef.current ? "next" : "prev");
    sync.sendSlide(slideId, 0);
    setUi((u) => ({ ...u, overview: false }));
  }, [sync, slides]);

  const toggleMode = useCallback(() => {
    setSessionMode((m) => (m === "dark" ? "light" : m === "light" ? null : "dark"));
  }, []);

  // theme mode: session override ?? slide override ?? deck default
  const effectiveMode: ThemeMode = sessionMode ?? current?.theme ?? deck?.settings.defaultMode ?? "dark";

  /* ---------- keyboard ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key;
      if (k === "ArrowRight" || k === "PageDown" || (k === " " && !isOnButton(e.target))) {
        e.preventDefault();
        navNext();
      } else if (k === "ArrowLeft" || k === "PageUp") {
        e.preventDefault();
        navPrev();
      } else if (k === "Home") {
        if (slides[0]) goSlide(slides[0].id);
      } else if (k === "End") {
        if (slides[slides.length - 1]) goSlide(slides[slides.length - 1].id);
      } else if (k === "f" || k === "F") {
        toggleFull();
      } else if (k === "g" || k === "G" || k === "o" || k === "O") {
        setUi((u) => ({ ...u, overview: !u.overview, qr: false }));
      } else if (k === "q" || k === "Q") {
        setUi((u) => ({ ...u, qr: !u.qr, overview: false }));
      } else if (k === "t" || k === "T") {
        toggleMode();
      } else if (k === "Escape") {
        if (ui.qr || ui.overview) setUi({ qr: false, overview: false });
        else nav.deck(deckId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navNext, navPrev, goSlide, toggleMode, slides, ui, nav, deckId]);

  /* ---------- swipe (plan §7) ---------- */
  const touchRef = useRef({ x: 0, y: 0 });
  useEffect(() => {
    const onStart = (e: TouchEvent) => {
      touchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    };
    const onEnd = (e: TouchEvent) => {
      const dx = e.changedTouches[0].clientX - touchRef.current.x;
      const dy = e.changedTouches[0].clientY - touchRef.current.y;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        if (dx < 0) navNext();
        else navPrev();
      }
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchend", onEnd);
    };
  }, [navNext, navPrev]);

  /* ---------- auto-hide chrome after 3s (plan §7) ---------- */
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bump = useCallback(() => {
    setChromeHidden(false);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setChromeHidden(true), 3000);
  }, []);
  useEffect(() => {
    bump();
    const events: Array<keyof WindowEventMap> = ["mousemove", "mousedown", "keydown", "touchstart", "wheel"];
    for (const ev of events) window.addEventListener(ev, bump, { passive: true });
    return () => {
      for (const ev of events) window.removeEventListener(ev, bump);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [bump]);

  /* ---------- smooth slide transition (incoming) ----------
     The live content frame glides in from the navigation direction —
     transform + opacity only, so it stays on the compositor at 60fps. */
  const frameWrapRef = useRef<HTMLDivElement | null>(null);
  const lastSlideIdRef = useRef<string | null>(null);
  useEffect(() => {
    const el = frameWrapRef.current;
    const slideId = current?.id ?? null;
    if (!el || !slideId) return;
    const first = lastSlideIdRef.current === null;
    const changed = lastSlideIdRef.current !== slideId;
    if (changed) {
      const to = slides.findIndex((s) => s.id === slideId);
      if (to >= 0 && lastIndexRef.current !== to) setDir(to > lastIndexRef.current ? "next" : "prev");
      lastIndexRef.current = to >= 0 ? to : index;
    } else {
      lastIndexRef.current = index;
    }
    lastSlideIdRef.current = slideId;
    if (first) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;
    const fromX = dir === "next" ? 44 : -44;
    el.animate(
      [
        { opacity: 0, transform: `translateX(${fromX}px) scale(.988)` },
        { opacity: 1, transform: "translateX(0px) scale(1)" },
      ],
      { duration: Math.max(300, deck?.settings.transitionMs ?? T_MS), easing: T_EASE, fill: "backwards" },
    );
     
  }, [current?.id, dir, deck?.settings.transitionMs]);

  /* ---------- exit ghost (outgoing static still) ----------
     A pre-generated transparent still of the outgoing slide glides OUT
     above the incoming frame — a true two-layer cross transition without
     keeping two live runtimes around. */
  const [ghost, setGhost] = useState<{ slideId: string; src: string; key: number } | null>(null);
  const ghostRef = useRef<HTMLImageElement | null>(null);
  const prevSlideRef = useRef<{ id: string; mode: ThemeMode } | null>(null);

  useEffect(() => {
    const t0 = Date.now();
    const prev = prevSlideRef.current;
    const cur = current ? { id: current.id, mode: current.theme ?? deck?.settings.defaultMode ?? "dark" } : null;
    prevSlideRef.current = cur;
    if (!prev || !cur || prev.id === cur.id) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setGhost(null);
      return;
    }
    // fire the ghost only when its still is already warm in the cache —
    // never block or flicker the live swap (np=1 → 404 while cold)
    const src = api.thumbUrl(deckId, prev.id, { w: 1280, layers: "content", mode: prev.mode, v: version, np: true });
    const probe = new Image();
    probe.onload = () => {
      // too late — the transition is over, a ghost would look out of place
      if (Date.now() - t0 > 650) return;
      setGhost({ slideId: prev.id, src, key: Date.now() });
      requestAnimationFrame(() => {
        const el = ghostRef.current;
        if (!el) return;
        const toX = dir === "next" ? -40 : 40;
        el.animate(
          [
            { opacity: 0.98, transform: "translateX(0px) scale(1)" },
            { opacity: 0, transform: `translateX(${toX}px) scale(1.012)` },
          ],
          { duration: GHOST_MS, easing: T_EASE, fill: "forwards" },
        );
      });
    };
    probe.src = src;
    const t = setTimeout(() => setGhost(null), GHOST_MS + 60);
    return () => clearTimeout(t);
  }, [current?.id, deckId, dir, version, deck?.settings.defaultMode]);

  /* ---------- 1600ms bg crossfade (plan §8) ----------
     No change → no fade. On change: incoming below zooms 1.045→1 and fades
     in, outgoing stays above and fades out. Common bg across consecutive
     slides never remounts (running effects never restart). */
  const bgSource: Source | undefined = current?.bg !== undefined ? current.bg : deck?.bg;
  const bgKey = bgSource ? JSON.stringify(bgSource) : "none";
  const [fade, setFade] = useState<{ key: string; src: Source | undefined } | null>(null);
  const lastBgRef = useRef<{ key: string; src: Source | undefined } | null>(null);
  const fadeInRef = useRef<HTMLDivElement | null>(null);
  const fadeOutRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const prev = lastBgRef.current;
    lastBgRef.current = { key: bgKey, src: bgSource };
    if (!prev || prev.key === bgKey || prev.key === "none" || bgKey === "none") {
      setFade(null);
      return;
    }
    setFade(prev);
    const ms = deck?.settings.bgCrossfadeMs ?? 1600;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduced) {
      fadeInRef.current?.animate(
        [
          { opacity: 0, transform: "scale(1.045)" },
          { opacity: 1, transform: "scale(1)" },
        ],
        { duration: ms, easing: "cubic-bezier(.16,1,.3,1)" },
      );
      fadeOutRef.current?.animate(
        [
          { opacity: 1, transform: "scale(1)" },
          { opacity: 0, transform: "scale(1.012)" },
        ],
        { duration: ms, easing: "cubic-bezier(.16,1,.3,1)" },
      );
    }
    const t = setTimeout(() => setFade(null), reduced ? 60 : ms);
    return () => clearTimeout(t);
  }, [bgKey]);

  /* ---------- report steps ---------- */
  const onSteps = useCallback(
    (steps: number) => {
      if (current) sync.reportSteps(current.id, steps);
    },
    [sync, current],
  );

  const themeCss = bundle?.themeCss ?? "";
  const themeCssTransparent = themeCss + "\n#root { background: transparent !important; }";
  const total = slides.length;
  const progress = total ? ((index + 1) / total) * 100 : 0;

  /* layer sources — the common overlay renders in its OWN persistent frame */
  const contentOverlay: Source | undefined = current?.overlay !== undefined ? current.overlay : { type: "none" };
  const commonOverlay: Source | undefined = deck?.overlay;
  const slideOverridesOverlay = Boolean(current?.overlay && current.overlay.type !== "none");

  const bgLayer = (src: Source | undefined, key: string, innerRef?: React.RefObject<HTMLDivElement | null>) => (
    <div key={key} style={{ position: "absolute", inset: 0 }}>
      <div ref={innerRef} style={{ position: "absolute", inset: 0 }}>
        <StageFrame
          deckId={deckId}
          slide={null}
          deckBg={src}
          deckOverlay={{ type: "none" }}
          themeCss={themeCss}
          mode={effectiveMode}
          show={{ bg: true, content: false, overlay: false }}
          version={version}
        />
      </div>
    </div>
  );

  return (
    <div className={`ss-display ${chromeHidden ? "hide-chrome" : ""}`} onMouseMove={bump}>
      {/* stage */}
      <div className="ss-display-stage">
        <div style={{ position: "relative", width: "min(100vw, calc(100vh * 16 / 9))", aspectRatio: "16/9" }}>
          {/* z0 — incoming background (below), crossfades on change */}
          {bgKey !== "none" && <div style={{ position: "absolute", inset: 0, zIndex: 0 }}>{bgLayer(bgSource, `bg-${bgKey}`, fade ? fadeInRef : undefined)}</div>}
          {/* z0 — outgoing background (above, fading out during crossfade) */}
          {fade && fade.key !== "none" && (
            <div style={{ position: "absolute", inset: 0, zIndex: 1 }}>{bgLayer(fade.src, `bg-old-${fade.key}`, fadeOutRef)}</div>
          )}

          {/* z2 — content + per-slide overlay (single mounted slide, animated) */}
          <div ref={frameWrapRef} style={{ position: "absolute", inset: 0, zIndex: 2, isolation: "isolate" }}>
            <StageFrame
              deckId={deckId}
              slide={current}
              deckBg={{ type: "none" }}
              deckOverlay={contentOverlay}
              commonOverlay={deck?.overlay}
              themeCss={themeCssTransparent}
              mode={effectiveMode}
              version={version}
              step={step}
              slideIndex={index}
              slideTotal={total}
              onSteps={onSteps}
            />
          </div>

          {/* z3 — outgoing ghost still (transparent, glides out on top of content) */}
          {ghost && (
            <img
              key={ghost.key}
              ref={ghostRef}
              src={ghost.src}
              alt=""
              aria-hidden
              draggable={false}
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "fill",
                zIndex: 3,
                pointerEvents: "none",
                willChange: "transform, opacity",
              }}
            />
          )}

          {/* z4 — deck common overlay: persistent, NEVER inside the animated
              wrapper — slide changes don't re-render, animate or refresh it */}
          {commonOverlay && commonOverlay.type !== "none" && (
            <CommonOverlayFrame
              key="common-overlay"
              deckId={deckId}
              source={commonOverlay}
              themeCss={themeCssTransparent}
              mode={effectiveMode}
              version={version}
              hidden={slideOverridesOverlay}
            />
          )}
        </div>
      </div>

      {/* click zones (12%) */}
      <div className="ss-clickzone left" onClick={navPrev} title="Previous" />
      <div className="ss-clickzone right" onClick={navNext} title="Next" />

      {/* chrome — top */}
      <div className="ss-chrome top">
        <div className="ss-chrome-panel">
          <div className="ss-brand" onClick={() => nav.deck(deckId)} title="Back to editor" style={{ gap: 8 }}>
            <span style={{ width: 17, height: 17, display: "inline-flex" }}>
              <BrandLogo size={17} />
            </span>
            <span style={{ font: "600 13px var(--ss-fd)" }}>{deck?.title ?? deckId}</span>
          </div>
        </div>
        <div className="ss-chrome-panel">
          <button className="ss-ghost-btn" onClick={toggleMode} title="Toggle theme (T) — session only">
            {effectiveMode === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <button className="ss-ghost-btn" onClick={() => setUi((u) => ({ ...u, overview: !u.overview, qr: false }))} title="Overview (O)">
            <Grid2X2 size={16} />
          </button>
          <button className="ss-ghost-btn" onClick={toggleFull} title="Fullscreen (F)">
            <Maximize2 size={16} />
          </button>
          <button
            className="ss-ghost-btn"
            onClick={() => setFreeze((f) => !f)}
            title={freeze ? "Frozen — file changes are NOT applied (click to unfreeze)" : "Live edit on (click to freeze)"}
            style={freeze ? { borderColor: "var(--ss-acc)", color: "var(--ss-acc)" } : undefined}
          >
            <span style={{ font: "600 10px var(--ss-fm)", letterSpacing: ".12em" }}>{freeze ? "FROZEN" : "LIVE"}</span>
          </button>
        </div>
      </div>

      {/* chrome — bottom */}
      <div className="ss-chrome bottom">
        <div className="ss-chrome-panel">
          <span className="ss-label" style={{ maxWidth: "34vw", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {current?.label ?? "—"}
          </span>
        </div>
        <div className="ss-chrome-panel">
          <span className="ss-chip" style={{ height: 22 }}>
            <span className="dot" style={{ background: sync.connected ? "var(--ss-ok)" : "var(--ss-err)" }} />
            {sync.connected ? (sync.remotes ? `${sync.remotes} remote${sync.remotes > 1 ? "s" : ""}` : "sync") : "offline"}
          </span>
          <span className="ss-label" style={{ letterSpacing: ".1em", fontVariantNumeric: "tabular-nums" }}>
            {now
              ? now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
              : "--:--:--"}
          </span>
        </div>
        <div className="ss-chrome-panel">
          <button className="ss-ghost-btn" onClick={navPrev} title="Previous (←)">
            <ChevronLeft size={16} />
          </button>
          <span style={{ font: "500 12px var(--ss-fm)", letterSpacing: ".14em", fontVariantNumeric: "tabular-nums", color: "var(--ss-ink2)" }}>
            {String(index + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
            {(state?.steps ?? 1) > 1 ? ` · ${step + 1}/${state?.steps}` : ""}
          </span>
          <button className="ss-ghost-btn" onClick={navNext} title="Next (→)">
            <ChevronRight size={16} />
          </button>
          <button className="ss-ghost-btn" onClick={() => setUi((u) => ({ ...u, qr: !u.qr, overview: false }))} title="QR panel (Q)">
            <QrCode size={15} />
          </button>
        </div>
      </div>

      {/* right dot nav */}
      <nav className="ss-dotnav" aria-label="Slides">
        {slides.map((s, i) => (
          <button
            key={s.id}
            className={`ss-dot ${i === index ? "cur" : ""} ${s.bg && s.bg.type !== "none" ? "has-override" : ""}`}
            onClick={() => goSlide(s.id)}
            title={s.label}
          >
            <span className="ss-dot-label">{s.label}</span>
          </button>
        ))}
      </nav>

      {/* progress bar */}
      <div className="ss-progress">
        <div className="ss-progress-bar" style={{ width: `${progress}%` }} />
      </div>

      {/* overview grid */}
      {ui.overview && (
        <div className="ss-ov ss-scroll" role="dialog" aria-label="Slide overview">
          <div className="ss-ov-head">
            <span className="ss-ov-title">Overview</span>
            <span className="ss-ov-hint">Click a slide to jump · Esc to close</span>
            <button className="ss-ghost-btn" onClick={() => setUi((u) => ({ ...u, overview: false }))} title="Close (Esc)">
              <X size={16} />
            </button>
          </div>
          <div className="ss-ov-grid">
            {slides.map((s, i) => (
              <OvItem
                key={s.id}
                deckId={deckId}
                entry={s}
                index={i}
                current={i === index}
                version={version}
                mode={s.theme ?? effectiveMode}
                onJump={() => goSlide(s.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* QR panel */}
      {ui.qr && (
        <QrPanel
          deckId={deckId}
          token={sync.token}
          remotes={sync.remotes}
          onClose={() => setUi((u) => ({ ...u, qr: false }))}
          absolute
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* persistent common overlay frame                                     */
/* ------------------------------------------------------------------ */

/**
 * The deck-wide overlay in its own sandbox layer, OUTSIDE any animated
 * wrapper. Memoized hard: slide changes change none of its props, so the
 * iframe never re-receives a config — its animations keep running untouched
 * across slide transitions. A slide-level overlay override hides it with
 * CSS (the runtime DOM survives, so returning slides don't restart it).
 */
const CommonOverlayFrame = memo(function CommonOverlayFrame({
  deckId,
  source,
  themeCss,
  mode,
  version,
  hidden,
}: {
  deckId: string;
  source: Source;
  themeCss: string;
  mode: ThemeMode;
  version: string;
  hidden: boolean;
}) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 4,
        pointerEvents: "none",
        opacity: hidden ? 0 : 1,
        transition: "opacity .18s linear",
        willChange: "opacity",
      }}
    >
      <StageFrame
        deckId={deckId}
        slide={null}
        deckBg={{ type: "none" }}
        deckOverlay={source}
        themeCss={themeCss}
        mode={mode}
        show={{ bg: false, content: false, overlay: true }}
        version={version}
      />
    </div>
  );
});

function isOnButton(target: EventTarget | null): boolean {
  return Boolean(target instanceof Element && target.closest("button, a, input, textarea, [contenteditable]"));
}

function toggleFull() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen().catch(() => {});
}

function OvItem(props: {
  deckId: string;
  entry: DeckJson["slides"][number];
  index: number;
  current: boolean;
  version: string;
  mode: ThemeMode;
  onJump: () => void;
}) {
  const { deckId, entry, index, mode } = props;
  const { ref, inView } = useInViewLite<HTMLButtonElement>();
  return (
    <button ref={ref} className={`ss-ov-item ${props.current ? "cur" : ""}`} onClick={props.onJump}>
      <span className="ss-ov-n">{String(index + 1).padStart(2, "0")}</span>
      <span>
        <div className="ss-ov-t">{entry.label}</div>
        <div className="ss-ov-k">{entry.bg ? "bg override" : entry.theme ? `theme ${entry.theme}` : "\u00A0"}</div>
      </span>
      <span className="ss-ov-thumb">
        {inView ? (
          <ThumbImg
            src={api.thumbUrl(deckId, entry.id, { w: 320, mode, v: props.version })}
            alt={`${entry.label} — slide ${index + 1}`}
          />
        ) : (
          <span className="ss-shimmer" aria-hidden />
        )}
      </span>
    </button>
  );
}

/** local lazy-mount observer (kept independent from the library one) */
function useInViewLite<T extends HTMLElement>(rootMargin = "200px") {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setInView(true);
          ro.disconnect();
        }
      },
      { rootMargin },
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, [rootMargin]);
  return { ref, inView };
}
