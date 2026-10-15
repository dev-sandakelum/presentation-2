"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Copy, ExternalLink, FileUp, FolderPlus, Import, Layers, Play, Plus, Presentation, QrCode, Trash2 } from "lucide-react";
import { api } from "@/lib/stagesmith/client";
import type { DeckBundle } from "@/lib/stagesmith/client";
import type { DeckSummary } from "@/lib/stagesmith/types";
import { StageFrame } from "./StageFrame";
import { NewProjectDialog } from "./NewProjectDialog";
import { download, formatWhen, type SsNav } from "./shared";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** lazy mount when scrolled into view (thumbnails are iframes) */
export function useInView<T extends HTMLElement>(rootMargin = "120px") {
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

export function LibraryView({ nav }: { nav: SsNav }) {
  const { toast } = useToast();
  const [decks, setDecks] = useState<DeckSummary[] | null>(null);
  const [bundles, setBundles] = useState<Record<string, DeckBundle>>({});
  const [newOpen, setNewOpen] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [pasted, setPasted] = useState("");
  const [pastedName, setPastedName] = useState("");
  const [busy, setBusy] = useState(false);
  const smdeckInput = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      setDecks(await api.listDecks());
    } catch (e) {
      toast({ title: "Could not list decks", description: (e as Error).message, variant: "destructive" });
    }
  }, [toast]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // load bundles for card thumbnails
  useEffect(() => {
    if (!decks) return;
    let cancelled = false;
    (async () => {
      for (const d of decks) {
        if (cancelled) return;
        if (bundles[d.id]) continue;
        try {
          const b = await api.getDeck(d.id);
          if (!cancelled) setBundles((prev) => ({ ...prev, [d.id]: b }));
        } catch {
          /* skip */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
     
  }, [decks]);

  const createDeck = async () => {
    const title = newTitle.trim() || "Untitled deck";
    setBusy(true);
    try {
      const deck = await api.createDeck(title);
      nav.deck(deck.id);
    } catch (e) {
      toast({ title: "Could not create deck", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const importFile = async (file: File) => {
    setBusy(true);
    try {
      const report = await api.importFile(file);
      toast({
        title: `Imported “${report.deckId}”`,
        description: `${report.slides} slides · ${report.files} files${report.warnings.length ? ` · ${report.warnings.length} warnings` : ""}`,
      });
      setImportOpen(false);
      refresh();
    } catch (e) {
      toast({ title: "Import failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const importText = async () => {
    if (!pasted.trim()) return;
    setBusy(true);
    try {
      const report = await api.importText(pasted, pastedName.trim() || "AI deck");
      toast({ title: `Imported “${report.deckId}”`, description: `${report.slides} slides · ${report.files} files` });
      setImportOpen(false);
      setPasted("");
      setPastedName("");
      refresh();
    } catch (e) {
      toast({ title: "Import failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  /** File → Load .smdeck… — one or many files; opens the last one */
  const loadSmdeckFiles = async (list: FileList | null) => {
    const files = Array.from(list || []);
    if (!files.length) return;
    setBusy(true);
    let lastId: string | null = null;
    try {
      for (const f of files) {
        const report = await api.importFile(f);
        lastId = report.deckId;
        toast({
          title: `Loaded “${f.name}”`,
          description: `${report.slides} slides · ${report.files} files${report.warnings.length ? ` · ${report.warnings.length} warnings` : ""}`,
        });
      }
      if (lastId) nav.deck(lastId);
    } catch (e) {
      toast({ title: "Load failed", description: (e as Error).message, variant: "destructive" });
      refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ss-library ss-scroll">
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          padding: "26px clamp(18px, 4vw, 44px) 22px",
          borderBottom: "1px solid var(--ss-line)",
          position: "sticky",
          top: 0,
          background: "color-mix(in srgb, var(--ss-bg) 88%, transparent)",
          backdropFilter: "blur(10px)",
          zIndex: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
          <svg viewBox="0 0 24 24" width="26" height="26" style={{ color: "var(--ss-acc)" }} aria-hidden>
            <path d="M12 3 22 20H2Z" fill="currentColor" />
          </svg>
          <div>
            <div style={{ font: "600 20px var(--ss-sans)", letterSpacing: "-.02em" }}>Stagesmith</div>
            <div className="ss-label" style={{ marginTop: 2 }}>Code-first presentation studio</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {/* File menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="ss-btn" disabled={busy} title="File options">
                <FolderPlus size={15} /> File <ChevronDown size={13} style={{ opacity: 0.7 }} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" style={{ background: "#141417", borderColor: "#2a2a2e", color: "#e8e8ea", minWidth: 210 }}>
              <DropdownMenuItem onClick={() => setNewProjectOpen(true)}>
                <FolderPlus size={14} /> New project…
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => smdeckInput.current?.click()}>
                <FileUp size={14} /> Load .smdeck…
              </DropdownMenuItem>
              <DropdownMenuSeparator style={{ background: "#2a2a2e" }} />
              <DropdownMenuItem onClick={() => setImportOpen(true)}>
                <Import size={14} /> Import / paste…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {/* hidden multi .smdeck picker */}
          <input
            ref={smdeckInput}
            type="file"
            accept=".smdeck,.zip"
            multiple
            style={{ display: "none" }}
            onChange={(e) => {
              loadSmdeckFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <button className="ss-btn ss-btn-acc" onClick={() => setNewOpen(true)}>
            <Plus size={15} /> New deck
          </button>
        </div>
      </header>

      <main style={{ padding: "26px clamp(18px, 4vw, 44px) 60px" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 16 }}>
          <div className="ss-label" style={{ fontSize: 12 }}>Decks — {decks ? decks.length : "…"}</div>
          <div className="ss-label">~/Stagesmith/decks · folder is the project</div>
        </div>

        {!decks ? (
          <div className="ss-label" style={{ padding: "40px 0" }}>Loading…</div>
        ) : decks.length === 0 ? (
          <div
            style={{
              border: "1px dashed var(--ss-line-strong)",
              borderRadius: 16,
              padding: "60px 20px",
              textAlign: "center",
              color: "var(--ss-mut)",
            }}
          >
            <Layers size={30} style={{ margin: "0 auto 14px", display: "block", opacity: .6 }} />
            <div style={{ font: "500 15px var(--ss-sans)", color: "var(--ss-ink2)" }}>No decks yet</div>
            <div style={{ font: "400 13px var(--ss-sans)", marginTop: 6 }}>
              Create a starter deck, or import a .smdeck / .deck.tsx / AI answer.
            </div>
          </div>
        ) : (
          <div className="ss-library-grid">
            {decks.map((d) => (
              <DeckCard key={d.id} deck={d} bundle={bundles[d.id]} nav={nav} onDeleted={refresh} onDuplicated={refresh} />
            ))}
          </div>
        )}
      </main>

      {/* New project (folder structure at a picked location) */}
      <NewProjectDialog open={newProjectOpen} onOpenChange={setNewProjectOpen} nav={nav} />

      {/* New deck */}
      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent style={{ background: "#101012", borderColor: "#2a2a2e", color: "#f1f1f2" }}>
          <DialogHeader>
            <DialogTitle style={{ color: "#f1f1f2" }}>New deck</DialogTitle>
          </DialogHeader>
          <div style={{ display: "grid", gap: 12, padding: "4px 0" }}>
            <div className="ss-label">Deck title</div>
            <input
              className="ss-input"
              autoFocus
              value={newTitle}
              placeholder="My talk"
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") createDeck();
              }}
            />
            <div style={{ font: "400 12px var(--ss-sans)", color: "var(--ss-mut)" }}>
              Creates a folder with a title slide, end slide, theme.css and a grid background.
            </div>
          </div>
          <DialogFooter>
            <button className="ss-btn ss-btn-acc" disabled={busy} onClick={createDeck}>
              <Plus size={15} /> Create
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent style={{ background: "#101012", borderColor: "#2a2a2e", color: "#f1f1f2", maxWidth: 560 }}>
          <DialogHeader>
            <DialogTitle style={{ color: "#f1f1f2" }}>Import a deck</DialogTitle>
          </DialogHeader>
          <div style={{ display: "grid", gap: 16, padding: "4px 0" }}>
            <div>
              <div className="ss-label" style={{ marginBottom: 8 }}>From file</div>
              <label className="ss-btn" style={{ cursor: "pointer" }}>
                <FileUp size={15} /> Choose .smdeck / .zip / .deck.tsx / .tsx
                <input
                  type="file"
                  accept=".smdeck,.zip,.deck.tsx,.tsx,.txt"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) importFile(f);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
            <div>
              <div className="ss-label" style={{ marginBottom: 8 }}>From pasted AI text — // @file sections become files</div>
              <input
                className="ss-input"
                style={{ width: "100%", marginBottom: 8 }}
                placeholder="Deck name (optional)"
                value={pastedName}
                onChange={(e) => setPastedName(e.target.value)}
              />
              <textarea
                className="ss-input"
                style={{ width: "100%", height: 140, padding: "10px 12px", resize: "vertical", fontFamily: "var(--ss-mono)", fontSize: 12 }}
                placeholder={"// @file slides/intro.tsx\nexport default function Slide() {\n  …\n}"}
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <button className="ss-btn ss-btn-acc" disabled={busy || !pasted.trim()} onClick={importText}>
              <Import size={15} /> Import text
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DeckCard({
  deck,
  bundle,
  nav,
  onDeleted,
  onDuplicated,
}: {
  deck: DeckSummary;
  bundle?: DeckBundle;
  nav: SsNav;
  onDeleted: () => void;
  onDuplicated: () => void;
}) {
  const { toast } = useToast();
  const { ref, inView } = useInView<HTMLDivElement>();
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="ss-card">
      <div
        ref={ref}
        className="ss-card-frame"
        onClick={() => nav.deck(deck.id)}
        title={`Open ${deck.title}`}
      >
        {inView && bundle ? (
          <StageFrame
            deckId={deck.id}
            slide={bundle.deck.slides[0] ?? null}
            deckBg={bundle.deck.bg}
            deckOverlay={bundle.deck.overlay}
            themeCss={bundle.themeCss}
            mode={bundle.deck.settings.defaultMode}
            staticMode
            version={bundle.signature}
          />
        ) : (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
            <span className="ss-label" style={{ opacity: 0.5 }}>…</span>
          </div>
        )}
      </div>
      <div className="ss-card-body">
        <div className="ss-card-title">
          {deck.title}
          {deck.external && (
            <span
              title="Linked project — folder lives outside decks/"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 3,
                marginLeft: 7,
                verticalAlign: "middle",
                font: "500 10px var(--ss-mono)",
                color: "var(--ss-mut)",
                border: "1px solid var(--ss-line-strong)",
                borderRadius: 99,
                padding: "1px 7px",
                letterSpacing: ".06em",
              }}
            >
              <ExternalLink size={10} /> linked
            </span>
          )}
        </div>
        <div className="ss-card-meta">
          {deck.slideCount} slides · {deck.id} · modified {formatWhen(deck.modified)}
        </div>
      </div>
      <div className="ss-card-acts">
        <button className="ss-btn" style={{ height: 30, padding: "0 12px" }} onClick={() => nav.deck(deck.id)}>
          <ChevronRight size={14} /> Open
        </button>
        <button className="ss-btn" style={{ height: 30, padding: "0 12px" }} onClick={() => nav.present(deck.id)}>
          <Play size={13} /> Present
        </button>
        <div style={{ flex: 1 }} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="ss-btn ss-btn-icon" style={{ height: 30, width: 30 }} title="More">
              <QrCode size={0} style={{ display: "none" }} />
              <Presentation size={0} style={{ display: "none" }} />
              <Copy size={0} style={{ display: "none" }} />
              <span style={{ font: "600 14px var(--ss-mono)" }}>···</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent style={{ background: "#141417", borderColor: "#2a2a2e", color: "#e8e8ea" }}>
            <DropdownMenuItem
              onClick={async () => {
                try {
                  await api.createDeck(`${deck.title} (copy)`, deck.id);
                  onDuplicated();
                  toast({ title: "Deck duplicated" });
                } catch (e) {
                  toast({ title: "Duplicate failed", description: (e as Error).message, variant: "destructive" });
                }
              }}
            >
              <Copy size={14} /> Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => download(api.exportUrl(deck.id, "smdeck"), `${deck.id}.smdeck`)}>
              <Import size={14} /> Export .smdeck
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => download(api.exportUrl(deck.id, "deck.tsx"), `${deck.id}.deck.tsx`)}>
              <Import size={14} /> Export .deck.tsx
            </DropdownMenuItem>
            <DropdownMenuSeparator style={{ background: "#2a2a2e" }} />
            <DropdownMenuItem
              style={{ color: "#f26d6d" }}
              onClick={() => {
                if (!confirming) {
                  setConfirming(true);
                  setTimeout(() => setConfirming(false), 2500);
                  return;
                }
                api.deleteDeck(deck.id).then((r) => {
                  onDeleted();
                  toast(
                    r.external
                      ? { title: "Removed from library", description: `Files kept on disk at ${r.root}` }
                      : { title: "Deck deleted" },
                  );
                }).catch((e: Error) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }));
              }}
            >
              <Trash2 size={14} />{" "}
              {confirming
                ? "Click again to confirm"
                : deck.external
                  ? "Remove from library (keeps files)"
                  : "Delete"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
