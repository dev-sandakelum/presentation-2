"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { DeckJson, SlideEntry, Source } from "@/lib/stagesmith/types";
import { StageFrame, resolveCode } from "./StageFrame";

type PreviewMode = "final" | "bg" | "content" | "overlay";

const SHOW: Record<PreviewMode, { bg: boolean; content: boolean; overlay: boolean }> = {
  final: { bg: true, content: true, overlay: true },
  bg: { bg: true, content: false, overlay: false },
  content: { bg: false, content: true, overlay: false },
  overlay: { bg: false, content: false, overlay: true },
};

export function PreviewPane(props: {
  deckId: string;
  deck: DeckJson;
  sel: SlideEntry | null;
  themeCss: string;
  version: string;
  onOverride: (slideId: string, layer: "bg" | "overlay", source: Source | undefined) => void;
}) {
  const { deckId, deck, sel, themeCss, version } = props;
  const [mode, setMode] = useState<PreviewMode>("final");
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [steps, setSteps] = useState(1);

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
      <div className="ss-preview-stage">
        <div className="ss-preview-frame">
          {sel ? (
            <StageFrame
              deckId={deckId}
              slide={sel}
              deckBg={deck.bg}
              deckOverlay={deck.overlay}
              themeCss={themeCss}
              mode={sel.theme ?? deck.settings.defaultMode}
              show={SHOW[mode]}
              version={version}
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
        <div className="ss-error-banner" style={{ borderTop: "1px solid #4a1f22", borderBottom: 0 }}>
          <span style={{ color: "#f26d6d", fontWeight: 600 }}>Compile error</span>
          <span>{error}</span>
        </div>
      )}
    </>
  );
}
