"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Grid2X2, Maximize2, Moon, QrCode, Sun, X } from "lucide-react";
import type { DeckBundle } from "@/lib/stagesmith/client";
import { api } from "@/lib/stagesmith/client";
import type { DeckJson, Source, ThemeMode } from "@/lib/stagesmith/types";
import { StageFrame } from "./StageFrame";
import { QrPanel } from "./QrPanel";
import { useDeckUpdated, useSync } from "@/hooks/useSync";
import { useInView } from "./LibraryView";
import type { SsNav } from "./shared";

/**
 * The presenter display (plan §7): layers bg → slide → overlay → chrome.
 * Server-resolved nav via WS; live edit hot-swap; 220ms transitions;
 * 1600ms bg crossfade; keys, swipe, click zones, overview, QR.
 */
export function PresentView({ deckId, fromParam, nav }: { deckId: string; fromParam: string | null; nav: SsNav }) {
  const [bundle, setBundle] = useState<DeckBundle | null>(null);
  const [version, setVersion] = useState("boot");
  const [sessionMode, setSessionMode] = useState<ThemeMode | null>(null);
  const [ui, setUi] = useState({ qr: false, overview: false });
  const [chromeHidden, setChromeHidden] = useState(false);
  const [freeze, setFreeze] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [dir, setDir] = useState<"next" | "prev">("next");

  const deck: DeckJson | null = bundle?.deck ?? null;
  const slides = useMemo(() => deck?.slides ?? [], [deck]);

  // sync — the display is the presenter: it owns the token
  const sync = useSync(deckId, "display", null, slides);
  const state = sync.state;
  const index = Math.max(0, Math.min(state?.index ?? 0, Math.max(0, slides.length - 1)));
  const step = state?.step ?? 0;
  const current = slides[index] ?? null;

  useEffect(() => {
    api.getDeck(deckId).then((b) => {
      setBundle(b);
      setVersion(b.signature);
    });
  }, [deckId]);

  // jump into position when the room state is missing (fresh room)
  // assert the start position on first join (present from start / from slide N)
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
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // live edit (plan: hot-swap the changed slide, stay in place)
  useDeckUpdated(sync.socket, useCallback(() => {
    if (freeze) return;
    api.getDeck(deckId).then((b) => {
      setBundle(b);
      setVersion(b.signature);
      sync.syncDeck(b.deck.slides.map((s) => ({ id: s.id, label: s.label })));
    }).catch(() => {});
  }, [deckId, freeze, sync]));

  const navNext = useCallback(() => {
    setDir("next");
    sync.sendNav("next");
  }, [sync]);
  const navPrev = useCallback(() => {
    setDir("prev");
    sync.sendNav("prev");
  }, [sync]);

  const goSlide = useCallback((slideId: string) => {
    sync.sendSlide(slideId, 0);
    setUi((u) => ({ ...u, overview: false }));
  }, [sync]);

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

  /* ---------- swipe + click zones (plan §7) ---------- */
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

  /* ---------- 220ms slide transition (plan §7) ---------- */
  const frameWrapRef = useRef<HTMLDivElement | null>(null);
  const lastSlideIdRef = useRef<string | null>(null);
  useEffect(() => {
    const el = frameWrapRef.current;
    const slideId = current?.id ?? null;
    if (!el || !slideId || lastSlideIdRef.current === slideId) return;
    const first = lastSlideIdRef.current === null;
    lastSlideIdRef.current = slideId;
    if (first) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;
    const move = dir === "next" ? 52 : -52; // 7vh on the 720 stage
    el.animate(
      [
        { opacity: 0, filter: "blur(12px)", transform: `translateY(${move}px)` },
        { opacity: 1, filter: "blur(0px)", transform: "translateY(0px)" },
      ],
      { duration: deck?.settings.transitionMs ?? 220, easing: "cubic-bezier(.16,1,.3,1)", fill: "backwards" },
    );
  }, [current?.id, dir, deck?.settings.transitionMs]);

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

  const onRuntimeError = useCallback((err: { phase: string; message: string }) => {
    // error card is shown inside the runtime; log for the presenter
    console.warn(`[stagesmith] runtime ${err.phase} error on ${current?.id}:`, err.message);
  }, [current?.id]);

  const themeCss = bundle?.themeCss ?? "";
  const total = slides.length;
  const progress = total ? ((index + 1) / total) * 100 : 0;

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
          {/* incoming background (below) — no crossfade when unchanged */}
          {bgKey !== "none" && <div style={{ position: "absolute", inset: 0, zIndex: 0 }}>{bgLayer(bgSource, `bg-${bgKey}`, fade ? fadeInRef : undefined)}</div>}
          {/* outgoing background (above, fading out during crossfade) */}
          {fade && fade.key !== "none" && (
            <div style={{ position: "absolute", inset: 0, zIndex: 1 }}>{bgLayer(fade.src, `bg-old-${fade.key}`, fadeOutRef)}</div>
          )}

          {/* content + overlay — single mounted slide (plan §7) */}
          <div ref={frameWrapRef} style={{ position: "absolute", inset: 0, zIndex: 2 }}>
            <StageFrame
              deckId={deckId}
              slide={current}
              deckBg={{ type: "none" }}
              deckOverlay={current?.overlay !== undefined ? current.overlay : deck?.overlay}
              themeCss={themeCss}
              mode={effectiveMode}
              version={version}
              step={step}
              slideIndex={index}
              slideTotal={total}
              onSteps={onSteps}
              onRuntimeError={onRuntimeError}
            />
          </div>
        </div>
      </div>

      {/* click zones (12%) */}
      <div className="ss-clickzone left" onClick={navPrev} title="Previous" />
      <div className="ss-clickzone right" onClick={navNext} title="Next" />

      {/* chrome — top */}
      <div className="ss-chrome top">
        <div className="ss-chrome-panel">
          <div className="ss-brand" onClick={() => nav.deck(deckId)} title="Back to editor">
            <svg viewBox="0 0 24 24" className="ss-brand-mark" style={{ width: 15, height: 15 }} aria-hidden>
              <path d="M12 3 22 20H2Z" fill="currentColor" />
            </svg>
            <span style={{ font: "600 13px var(--ss-sans)" }}>{deck?.title ?? deckId}</span>
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
            <span style={{ font: "600 11px var(--ss-mono)" }}>{freeze ? "FROZEN" : "LIVE"}</span>
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
            {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </span>
        </div>
        <div className="ss-chrome-panel">
          <button className="ss-ghost-btn" onClick={navPrev} title="Previous (←)">
            <ChevronLeft size={16} />
          </button>
          <span style={{ font: "500 12px var(--ss-mono)", letterSpacing: ".14em", fontVariantNumeric: "tabular-nums", color: "#eee" }}>
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
            className={`ss-dot ${i === index ? "cur" : ""} ${s.bg || s.overlay || s.theme ? "has-override" : ""}`}
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
                deck={deck}
                entry={s}
                index={i}
                current={i === index}
                themeCss={themeCss}
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

function isOnButton(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("button, a, input, textarea, [contenteditable]");
}

function toggleFull() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen().catch(() => {});
}

function OvItem(props: {
  deckId: string;
  deck: DeckJson | null;
  entry: DeckJson["slides"][number];
  index: number;
  current: boolean;
  themeCss: string;
  version: string;
  mode: ThemeMode;
  onJump: () => void;
}) {
  const { deckId, deck, entry, index, themeCss, version, mode } = props;
  const { ref, inView } = useInView<HTMLButtonElement>();
  return (
    <button ref={ref} className={`ss-ov-item ${props.current ? "cur" : ""}`} onClick={props.onJump}>
      <span className="ss-ov-n">{String(index + 1).padStart(2, "0")}</span>
      <span>
        <div className="ss-ov-t">{entry.label}</div>
        <div className="ss-ov-k">{entry.theme ? `theme ${entry.theme}` : entry.bg || entry.overlay ? "has override" : "\u00A0"}</div>
      </span>
      <span style={{ width: 120, height: 68, borderRadius: 8, overflow: "hidden", background: "#000", border: "1px solid rgba(255,255,255,.12)", flex: "none" }}>
        {inView && deck ? (
          <StageFrame
            deckId={deckId}
            slide={entry}
            deckBg={deck.bg}
            deckOverlay={deck.overlay}
            themeCss={themeCss}
            mode={mode}
            staticMode
            version={version}
            slideIndex={index}
            slideTotal={deck.slides.length}
          />
        ) : null}
      </span>
    </button>
  );
}
