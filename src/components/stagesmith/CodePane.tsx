"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState, memo } from "react";
import dynamic from "next/dynamic";
import type { EditorView } from "@codemirror/view";
import { AlertTriangle, Braces, ChevronsDown, ChevronsUp, Copy, FilePlus2, PanelBottom, PanelRight, Save, Trash2, Upload, WandSparkles } from "lucide-react";
import type { DeckJson, FileRow, SlideEntry, Source } from "@/lib/stagesmith/types";
import { api, assetRouteUrl } from "@/lib/stagesmith/client";
import { FORMATABLE_EXT, formatTsx } from "@/lib/stagesmith/format";
import { useUiTheme } from "@/hooks/useUiTheme";
import { copyText, fixPrompt, sourceLabel } from "./shared";
import { resolveCode } from "./StageFrame";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog } from "./ConfirmDialog";
import { PromptDialog } from "./PromptDialog";

/** the whole CodeMirror stack loads in its own chunk — fast first paint */
const CmEditor = dynamic(() => import("./editor/CmEditor"), {
  ssr: false,
  loading: () => (
    <div style={{ height: "100%", display: "grid", placeItems: "center" }}>
      <span className="ss-label" style={{ opacity: 0.45 }}>Loading editor…</span>
    </div>
  ),
});

export type CodeTab = "slide" | "bg" | "overlay" | "notes" | "assets" | "theme";

/** cursor jump request from the filmstrip error badge (fix-list item 4) */
export interface GotoError {
  slideId: string;
  line: number;
  col: number;
  nonce: number;
}

/**
 * Format a TSX buffer once, when it first appears in the editor
 * (fix-list item 2). The result is applied through onBufferChange, so it
 * is a single undoable edit that autosaves like any other change.
 */
function useFormatOnOpen(
  path: string | null,
  content: string | undefined,
  apply: (formatted: string) => void,
) {
  const doneRef = useRef<Set<string>>(new Set());
  const busyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!path || content === undefined) return;
    if (!FORMATABLE_EXT.test(path) || doneRef.current.has(path) || busyRef.current === path) return;
    busyRef.current = path;
    let cancelled = false;
    (async () => {
      const formatted = await formatTsx(content);
      if (formatted !== content) apply(formatted);
      if (!cancelled) doneRef.current.add(path);
      busyRef.current = null;
    })();
    return () => {
      cancelled = true;
    };
  }, [path, content, apply]);
}

