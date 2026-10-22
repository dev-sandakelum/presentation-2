"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Copy, ExternalLink, FileUp, FolderOpen, FolderPlus, Home, Import, Layers, MonitorSmartphone, Play, Plus, ArrowUp, RefreshCw, HardDrive } from "lucide-react";
import { api, getCapabilities, defaultStore, type FsBrowse } from "@/lib/stagesmith/client";
import type { DeckSummary } from "@/lib/stagesmith/types";
import { openDeviceProject, supportsDeviceFolders, isDesktopWebview } from "@/lib/stagesmith/device";
import { desktopFsStatus } from "@/lib/stagesmith/desktop-store";
import { DesktopFsError, fsChooseDeckFolder, fsConfirmAddDecks, type DesktopDeckCandidate } from "@/lib/stagesmith/desktop-fs";
import { hasCefQuery } from "@/lib/stagesmith/desktop-bridge";
import { useDesktopFs } from "@/hooks/useDesktopFs";
import {
  grantNextPending,
  pickFolderAgain,
  requestDeckAccess,
  type DeckAccessState,
} from "@/lib/stagesmith/permission";
import { useAccessStates } from "@/hooks/useDeviceAccess";
import { AccessBanner, DeckAccessNotice } from "./AccessBanner";
import { NewProjectDialog } from "./NewProjectDialog";
import { LiveThumb } from "./LiveThumb";
import { BrandLogo } from "./BrandLogo";
import { ConfirmDialog } from "./ConfirmDialog";
import { download, formatWhen, type SsNav } from "./shared";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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

