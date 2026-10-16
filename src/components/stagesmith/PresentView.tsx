"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Grid2X2, Maximize2, Moon, QrCode, Sun, X } from "lucide-react";
import { api } from "@/lib/stagesmith/client";
import type { DeckBundle } from "@/lib/stagesmith/client";
import type { DeckJson, Source, ThemeMode } from "@/lib/stagesmith/types";
import { StageFrame } from "./StageFrame";
import { QrPanel } from "./QrPanel";
import { LiveThumb } from "./LiveThumb";
import { useDeckUpdated, useSync } from "@/hooks/useSync";
import { BrandLogo } from "./LibraryView";
import { download, type SsNav } from "./shared";

/**
 * The presenter display (plan §7).
 *
 * ONE live StageFrame renders the full composed stage — background, slide
 * content and overlays — exactly like the editor's "Final" preview (Problem 07:
 * present must match the editor pixel-for-pixel). The runtime hot-swaps only
 * the layer modules that changed, so the background and common overlay keep
 * running (no reload, no animation restart) across slide changes.
 *
 * Navigation is room-synced when the sync service is reachable (local runs)
 * and falls back to fully local navigation when it isn't (hosted deployments)
 * — the presenter always works, with or without a phone remote.
 */

/** transition defaults (deck settings override the duration) */
const T_EASE = "cubic-bezier(.22,1,.36,1)";
const T_MS = 430;

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

  // local navigation state — drives the deck whenever the room state is not
  // available (offline / hosted): the presenter never gets stuck (Problem 07)
  const start = fromParam ? Math.max(0, Number(fromParam) || 0) : 0;
  const [localIndex, setLocalIndex] = useState(start);
  const roomIndex =
    sync.connected && state ? Math.max(0, Math.min(state.index ?? 0, Math.max(0, slides.length - 1))) : null;
  const index = roomIndex ?? Math.max(0, Math.min(localIndex, Math.max(0, slides.length - 1)));
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
  useEffect(() => {
    if (!sync.connected || !state || didInitRef.current) return;
    didInitRef.current = true;
    if (fromParam !== null && slides[start]?.id) {
      setLocalIndex(start);
      sync.sendSlide(slides[start].id, 0);
    }
  }, [sync.connected, state, slides, fromParam]);

  // clock
  useEffect(() => {
    setNow(new Date());
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

  const lastIndexRef = useRef(index);
  const navNext = useCallback(() => {
    setDir("next");
    setLocalIndex((i) => Math.min(i + 1, Math.max(0, slides.length - 1)));
    sync.sendNav("next");
  }, [sync, slides.length]);
  const navPrev = useCallback(() => {
    setDir("prev");
    setLocalIndex((i) => Math.max(0, i - 1));
    sync.sendNav("prev");
  }, [sync]);

  const goSlide = useCallback((slideId: string) => {
    const to = slides.findIndex((s) => s.id === slideId);
    if (to >= 0) {
      setDir(to > lastIndexRef.current ? "next" : "prev");
      setLocalIndex(to);
    }
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
     The live stage glides in from the navigation direction — transform +
     opacity only, so it stays on the compositor at 60fps. */
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

  /* ---------- report steps ---------- */
  const onSteps = useCallback(
    (steps: number) => {
      if (current) sync.reportSteps(current.id, steps);
    },
    [sync, current],
  );

  const themeCss = bundle?.themeCss ?? "";
  const total = slides.length;
  const progress = total ? ((index + 1) / total) * 100 : 0;

  return (
    <div className={`ss-display ${chromeHidden ? "hide-chrome" : ""}`} onMouseMove={bump}>
      {/* stage */}
      <div className="ss-display-stage">
        <div style={{ position: "relative", width: "min(100vw, calc(100vh * 16 / 9))", aspectRatio: "16/9" }}>
          {/* the live stage — background + content + overlays in ONE sandboxed
              runtime, the exact pipeline the editor preview uses (Problem 07).
              Slide changes hot-swap only the slide module; the background and
              common overlay modules are reused, so their animations keep
              running across slides. */}
          <div ref={frameWrapRef} style={{ position: "absolute", inset: 0, zIndex: 2, isolation: "isolate" }}>
            <StageFrame
              deckId={deckId}
              slide={current}
              deckBg={deck?.bg}
              deckOverlay={deck?.overlay}
              commonOverlay={deck?.overlay}
              themeCss={themeCss}
              mode={effectiveMode}
              version={version}
              step={step}
              slideIndex={index}
              slideTotal={total}
              onSteps={onSteps}
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
          <div className="ss-brand" onClick={() => nav.deck(deckId)} title="Back to editor" style={{ gap: 8 }}>
            <span style={{ width: 17, height: 17, display: "inline-flex" }}>
              <BrandLogo size={17} showImage />
            </span>
            <span className="ss-chrome-title">{deck?.title ?? deckId}</span>
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
          <span className="ss-chip" style={{ height: 22 }} title={sync.unavailable ? "Presenting from this browser — phone remote needs a local run" : sync.connected ? "Synced with the phone remote service" : "Reconnecting to the sync service…"}>
            <span
              className="dot"
              style={{ background: sync.connected ? "var(--ss-ok)" : sync.unavailable ? "var(--ss-mut)" : "var(--ss-err)" }}
            />
            {sync.connected
              ? sync.remotes
                ? `${sync.remotes} remote${sync.remotes > 1 ? "s" : ""}`
                : "sync"
              : sync.unavailable
                ? "local"
                : "offline"}
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
            <span className="ss-ov-title">{deck?.title ?? "Overview"}</span>
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
                deckBg={deck?.bg}
                deckOverlay={deck?.overlay}
                defaultMode={effectiveMode}
                themeCss={themeCss}
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
          connected={sync.connected}
          unavailable={sync.unavailable}
          onClose={() => setUi((u) => ({ ...u, qr: false }))}
          absolute
        />
      )}
    </div>
  );
}

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
  deckBg?: Source;
  deckOverlay?: Source;
  defaultMode: ThemeMode;
  themeCss: string;
  onJump: () => void;
}) {
  const { deckId, entry, index, defaultMode } = props;
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
          <LiveThumb
            deckId={deckId}
            slideId={entry.id}
            slideTheme={entry.theme}
            deckDefaultMode={defaultMode}
            deckBg={props.deckBg}
            deckOverlay={props.deckOverlay}
            themeCss={props.themeCss}
            version={props.version}
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