export const CodePane = memo(function CodePane(props: {
  deckId: string;
  deck: DeckJson;
  files: FileRow[];
  sel: SlideEntry | null;
  tab: CodeTab;
  onTab: (t: CodeTab) => void;
  buffers: Record<string, string>;
  dirty: Record<string, boolean>;
  onBufferChange: (path: string, content: string) => void;
  ensureBuffer: (path: string) => Promise<void>;
  onFlushSave: () => void;
  onCommonSource: (layer: "bg" | "overlay", source: Source) => void;
  onOverride: (slideId: string, layer: "bg" | "overlay", source: Source | undefined) => void;
  version: string;
  /** fix-list item 1: minimized = tab bar only, preview grows */
  minimized: boolean;
  onToggleMinimize: () => void;
  /** dock the editor as a right side panel (full-height, scrollable) */
  side: boolean;
  onToggleSide: () => void;
  /** fix-list item 4: open this slide with the cursor on the error line */
  gotoError: GotoError | null;
}) {
  const { deckId, deck, sel, tab, buffers, onBufferChange, ensureBuffer } = props;
  const { toast } = useToast();
  const [slideError, setSlideError] = useState<string | null>(null);
  const [uiTheme] = useUiTheme();

  const slidePath = sel ? `slides/${sel.id}.tsx` : "";
  const notesPath = sel ? `notes/${sel.id}.md` : "";

  // mirrors for async handlers
  const buffersRef = useRef(buffers);
  buffersRef.current = buffers;
  const changeRef = useRef(onBufferChange);
  changeRef.current = onBufferChange;

  /** the file currently shown in the editor (slide / bg / overlay) */
  const activeFileRef = useRef<string | null>(null);
  useEffect(() => {
    if (tab === "slide") activeFileRef.current = slidePath || null;
    else if (tab === "notes") activeFileRef.current = notesPath || null;
    else if (tab === "theme") activeFileRef.current = "theme.css";
    // bg / overlay register themselves from SourceEditor
  }, [tab, slidePath, notesPath]);

  /** format one file — one undoable edit, skipped for non-TSX */
  const formatFile = useCallback(
    async (path: string | null) => {
      if (!path) return;
      if (!FORMATABLE_EXT.test(path)) {
        toast({ title: "Formatting is TSX-only", description: `${path} is left as-is` });
        return;
      }
      const content = buffersRef.current[path];
      if (content === undefined) return;
      const formatted = await formatTsx(content);
      if (formatted !== content) {
        changeRef.current(path, formatted);
        toast({ title: "Formatted", description: path });
      }
    },
    [toast],
  );
  const formatActive = useCallback(() => formatFile(activeFileRef.current), [formatFile]);

  // Shift+Alt+F (fix-list item 2)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.shiftKey && (e.key === "f" || e.key === "F")) {
        e.preventDefault();
        formatActive();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [formatActive]);

  // format-on-open for the slide file
  const applySlideFormat = useCallback(
    (formatted: string) => {
      if (slidePath) changeRef.current(slidePath, formatted);
    },
    [slidePath],
  );
  useFormatOnOpen(tab === "slide" ? slidePath || null : null, tab === "slide" ? buffers[slidePath] : undefined, applySlideFormat);

  // load buffer for the active file
  useEffect(() => {
    const path =
      tab === "slide" ? slidePath
      : tab === "theme" ? "theme.css"
      : tab === "notes" ? notesPath
      : null;
    if (path) ensureBuffer(path);
  }, [tab, slidePath, notesPath, ensureBuffer]);

  useEffect(() => {
    if (!sel) return setSlideError(null);
    let cancelled = false;
    resolveCode(deckId, slidePath, props.version).then((m) => {
      if (!cancelled) setSlideError(m.error);
    });
    return () => {
      cancelled = true;
    };
  }, [deckId, slidePath, props.version, sel]);

  const slideCode = buffers[slidePath] ?? "";

  const copyFix = async () => {
    const ok = await copyText(fixPrompt(slidePath, slideCode, slideError || "unknown error"));
    toast(ok ? { title: "Fix prompt copied — paste it into your AI tool" } : { title: "Clipboard blocked", variant: "destructive" });
  };

  /* cursor jump to the first error line (fix-list item 4) */
  const viewRef = useRef<EditorView | null>(null);
  const goto = props.gotoError;
  const slideBuffer = tab === "slide" ? buffers[slidePath] : undefined;
  useEffect(() => {
    if (props.minimized || !goto || !sel || goto.slideId !== sel.id || tab !== "slide") return;
    if (slideBuffer === undefined) return; // still loading
    const view = viewRef.current;
    if (!view) return;
    let cancelled = false;
    (async () => {
      const { EditorSelection, EditorView: EV } = await import("./editor/bits");
      if (cancelled) return;
      const line = Math.max(1, Math.min(goto.line, view.state.doc.lines));
      const lineInfo = view.state.doc.line(line);
      const pos = Math.min(lineInfo.to, lineInfo.from + Math.max(0, goto.col));
      view.dispatch({
        selection: EditorSelection.cursor(pos),
        effects: EV.scrollIntoView(pos, { y: "center" }),
      });
      view.focus();
    })();
    return () => {
      cancelled = true;
    };
  }, [goto, sel, tab, slideBuffer, props.minimized]);

  /* multi-line paste → format (fix-list item 2) — the domEventHandlers
     extension arrives with the lazy editor chunk */
  const formatActiveRef = useRef(formatActive);
  formatActiveRef.current = formatActive;
  const [pasteFormatExt, setPasteFormatExt] = useState<unknown>(null);
  useEffect(() => {
    let cancelled = false;
    import("./editor/bits").then(({ EditorView: EV }) => {
      if (cancelled) return;
      setPasteFormatExt(
        EV.domEventHandlers({
          paste: (e) => {
            const text = e.clipboardData?.getData("text/plain") ?? "";
            if (/\n/.test(text.trim())) {
              setTimeout(() => formatActiveRef.current(), 60);
            }
          },
        }),
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const tabs: Array<{ key: CodeTab; label: string; badge?: boolean }> = [
    { key: "slide", label: "Slide", badge: Boolean(slideError) },
    { key: "bg", label: "BG" },
    { key: "overlay", label: "Overlay" },
    { key: "notes", label: "Notes" },
    { key: "assets", label: "Assets" },
    { key: "theme", label: "Theme" },
  ];

  const cmTheme: "dark" | "light" = uiTheme === "light" ? "light" : "dark";

  return (
    <section className={`ss-codepane ${props.minimized ? "min" : ""} ${props.side ? "side" : ""}`}>
      <div className="ss-codepane-head">
        <div className="ss-code-tabs">
          {tabs.map((t) => (
            <button key={t.key} className={`ss-code-tab ${tab === t.key ? "on" : ""}`} onClick={() => props.onTab(t.key)}>
              {t.label}
              {t.badge && <span className="badge">!</span>}
            </button>
          ))}
        </div>
        {!props.minimized && (
          <>
            <div style={{ flex: 1 }} />
            {tab === "slide" && sel && (
              <span className="ss-label" style={{ letterSpacing: ".06em" }}>{slidePath}</span>
            )}
            {tab === "notes" && sel && <span className="ss-label">{notesPath}</span>}
            {tab === "theme" && <span className="ss-label">theme.css</span>}
            {slideError && tab === "slide" && (
              <button className="ss-btn" style={{ height: 26, padding: "0 10px", fontSize: 12 }} onClick={copyFix} title="Copy slide code + error as an AI fix prompt">
                <WandSparkles size={13} /> Copy fix prompt
              </button>
            )}
            {(tab === "slide" || tab === "bg" || tab === "overlay") && (
              <button className="ss-btn" style={{ height: 26, padding: "0 10px", fontSize: 12 }} onClick={() => formatActive()} title="Format file (Shift+Alt+F)">
                <Braces size={13} /> Format
              </button>
            )}
            <button className="ss-btn" style={{ height: 26, padding: "0 10px", fontSize: 12 }} onClick={props.onFlushSave} title="Save now (Ctrl+S)">
              <Save size={13} /> Save
            </button>
          </>
        )}
        {props.minimized && <div style={{ flex: 1 }} />}
        <button
          className="ss-btn ss-btn-icon"
          style={{ width: 28, height: 26, flex: "none" }}
          onClick={props.onToggleSide}
          title={props.side ? "Dock the code panel back at the bottom" : "Move code to the right side panel"}
        >
          {props.side ? <PanelBottom size={14} /> : <PanelRight size={14} />}
        </button>
        <button
          className="ss-btn ss-btn-icon"
          style={{ width: 28, height: 26, flex: "none" }}
          onClick={props.onToggleMinimize}
          title={props.minimized ? "Restore code pane (Ctrl+E)" : "Minimize code pane (Ctrl+E)"}
        >
          {props.minimized ? <ChevronsUp size={14} /> : <ChevronsDown size={14} />}
        </button>
      </div>

      {!props.minimized && (
        <>
          {slideError && (tab === "slide" || tab === "bg" || tab === "overlay") && (
            <div className="ss-error-banner">
              <span style={{ color: "var(--ss-err)", flex: "none", fontWeight: 600 }}>
                <AlertTriangle size={12} style={{ verticalAlign: -1, marginRight: 6 }} />
                Error
              </span>
              <span>{slideError}</span>
            </div>
          )}

          <div className="ss-codepane-body ss-cm">
            {tab === "slide" && sel && (
              <CmEditor
                value={buffers[slidePath] ?? ""}
                theme={cmTheme}
                lang="tsx"
                pasteFormatExt={pasteFormatExt}
                onChange={(v) => onBufferChange(slidePath, v)}
                onCreateEditor={(view) => {
                  viewRef.current = view;
                }}
              />
            )}
            {tab === "slide" && !sel && <EmptyPane text="Select a slide in the filmstrip" />}

            {tab === "bg" && (
              <SourceEditor
                layer="bg"
                deckId={deckId}
                deck={deck}
                files={props.files}
                sel={sel}
                buffers={buffers}
                onBufferChange={onBufferChange}
                ensureBuffer={ensureBuffer}
                onCommonSource={props.onCommonSource}
                onOverride={props.onOverride}
                activeFileRef={activeFileRef}
                formatFile={formatFile}
                cmTheme={cmTheme}
                pasteFormatExt={pasteFormatExt}
              />
            )}
            {tab === "overlay" && (
              <SourceEditor
                layer="overlay"
                deckId={deckId}
                deck={deck}
                files={props.files}
                sel={sel}
                buffers={buffers}
                onBufferChange={onBufferChange}
                ensureBuffer={ensureBuffer}
                onCommonSource={props.onCommonSource}
                onOverride={props.onOverride}
                activeFileRef={activeFileRef}
                formatFile={formatFile}
                cmTheme={cmTheme}
                pasteFormatExt={pasteFormatExt}
              />
            )}

            {tab === "notes" && sel && (
              <CmEditor
                value={buffers[notesPath] ?? ""}
                theme={cmTheme}
                lang="plain"
                onChange={(v) => onBufferChange(notesPath, v)}
              />
            )}
            {tab === "notes" && !sel && <EmptyPane text="Select a slide to edit its notes" />}

            {tab === "assets" && <AssetsTab deckId={deckId} version={props.version} />}

            {tab === "theme" && (
              <CmEditor
                value={buffers["theme.css"] ?? ""}
                theme={cmTheme}
                lang="plain"
                onChange={(v) => onBufferChange("theme.css", v)}
              />
            )}
          </div>
        </>
      )}
    </section>
  );
});

function EmptyPane({ text }: { text: string }) {
  return (
    <div style={{ height: "100%", display: "grid", placeItems: "center" }}>
      <span className="ss-label" style={{ opacity: 0.5 }}>{text}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* BG / Overlay source editing: common + per-slide override            */
/* ------------------------------------------------------------------ */

function SourceEditor(props: {
  layer: "bg" | "overlay";
  deckId: string;
  deck: DeckJson;
  files: FileRow[];
  sel: SlideEntry | null;
  buffers: Record<string, string>;
  onBufferChange: (path: string, content: string) => void;
  ensureBuffer: (path: string) => Promise<void>;
  onCommonSource: (layer: "bg" | "overlay", source: Source) => void;
  onOverride: (slideId: string, layer: "bg" | "overlay", source: Source | undefined) => void;
  activeFileRef: React.RefObject<string | null>;
  formatFile: (path: string | null) => Promise<void>;
  cmTheme: "dark" | "light";
  pasteFormatExt: unknown;
}) {
  const { layer, deckId, deck, files, sel } = props;
  const { toast } = useToast();
  const [scope, setScope] = useState<"common" | "override">("common");
  // the in-app name dialog for new code files (window.prompt never renders
  // inside the desktop webview — JCEF drops JS dialogs without a handler)
  const [newNameOpen, setNewNameOpen] = useState(false);
  const [newNameBusy, setNewNameBusy] = useState(false);
  const [newNameError, setNewNameError] = useState<string | null>(null);

  const common = layer === "bg" ? deck.bg : deck.overlay;
  const override = sel ? (layer === "bg" ? sel.bg : sel.overlay) : undefined;
  const effective = scope === "override" ? override : common;
  const dirFiles = files
    .filter((f) => f.path.startsWith(`${layer}/`) && /\.(tsx|ts)$/.test(f.path))
    .map((f) => f.path);
  const images = files.filter((f) => f.path.startsWith("assets/") && /\.(png|jpe?g|svg|webp|gif|avif)$/i.test(f.path)).map((f) => f.path);

  const codePath = effective && effective.type === "code" ? effective.path : null;

  useEffect(() => {
    if (codePath) props.ensureBuffer(codePath);
  }, [codePath]);

  // register the visible file with the pane-level formatter
  const activeFileRef = props.activeFileRef;
  useEffect(() => {
    activeFileRef.current = codePath;
    return () => {
      if (activeFileRef.current === codePath) activeFileRef.current = null;
    };
  }, [codePath, activeFileRef]);

  const applyFormat = useCallback(
    (formatted: string) => {
      if (codePath) props.onBufferChange(codePath, formatted);
    },
    [codePath],
  );
  useFormatOnOpen(codePath, codePath ? props.buffers[codePath] : undefined, applyFormat);

  const setSource = (source: Source | undefined) => {
    if (scope === "override" && sel) {
      props.onOverride(sel.id, layer, source);
    } else {
      props.onCommonSource(layer, source ?? { type: "none" });
    }
  };

  const newCodeFile = () => setNewNameOpen(true);

  const createCodeFile = async (name: string) => {
    const path = `${layer}/${name.replace(/[^\w-]/g, "-").replace(/\.tsx$/, "")}.tsx`;
    const template =
      layer === "bg"
        ? `import { GridLines, Vignette, Aurora } from "stagesmith";

export default function ${name.replace(/[^\w]/g, "") || "Bg"}() {
  return (
    <>
      <GridLines />
      <Vignette strength={0.3} />
    </>
  );
}
`
        : `import { CornerMarks, SlideNumber } from "stagesmith";

export default function ${name.replace(/[^\w]/g, "") || "Overlay"}() {
  return (
    <>
      <CornerMarks inset={20} />
      <SlideNumber format="{n} / {total}" />
    </>
  );
}
`;
    setNewNameBusy(true);
    setNewNameError(null);
    try {
      await api.saveFile(deckId, path, template);
      setSource({ type: "code", path });
      setNewNameOpen(false);
      toast({ title: `Created ${path}` });
    } catch (e) {
      // the dialog stays open with the reason — confirm becomes Retry
      setNewNameError((e as Error).message);
    } finally {
      setNewNameBusy(false);
    }
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="ss-srcbar">
        <span className="ss-label" style={{ flex: "none" }}>{layer === "bg" ? "Background" : "Overlay"}</span>
        <div className="ss-mode-tabs" style={{ flex: "none" }}>
          <button className={`ss-mode-tab ${scope === "common" ? "on" : ""}`} onClick={() => setScope("common")}>
            Common
          </button>
          <button
            className={`ss-mode-tab ${scope === "override" ? "on" : ""}`}
            disabled={!sel}
            title={sel ? "Override for this slide only" : "Select a slide first"}
            onClick={() => setScope("override")}
          >
            Override {sel ? `· ${sel.label.slice(0, 18)}` : ""}
          </button>
        </div>
        <span className="ss-divider" />
        <Select
          value={effective?.type ?? "none"}
          onValueChange={(v) => {
            if (v === "none") setSource(undefined);
            else if (v === "code") setSource({ type: "code", path: dirFiles[0] ?? `${layer}/common.tsx` });
            else if (v === "image") setSource({ type: "image", path: images[0] ?? "assets/placeholder.png" });
          }}
        >
          <SelectTrigger className="ss-input" style={{ height: 28, width: 150, fontSize: 12 }}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent style={{ background: "var(--ss-panel2)", borderColor: "var(--ss-line-strong)", color: "var(--ss-ink)" }}>
            <SelectItem value="none">None</SelectItem>
            <SelectItem value="code">Code (.tsx)</SelectItem>
            <SelectItem value="image" disabled={images.length === 0}>Image</SelectItem>
          </SelectContent>
        </Select>

        {effective?.type === "code" && (
          <>
            <Select
              value={codePath ?? ""}
              onValueChange={(v) => setSource({ type: "code", path: v })}
            >
              <SelectTrigger className="ss-input" style={{ height: 28, width: 210, fontSize: 12 }}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent style={{ background: "var(--ss-panel2)", borderColor: "var(--ss-line-strong)", color: "var(--ss-ink)" }}>
                {dirFiles.map((p) => (
                  <SelectItem key={p} value={p}>{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <button className="ss-btn" style={{ height: 28, padding: "0 10px", fontSize: 12 }} onClick={newCodeFile}>
              <FilePlus2 size={13} /> New file
            </button>
          </>
        )}

        {effective?.type === "image" && (
          <>
            <Select value={effective.path} onValueChange={(v) => setSource({ ...effective, path: v })}>
              <SelectTrigger className="ss-input" style={{ height: 28, width: 210, fontSize: 12 }}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent style={{ background: "var(--ss-panel2)", borderColor: "var(--ss-line-strong)", color: "var(--ss-ink)" }}>
                {images.map((p) => (
                  <SelectItem key={p} value={p}>{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {layer === "bg" ? <ImageBgFields source={effective} onChange={setSource} /> : <ImageOverlayFields source={effective} onChange={setSource} />}
          </>
        )}

        <span style={{ font: "500 11px var(--ss-mono)", color: "var(--ss-faint)" }}>
          {scope === "common" ? sourceLabel(common) : override === undefined ? "follows common" : override?.type === "none" ? "none on this slide" : sourceLabel(override)}
        </span>
      </div>
      <div className="ss-cm" style={{ flex: 1 }}>
        {effective?.type === "code" && codePath ? (
          <CmEditor
            value={props.buffers[codePath] ?? ""}
            theme={props.cmTheme}
            lang="tsx"
            pasteFormatExt={props.pasteFormatExt}
            onChange={(v) => props.onBufferChange(codePath, v)}
          />
        ) : (
          <EmptyPane
            text={
              effective?.type === "image"
                ? `Image source: ${effective.path}`
                : "No code source — pick Code + a file, or create one"
            }
          />
        )}
      </div>
      <PromptDialog
        open={newNameOpen}
        onOpenChange={(o) => {
          if (!o) {
            setNewNameOpen(false);
            setNewNameError(null);
          }
        }}
        title={`New ${layer} code file`}
        description="A starter component will be created for you."
        label={`File name (without .tsx)`}
        initial={`custom-${layer}`}
        confirmLabel="Create"
        busy={newNameBusy}
        error={newNameError}
        onResolve={(name) => {
          if (name) void createCodeFile(name);
        }}
      />
    </div>
  );
}

function ImageBgFields({ source, onChange }: { source: Extract<Source, { type: "image" }>; onChange: (s: Source) => void }) {
  const num = (label: string, key: "blur" | "dim" | "opacity" | "zoom", step = 0.1) => (
    <label key={key} style={{ display: "inline-flex", alignItems: "center", gap: 6, font: "500 11px var(--ss-mono)", color: "var(--ss-mut)" }}>
      {label}
      <input
        type="number"
        step={step}
        min={0}
        max={key === "dim" || key === "opacity" ? 1 : 10}
        value={source[key] ?? 0}
        onChange={(e) => onChange({ ...source, [key]: Number(e.target.value) })}
        style={{ width: 58, height: 26, padding: "0 6px", background: "var(--ss-panel)", color: "var(--ss-ink)", border: "1px solid var(--ss-line-strong)", borderRadius: 6, font: "400 11px var(--ss-mono)", outline: "none" }}
      />
    </label>
  );
  return (
    <>
      <Select value={source.fit ?? "cover"} onValueChange={(v) => onChange({ ...source, fit: v as "cover" | "contain" })}>
        <SelectTrigger className="ss-input" style={{ height: 28, width: 110, fontSize: 12 }}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent style={{ background: "var(--ss-panel2)", borderColor: "var(--ss-line-strong)", color: "var(--ss-ink)" }}>
          <SelectItem value="cover">cover</SelectItem>
          <SelectItem value="contain">contain</SelectItem>
        </SelectContent>
      </Select>
      {num("blur", "blur")}
      {num("dim", "dim")}
      {num("op", "opacity")}
    </>
  );
}

function ImageOverlayFields({ source, onChange }: { source: Extract<Source, { type: "image" }>; onChange: (s: Source) => void }) {
  const field = (label: string, key: "x" | "y" | "width" | "opacity", def: number, step = 1) => (
    <label key={key} style={{ display: "inline-flex", alignItems: "center", gap: 6, font: "500 11px var(--ss-mono)", color: "var(--ss-mut)" }}>
      {label}
      <input
        type="number"
        step={step}
        value={source[key] ?? def}
        onChange={(e) => onChange({ ...source, [key]: Number(e.target.value) })}
        style={{ width: 64, height: 26, padding: "0 6px", background: "var(--ss-panel)", color: "var(--ss-ink)", border: "1px solid var(--ss-line-strong)", borderRadius: 6, font: "400 11px var(--ss-mono)", outline: "none" }}
      />
    </label>
  );
  return (
    <>
      {field("x", "x", 40)}
      {field("y", "y", 40)}
      {field("w", "width", 320, 10)}
      {field("op", "opacity", 1, 0.1)}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Assets tab                                                          */
/* ------------------------------------------------------------------ */

type AssetsSubTab = "assets" | "overlay" | "bg";

function CodeFileList({
  deckId,
  dir,
  version,
  onOpenFile,
}: {
  deckId: string;
  dir: "overlay" | "bg";
  version: string;
  onOpenFile?: (path: string) => void;
}) {
  const { toast } = useToast();
  const [files, setFiles] = useState<FileRow[] | null>(null);

  const refresh = useCallback(async () => {
    try {
      setFiles(await api.listCodeFiles(deckId, dir));
    } catch {
      setFiles([]);
    }
  }, [deckId, dir]);

  useEffect(() => {
    refresh();
  }, [refresh, version]);

  const upload = async (fileList: FileList | File[]) => {
    const list = Array.from(fileList);
    if (!list.length) return;
    const nonTsx = list.filter((f) => !f.name.endsWith(".tsx"));
    if (nonTsx.length) {
      toast({ title: "Only .tsx files allowed", description: nonTsx.map((f) => f.name).join(", "), variant: "destructive" });
      return;
    }
    try {
      await api.uploadCodeFile(deckId, dir, list);
      await refresh();
      toast({ title: `${list.length} file${list.length > 1 ? "s" : ""} uploaded into ${dir}/` });
    } catch (e) {
      toast({ title: "Upload failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  const rows = files ?? [];

  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14 }}>
        <label className="ss-btn" style={{ cursor: "pointer" }}>
          <Upload size={14} /> Upload .tsx into {dir}/
          <input
            type="file"
            multiple
            accept=".tsx"
            style={{ display: "none" }}
            onChange={(e) => {
              if (e.target.files) upload(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
        <span className="ss-label">Upload React components directly into {dir}/</span>
      </div>
      {rows.length === 0 ? (
        <EmptyPane text={files === null ? `Loading ${dir} files…` : `No ${dir} files yet — upload a .tsx component above`} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {rows.map((f) => {
            const name = f.path.replace(`${dir}/`, "");
            return (
              <div
                key={f.path}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 8px",
                  borderRadius: 4,
                  background: "var(--ss-panel2)",
                }}
              >
                <span
                  style={{
                    flex: 1,
                    font: "500 12px var(--ss-mono)",
                    color: "var(--ss-ink2)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={f.path}
                >
                  {name}
                </span>
                {onOpenFile && (
                  <button
                    className="ss-btn"
                    style={{ height: 24, padding: "0 8px", fontSize: 11 }}
                    title="Open in editor"
                    onClick={() => onOpenFile(f.path)}
                  >
                    <Braces size={11} /> open
                  </button>
                )}
                <button
                  className="ss-btn"
                  style={{ height: 24, padding: "0 8px", fontSize: 11 }}
                  title="Copy import path"
                  onClick={async () => {
                    const ok = await copyText(`import './${f.path}';`);
                    toast(ok ? { title: "Path copied" } : { title: "Clipboard blocked", variant: "destructive" });
                  }}
                >
                  <Copy size={11} /> path
                </button>
                <button
                  className="ss-btn"
                  style={{ height: 24, padding: "0 8px", fontSize: 11, color: "var(--ss-err)" }}
                  title="Delete file"
                  onClick={async () => {
                    try {
                      await api.deleteCodeFile(deckId, f.path);
                      refresh();
                    } catch (e) {
                      toast({ title: "Delete failed", description: (e as Error).message, variant: "destructive" });
                    }
                  }}
                >
                  <Trash2 size={11} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AssetsTab({ deckId, version }: { deckId: string; version: string }) {
  const { toast } = useToast();
  const [assets, setAssets] = useState<FileRow[] | null>(null);
  const [subTab, setSubTab] = useState<AssetsSubTab>("assets");
  /** store-aware preview URLs (Problem 06): browser decks serve IndexedDB
   *  blobs as object URLs — the /api/assets route 404s for them. */
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  /** paths whose preview genuinely failed to load → error placeholder */
  const [broken, setBroken] = useState<Record<string, boolean>>({});

  /* asset trash → reusable confirmation dialog (never delete on first click) */
  const [trashTarget, setTrashTarget] = useState<FileRow | null>(null);
  const [trashing, setTrashing] = useState(false);
  const [trashError, setTrashError] = useState<string | null>(null);
  const trashingRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      setAssets(await api.listAssets(deckId));
    } catch {
      setAssets([]);
    }
  }, [deckId]);

  useEffect(() => {
    refresh();
  }, [refresh, version]);

  const upload = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (!list.length) return;
    try {
      const uploaded = await api.uploadAssets(deckId, list);
      await refresh();
      toast({
        title: `${uploaded.length} asset${uploaded.length > 1 ? "s" : ""} copied into assets/`,
        description: uploaded.some((u) => u.display !== u.path.replace("assets/", ""))
          ? "File names were made disk-safe — the panel shows the original names."
          : undefined,
      });
    } catch (e) {
      toast({ title: "Upload failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  const doTrash = useCallback(async () => {
    if (!trashTarget || trashingRef.current) return;
    trashingRef.current = true;
    setTrashing(true);
    setTrashError(null);
    try {
      await api.deleteFile(deckId, trashTarget.path);
      setTrashTarget(null);
      refresh();
      toast({ title: "Asset deleted", description: trashTarget.path });
    } catch (e) {
      setTrashError((e as Error).message || "The file couldn't be deleted");
    } finally {
      setTrashing(false);
      trashingRef.current = false;
    }
  }, [deckId, trashTarget, refresh, toast]);

  const rows = useMemo(() => assets ?? [], [assets]);

  // resolve image preview URLs for whichever store the deck lives in — one
  // URL for EVERY listed file (not just freshly uploaded ones), whatever its
  // name: object URLs for browser/device decks, ENCODED route URLs otherwise
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const out: Record<string, string> = {};
      for (const a of rows) {
        if (/\.(png|jpe?g|svg|webp|gif|avif)$/i.test(a.path)) {
          try {
            out[a.path] = await api.assetUrl(deckId, a.path);
          } catch {
            out[a.path] = assetRouteUrl(deckId, a.path);
          }
        }
      }
      if (!cancelled) setPreviewUrls(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [deckId, rows]);

  const subTabStyle = (t: AssetsSubTab): React.CSSProperties => ({
    padding: "3px 10px",
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 600,
    cursor: "pointer",
    border: "none",
    background: subTab === t ? "var(--ss-acc)" : "transparent",
    color: subTab === t ? "var(--ss-acc-ink)" : "var(--ss-mut)",
    letterSpacing: "0.02em",
  });

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Sub-tab bar */}
      <div style={{ display: "flex", gap: 4, padding: "8px 14px 0", borderBottom: "1px solid var(--ss-line)", paddingBottom: 8 }}>
        <button style={subTabStyle("assets")} onClick={() => setSubTab("assets")}>Assets</button>
        <button style={subTabStyle("overlay")} onClick={() => setSubTab("overlay")}>Overlay</button>
        <button style={subTabStyle("bg")} onClick={() => setSubTab("bg")}>Background</button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", padding: 14 }} className="ss-scroll">
        {subTab === "assets" && (
          <>
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14 }}>
              <label className="ss-btn" style={{ cursor: "pointer" }}>
                <Upload size={14} /> Upload into assets/
                <input
                  type="file"
                  multiple
                  accept=".png,.jpg,.jpeg,.svg,.webp,.gif,.avif,.woff,.woff2,.ttf,.otf,.html"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    if (e.target.files) upload(e.target.files);
                    e.target.value = "";
                  }}
                />
              </label>
              <span className="ss-label">Assets are copied into the deck folder — never linked (plan §2)</span>
            </div>
            {rows.length === 0 ? (
              <EmptyPane text={assets === null ? "Loading assets…" : "No assets — drop files into the deck via upload"} />
            ) : (
              <div className="ss-assets-grid">
                {rows.map((a) => {
                  const isImage = /\.(png|jpe?g|svg|webp|gif|avif)$/i.test(a.path);
                  const displayName = a.display ?? a.path.replace("assets/", "");
                  const src = previewUrls[a.path] ?? assetRouteUrl(deckId, a.path);
                  return (
                    <div key={a.path} className="ss-asset">
                      {isImage ? (
                        broken[a.path] ? (
                          /* honest placeholder when the image really failed —
                             logged, never a silent broken-image icon */
                          <div
                            title={`Couldn't load ${a.path}`}
                            style={{
                              aspectRatio: "16/10",
                              display: "grid",
                              placeItems: "center",
                              gap: 6,
                              background: "var(--ss-errbg)",
                              color: "var(--ss-err)",
                            }}
                          >
                            <AlertTriangle size={18} />
                            <span style={{ font: "500 9px var(--ss-mono)", color: "var(--ss-mut)" }}>couldn&apos;t load</span>
                          </div>
                        ) : (
                          <img
                            src={src}
                            alt={displayName}
                            loading="lazy"
                            onError={() => {
                              console.warn(`[assets] preview failed to load: ${a.path} (src=${src})`);
                              setBroken((b) => ({ ...b, [a.path]: true }));
                            }}
                          />
                        )
                      ) : (
                        <div style={{ aspectRatio: "16/10", display: "grid", placeItems: "center", font: "500 10px var(--ss-mono)", color: "var(--ss-mut)" }}>
                          {a.path.split(".").pop()?.toUpperCase()}
                        </div>
                      )}
                      <div className="nm" title={a.path}>
                        {displayName}
                      </div>
                      <div className="acts">
                        <button
                          className="ss-btn"
                          style={{ height: 24, padding: "0 8px", fontSize: 11 }}
                          title={`Copy <Img name="${a.path}" /> snippet`}
                          onClick={async () => {
                            // the runtime's asset() encodes every segment, so
                            // the RAW path is the correct thing to copy — it
                            // works with spaces, # and unicode as-is
                            const escaped = a.path.replace(/(["\\])/g, "\\$1");
                            const ok = await copyText(`<Img name="${escaped}" />`);
                            toast(ok ? { title: "Snippet copied", description: `<Img name="${escaped}" />` } : { title: "Clipboard blocked", variant: "destructive" });
                          }}
                        >
                          <Copy size={11} /> snippet
                        </button>
                        <button
                          className="ss-btn"
                          style={{ height: 24, padding: "0 8px", fontSize: 11, color: "var(--ss-err)" }}
                          title="Delete asset"
                          onClick={() => {
                            setTrashError(null);
                            setTrashTarget(a);
                          }}
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {subTab === "overlay" && (
          <CodeFileList deckId={deckId} dir="overlay" version={version} />
        )}

        {subTab === "bg" && (
          <CodeFileList deckId={deckId} dir="bg" version={version} />
        )}
      </div>

      {/* asset delete confirmation — reuses the deck-delete dialog */}
      <ConfirmDialog
        open={trashTarget !== null}
        onOpenChange={(o) => {
          if (!o) {
            setTrashTarget(null);
            setTrashError(null);
          }
        }}
        title="Delete asset?"
        description={
          <>
            <div style={{ font: "600 13px var(--ss-fb, sans-serif)", color: "var(--ss-ink)" }}>
              {trashTarget ? (trashTarget.display ?? trashTarget.path.replace("assets/", "")) : ""}
            </div>
            {trashTarget && (
              <div style={{ color: "var(--ss-mut)", font: "400 11.5px var(--ss-fm, monospace)" }}>{trashTarget.path}</div>
            )}
            <div>
              This removes the file from the deck. Slides that use it will show a placeholder. This cannot be undone.
            </div>
          </>
        }
        confirmLabel="Delete asset"
        danger
        busy={trashing}
        error={trashError}
        onConfirm={doTrash}
        closeLabel="Close without deleting"
      />
    </div>
  );
}