/** lazy mount when scrolled into view (thumbnails are static images now) */
export function useInView<T extends HTMLElement>(rootMargin = "160px") {
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

export function LibraryView({ nav, initialDecks }: { nav: SsNav; initialDecks: DeckSummary[] | null }) {
  const { toast } = useToast();
  const [decks, setDecks] = useState<DeckSummary[] | null>(initialDecks);
  const [newOpen, setNewOpen] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [openFolderOpen, setOpenFolderOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [pasted, setPasted] = useState("");
  const [pastedName, setPastedName] = useState("");
  const [busy, setBusy] = useState(false);
  const smdeckInput = useRef<HTMLInputElement | null>(null);

  /* ---------- lapsed device-folder permissions (banner + cards) ----------
   * Filled in asynchronously by the shell-level check — rendering never
   * waits for it; a granted deck simply shows nothing extra. */
  const access = useAccessStates();
  const [grantBusy, setGrantBusy] = useState(false);

  /* ---------- the desktop app's decks folder (fs capability) ----------
   * When the studio runs inside Chassé Studio, Java owns the folder — one
   * native pick, persisted on the Java side, nothing expires. The banner
   * appears when no folder is chosen yet (first run) or when the saved one
   * went missing / read-only (moved, unmounted, permissions). */
  const desktopFs = useDesktopFs();
  const desktopNeedsFolder =
    desktopFs.status?.available === true && !(desktopFs.status.configured && desktopFs.status.valid);
  // an OLDER desktop build (bridge present, but no "fs" capability): the
  // app falls back to browser storage and the user should update the desktop
  // app to get the folder-backed, never-expiring storage
  const legacyDesktopApp = desktopFs.status !== null && !desktopFs.status.available && hasCefQuery();
  const chooseDesktopFolder = async () => {
    try {
      const s = await desktopFs.choose({
        // the in-app dialog's copy — the native chooser carries it from here
        title: "Choose your Chassé decks folder",
        startPath: desktopFs.status?.path || undefined,
        hint: "Chassé Studio keeps each deck as a plain folder here — deck.json, slides and assets together.",
      });
      if (s?.configured && s.valid) {
        toast({ title: "Decks folder ready", description: s.path });
        refresh();
      } else if (s?.configured && !s.valid) {
        toast({ title: "Folder not usable", description: `${s.path} — ${s.problem === "no-permission" ? "no write permission" : "folder missing"}`, variant: "destructive" });
      }
      // {cancelled:true} — quiet by design: the user closed the chooser,
      // nothing changed, no error to show
    } catch (e) {
      if (e instanceof DesktopFsError && e.code === "BUSY") {
        toast({ title: "Folder chooser already open", description: "Finish or close the open chooser first." });
      } else if (e instanceof DesktopFsError && e.code === "NO_OS_PERMISSION") {
        // the desktop app's own verdict — missing or read-only folder
        toast({ title: "Folder not usable", description: e.message, variant: "destructive" });
      } else {
        toast({ title: "Could not choose folder", description: (e as Error).message, variant: "destructive" });
      }
    }
  };

  const promptDeckIds = (decks ?? [])
    .filter((d) => d.device && d.store === "browser")
    .filter((d) => access[d.id] === "prompt")
    .map((d) => d.id);
  // high-water mark so a partially-restored multi-deck banner can say
  // “Access restored for N of M — click Allow again for the rest”
  const promptHighRef = useRef(0);
  if (promptDeckIds.length > promptHighRef.current) promptHighRef.current = promptDeckIds.length;
  const restoredCount = Math.max(0, promptHighRef.current - promptDeckIds.length);

  const allowAll = useCallback(async () => {
    if (grantBusy || !promptDeckIds.length) return;
    setGrantBusy(true);
    try {
      // one parent sheet covers every deck inside a remembered shared
      // folder; otherwise ONE deck per click (chained requestPermission
      // calls after an await lose the user-gesture context)
      await grantNextPending(promptDeckIds);
    } finally {
      setGrantBusy(false);
    }
  }, [grantBusy, promptDeckIds]);

  const refresh = useCallback(async () => {
    try {
      setDecks(await api.listDecks());
    } catch (e) {
      toast({ title: "Could not list decks", description: (e as Error).message, variant: "destructive" });
    }
  }, [toast]);

  // SSR delivered the list — refresh in the background for freshness
  useEffect(() => {
    if (initialDecks) {
      const t = setTimeout(refresh, 800);
      return () => clearTimeout(t);
    }
    refresh();
  }, [refresh, initialDecks]);

  const createDeck = async () => {
    const title = newTitle.trim() || "Untitled deck";
    setBusy(true);
    try {
      const store = await defaultStore();
      const deck = await api.createDeck(title, { store });
      toast({
        title: `Deck “${deck.title}” created`,
        description:
          store === "desktop"
            ? "Saved in the Chassé Studio desktop folder you picked — no permission to renew, ever."
            : store === "browser"
              ? "Saved in this browser — this site can’t write server files (use Export for a portable copy)."
              : undefined,
      });
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
          padding: "24px clamp(18px, 4vw, 44px) 20px",
          borderBottom: "1px solid var(--ss-line)",
          position: "sticky",
          top: 0,
          background: "color-mix(in srgb, var(--ss-bg) 86%, transparent)",
          backdropFilter: "blur(10px)",
          zIndex: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
          <BrandLogo size={30} showImage />
          <div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ font: "italic 600 22px var(--ss-fbrand)", letterSpacing: "-.01em" }}>Chassé</span>
              <span style={{ font: "400 12px var(--ss-fb)", color: "var(--ss-mut)" }}>studio</span>
            </div>
            <div className="ss-label" style={{ marginTop: 3 }}>Slides written as code</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {/* File menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="ss-btn" disabled={busy} title="File options">
                <FolderPlus size={15} /> File <ChevronDown size={13} style={{ opacity: 0.65 }} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" style={{ minWidth: 210 }}>
              <DropdownMenuItem onClick={() => setNewProjectOpen(true)}>
                <FolderPlus size={14} /> New project…
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setOpenFolderOpen(true)}>
                <FolderOpen size={14} /> Open folder…
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => smdeckInput.current?.click()}>
                <FileUp size={14} /> Load .smdeck…
              </DropdownMenuItem>
              <DropdownMenuSeparator />
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
        {/* the permission banner — ONLY when a device folder actually came
            back as "prompt" after a restart; granted shows nothing */}
        <AccessBanner
          count={promptDeckIds.length}
          restored={restoredCount}
          busy={grantBusy}
          onAllow={() => void allowAll()}
        />

        {/* the desktop decks-folder banner — first run (no folder yet) or a
            folder that went missing / read-only since the last run */}
        {legacyDesktopApp && (
          <div
            role="status"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              flexWrap: "wrap",
              border: "1px solid var(--ss-line-strong)",
              borderRadius: 14,
              padding: "12px 16px",
              marginBottom: 18,
              background: "var(--ss-panel)",
            }}
          >
            <MonitorSmartphone size={18} style={{ flex: "0 0 auto", opacity: 0.8 }} />
            <div style={{ flex: "1 1 320px", minWidth: 240, font: "400 12.5px/1.6 var(--ss-fb)", color: "var(--ss-mut)" }}>
              <span style={{ font: "600 13.5px var(--ss-fb)", color: "var(--ss-ink)" }}>Desktop app update available — </span>
              this installed desktop build is older than the studio, so decks are kept in this
              browser’s storage. Updating the app lets it own a real decks folder for you.
            </div>
            <a
              className="ss-btn"
              href="https://github.com/dev-sandakelum/chasse-desktop/releases"
              target="_blank"
              rel="noreferrer"
              style={{ flex: "0 0 auto", textDecoration: "none" }}
            >
              Get the latest release
            </a>
          </div>
        )}
        {desktopNeedsFolder && (
          <div
            role="status"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              flexWrap: "wrap",
              border: "1px solid var(--ss-line-strong)",
              borderRadius: 14,
              padding: "14px 16px",
              marginBottom: 18,
              background: "color-mix(in srgb, var(--ss-acc, #5b52cc) 8%, var(--ss-bg))",
            }}
          >
            <MonitorSmartphone size={18} style={{ flex: "0 0 auto", opacity: 0.8 }} />
            <div style={{ flex: "1 1 320px", minWidth: 240 }}>
              <div style={{ font: "600 13.5px var(--ss-fb)", color: "var(--ss-ink)" }}>
                {desktopFs.status?.configured
                  ? "The desktop decks folder needs to be chosen again"
                  : "Choose the folder where Chassé Studio should keep your decks"}
              </div>
              <div style={{ font: "400 12.5px/1.6 var(--ss-fb)", color: "var(--ss-mut)", marginTop: 3 }}>
                {desktopFs.status?.configured ? (
                  <>
                    {desktopFs.status.problem === "no-permission" ? "No write permission — " : "Couldn’t find — "}
                    <code style={{ font: "500 11.5px var(--ss-fm)" }}>{desktopFs.status.path}</code>. The desktop app
                    remembers the folder for you, so this only appears when it moved or lost write access.
                  </>
                ) : (
                  <>
                    The desktop app keeps decks as plain folders (deck.json + slides + assets) and remembers your choice —
                    no permission prompts on restart, ever. Picking a folder that already contains decks adopts them.
                  </>
                )}
              </div>
            </div>
            <button
              className="ss-btn ss-btn-acc"
              disabled={desktopFs.choosing}
              onClick={() => void chooseDesktopFolder()}
              style={{ flex: "0 0 auto" }}
            >
              <FolderOpen size={14} />
              {desktopFs.choosing
                ? "Choose in the app…"
                : desktopFs.status?.configured
                  ? "Choose folder again…"
                  : "Choose decks folder…"}
            </button>
          </div>
        )}

        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 16 }}>
          <div className="ss-label" style={{ fontSize: 11 }}>Decks — {decks ? decks.length : "…"}</div>
          <div className="ss-label">~/chasse/decks · the folder is the project</div>
        </div>

        {!decks ? (
          <div className="ss-library-grid" aria-hidden>
            {[0, 1, 2].map((i) => (
              <div key={i} className="ss-card" style={{ pointerEvents: "none" }}>
                <div className="ss-card-frame ss-shimmer" style={{ aspectRatio: "16/9" }} />
                <div className="ss-card-body">
                  <div style={{ height: 14, width: "56%", borderRadius: 7, background: "var(--ss-hov)", marginBottom: 8 }} />
                  <div style={{ height: 10, width: "38%", borderRadius: 6, background: "var(--ss-hov)" }} />
                </div>
              </div>
            ))}
          </div>
        ) : decks.length === 0 ? (
          <div
            style={{
              border: "1.5px dashed var(--ss-line-strong)",
              borderRadius: 16,
              padding: "56px 20px",
              textAlign: "center",
              color: "var(--ss-mut)",
            }}
          >
            <Layers size={30} style={{ margin: "0 auto 14px", display: "block", opacity: 0.6 }} />
            <div style={{ font: "600 15px var(--ss-fb)", color: "var(--ss-ink2)" }}>No decks yet — the studio starts empty</div>
            <div style={{ font: "400 13px/1.7 var(--ss-fb)", marginTop: 6, maxWidth: 460, marginInline: "auto" }}>
              Create a starter deck with <b>New deck</b>, place a full project folder on your device with{" "}
              <b>File → New project…</b>, or load an existing one with <b>File → Load .smdeck…</b>.
            </div>
          </div>
        ) : (
          <div className="ss-library-grid">
            {decks.map((d) => (
              <DeckCard key={d.id} deck={d} nav={nav} onDeleted={refresh} onDuplicated={refresh} />
            ))}
          </div>
        )}
      </main>

      {/* New project (folder structure at a picked location) */}
      <NewProjectDialog open={newProjectOpen} onOpenChange={setNewProjectOpen} nav={nav} />

      {/* Open existing folder */}
      <OpenFolderDialog open={openFolderOpen} onOpenChange={setOpenFolderOpen} nav={nav} />

      {/* New deck */}
      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent style={{ background: "var(--ss-pop)", borderColor: "var(--ss-line)", color: "var(--ss-ink)", borderRadius: 18 }}>
          <DialogHeader>
            <DialogTitle style={{ color: "var(--ss-ink)", font: "italic 600 17px var(--ss-fbrand)", letterSpacing: "-.01em" }}>New deck</DialogTitle>
            <DialogDescription className="sr-only">Give the deck a title — the starter deck is created with two slides.</DialogDescription>
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
            <div style={{ font: "400 12px var(--ss-fb)", color: "var(--ss-mut)" }}>
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
        <DialogContent style={{ background: "var(--ss-pop)", borderColor: "var(--ss-line)", color: "var(--ss-ink)", borderRadius: 18, maxWidth: 560 }}>
          <DialogHeader>
            <DialogTitle style={{ color: "var(--ss-ink)", font: "italic 600 17px var(--ss-fbrand)", letterSpacing: "-.01em" }}>Import a deck</DialogTitle>
            <DialogDescription className="sr-only">
              Import a deck from a .smdeck or .zip file, a .deck.tsx file, or paste slide TSX code.
            </DialogDescription>
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
                style={{ width: "100%", height: 140, padding: "10px 12px", resize: "vertical", fontFamily: "var(--ss-fm)", fontSize: 12 }}
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

