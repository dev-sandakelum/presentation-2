"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Copy, ExternalLink, FileUp, FolderOpen, FolderPlus, Home, Import, Layers, MonitorSmartphone, Play, Plus, ArrowUp, RefreshCw, HardDrive } from "lucide-react";
import { api, getCapabilities, defaultStore, type DeleteDeckResult, type FsBrowse } from "@/lib/stagesmith/client";
import type { DeckSummary } from "@/lib/stagesmith/types";
import { openDeviceProject, supportsDeviceFolders } from "@/lib/stagesmith/device";
import { desktopFsStatus } from "@/lib/stagesmith/desktop-store";
import { DesktopFsError } from "@/lib/stagesmith/desktop-fs";
import { useDesktopFs } from "@/hooks/useDesktopFs";
import {
  grantNextPending,
  pickFolderAgain,
  requestDeckAccess,
  ensureWriteAccess,
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
import { ToastAction } from "@/components/ui/toast";
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
        </DialogHeader>

        <div style={{ display: "grid", gap: 14, padding: "2px 0 6px" }}>
          {desktopRoot ? (
            <div
              style={{
                border: "1px solid var(--ss-line-strong)",
                borderRadius: 12,
                padding: "14px 16px",
                font: "400 12.5px/1.7 var(--ss-sans)",
                color: "var(--ss-mut)",
              }}
            >
              <div style={{ font: "600 13.5px var(--ss-sans)", color: "var(--ss-ink)", marginBottom: 4 }}>
                The Chassé Studio desktop app owns your decks folder
              </div>
              Decks live in{" "}
              <code style={{ font: "500 11px var(--ss-mono)", color: "var(--ss-ink2)" }}>{desktopRoot}</code>. Drop a
              deck folder (any folder with a <code style={{ font: "500 11px var(--ss-mono)" }}>deck.json</code>) in there
              and it appears in the library — no permission to grant. To switch to a different folder, use the banner on
              the library page.
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

  /* per-card permission state — granted shows nothing extra, the device
   * chip above already marks the healthy case */
  const access = useAccessStates();
  const accessState: DeckAccessState | undefined =
    deck.device && deck.store === "browser" ? access[deck.id] : undefined;

  // big decks ask for the title to be typed (decks can share a title — the
  // folder/id line + the typed title together pin down the right deck)
  const requireText = deck.slideCount >= 20 ? deck.title : null;
  const folderName = deck.folderName ?? deck.id;

  /* ---------- delete without permission: honest, resumable ----------
   * api.deleteDeck returns needsAccess when the device folder couldn't be
   * written: NOTHING is deleted then (files stay, browser copy stays) and
   * this toast offers the recovery click — a fresh user gesture that
   * re-grants and finishes the delete. "Deck deleted" is only ever shown
   * after the files are actually gone. */
  const deleteNeedsAccessToast = (r: DeleteDeckResult) => {
    if (r.accessState === "missing") {
      toast({
        title: "Folder not found — nothing was deleted",
        description: `Chassé can't find the “${folderName}” folder on your device, so the deck was kept. Choose the folder again to finish deleting it.`,
        duration: 60_000, // recovery action — keep it around long enough to click
        action: (
          <ToastAction
            altText="Choose folder again"
            onClick={() => {
              void (async () => {
                const state = await pickFolderAgain(deck.id);
                if (state === "granted") await runDelete();
                else
                  toast({
                    title: "Folder not re-attached",
                    description: "The deck was kept — nothing was deleted.",
                    variant: "destructive",
                  });
              })();
            }}
          >
            Choose folder again
          </ToastAction>
        ),
      });
      return;
    }
    toast({
      title: "Access needed to delete files",
      duration: 60_000, // recovery action — keep it around long enough to click
      description:
        r.accessState === "denied"
          ? `Chassé is blocked from writing the “${folderName}” folder, so nothing was deleted. Allow it in the browser's site settings (chrome://settings/content/filesystem), then delete the deck again.`
          : `Chassé can't write to the “${folderName}” folder, so nothing was deleted yet. Allow access to finish the delete.`,
      action: (
        <ToastAction
          altText="Allow access"
          onClick={() => {
            void (async () => {
              // this click is a fresh user gesture — the permission sheet
              // can appear, then the delete completes
              const state = await ensureWriteAccess(deck.id);
              if (state !== "granted") {
                toast({
                  title: "Delete not finished",
                  description:
                    state === "denied"
                      ? "Access is still blocked. Allow Chassé under the browser's site settings → File System editing for sites, then delete the deck again."
                      : "Access couldn't be restored — the deck was kept. Try deleting it again after restoring folder access.",
                  variant: "destructive",
                });
                return;
              }
              await runDelete();
            })();
          }}
        >
          Allow access
        </ToastAction>
      ),
    });
  };

  /** the actual delete — safe to re-run after a grant (idempotent guard) */
  const runDelete = async (): Promise<void> => {
    if (deletingRef.current) return;
    deletingRef.current = true;
    setDeleting(true);
    setDeleteError(null);
    try {
      const r = await api.deleteDeck(deck.id);
      setDeleteOpen(false);
      if (r.needsAccess) {
        // permission slipped away again mid-flow — nothing deleted
        deleteNeedsAccessToast(r);
        return;
      }
      onDeleted();
      toast(
        r.external
          ? { title: "Removed from library", description: `Files kept on disk at ${r.root}` }
          : {
              title: r.folderCleanupError ? "Removed from this browser" : "Deck deleted",
              description: r.folderCleanupError
                ? `${r.folderCleanupError} (${folderName})`
                : deck.device
                  ? `Removed from this browser and the “${folderName}” folder.`
                  : undefined,
            },
      );
    } catch (e) {
      // keep the dialog open with the reason — confirm button becomes Retry
      setDeleteError((e as Error).message || "The deck couldn't be deleted");
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
                font: "500 10px var(--ss-fm)",
                color: "var(--ss-mut)",
                border: "1px solid var(--ss-line)",
                borderRadius: 99,
                padding: "1px 7px",
                letterSpacing: ".06em",
              }}
            >
              <ExternalLink size={10} /> linked
            </span>
          )}
          {isBrowserDeck && (
            <span
              title={
                deck.device
                  ? "Stored in this browser, mirrored to a folder on your device"
                  : "Stored in this browser (this deployment can't write server files)"
              }
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 3,
                marginLeft: 7,
                verticalAlign: "middle",
                font: "500 10px var(--ss-fm)",
                color: "var(--ss-mut)",
                border: "1px solid var(--ss-line)",
                borderRadius: 99,
                padding: "1px 7px",
                letterSpacing: ".06em",
              }}
            >
              {deck.device ? <HardDrive size={10} /> : <Layers size={10} />}
              {deck.device ? "device" : "this browser"}
            </span>
          )}
          {deck.store === "desktop" && (
            <span
              title={deck.folderName ? `Stored in the Chassé Studio desktop folder: ${deck.folderName}` : "Stored in the Chassé Studio desktop folder"}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 3,
                marginLeft: 7,
                verticalAlign: "middle",
                font: "500 10px var(--ss-fm)",
                color: "var(--ss-mut)",
                border: "1px solid var(--ss-line)",
                borderRadius: 99,
                padding: "1px 7px",
                letterSpacing: ".06em",
              }}
            >
              <MonitorSmartphone size={10} /> desktop
            </span>
          )}
        </div>
        <div className="ss-card-meta">
          {deck.slideCount} slides · {deck.id} · modified {formatWhen(deck.modified)}
        </div>
        {accessState && (
          <DeckAccessNotice
            state={accessState}
            onAllow={() => void requestDeckAccess(deck.id)}
            onChooseFolder={() => void pickFolderAgain(deck.id)}
          />
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
              <ExternalLink size={0} style={{ display: "none" }} />
              {deck.external ? "Remove from library (keeps files)" : "Delete"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* the delete confirmation — nothing is removed until Confirm */}
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={(o) => {
          if (!o) {
            setDeleteOpen(false);
            setDeleteError(null);
          }
        }}
        title={deck.external ? "Remove deck from library?" : "Delete deck?"}
        description={
          <>
            <div style={{ font: "600 13.5px var(--ss-fb, sans-serif)", color: "var(--ss-ink, #f2f0fa)" }}>
              {deck.title}
            </div>
            <div style={{ color: "var(--ss-mut, #9894b0)", font: "400 12px var(--ss-fm, monospace)" }}>
              {deck.slideCount} slides · folder: {folderName}
              {deck.store === "desktop"
                ? " · Chassé Studio desktop folder"
                : deck.store === "browser" && !deck.device
                  ? " · stored in this browser"
                  : ""}
            </div>
            <div style={{ marginTop: 4 }}>
              {deck.external ? (
                <>
                  This removes the deck from the library only. Its files stay on disk at{" "}
                  <code style={{ font: "500 11.5px var(--ss-fm, monospace)" }}>{deck.id}</code>.
                </>
              ) : (
                <>
                  This permanently deletes the deck and its files from{" "}
                  {deck.device
                    ? "this device"
                    : deck.store === "desktop"
                      ? "the Chassé Studio desktop folder"
                      : deck.store === "server"
                        ? "the app's decks folder"
                        : "this browser"}
                  . This cannot be undone.
                </>
              )}
            </div>
          </>
        }
        confirmLabel={deck.external ? "Remove from library" : "Delete deck"}
        danger
        busy={deleting}
        error={deleteError}
        requireText={requireText}
        onConfirm={doDelete}
        closeLabel="Close without deleting"
      />
    </div>
  );
}
