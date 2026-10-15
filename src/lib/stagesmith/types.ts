/**
 * Stagesmith deck format (per "Stagesmith Final Plan" §4).
 * The folder is the project — deck.json only holds wiring and settings.
 */

export type ThemeMode = "dark" | "light";

/** A layer source: none | code | html | image */
export type Source =
  | { type: "none" }
  | { type: "code"; path: string }
  | {
      type: "html";
      path: string;
      fit?: "cover" | "contain" | "fill";
      opacity?: number;
      dim?: number;
    }
  | {
      type: "image";
      path: string;
      fit?: "cover" | "contain";
      position?: string;
      zoom?: number;
      blur?: number;
      dim?: number;
      opacity?: number;
      /** overlay-only */
      x?: number;
      y?: number;
      width?: number;
      rotation?: number;
      anchor?: string;
    };

export interface SlideEntry {
  id: string;
  label: string;
  /** per-slide theme mode override */
  theme?: ThemeMode;
  /** per-slide bg override (replaces common bg on this slide) */
  bg?: Source;
  /** per-slide overlay override */
  overlay?: Source;
}

export interface DeckSettings {
  size: [number, number];
  defaultMode: ThemeMode;
  transitionMs: number;
  bgCrossfadeMs: number;
}

export interface DeckJson {
  format: "smdeck";
  format_version: number;
  id: string;
  title: string;
  created: string;
  modified: string;
  settings: DeckSettings;
  bg: Source;
  overlay: Source;
  slides: SlideEntry[];
}

/** A single file row used by the editor + poller */
export interface FileRow {
  path: string;
  mtime: number;
  size: number;
}

export interface DeckSummary {
  id: string;
  title: string;
  slideCount: number;
  modified: string;
  /** signature of the whole folder — changes when anything changes */
  signature: string;
}

export interface CompileResult {
  ok: boolean;
  /** url of compiled module (with cache-busting version) */
  url?: string;
  error?: string;
  /** literal step count detected in source, if any */
  steps?: number;
  hash?: string;
}

export type LayerKind = "slide" | "bg" | "overlay";

export interface RuntimeConfig {
  type: "render";
  frameId: string;
  css: string;
  mode: ThemeMode;
  static: boolean;
  scale: number;
  assetBase: string;
  slide?: string | null;
  bg?: string | null;
  overlay?: string | null;
  show: { bg: boolean; content: boolean; overlay: boolean };
}

export type RuntimeMessage =
  | { type: "ready"; frameId: string }
  | { type: "boot-ok"; frameId: string }
  | { type: "boot-error"; frameId: string; message: string }
  | {
      type: "error";
      frameId: string;
      phase: "import" | "render" | "compile";
      message: string;
      stack?: string;
    }
  | { type: "rendered"; frameId: string; steps?: number }
  | { type: "steps"; frameId: string; steps: number };