/**
 * "Open folder…" — opens an existing presentation folder from anywhere
 * on the filesystem and links it into the library.
 */
function OpenFolderDialog({
  open,
  onOpenChange,
  nav,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  nav: SsNav;
}) {
  const { toast } = useToast();
  const [fsWritable, setFsWritable] = useState<boolean | null>(null);
  const [deviceSupported, setDeviceSupported] = useState(false);
  const [opening, setOpening] = useState(false);
  const [desktopRoot, setDesktopRoot] = useState<string | null>(null);
  // desktop folder-chooser flow (fs.chooseDeckFolder via the bridge)
  const [choosingDesktop, setChoosingDesktop] = useState(false);
  const [candidates, setCandidates] = useState<DesktopDeckCandidate[] | null>(null);
  const [candidatePick, setCandidatePick] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);

  // server browser state (local runs only)
  const [dir, setDir] = useState<string | null>(null);
  const [browse, setBrowse] = useState<FsBrowse | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDeviceSupported(supportsDeviceFolders());
    getCapabilities()
      .then((c) => setFsWritable(c.fsWritable))
      .catch(() => setFsWritable(false));
    // inside the desktop app, Java owns the decks folder — the browser's
    // folder permission is exactly what we DON'T rely on there
    desktopFsStatus().then((s) =>
      setDesktopRoot(s.available && s.configured && s.valid ? s.path : null),
    );
  }, [open]);

  useEffect(() => {
    if (!open || !fsWritable) return;
    let cancelled = false;
    (async () => {
      setBusy(true);
      try {
        const b = await api.browseFs(dir ?? undefined);
        if (cancelled) return;
        setBrowse(b);
        setTyped(b.path);
        setError(null);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, dir, fsWritable]);

  /** desktop app: native folder chooser through the fs bridge — the Java side
   *  opens a real JFileChooser; a folder with a deck.json is added to the
   *  library, a parent folder offers its deck subfolders for confirmation */
  const openDesktopFolder = async () => {
    if (choosingDesktop) return;
    setChoosingDesktop(true);
    try {
      const r = await fsChooseDeckFolder({
        title: "Choose a deck folder",
        startPath: desktopRoot ?? undefined,
      });
      if ("cancelled" in r) return; // user closed the chooser — nothing changed
      if ("alreadyInLibrary" in r) {
        toast({ title: "Already in your library", description: "That deck folder is already listed." });
        return;
      }
      if ("needsConfirm" in r) {
        setCandidates(r.candidates);
        setCandidatePick(new Set(r.candidates.map((c) => c.token)));
        return;
      }
      if ("added" in r && r.added.length) {
        const first = r.added[0];
        toast({
          title: `Opened “${first.title}”`,
          description: `${first.path} — added to your library.`,
        });
        onOpenChange(false);
        nav.deck(first.id);
      }
    } catch (e) {
      if (e instanceof DesktopFsError && e.code === "BUSY") {
        toast({ title: "Folder chooser already open", description: "Finish or close the open chooser first." });
      } else {
        toast({ title: "Could not open folder", description: (e as Error).message, variant: "destructive" });
      }
    } finally {
      setChoosingDesktop(false);
    }
  };

  const confirmCandidates = async () => {
    if (!candidates || confirming) return;
    setConfirming(true);
    try {
      const r = await fsConfirmAddDecks([...candidatePick]);
      const added = r.added ?? [];
      toast({
        title: added.length === 1 ? `Opened “${added[0].title}”` : `${added.length} decks added`,
        description: added.map((a) => a.path).join("\n"),
      });
      setCandidates(null);
      onOpenChange(false);
      if (added[0]) nav.deck(added[0].id);
    } catch (e) {
      toast({ title: "Could not add the decks", description: (e as Error).message, variant: "destructive" });
    } finally {
      setConfirming(false);
    }
  };

  /** open a folder from the USER'S device (File System Access API) */
  const openDeviceFolder = async () => {
    setOpening(true);
    try {
      const res = await openDeviceProject();
      if (!res) return; // user cancelled the picker
      toast({
        title: `Opened “${res.title}”`,
        description: "Loaded from your device folder — edits are saved back to it while this tab has access.",
      });
      onOpenChange(false);
      nav.deck(res.deckId);
    } catch (e) {
      toast({
        title: "Could not open folder",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setOpening(false);
    }
  };

  /** open a server-side folder (local runs — the server is this machine) */
  const openServerFolder = async () => {
    if (!browse?.path) return;
    setOpening(true);
    try {
      const result = await api.createProject("", browse.path);
      toast({
        title: `Opened "${result.deck.title}"`,
        description: result.external ? `Linked: ${result.root}` : `${result.root}`,
      });
      onOpenChange(false);
      nav.deck(result.deckId);
    } catch (e) {
      toast({
        title: "Could not open folder",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setOpening(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        style={{ background: "var(--ss-pop)", borderColor: "var(--ss-line)", color: "var(--ss-ink)", maxWidth: 620 }}
      >
        <DialogHeader>
          <DialogTitle style={{ color: "var(--ss-ink)", font: "700 17px var(--ss-fd)" }}>Open existing folder</DialogTitle>
          <DialogDescription className="sr-only">
            Open a deck from a device folder, this server’s decks folder, or a downloaded .smdeck file.
          </DialogDescription>
        </DialogHeader>

        <div style={{ display: "grid", gap: 14, padding: "2px 0 6px" }}>
          {desktopRoot ? (
            <div>
              <button
                className="ss-btn ss-btn-acc"
                style={{ width: "100%", height: 40, justifyContent: "center", gap: 8 }}
                disabled={choosingDesktop}
                onClick={() => void openDesktopFolder()}
              >
                <FolderOpen size={15} />
                {choosingDesktop ? "Choose in the app…" : "Choose a deck folder…"}
              </button>
              <div style={{ font: "400 12px/1.6 var(--ss-sans)", color: "var(--ss-mut)", marginTop: 7 }}>
                The desktop app opens its own folder picker. A folder with a{" "}
                <code style={{ font: "500 11px var(--ss-mono)" }}>deck.json</code> is added to your library
                as-is — anywhere on your computer. Decks also live in{" "}
                <code style={{ font: "500 11px var(--ss-mono)" }}>{desktopRoot}</code>; drop a deck folder in
                there and it appears automatically.
              </div>
              {candidates && (
                <div
                  style={{
                    marginTop: 10,
                    border: "1px solid var(--ss-line)",
                    borderRadius: 10,
                    background: "var(--ss-panel2)",
                    padding: 10,
                  }}
                >
                  <div className="ss-label" style={{ marginBottom: 6 }}>
                    Decks found in that folder — choose which to add
                  </div>
                  {candidates.map((c) => (
                    <label
                      key={c.token}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "5px 4px",
                        font: "400 12.5px var(--ss-sans)",
                        color: "var(--ss-ink2)",
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={candidatePick.has(c.token)}
                        onChange={(e) =>
                          setCandidatePick((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(c.token);
                            else next.delete(c.token);
                            return next;
                          })
                        }
                      />
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {c.title}
                      </span>
                      <span style={{ font: "400 11px var(--ss-mono)", color: "var(--ss-mut)", flex: "none" }}>
                        {c.slides} slides
                      </span>
                    </label>
                  ))}
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <button
                      className="ss-btn ss-btn-acc"
                      style={{ height: 30, flex: 1, justifyContent: "center" }}
                      disabled={confirming || candidatePick.size === 0}
                      onClick={() => void confirmCandidates()}
                    >
                      {confirming ? "Adding…" : `Add ${candidatePick.size} deck${candidatePick.size === 1 ? "" : "s"}`}
                    </button>
                    <button
                      className="ss-btn"
                      style={{ height: 30 }}
                      disabled={confirming}
                      onClick={() => setCandidates(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <>
              {/* device folder — the primary path */}
              <div>
                <div className="ss-label" style={{ marginBottom: 6 }}>A folder on this device</div>
            {deviceSupported ? (
              <>
                <button
                  className="ss-btn ss-btn-acc"
                  style={{ width: "100%", height: 40, justifyContent: "center", gap: 8 }}
                  disabled={opening}
                  onClick={openDeviceFolder}
                >
                  <FolderOpen size={15} />
                  {opening ? "Opening…" : "Choose a folder with a deck.json…"}
                </button>
                <div style={{ font: "400 12px var(--ss-sans)", color: "var(--ss-mut)", marginTop: 7 }}>
                  Your browser asks for permission to read the folder you pick. The project opens from
                  your device and edits are mirrored back to it.
                </div>
              </>
            ) : (
              <div style={{ font: "400 12px var(--ss-sans)", color: "var(--ss-mut)" }}>
                This browser can&rsquo;t pick device folders (Chromium browsers support it). Use{" "}
                <b>File &rarr; Load .smdeck…</b> to open a project archive instead.
              </div>
            )}
          </div>

          {/* server-side browser — only meaningful when the app runs locally */}
          {fsWritable && (
            <div>
              <div className="ss-label" style={{ marginBottom: 6 }}>Server folders (this machine)</div>
              <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
                <button
                  className="ss-btn ss-btn-icon"
                  style={{ height: 28, width: 28, flex: "none" }}
                  title="Up one folder"
                  disabled={!browse?.parent || busy}
                  onClick={() => browse?.parent && setDir(browse.parent)}
                >
                  <ArrowUp size={13} />
                </button>
                <button
                  className="ss-btn ss-btn-icon"
                  style={{ height: 28, width: 28, flex: "none" }}
                  title="Home"
                  disabled={busy}
                  onClick={() => setDir(null)}
                >
                  <Home size={13} />
                </button>
                <button
                  className="ss-btn ss-btn-icon"
                  style={{ height: 28, width: 28, flex: "none" }}
                  title="Default decks folder"
                  disabled={busy}
                  onClick={() => browse && setDir(browse.decksRoot)}
                >
                  <HardDrive size={13} />
                </button>
                <div
                  style={{
                    flex: 1,
                    minWidth: 0,
                    font: "500 12px var(--ss-mono)",
                    color: "var(--ss-ink2)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    padding: "6px 8px",
                    border: "1px solid var(--ss-line)",
                    borderRadius: 8,
                    background: "var(--ss-panel2)",
                  }}
                  title={browse?.path ?? ""}
                >
                  {busy ? "…" : browse?.path ?? ""}
                </div>
                <button
                  className="ss-btn ss-btn-icon"
                  style={{ height: 28, width: 28, flex: "none" }}
                  title="Refresh"
                  disabled={busy}
                  onClick={() => setDir(browse?.path ?? null)}
                >
                  <RefreshCw size={13} />
                </button>
              </div>

              <div
                className="ss-scroll"
                style={{
                  border: "1px solid var(--ss-line)",
                  borderRadius: 10,
                  background: "var(--ss-panel2)",
                  maxHeight: 150,
                  overflowY: "auto",
                  padding: 4,
                }}
              >
                {busy && !browse ? (
                  <div className="ss-label" style={{ padding: "14px 10px" }}>Loading…</div>
                ) : browse && browse.dirs.length === 0 ? (
                  <div className="ss-label" style={{ padding: "14px 10px" }}>No subfolders here</div>
                ) : (
                  browse?.dirs.map((d) => (
                    <button
                      key={d}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        width: "100%",
                        padding: "6px 10px",
                        borderRadius: 7,
                        border: "none",
                        background: "transparent",
                        color: "var(--ss-ink2)",
                        font: "400 13px var(--ss-sans)",
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                      onClick={() => setDir(`${browse.path}/${d}`)}
                    >
                      <FolderOpen size={13} style={{ color: "var(--ss-acc)", flex: "none" }} />
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d}</span>
                    </button>
                  ))
                )}
              </div>

              <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                <input
                  className="ss-input"
                  style={{ flex: 1, minWidth: 0, font: "400 12px var(--ss-mono)" }}
                  value={typed}
                  placeholder="/absolute/path/to/folder"
                  spellCheck={false}
                  onChange={(e) => setTyped(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && typed.trim()) setDir(typed.trim());
                  }}
                />
                <button
                  className="ss-btn"
                  style={{ height: 34, flex: "none" }}
                  disabled={busy || !typed.trim()}
                  onClick={() => setDir(typed.trim())}
                >
                  Go
                </button>
              </div>

              {error && (
                <div style={{ font: "400 12px var(--ss-sans)", color: "var(--ss-err)", marginTop: 6 }}>
                  {error}
                </div>
              )}
              <button
                className="ss-btn"
                style={{ marginTop: 8, height: 34, justifyContent: "center" }}
                disabled={opening || busy || !browse?.path || !!error}
                onClick={openServerFolder}
              >
                <FolderOpen size={15} />
                {opening ? "Opening…" : "Open this server folder"}
              </button>
            </div>
          )}
            </>
          )}

          <div style={{ font: "400 12px var(--ss-sans)", color: "var(--ss-mut)" }}>
            The folder must contain a deck.json file (a Chassé/Stagesmith project).
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Chassé brand mark — moved to ./BrandLogo so the loading screen shares
 *  the exact same mark as the app headers. */

function DeckCard({
  deck,
  nav,
  onDeleted,
  onDuplicated,
}: {
  deck: DeckSummary;
  nav: SsNav;
  onDeleted: () => void;
  onDuplicated: () => void;
}) {
  const { toast } = useToast();
  const { ref, inView } = useInView<HTMLDivElement>();
  const [sig, setSig] = useState(deck.signature);

  /* ---------- delete flow: menu only OPENS the confirmation ---------- */
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deletingRef = useRef(false); // rapid double-clicks → ONE delete

  /* per-card permission state (browser mode only — the desktop webview has
   * no permission prompts at all, so device decks there get the migration
   * notice instead of an impossible "Allow access" flow) */
  const access = useAccessStates();
  const inDesktopWebview = isDesktopWebview();
  const accessState: DeckAccessState | undefined =
    !inDesktopWebview && deck.device && deck.store === "browser" ? access[deck.id] : undefined;
  const showMigration = inDesktopWebview && deck.store === "browser" && deck.device === true;

  // big decks ask for the title to be typed (decks can share a title — the
  // folder/id line + the typed title together pin down the right deck)
  const requireText = deck.slideCount >= 20 ? deck.title : null;

  const folderName = deck.folderName ?? deck.id;

  /* ---------- move a browser/device deck into the desktop app's folder ---------- */
  const [moving, setMoving] = useState(false);
  const moveToDesktopFolder = async () => {
    if (moving) return;
    setMoving(true);
    try {
      const { deckId } = await api.duplicateIntoDesktop(deck.id, deck.title);
      await api.deleteDeck(deck.id); // removes the browser copy (device folder files stay)
      toast({
        title: `“${deck.title}” moved to the app’s decks folder`,
        description: "It now saves through the desktop app — no permissions to renew, ever.",
      });
      onDeleted();
      nav.deck(deckId);
    } catch (e) {
      toast({ title: "Could not move the deck", description: (e as Error).message, variant: "destructive" });
    } finally {
      setMoving(false);
    }
  };

  /** the actual delete — remove the LIBRARY ENTRY ONLY; the folder and every
   *  file in it stay on disk (all stores). No permission is needed. */
  const runDelete = async (): Promise<void> => {
    if (deletingRef.current) return;
    deletingRef.current = true;
    setDeleting(true);
    setDeleteError(null);
    try {
      const r = await api.deleteDeck(deck.id);
      setDeleteOpen(false);
      onDeleted();
      toast({
        title: "Removed from library",
        description: `The project folder and its files were kept${r.root && r.root !== "this browser" ? ` (${r.root})` : ""} — the deck is no longer listed here.`,
        duration: 8000,
      });
    } catch (e) {
      // keep the dialog open with the reason — confirm button becomes Retry
      setDeleteError((e as Error).message || "The deck couldn’t be removed");
    } finally {
      setDeleting(false);
      deletingRef.current = false;
    }
  };

  const doDelete = () => {
    void runDelete();
  };
  // keep the cover thumbnail fresh without a full refresh
  useEffect(() => {
    setSig(deck.signature);
  }, [deck.signature]);

  const isBrowserDeck = deck.store === "browser";

  return (
    <div className="ss-card">
      <div
        ref={ref}
        className="ss-card-frame"
        onClick={() => nav.deck(deck.id)}
        title={`Open ${deck.title}`}
      >
        {inView && deck.cover?.slideId ? (
          <LiveThumb
            deckId={deck.id}
            slideId={deck.cover.slideId}
            slideTheme={deck.cover.mode}
            deckDefaultMode={deck.cover.mode}
            deckBg={deck.cover.bg}
            deckOverlay={deck.cover.overlay}
            themeCss={deck.cover.themeCss}
            version={sig}
          />
        ) : (
          <span className="ss-shimmer" aria-hidden />
        )}
      </div>
      <div className="ss-card-body">
        <div className="ss-card-title" title={deck.title}>
          {deck.title}
        </div>
        <div className="ss-card-badges">
          {deck.external && (
            <span className="ss-badge" title="Linked project — folder lives outside decks/">
              <ExternalLink size={10} /> linked
            </span>
          )}
          {isBrowserDeck && (
            <span
              className="ss-badge"
              title={
                deck.device
                  ? "Stored in this browser, mirrored to a folder on your device"
                  : "Stored in this browser (this deployment can't write server files)"
              }
            >
              {deck.device ? <HardDrive size={10} /> : <Layers size={10} />}
              {deck.device ? "device" : "this browser"}
            </span>
          )}
          {deck.store === "desktop" && (
            <span
              className="ss-badge"
              title={deck.folderName ? `Stored in the Chassé Studio desktop folder: ${deck.folderName}` : "Stored in the Chassé Studio desktop folder"}
            >
              <MonitorSmartphone size={10} /> desktop
            </span>
          )}
        </div>
        <div className="ss-card-meta" title={`${deck.slideCount} slides · ${deck.id} · modified ${formatWhen(deck.modified)}`}>
          {deck.slideCount} slides · {deck.id} · modified {formatWhen(deck.modified)}
        </div>
        {accessState && (
          <DeckAccessNotice
            state={accessState}
            onAllow={() => void requestDeckAccess(deck.id)}
            onChooseFolder={() => void pickFolderAgain(deck.id)}
          />
        )}
        {showMigration && (
          <div className="ss-card-migrate">
            <span>
              This deck lives in a browser folder. The desktop app can’t renew browser folder
              permissions — move it to the app’s decks folder to keep editing it here.
            </span>
            <button className="ss-btn" style={{ height: 26, padding: "0 10px", flex: "none" }} disabled={moving} onClick={() => void moveToDesktopFolder()}>
              <FolderPlus size={12} /> {moving ? "Moving…" : "Move to app folder"}
            </button>
          </div>
        )}
      </div>
      <div className="ss-card-acts">
        <button className="ss-btn" style={{ height: 30, padding: "0 12px" }} onClick={() => nav.deck(deck.id)}>
          <ChevronRight size={14} /> Open
        </button>
        <button className="ss-btn" style={{ height: 30, padding: "0 12px" }} onClick={() => nav.present(deck.id)}>
          <Play size={13} /> Present
        </button>
        <div style={{ flex: 1 }} />
        {isBrowserDeck && inDesktopWebview && (
          <button
            className="ss-btn"
            style={{ height: 30, padding: "0 10px" }}
            disabled={moving}
            title="Copy this deck into the desktop app's decks folder (files on your device stay)"
            onClick={() => void moveToDesktopFolder()}
          >
            <FolderPlus size={13} /> {moving ? "Moving…" : "Move"}
          </button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="ss-btn ss-btn-icon" style={{ height: 30, width: 30 }} title="More">
              <span style={{ font: "600 14px var(--ss-fm)", letterSpacing: 1 }}>···</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem
              onClick={async () => {
                try {
                  await api.createDeck(`${deck.title} (copy)`, { duplicateOf: deck.id });
                  onDuplicated();
                  toast({ title: "Deck duplicated" });
                } catch (e) {
                  toast({ title: "Duplicate failed", description: (e as Error).message, variant: "destructive" });
                }
              }}
            >
              <Copy size={14} /> Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={async () => {
                try {
                  const { url, filename } = await api.exportDeck(deck.id, "smdeck");
                  download(url, filename);
                } catch (e) {
                  toast({ title: "Export failed", description: (e as Error).message, variant: "destructive" });
                }
              }}
            >
              <Import size={14} /> Export .smdeck
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={async () => {
                try {
                  const { url, filename } = await api.exportDeck(deck.id, "deck.tsx");
                  download(url, filename);
                } catch (e) {
                  toast({ title: "Export failed", description: (e as Error).message, variant: "destructive" });
                }
              }}
            >
              <Import size={14} /> Export .deck.tsx
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              style={{ color: "var(--ss-danger)" }}
              onClick={() => {
                // NEVER delete from the menu — open the confirmation dialog
                setDeleteError(null);
                setDeleteOpen(true);
              }}
            >
              Remove from library
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* the delete confirmation — nothing is removed until Confirm. Files
          are ALWAYS kept on disk; this only removes the deck from the library. */}
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={(o) => {
          if (!o) {
            setDeleteOpen(false);
            setDeleteError(null);
          }
        }}
        title="Remove deck from library?"
        description={
          <>
            <div style={{ font: "600 13.5px var(--ss-fb, sans-serif)", color: "var(--ss-ink, #f2f0fa)" }}>
              {deck.title}
            </div>
            <div style={{ color: "var(--ss-mut, #9894b0)", font: "400 12px var(--ss-fm, monospace)" }}>
              {deck.slideCount} slides · folder: {folderName}
            </div>
            <div style={{ marginTop: 4 }}>
              This only removes the deck from your library. The project folder and its files stay on
              disk{deck.store === "browser" ? (deck.device ? " (your device folder is untouched)" : " (this browser's working copy is removed)") : ""}.
              You can get the deck back by opening the folder again.
            </div>
          </>
        }
        confirmLabel="Remove from library"
        danger
        busy={deleting}
        error={deleteError}
        requireText={requireText}
        onConfirm={doDelete}
        closeLabel="Close without removing"
      />
    </div>
  );
}
