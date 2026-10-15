"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { oneDark } from "@codemirror/theme-one-dark";
import { AlertTriangle, Copy, FilePlus2, Save, Trash2, Upload, WandSparkles } from "lucide-react";
import type { DeckJson, FileRow, SlideEntry, Source } from "@/lib/stagesmith/types";
import { api } from "@/lib/stagesmith/client";
import { copyText, fixPrompt, sourceLabel } from "./shared";
import { resolveCode } from "./StageFrame";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type CodeTab = "slide" | "bg" | "overlay" | "notes" | "assets" | "theme";

const TSX_EXT = [javascript({ jsx: true, typescript: true })];

export function CodePane(props: {
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
}) {
  const { deckId, deck, sel, tab, buffers, onBufferChange, ensureBuffer } = props;
  const { toast } = useToast();
  const [slideError, setSlideError] = useState<string | null>(null);

  const slidePath = sel ? `slides/${sel.id}.tsx` : "";
  const notesPath = sel ? `notes/${sel.id}.md` : "";

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

  const tabs: Array<{ key: CodeTab; label: string; badge?: boolean }> = [
    { key: "slide", label: "Slide", badge: Boolean(slideError) },
    { key: "bg", label: "BG" },
    { key: "overlay", label: "Overlay" },
    { key: "notes", label: "Notes" },
    { key: "assets", label: "Assets" },
    { key: "theme", label: "Theme" },
  ];

  return (
    <section className="ss-codepane">
      <div className="ss-codepane-head">
        <div className="ss-code-tabs">
          {tabs.map((t) => (
            <button key={t.key} className={`ss-code-tab ${tab === t.key ? "on" : ""}`} onClick={() => props.onTab(t.key)}>
              {t.label}
              {t.badge && <span className="badge">!</span>}
            </button>
          ))}
        </div>
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
        <button className="ss-btn" style={{ height: 26, padding: "0 10px", fontSize: 12 }} onClick={props.onFlushSave} title="Save now (Ctrl+S)">
          <Save size={13} /> Save
        </button>
      </div>

      {slideError && (tab === "slide" || tab === "bg" || tab === "overlay") && (
        <div className="ss-error-banner">
          <span style={{ color: "#f26d6d", flex: "none", fontWeight: 600 }}>
            <AlertTriangle size={12} style={{ verticalAlign: -1, marginRight: 6 }} />
            Error
          </span>
          <span>{slideError}</span>
        </div>
      )}

      <div className="ss-codepane-body ss-cm">
        {tab === "slide" && sel && (
          <CodeMirror
            value={buffers[slidePath] ?? ""}
            theme={oneDark}
            extensions={TSX_EXT}
            height="100%"
            basicSetup={{ foldGutter: true, highlightActiveLine: true, autocompletion: false }}
            onChange={(v) => onBufferChange(slidePath, v)}
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
          />
        )}

        {tab === "notes" && sel && (
          <CodeMirror
            value={buffers[notesPath] ?? ""}
            theme={oneDark}
            extensions={[]}
            height="100%"
            onChange={(v) => onBufferChange(notesPath, v)}
          />
        )}
        {tab === "notes" && !sel && <EmptyPane text="Select a slide to edit its notes" />}

        {tab === "assets" && <AssetsTab deckId={deckId} version={props.version} />}

        {tab === "theme" && (
          <CodeMirror
            value={buffers["theme.css"] ?? ""}
            theme={oneDark}
            extensions={[]}
            height="100%"
            onChange={(v) => onBufferChange("theme.css", v)}
          />
        )}
      </div>
    </section>
  );
}

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
}) {
  const { layer, deckId, deck, files, sel } = props;
  const { toast } = useToast();
  const [scope, setScope] = useState<"common" | "override">("common");

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

  const setSource = (source: Source | undefined) => {
    if (scope === "override" && sel) {
      props.onOverride(sel.id, layer, source);
    } else {
      props.onCommonSource(layer, source ?? { type: "none" });
    }
  };

  const newCodeFile = async () => {
    const name = window.prompt(`New ${layer} code file name (without .tsx)`, `custom-${layer}`);
    if (!name) return;
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
    try {
      await api.saveFile(deckId, path, template);
      setSource({ type: "code", path });
      toast({ title: `Created ${path}` });
    } catch (e) {
      toast({ title: "Could not create file", description: (e as Error).message, variant: "destructive" });
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
          <SelectContent style={{ background: "#141417", borderColor: "#2a2a2e", color: "#e8e8ea" }}>
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
              <SelectContent style={{ background: "#141417", borderColor: "#2a2a2e", color: "#e8e8ea" }}>
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
              <SelectContent style={{ background: "#141417", borderColor: "#2a2a2e", color: "#e8e8ea" }}>
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
          <CodeMirror
            value={props.buffers[codePath] ?? ""}
            theme={oneDark}
            extensions={TSX_EXT}
            height="100%"
            basicSetup={{ foldGutter: true, highlightActiveLine: true, autocompletion: false }}
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
        <SelectContent style={{ background: "#141417", borderColor: "#2a2a2e", color: "#e8e8ea" }}>
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

function AssetsTab({ deckId, version }: { deckId: string; version: string }) {
  const { toast } = useToast();
  const [assets, setAssets] = useState<FileRow[] | null>(null);

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
      await api.uploadAssets(deckId, list);
      await refresh();
      toast({ title: `${list.length} asset${list.length > 1 ? "s" : ""} copied into assets/` });
    } catch (e) {
      toast({ title: "Upload failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  const rows = useMemo(() => assets ?? [], [assets]);

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: 14 }} className="ss-scroll">
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
            return (
              <div key={a.path} className="ss-asset">
                {isImage ? (
                  <img src={`/api/assets/${deckId}/${a.path}`} alt={a.path} loading="lazy" />
                ) : (
                  <div style={{ aspectRatio: "16/10", display: "grid", placeItems: "center", font: "500 10px var(--ss-mono)", color: "var(--ss-mut)" }}>
                    {a.path.split(".").pop()?.toUpperCase()}
                  </div>
                )}
                <div className="nm" title={a.path}>
                  {a.path.replace("assets/", "")}
                </div>
                <div className="acts">
                  <button
                    className="ss-btn"
                    style={{ height: 24, padding: "0 8px", fontSize: 11 }}
                    title="Copy <Img name='…' /> snippet"
                    onClick={async () => {
                      const ok = await copyText(`<Img name='${a.path}' />`);
                      toast(ok ? { title: "Snippet copied" } : { title: "Clipboard blocked", variant: "destructive" });
                    }}
                  >
                    <Copy size={11} /> snippet
                  </button>
                  <button
                    className="ss-btn"
                    style={{ height: 24, padding: "0 8px", fontSize: 11, color: "var(--ss-err)" }}
                    onClick={async () => {
                      try {
                        await api.deleteFile(deckId, a.path);
                        refresh();
                      } catch (e) {
                        toast({ title: "Delete failed", description: (e as Error).message, variant: "destructive" });
                      }
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
    </div>
  );
}
