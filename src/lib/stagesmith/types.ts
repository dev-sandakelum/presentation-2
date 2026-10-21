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
  /** original upload file name when the stored name is sanitized */
  display?: string;
}

export interface DeckSummary {
  id: string;
  title: string;
  slideCount: number;
  modified: string;
  /** signature of the whole folder — changes when anything changes */
  signature: string;
  /** true when the project folder lives outside decks/ (linked project) */
  external?: boolean;
  /** where this deck lives: "server" (app folder, local runs), "browser"
   *  (this browser's storage — hosted/read-only deployments) or "desktop"
   *  (the Chassé desktop app's chosen folder, via the fs bridge) */
  store?: "server" | "browser" | "desktop";
  /** true when the deck mirrors into a folder on the user's device
   *  (File System Access API — Chromium browsers) */
  device?: boolean;
  /** device-folder name (decks can share a title — the delete dialog needs
   *  the folder to say exactly what will be removed); for desktop decks this
   *  is the absolute path of the deck folder */
  folderName?: string;
  /** minimal payload to render a live cover thumbnail without loading the deck */
  cover?: DeckCover;
}

/** everything a live cover/thumb needs, without a full bundle fetch */
export interface DeckCover {
  slideId: string | null;
  mode: ThemeMode;
  bg: Source;
  overlay: Source;
  themeCss: string;
}

/** full deck payload used by the editor / presenter / remote (client + SSR) */
export interface DeckBundle {
  deck: DeckJson;
  files: FileRow[];
  signature: string;
  themeCss: string;
  /** "browser" decks live in this browser's storage; "desktop" decks live
   *  in the Chassé desktop app's chosen folder (fs bridge) */
  store?: "server" | "browser" | "desktop";
  /** device-folder mirror is attached (File System Access API) */
  device?: boolean;
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

/** present-mode transition directive carried by a render config — attached
 *  only to the config that applies a NEW slide's resolved modules. The
 *  runtime's controller then runs: exiting → (bgChanging, only when the
 *  background key differs) → entering. */
export interface TransitionDirective {
  dir: "next" | "prev";
  /** content fade-out, ms */
  exitMs: number;
  /** background crossfade, ms */
  bgMs: number;
  /** content fade-in, ms */
  enterMs: number;
}

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
  transition?: TransitionDirective;
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
  | { type: "steps"; frameId: string; steps: number }
  /** observability: the transition controller's phase changes (verification
   *  harness + debugging; no UI action required) */
  | {
      type: "transition";
      frameId: string;
      phase:
        | "start" // transition begins (exit phase follows immediately)
        | "bg" // background crossfade started
        | "enter" // new content glides in
        | "done" // controller back to idle
        | "interrupt" // superseded by a newer target (rapid input)
        | "skip" // directive ignored (reduced motion)
        | "instant"; // applied without choreography (editor/first config)
      dir?: "next" | "prev";
      bgChanged?: boolean;
      to?: string | null;
      reason?: string;
    };
