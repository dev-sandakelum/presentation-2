"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FileUp,
  Import,
  Moon,
  Play,
  Presentation,
  QrCode,
  Redo2,
  Sun,
  Undo2,
  BookOpen,
  Camera,
} from "lucide-react";
import { api } from "@/lib/stagesmith/client";
import type { DeckBundle } from "@/lib/stagesmith/client";
import type { DeckJson, Source, ThemeMode } from "@/lib/stagesmith/types";
import { Filmstrip } from "./Filmstrip";
import { PreviewPane } from "./PreviewPane";
import { CodePane, type CodeTab, type GotoError } from "./CodePane";
import { QrPanel } from "./QrPanel";
import { useSync } from "@/hooks/useSync";
import { useUiTheme, hydrateUiTheme } from "@/hooks/useUiTheme";
import { download, type SsNav } from "./shared";
import { useToast } from "@/hooks/use-toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const SAVE_DEBOUNCE = 320; // ms — plan: ~400 ms autosave
const CODE_MIN_KEY = "ss-code-minimized"; // fix-list item 1: remembered between sessions

function readCodeMinimized(): boolean {
  try {
    return window.localStorage.getItem(CODE_MIN_KEY) === "1";
  } catch {
    return false;
  }
}

export function DashboardView({ deckId, nav }: { deckId: string; nav: SsNav }) {
  const { toast } = useToast();
  const [bundle, setBundle] = useState<DeckBundle | null>(null);
  const [deck, setDeck] = useState<DeckJson | null>(null);
  const [themeCss, setThemeCss] = useState("");
  const [version, setVersion] = useState("boot");
  const [selId, setSelId] = useState<string | null>(null);
  const [buffers, setBuffers] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [saveState, setSaveState] = useState<"saved" | "saving" | "idle">("idle");
  const [codeMinimized, setCodeMinimized] = useState(false);
  const [tab, setTab] = useState<CodeTab>("slide");
  const [qrOpen, setQrOpen] = useState(false);
  const [snapshots, setSnapshots] = useState<string[]>([]);
  const [gotoError, setGotoError] = useState<GotoError | null>(null);

  // app chrome theme (fix-list item 8) — hydrate once per mount
  const [uiTheme, setUiTheme] = useUiTheme();
  useEffect(() => {
    hydrateUiTheme();
  }, []);
  // code pane minimize state — persisted (fix-list item 1)
  useEffect(() => {
    setCodeMinimized(readCodeMinimized());
  }, []);
  const toggleCodeMin = useCallback(() => {
    setCodeMinimized((m) => {
      const next = !m;
      try {
        window.localStorage.setItem(CODE_MIN_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  // undo/redo of file buffers (plan: 200-step undo)
  const undoRef = useRef<Array<{ path: string; content: string }>>([]);
  const redoRef = useRef<Array<{ path: string; content: string }>>([]);
  const undoTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // sweep any pending per-file undo debounce timers on unmount (memory)
  useEffect(
    () => () => {
      for (const t of Object.values(undoTimers.current)) clearTimeout(t);
      undoTimers.current = {};
    },
    [],
  );

  const refreshSnapshots = useCallback(async () => {
    try {
      setSnapshots((await api.listSnapshots(deckId)) ?? []);
    } catch {
      setSnapshots([]);
    }
  }, [deckId]);

  const load = useCallback(async () => {
    const b = await api.getDeck(deckId);
    setBundle(b);
    setDeck(b.deck);
    setThemeCss(b.themeCss);
    setVersion(b.signature);
    setSelId((prev) => (prev && b.deck.slides.some((s) => s.id === prev) ? prev : b.deck.slides[0]?.id ?? null));
    setBuffers({});
    setDirty({});
    refreshSnapshots();
  }, [deckId, refreshSnapshots]);

  useEffect(() => {
    load().catch((e) => toast({ title: "Could not open deck", description: (e as Error).message, variant: "destructive" }));
     
  }, [deckId]);

  /* ---------- folder watching (plan §2: VS Code edits appear live) ---------- */
  const ownSaveRef = useRef(false);
  useEffect(() => {
    const t = setInterval(async () => {
      if (ownSaveRef.current) {
        ownSaveRef.current = false;
        return;
      }
      if (Object.values(dirty).some(Boolean)) return; // never clobber local edits
      try {
        const sig = await api.poll(deckId);
        if (sig !== version) {
          const b = await api.getDeck(deckId);
          setBundle(b);
          setDeck(b.deck);
          setThemeCss(b.themeCss);
          setVersion(sig);
          setBuffers({});
          setDirty({});
          toast({ title: "Deck folder changed — reloaded" });
        }
      } catch {
        /* server hiccup — keep polling */
      }
    }, 1500);
    return () => clearInterval(t);
  }, [deckId, version, dirty, toast]);

  /* ---------- autosave ---------- */
  const buffersRef = useRef(buffers);
  buffersRef.current = buffers;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  const flushSave = useCallback(
    async (paths?: string[]) => {
      const toSave = paths ?? Object.keys(dirtyRef.current).filter((p) => dirtyRef.current[p]);
      if (toSave.length === 0) return;
      setSaveState("saving");
      try {
        for (const p of toSave) {
          await api.saveFile(deckId, p, buffersRef.current[p] ?? "");
        }
        ownSaveRef.current = true;
        const sig = await api.poll(deckId);
        setVersion(sig);
        setDirty((d) => {
          const nd = { ...d };
          for (const p of toSave) delete nd[p];
          return nd;
        });
        setSaveState("saved");
      } catch (e) {
        setSaveState("idle");
        toast({ title: "Save failed", description: (e as Error).message, variant: "destructive" });
      }
    },
    [deckId, toast],
  );

  const onBufferChange = useCallback(
    (path: string, content: string) => {
      // undo capture (debounced per file)
      const prevTimer = undoTimers.current[path];
      if (prevTimer) clearTimeout(prevTimer);
      undoRef.current.push({ path, content: buffersRef.current[path] ?? "" });
      if (undoRef.current.length > 200) undoRef.current.shift();
      redoRef.current = [];
      undoTimers.current[path] = setTimeout(() => delete undoTimers.current[path], 600);
      setBuffers((b) => ({ ...b, [path]: content }));
      setDirty((d) => ({ ...d, [path]: true }));
      setSaveState("saving");
    },
    [],
  );

  // debounced flush
  useEffect(() => {
    if (!Object.values(dirty).some(Boolean)) return;
    const t = setTimeout(() => flushSave(), SAVE_DEBOUNCE);
    return () => clearTimeout(t);
  }, [buffers, dirty, flushSave]);

  const undo = useCallback(() => {
    const step = undoRef.current.pop();
    if (!step) return;
    redoRef.current.push({ path: step.path, content: buffersRef.current[step.path] ?? "" });
    setBuffers((b) => ({ ...b, [step.path]: step.content }));
    setDirty((d) => ({ ...d, [step.path]: true }));
    setTab((cur) => (step.path.startsWith("slides/") ? "slide" : step.path === "theme.css" ? "theme" : cur));
  }, []);

  const redo = useCallback(() => {
    const step = redoRef.current.pop();
    if (!step) return;
    undoRef.current.push({ path: step.path, content: buffersRef.current[step.path] ?? "" });
    setBuffers((b) => ({ ...b, [step.path]: step.content }));
    setDirty((d) => ({ ...d, [step.path]: true }));
  }, []);

  /* ---------- keyboard ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
          e.preventDefault();
          flushSave();
        }
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
          e.preventDefault();
          if (e.shiftKey) redo();
          else undo();
        }
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "e") {
          e.preventDefault();
          toggleCodeMin();
        }
        return;
      }
      if (e.key === "F5") {
        e.preventDefault();
        nav.present(deckId, 0);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flushSave, undo, redo, nav, deckId, toggleCodeMin]);

  /* ---------- sync (presence + token for QR) ---------- */
  const sync = useSync(deckId, "editor", null, deck?.slides);
  const slides = deck?.slides ?? [];

  /* ---------- deck ops ---------- */
  const applyDeck = useCallback((d: DeckJson) => {
    setDeck(d);
    setBundle((b) => (b ? { ...b, deck: d } : b));
  }, []);

  const reorder = useCallback(
    async (order: string[]) => {
      try {
        const d = await api.reorder(deckId, order);
        applyDeck(d);
      } catch (e) {
        toast({ title: "Reorder failed", description: (e as Error).message, variant: "destructive" });
        load();
      }
    },
    [deckId, applyDeck, toast, load],
  );

  const duplicate = useCallback(
    async (slideId: string) => {
      try {
        const d = await api.duplicateSlide(deckId, slideId);
        applyDeck(d);
        setSelId(d.slides.find((s) => s.id.startsWith(slideId) && s.id !== slideId)?.id ?? slideId);
      } catch (e) {
        toast({ title: "Duplicate failed", description: (e as Error).message, variant: "destructive" });
      }
    },
    [deckId, applyDeck, toast],
  );

  const remove = useCallback(
    async (slideId: string) => {
      try {
        const d = await api.deleteSlide(deckId, slideId);
        applyDeck(d);
        if (selId === slideId) setSelId(d.slides[0]?.id ?? null);
        refreshSnapshots();
        toast({ title: "Slide deleted", description: "A snapshot was taken before deletion" });
      } catch (e) {
        toast({ title: "Delete failed", description: (e as Error).message, variant: "destructive" });
      }
    },
    [deckId, applyDeck, selId, toast, refreshSnapshots],
  );

  const rename = useCallback(
    async (slideId: string, label: string) => {
      try {
        applyDeck(await api.patchSlide(deckId, slideId, { label }));
      } catch (e) {
        toast({ title: "Rename failed", description: (e as Error).message, variant: "destructive" });
      }
    },
    [deckId, applyDeck, toast],
  );

  const setSlideTheme = useCallback(
    async (slideId: string, theme: ThemeMode | null) => {
      try {
        applyDeck(await api.patchSlide(deckId, slideId, { theme: theme ?? undefined }));
      } catch (e) {
        toast({ title: "Could not set slide theme", description: (e as Error).message, variant: "destructive" });
      }
    },
    [deckId, applyDeck, toast],
  );

  const setSlideOverride = useCallback(
    async (slideId: string, layer: "bg" | "overlay", source: Source | undefined) => {
      try {
        // null (not undefined) so JSON keeps the key → the store removes it
        // and the filmstrip dot disappears (fix-list item 5)
        applyDeck(await api.patchSlide(deckId, slideId, { [layer]: source ?? null } as never));
      } catch (e) {
        toast({ title: "Could not set override", description: (e as Error).message, variant: "destructive" });
      }
    },
    [deckId, applyDeck, toast],
  );

  /* filmstrip error badge → open the slide on the first error line (item 4) */
  const jumpToError = useCallback((slideId: string, line: number, col: number) => {
    setSelId(slideId);
    setTab("slide");
    setCodeMinimized(false);
    try {
      window.localStorage.setItem(CODE_MIN_KEY, "0");
    } catch {
      /* ignore */
    }
    setGotoError({ slideId, line, col, nonce: Date.now() });
  }, []);

  const addSlideFrom = useCallback(
    async (opts: { template?: string; label?: string; code?: string; position?: number }) => {
      try {
        const d = await api.addSlide(deckId, opts);
        applyDeck(d);
        const last = opts.position ?? d.slides.length - 1;
        setSelId(d.slides[Math.max(0, Math.min(last, d.slides.length - 1))]?.id ?? null);
        setTab("slide");
      } catch (e) {
        toast({ title: "Could not add slide", description: (e as Error).message, variant: "destructive" });
      }
    },
    [deckId, applyDeck, toast],
  );

  const setCommonSource = useCallback(
    async (layer: "bg" | "overlay", source: Source) => {
      try {
        applyDeck(await api.patchDeck(deckId, { [layer]: source } as never));
      } catch (e) {
        toast({ title: "Could not set common source", description: (e as Error).message, variant: "destructive" });
      }
    },
    [deckId, applyDeck, toast],
  );

  const sel = useMemo(() => slides.find((s) => s.id === selId) ?? null, [slides, selId]);

  // stable selection callback — keeps the memoized Filmstrip from
  // re-rendering on every DashboardView state change (buffers, save state…)
  const selectSlide = useCallback((id: string) => {
    setSelId((prev) => (prev === id ? prev : id));
  }, []);

  /** single-flight file loader — never caches a failed fetch as "" */
  const inflightRef = useRef<Map<string, Promise<void>>>(new Map());
  const ensureBuffer = useCallback(
    (path: string): Promise<void> => {
      if (buffersRef.current[path] !== undefined || dirtyRef.current[path]) return Promise.resolve();
      const existing = inflightRef.current.get(path);
      if (existing) return existing;
      const p = (async () => {
        try {
          const content = await api.readFile(deckId, path);
          setBuffers((b) => (b[path] === undefined ? { ...b, [path]: content } : b));
        } catch {
          /* leave undefined — a later call can retry */
        } finally {
          inflightRef.current.delete(path);
        }
      })();
      inflightRef.current.set(path, p);
      return p;
    },
    [deckId],
  );

  const title = deck?.title ?? deckId;
  const anyDirty = Object.values(dirty).some(Boolean);

  if (!deck) {
    return (
      <div className="ss-app" style={{ placeItems: "center", display: "grid" }}>
        <div className="ss-label" style={{ letterSpacing: ".3em" }}>Opening {deckId}…</div>
      </div>
    );
  }

  return (
    <div className="ss-app">
      {/* top bar */}
      <header className="ss-topbar">
        <div className="ss-brand" onClick={nav.library} title="Back to library">
          <svg viewBox="0 0 24 24" className="ss-brand-mark" aria-hidden>
            <path d="M12 3 22 20H2Z" fill="currentColor" />
          </svg>
          <span className="ss-brand-name">Stagesmith</span>
        </div>
        <span className="ss-divider" />
        <input
          value={title}
          onChange={(e) => setDeck((d) => (d ? { ...d, title: e.target.value } : d))}
          onBlur={async (e) => {
            const t = e.target.value.trim() || "Untitled deck";
            if (t !== deck.title) {
              try {
                applyDeck(await api.patchDeck(deckId, { title: t }));
              } catch (err) {
                toast({ title: "Rename failed", description: (err as Error).message, variant: "destructive" });
              }
            }
          }}
          style={{
            background: "transparent",
            border: "1px solid transparent",
            borderRadius: 8,
            color: "var(--ss-ink)",
            font: "600 14px var(--ss-sans)",
            padding: "6px 10px",
            width: 260,
            outline: "none",
          }}
        />
        <span className={`ss-chip ${anyDirty ? (saveState === "saving" ? "warn" : "warn") : "ok"}`}>
          <span className="dot" />
          {anyDirty ? (saveState === "saving" ? "Saving…" : "Unsaved") : "Saved"}
        </span>
        <span className="ss-chip">
          <span className="dot" style={{ background: sync.connected ? "var(--ss-ok)" : "var(--ss-faint)" }} />
          {sync.remotes > 0 ? `${sync.remotes} phone${sync.remotes > 1 ? "s" : ""} connected` : "sync idle"}
        </span>
        <div style={{ flex: 1 }} />
        <button
          className="ss-btn ss-btn-icon"
          onClick={() => setUiTheme()}
          title={uiTheme === "dark" ? "Switch app to light theme" : "Switch app to dark theme"}
        >
          {uiTheme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
        </button>
        <button className="ss-btn ss-btn-icon" title="Undo (Ctrl+Z)" onClick={undo}>
          <Undo2 size={15} />
        </button>
        <button className="ss-btn ss-btn-icon" title="Redo (Ctrl+Shift+Z)" onClick={redo}>
          <Redo2 size={15} />
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="ss-btn" title="Import a slide into this deck">
              <FileUp size={15} /> Import
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent style={{ background: "var(--ss-panel2)", borderColor: "var(--ss-line-strong)", color: "var(--ss-ink)" }}>
            <ImportSlideItems onAdd={addSlideFrom} />
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="ss-btn">
              <Import size={15} /> Export
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent style={{ background: "var(--ss-panel2)", borderColor: "var(--ss-line-strong)", color: "var(--ss-ink)" }}>
            <DropdownMenuItem onClick={() => download(api.exportUrl(deckId, "smdeck"), `${deckId}.smdeck`)}>
              .smdeck (zip with manifest)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => download(api.exportUrl(deckId, "deck.tsx"), `${deckId}.deck.tsx`)}>
              .deck.tsx (single text file)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="ss-btn ss-btn-icon" title="Snapshots (last 10)">
              <Camera size={15} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent style={{ background: "var(--ss-panel2)", borderColor: "var(--ss-line-strong)", color: "var(--ss-ink)", maxHeight: 320, overflowY: "auto" }}>
            <DropdownMenuLabel className="ss-label">Snapshots — restore a point</DropdownMenuLabel>
            {snapshots.length === 0 && (
              <div style={{ padding: "8px 12px", font: "400 12px var(--ss-sans)", color: "var(--ss-mut)" }}>
                No snapshots yet — taken automatically before delete/restore.
              </div>
            )}
            {snapshots.map((s) => (
              <DropdownMenuItem
                key={s}
                onClick={async () => {
                  try {
                    await api.restoreSnapshot(deckId, s);
                    await load();
                    toast({ title: "Snapshot restored", description: s });
                  } catch (e) {
                    toast({ title: "Restore failed", description: (e as Error).message, variant: "destructive" });
                  }
                }}
              >
                <BookOpen size={13} /> {s.replace(/\.json$/, "")}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <button className="ss-btn" onClick={() => setQrOpen(true)} title="Open QR panel">
          <QrCode size={15} /> QR
        </button>
        <button className="ss-btn ss-btn-acc" onClick={() => nav.present(deckId, 0)} title="Present (F5 from start)">
          <Presentation size={15} /> Present
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="ss-btn ss-btn-icon" style={{ marginLeft: -8 }} title="Present options">
              <Play size={13} style={{ transform: "rotate(90deg)" }} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent style={{ background: "var(--ss-panel2)", borderColor: "var(--ss-line-strong)", color: "var(--ss-ink)" }}>
            <DropdownMenuItem onClick={() => nav.present(deckId, 0)}>
              <Play size={13} /> From start
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                const idx = slides.findIndex((s) => s.id === selId);
                nav.present(deckId, Math.max(0, idx));
              }}
            >
              <Play size={13} /> From current slide ({slides.findIndex((s) => s.id === selId) + 1 || 1})
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {/* body */}
      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <Filmstrip
          deckId={deckId}
          deck={deck}
          themeCss={themeCss}
          version={version}
          selId={selId}
          onSelect={selectSlide}
          onReorder={reorder}
          onDuplicate={duplicate}
          onDelete={remove}
          onRename={rename}
          onSetTheme={setSlideTheme}
          onAdd={addSlideFrom}
          onJumpToError={jumpToError}
        />
        <div className="ss-preview-wrap">
          <PreviewPane
            deckId={deckId}
            deck={deck}
            sel={sel}
            themeCss={themeCss}
            version={version}
            onOverride={setSlideOverride}
          />
          <CodePane
            deckId={deckId}
            deck={deck}
            files={bundle?.files ?? []}
            sel={sel}
            tab={tab}
            onTab={setTab}
            buffers={buffers}
            dirty={dirty}
            onBufferChange={onBufferChange}
            ensureBuffer={ensureBuffer}
            onFlushSave={() => flushSave()}
            onCommonSource={setCommonSource}
            onOverride={setSlideOverride}
            version={version}
            minimized={codeMinimized}
            onToggleMinimize={toggleCodeMin}
            gotoError={gotoError}
          />
        </div>
      </div>

      {qrOpen && (
        <QrPanel
          deckId={deckId}
          token={sync.token}
          remotes={sync.remotes}
          onClose={() => setQrOpen(false)}
        />
      )}
    </div>
  );
}

function ImportSlideItems({ onAdd }: { onAdd: (opts: { code?: string; label?: string; template?: string; position?: number }) => void }) {
  const { toast } = useToast();
  return (
    <>
      <DropdownMenuItem
        onClick={() => {
          const input = document.createElement("input");
          input.type = "file";
          input.accept = ".tsx,.ts,.txt";
          input.onchange = () => {
            const f = input.files?.[0];
            if (!f) return;
            f.text().then((code) => {
              onAdd({ code, label: f.name.replace(/\.(tsx|ts|txt)$/i, "") });
            }).catch(() => toast({ title: "Could not read file" }));
          };
          input.click();
        }}
      >
        <FileUp size={14} /> Import .tsx as new slide
      </DropdownMenuItem>
      <DropdownMenuItem
        onClick={() => {
          navigator.clipboard
            .readText()
            .then((code) => {
              if (code.trim()) onAdd({ code, label: "Pasted slide" });
              else toast({ title: "Clipboard is empty" });
            })
            .catch(() => toast({ title: "Clipboard blocked by the browser" }));
        }}
      >
        <Import size={14} /> Paste TSX from clipboard
      </DropdownMenuItem>
      <DropdownMenuSeparator style={{ background: "#2a2a2e" }} />
    </>
  );
}
