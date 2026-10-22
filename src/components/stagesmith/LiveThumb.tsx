"use client";

import { memo } from "react";
import type { Source, ThemeMode } from "@/lib/stagesmith/types";
import { StageFrame } from "./StageFrame";

/**
 * LIVE client-side thumbnail (Problem 03 fix).
 *
 * The old system rendered stills with a server-side headless Chromium —
 * impossible on hosted/serverless deployments (no Chrome, read-only cache),
 * which is why placeholders like "01" appeared.
 *
 * LiveThumb runs the SAME sandboxed Stage Runtime as the big preview, in
 * static mode (animations frozen, all steps visible), scaled into the thumb
 * box. Because module versions are part of the render config, every thumb
 * refreshes automatically after ANY change — edits, undo/redo, theme, bg —
 * with nothing stored server-side.
 *
 * `slideBg` / `slideOverlay` carry the slide's OWN layer overrides — without
 * them a slide with its own (TSX or image) background renders the deck
 * default in every thumbnail instead of what the slide actually shows.
 */
export const LiveThumb = memo(function LiveThumb(props: {
  deckId: string;
  slideId: string | null;
  /** per-slide theme override (slide.theme) */
  slideTheme?: ThemeMode;
  deckDefaultMode: ThemeMode;
  deckBg?: Source;
  deckOverlay?: Source;
  /** the slide's OWN background override (falls back to deckBg) */
  slideBg?: Source;
  /** the slide's OWN overlay override (falls back to deckOverlay) */
  slideOverlay?: Source;
  themeCss: string;
  /** deck signature — bump re-resolves modules */
  version: string | number;
  compileVersion?: string | number;
  className?: string;
  onError?: (message: string) => void;
  loadPriority?: "selected" | "normal" | "background";
}) {
  const {
    deckId, slideId, slideTheme, deckDefaultMode, deckBg, deckOverlay, slideBg, slideOverlay,
    themeCss, version, compileVersion, className, onError, loadPriority,
  } = props;
  if (!slideId || !themeCss) {
    return <span className="ss-shimmer" aria-hidden />;
  }
  return (
    <StageFrame
      className={className}
      deckId={deckId}
      slide={{
        id: slideId,
        label: "",
        ...(slideTheme ? { theme: slideTheme } : {}),
        ...(slideBg !== undefined ? { bg: slideBg } : {}),
        ...(slideOverlay !== undefined ? { overlay: slideOverlay } : {}),
      }}
      deckBg={deckBg}
      deckOverlay={deckOverlay}
      themeCss={themeCss}
      mode={slideTheme ?? deckDefaultMode}
      staticMode
      thumbnail
      loadPriority={loadPriority}
      version={version}
      compileVersion={compileVersion}
      onRuntimeError={(err) => onError?.(err.message)}
    />
  );
});
