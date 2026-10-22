"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Moon, Sun } from "lucide-react";
import type { DeckJson, SlideEntry, Source, ThemeMode } from "@/lib/stagesmith/types";
import { StageFrame, resolveCode } from "./StageFrame";

type PreviewMode = "final" | "bg" | "content" | "overlay";

const SHOW: Record<PreviewMode, { bg: boolean; content: boolean; overlay: boolean }> = {
  final: { bg: true, content: true, overlay: true },
  bg: { bg: true, content: false, overlay: false },
  content: { bg: false, content: true, overlay: false },
  overlay: { bg: false, content: false, overlay: true },
};

/** Fit a 1280×720 stage into a box without cropping (fix-list item 1).
 *  Recalculated by a ResizeObserver, so window resizes, filmstrip changes
 *  and code-pane open / close / minimize all resize the preview cleanly. */
function useFitStage(margin = 24) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      // debounce via rAF — avoids layout thrash during resize drags
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (r.width <= 0 || r.height <= 0) return;
        const availW = Math.max(0, r.width - margin);
        const availH = Math.max(0, r.height - margin);
        const scale = Math.min(availW / 1280, availH / 720);
        const w = Math.floor(1280 * scale);
        const h = (w * 720) / 1280;
        setSize((prev) => (prev && prev.w === w && prev.h === h ? prev : { w, h }));
      });
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [margin]);
  return { ref, size };
}

export const PreviewPane = memo(function PreviewPane(props: {
  deckId: string;
  deck: DeckJson;
  sel: SlideEntry | null;
  themeCss: string;
  version: string;
  compileVersion?: string;
  onOverride: (slideId: string, layer: "bg" | "overlay", source: Source | undefined) => void;
  /** set the deck-wide default theme mode (readability fix: a light deck
   *  authored in dark mode has faint light ink — Problem 07) */
  onDeckMode?: (mode: ThemeMode) => void;
}) {
  const { deckId, deck, sel, themeCss, version, compileVersion, onDeckMode } = props;
  const [mode, setMode] = useState<PreviewMode>("final");
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [steps, setSteps] = useState(1);
  const fit = useFitStage(24);

  useEffect(() => {
    setStep(0);
    setSteps(1);
    setError(null);
  }, [sel?.id, version]);

  // compile meta for the selected slide (error banner + literal step count)
  useEffect(() => {
    if (!sel) return;
    let cancelled = false;
    resolveCode(deckId, `slides/${sel.id}.tsx`, version).then((meta) => {
      if (cancelled) return;
      setError(meta.error);
      if (meta.steps > 1) setSteps(meta.steps);
    });
    return () => {
      cancelled = true;
    };
  }, [deckId, sel?.id, version, sel]);

  const onSteps = useCallback((n: number) => {
    setSteps((prev) => (n > prev ? n : prev));
  }, []);

  const idx = deck.slides.findIndex((s) => s.id === sel?.id);
  const deckMode: ThemeMode = deck.settings.defaultMode ?? "dark";
  const slideMode: ThemeMode = sel?.theme ?? deckMode;

  /* transparent stage behind layer-only previews — shows the Chassé checkerboard */
  const frameThemeCss =
    mode === "content" || mode === "overlay" ? `${themeCss}\n#root { background: transparent !important; }` : themeCss;

  const modeTabs = useMemo(
    () => (["final", "bg", "content", "overlay"] as PreviewMode[]).map((m) => ({ m, label: m === "final" ? "Final" : m === "bg" ? "BG" : m === "content" ? "Content" : "Overlay" })),
    [],
  );

  return (
    <>
      <div className="ss-preview-toolbar">
        <div className="ss-mode-tabs">
          {modeTabs.map(({ m, label }) => (
            <button key={m} className={`ss-mode-tab ${mode === m ? "on" : ""}`} onClick={() => setMode(m)}>
              {label}
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        {onDeckMode && (
          <button
            className="ss-btn ss-btn-icon"
            style={{ height: 24, width: 24 }}
            onClick={() => onDeckMode(deckMode === "dark" ? "light" : "dark")}
            title={`Deck theme: ${deckMode}${sel?.theme ? ` (this slide overrides with ${slideMode})` : ""} — click to switch the deck default`}
          >
            {deckMode === "dark" ? <Moon size={13} /> : <Sun size={13} />}
          </button>
        )}
        {steps > 1 && mode !== "bg" && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="ss-label" style={{ letterSpacing: ".1em" }}>
              Step {step + 1}/{steps}
            </span>
            <button
              className="ss-btn ss-btn-icon"
              style={{ height: 24, width: 24 }}
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              title="Previous step"
            >
              <ChevronLeft size={13} />
            </button>
            <button
              className="ss-btn ss-btn-icon"
              style={{ height: 24, width: 24 }}
              onClick={() => setStep((s) => Math.min(steps - 1, s + 1))}
              title="Next step"
            >
              <ChevronRight size={13} />
            </button>
          </div>
        )}
        {sel && (
          <span className="ss-chip">
            {String(idx + 1).padStart(2, "0")} · {sel.label}
          </span>
        )}
      </div>
      <div className="ss-preview-stage" ref={fit.ref}>
        <div
          className={`ss-preview-frame ss-frame-${mode}`}
          style={
            fit.size
              ? { width: fit.size.w, height: fit.size.h, aspectRatio: "16 / 9", maxWidth: "100%", maxHeight: "100%" }
              : undefined
          }
        >
          {sel ? (
            <StageFrame
              deckId={deckId}
              slide={sel}
              deckBg={deck.bg}
              deckOverlay={deck.overlay}
              themeCss={frameThemeCss}
              mode={sel.theme ?? deck.settings.defaultMode}
              show={SHOW[mode]}
              version={version}
              compileVersion={compileVersion}
              step={step}
              slideIndex={idx}
              slideTotal={deck.slides.length}
              onSteps={onSteps}
            />
          ) : (
            <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
              <span className="ss-label" style={{ opacity: 0.5 }}>No slide selected</span>
            </div>
          )}
        </div>
      </div>
      {error && (
        <div className="ss-error-banner" style={{ borderTop: "1px solid var(--ss-errline)", borderBottom: 0 }}>
          <span style={{ color: "var(--ss-err)", fontWeight: 600 }}>Compile error</span>
          <span>{error}</span>
        </div>
      )}
    </>
  );
});
