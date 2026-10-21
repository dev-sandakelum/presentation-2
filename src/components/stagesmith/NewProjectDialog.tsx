"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowUp,
  Check,
  Download,
  FolderOpen,
  FolderPlus,
  HardDrive,
  Home,
  MonitorSmartphone,
  RefreshCw,
} from "lucide-react";
import { api, getCapabilities, type FsBrowse } from "@/lib/stagesmith/client";
import { slugify } from "@/lib/stagesmith/browser-store";
import { desktopFsStatus } from "@/lib/stagesmith/desktop-store";
import { starterDeckFiles } from "@/lib/stagesmith/templates";
import {
  createDeviceProject,
  downloadStarterZip,
  supportsDeviceFolders,
} from "@/lib/stagesmith/device";
import type { SsNav } from "./shared";
import { PromptDialog } from "./PromptDialog";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * "New project…" (Problem 04 fix).
 *
 * The old dialog browsed the SERVER's file system — on a hosted deployment
 * that's a stranger's computer, and the browser never asked for permission
 * to touch the user's own files.
 *
 * Inside the Chassé Studio desktop app, the "desktop" mode wins: the Java
 * side owns the folder (fs capability), so the project lands in the chosen
 * decks folder with no browser permission that could expire.
 *
 * Otherwise the primary flow is the user's DEVICE via the File System Access
 * API: the browser shows its permission prompt (showDirectoryPicker), the
 * project folder structure is created in the folder they pick, and every
 * later edit is mirrored there (write-through). Browsers without the API get
 * a .zip download of the same structure. Local runs additionally keep the
 * classic server-folder browser (the server IS the user's machine there).
 */

type LocationMode = "device" | "server" | "zip" | "desktop";

export function NewProjectDialog({
  open,
  onOpenChange,
  nav,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  nav: SsNav;
}) {
  const { toast } = useToast();
  const [name, setName] = useState("stagelink");
  const [mode, setMode] = useState<LocationMode>("device");
  const [fsWritable, setFsWritable] = useState<boolean | null>(null);
  const [deviceSupported, setDeviceSupported] = useState(false);
  const [pickedFolder, setPickedFolder] = useState<string | null>(null);
  const [desktopPath, setDesktopPath] = useState<string | null>(null);

  // server browser state (only used in "server" mode)
  const [dir, setDir] = useState<string | null>(null);
  const [browse, setBrowse] = useState<FsBrowse | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // in-app replacement for the window.prompt() of "New folder here"
  // (window.prompt never renders inside the desktop webview)
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderBusy, setNewFolderBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const caps = getCapabilities().then((c) => setFsWritable(c.fsWritable));
    setDeviceSupported(supportsDeviceFolders());
    caps.catch(() => setFsWritable(false));
    desktopFsStatus().then((s) => {
      if (s.available && s.configured && s.valid) {
        setDesktopPath(s.path);
      } else {
        setDesktopPath(null);
      }
    });
    return () => {};
  }, [open]);

  // pick a sensible default mode once capabilities arrive — the desktop
  // folder wins whenever the fs capability is active
  useEffect(() => {
    if (fsWritable === null) return;
    setMode((cur) => {
      if (cur !== "device") return cur;
      if (desktopPath) return "desktop";
      if (supportsDeviceFolders()) return "device";
      return fsWritable ? "server" : "zip";
    });
  }, [fsWritable, desktopPath]);

  // server-side folder browsing (local runs only)
  useEffect(() => {
    if (!open || mode !== "server" || !fsWritable) return;
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
  }, [open, dir, mode, fsWritable]);

  const projectName = name.trim() || "stagelink";
  const files = useMemo(() => starterDeckFiles(projectName), [projectName]);

  const target = useMemo(() => {
    if (mode === "desktop") return desktopPath ? `${desktopPath}/${projectName}` : "…the desktop app's decks folder";
    if (mode === "device") return pickedFolder ? `${pickedFolder}/${projectName}` : "…pick a folder on your device";
    if (mode === "zip") return `${projectName}.smdeck (download)`;
    if (!browse) return "…/";
    return `${browse.path.replace(/\/+$/, "")}/${projectName}`;
  }, [mode, browse, projectName, pickedFolder, desktopPath]);

  /* ---------------- create: Chassé desktop folder (fs bridge) ---------------- */
  const createOnDesktop = async () => {
    setCreating(true);
    setError(null);
    try {
      const { createDeck } = await import("@/lib/stagesmith/desktop-store");
      const { deck, deckId } = await createDeck(projectName, files);
      toast({
        title: `Project “${deck.title}” created`,
        description: `Written to the Chassé Studio decks folder${desktopPath ? ` (${desktopPath})` : ""} — it stays there across restarts.`,
      });
      onOpenChange(false);
      nav.deck(deckId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  /* ---------------- create: device folder ---------------- */
  const createOnDevice = async () => {
    setCreating(true);
    setError(null);
    try {
      const { deckId, folderName } = await createDeviceProject(slugify(projectName, "project"), projectName, files);
      toast({
        title: `Project “${projectName}” created on your device`,
        description: `Written to the “${folderName}” folder you picked — and kept in this browser so it stays editable.`,
      });
      onOpenChange(false);
      nav.deck(deckId);
    } catch (e) {
      const msg = (e as Error).message;
      if (!/AbortError|No folder picked/i.test(msg)) setError(msg);
    } finally {
      setCreating(false);
    }
  };

  /* ---------------- create: server folder (local runs) ---------------- */
  const createOnServer = async () => {
    if (!browse?.path) return;
    setCreating(true);
    try {
      const result = await api.createProject(projectName, browse.path);
      toast({
        title: `Project “${result.deck.title}” created`,
        description: result.external ? `${result.root} — linked into your library` : `${result.root}`,
      });
      onOpenChange(false);
      nav.deck(result.deckId);
    } catch (e) {
      toast({
        title: "Could not create project",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  const structure = [
    "deck.json",
    "theme.css",
    "slides/  (title + end to start)",
    "bg/  (common.tsx grid)",
    "overlay/  (common.tsx marks)",
    "notes/",
    "assets/",
  ];

  const canCreate =
    mode === "desktop"
      ? true // the Java side owns the folder — no permission to grant
      : mode === "device"
        ? true // the picker itself is the gesture — createOnDevice prompts first
        : mode === "zip"
          ? true
          : Boolean(browse?.path) && !error && (browse?.writable ?? false);

  const create = () => {
    if (mode === "desktop") return createOnDesktop();
    if (mode === "device") return createOnDevice();
    if (mode === "zip") return downloadZip();
    return createOnServer();
  };

  const downloadZip = async () => {
    setCreating(true);
    try {
      await downloadStarterZip(projectName, files);
      toast({
        title: `“${projectName}.smdeck” downloaded`,
        description: "Unzip it anywhere, or load it back via File → Load .smdeck…",
      });
      onOpenChange(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        style={{ background: "var(--ss-pop)", borderColor: "var(--ss-line)", color: "var(--ss-ink)", maxWidth: 640 }}
      >
        <DialogHeader>
          <DialogTitle style={{ color: "var(--ss-ink)", font: "700 17px var(--ss-fd)" }}>New project</DialogTitle>
          <DialogDescription className="sr-only">
            Choose a name and where the new deck project should live: the desktop app’s decks folder,
            a device folder, the server’s decks folder, or a downloaded starter zip.
          </DialogDescription>
        </DialogHeader>

        <div style={{ display: "grid", gap: 14, padding: "2px 0 6px" }}>
          {/* name */}
          <div>
            <div className="ss-label" style={{ marginBottom: 6 }}>Project name</div>
            <input
              className="ss-input"
              style={{ width: "100%" }}
              autoFocus
              value={name}
              placeholder="stagelink"
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {/* location mode picker */}
          <div>
            <div className="ss-label" style={{ marginBottom: 6 }}>Location — where should the project live?</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {desktopPath && (
                <ModeChip
                  active={mode === "desktop"}
                  onClick={() => setMode("desktop")}
                  icon={<MonitorSmartphone size={13} />}
                  label="Chassé app folder"
                  title={`The Chassé Studio desktop app owns this folder (${desktopPath}) — no permission to renew, ever`}
                />
              )}
              {deviceSupported && !desktopPath && (
                <ModeChip
                  active={mode === "device"}
                  onClick={() => setMode("device")}
                  icon={<MonitorSmartphone size={13} />}
                  label="My device"
                  title="Pick a folder on your computer — the browser asks for permission and the project is written there"
                />
              )}
              {fsWritable && !desktopPath && (
                <ModeChip
                  active={mode === "server"}
                  onClick={() => setMode("server")}
                  icon={<HardDrive size={13} />}
                  label="App folder"
                  title="This app runs locally — create the project in its decks folder (or anywhere on this machine)"
                />
              )}
              <ModeChip
                active={mode === "zip"}
                onClick={() => setMode("zip")}
                icon={<Download size={13} />}
                label="Download .zip"
                title="Download the project folder as a .smdeck archive"
              />
            </div>
          </div>

          {/* desktop mode info */}
          {mode === "desktop" && (
            <div style={{ font: "400 12px/1.6 var(--ss-sans)", color: "var(--ss-mut)" }}>
              The Chassé Studio desktop app writes the project into the decks folder it owns
              {desktopPath ? (
                <>
                  {" — "}
                  <code style={{ font: "500 11px var(--ss-mono)", color: "var(--ss-ink2)" }}>{desktopPath}</code>
                </>
              ) : null}
              . The choice is remembered by the app itself: no permission prompts, nothing to renew after a restart,
              and every deck stays a plain folder you can open anywhere.
            </div>
          )}

          {/* device folder picker */}
          {mode === "device" && (
            <div>
              {deviceSupported ? (
                <>
                  <button
                    className="ss-btn ss-btn-acc"
                    style={{ width: "100%", height: 40, justifyContent: "center", gap: 8 }}
                    disabled={creating}
                    onClick={async () => {
                      // picking IS the create action — the browser permission
                      // prompt must come from this user gesture
                      await createOnDevice();
                    }}
                  >
                    <FolderOpen size={15} />
                    {creating ? "Creating…" : pickedFolder ? `Picked “${pickedFolder}” — choose again` : "Choose a folder on my device…"}
                  </button>
                  <div style={{ font: "400 12px var(--ss-sans)", color: "var(--ss-mut)", marginTop: 7 }}>
                    Your browser will ask for permission to write the folder you pick. The project is
                    created there (deck.json, theme.css, slides/, bg/, overlay/, notes/, assets/) and
                    every edit is saved back to it while this tab has access.
                  </div>
                </>
              ) : (
                <div style={{ font: "400 12px var(--ss-sans)", color: "var(--ss-mut)" }}>
                  This browser can’t pick device folders (Chromium browsers support it — Chrome, Edge, Opera, Brave).
                  Use the .zip download instead, or open this studio in a Chromium browser.
                </div>
              )}
            </div>
          )}

          {/* server folder browser (local runs) */}
          {mode === "server" && fsWritable && (
            <div>
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
                <button
                  className="ss-btn ss-btn-icon"
                  style={{ height: 28, width: 28, flex: "none" }}
                  title="New folder here"
                  disabled={busy || !browse?.writable}
                  onClick={() => setNewFolderOpen(true)}
                >
                  <FolderPlus size={13} />
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
                  placeholder="/absolute/path"
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
                <div style={{ font: "400 12px var(--ss-sans)", color: "var(--ss-err)", marginTop: 6 }}>{error}</div>
              )}
              {!error && browse && !browse.writable && (
                <div style={{ font: "400 12px var(--ss-sans)", color: "var(--ss-warn)", marginTop: 6 }}>
                  This folder is not writable — pick another location.
                </div>
              )}
            </div>
          )}

          {/* zip mode */}
          {mode === "zip" && (
            <div style={{ font: "400 12px/1.6 var(--ss-sans)", color: "var(--ss-mut)" }}>
              Downloads <b style={{ color: "var(--ss-ink)" }}>{projectName}.smdeck</b> — a zip with the full
              project structure (deck.json, theme.css, slides/, bg/, overlay/, notes/, assets/).
              Unzip it anywhere on your device, or load it straight back via <b>File → Load .smdeck…</b>
            </div>
          )}

          {/* structure preview */}
          <div>
            <div className="ss-label" style={{ marginBottom: 6 }}>Folder structure to create</div>
            <div
              style={{
                border: "1px dashed var(--ss-line-strong)",
                borderRadius: 10,
                padding: "10px 14px",
                font: "400 12px/1.75 var(--ss-mono)",
                color: "var(--ss-mut)",
                overflowX: "auto",
              }}
            >
              <span style={{ color: "var(--ss-ink)" }}>{target}</span>
              {structure.map((s, i) => (
                <div key={s} style={{ paddingLeft: 14 }}>
                  <span style={{ opacity: 0.6 }}>{i === structure.length - 1 ? "└─ " : "├─ "}</span>
                  {s}
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          {mode !== "device" && mode !== "desktop" && (
            <button className="ss-btn ss-btn-acc" disabled={creating || !canCreate} onClick={create}>
              {creating ? <Check size={15} /> : mode === "zip" ? <Download size={15} /> : <FolderPlus size={15} />}
              {creating ? "Working…" : mode === "zip" ? "Download project" : "Create project"}
            </button>
          )}
          {mode === "desktop" && (
            <button className="ss-btn ss-btn-acc" disabled={creating || !canCreate} onClick={create}>
              {creating ? <Check size={15} /> : <MonitorSmartphone size={15} />}
              {creating ? "Working…" : "Create project"}
            </button>
          )}
          {mode === "device" && (
            <span style={{ font: "400 11.5px var(--ss-sans)", color: "var(--ss-mut)" }}>
              The folder picker creates the project in one step.
            </span>
          )}
        </DialogFooter>
      </DialogContent>
      {/* nested dialogs are fine in Radix — the prompt for a new folder
          only opens from the server-location browser */}
      <PromptDialog
        open={newFolderOpen}
        onOpenChange={setNewFolderOpen}
        title="New folder"
        description={browse ? `Inside ${browse.path}` : undefined}
        label="Folder name"
        initial="presentations"
        confirmLabel="Create folder"
        busy={newFolderBusy}
        onResolve={async (label) => {
          const clean = (label || "").trim();
          if (!clean || !browse) return;
          setNewFolderBusy(true);
          try {
            const made = await api.createFolder(`${browse.path}/${clean.replace(/[/\\]/g, "-")}`);
            setDir(made.path);
            setNewFolderOpen(false);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setNewFolderBusy(false);
          }
        }}
      />
    </Dialog>
  );
}

function ModeChip({
  active,
  onClick,
  icon,
  label,
  title,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  title: string;
}) {
  return (
    <button
      className="ss-btn"
      title={title}
      onClick={onClick}
      style={{
        height: 30,
        padding: "0 12px",
        gap: 6,
        flex: "none",
        font: "500 12px var(--ss-fb)",
        border: active ? "1px solid var(--ss-acc)" : "1px solid var(--ss-line)",
        color: active ? "var(--ss-ink)" : "var(--ss-mut)",
        background: active ? "var(--ss-hov)" : "transparent",
      }}
    >
      {icon}
      {label}
    </button>
  );
}
