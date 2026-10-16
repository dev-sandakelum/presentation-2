"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowUp,
  Check,
  FolderOpen,
  FolderPlus,
  HardDrive,
  Home,
  RefreshCw,
} from "lucide-react";
import { api, type FsBrowse } from "@/lib/stagesmith/client";
import type { SsNav } from "./shared";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * "New project…" — creates the full Stagesmith folder structure at a
 * user-picked location on disk (server-side folder browser, /api/fs).
 */
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
  const [dir, setDir] = useState<string | null>(null); // null → server default (home)
  const [browse, setBrowse] = useState<FsBrowse | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
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
  }, [open, dir]);

  const projectName = name.trim() || "stagelink";
  const target = useMemo(() => {
    if (!browse) return null;
    return `${browse.path.replace(/\/+$/, "")}/${projectName}`;
  }, [browse, projectName]);

  const create = async () => {
    if (!browse?.path) return;
    setCreating(true);
    try {
      const result = await api.createProject(projectName, browse.path);
      toast({
        title: `Project “${result.deck.title}” created`,
        description: result.external
          ? `${result.root} — linked into your library`
          : `${result.root}`,
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        style={{ background: "var(--ss-pop)", borderColor: "var(--ss-line)", color: "var(--ss-ink)", maxWidth: 620 }}
      >
        <DialogHeader>
          <DialogTitle style={{ color: "var(--ss-ink)", font: "700 17px var(--ss-fd)" }}>New project</DialogTitle>
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

          {/* location browser */}
          <div>
            <div className="ss-label" style={{ marginBottom: 6 }}>Location — pick a folder</div>
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
                onClick={async () => {
                  const label = window.prompt("New folder name", "presentations");
                  const clean = (label || "").trim();
                  if (!clean || !browse) return;
                  try {
                    const made = await api.createFolder(`${browse.path}/${clean.replace(/[/\\]/g, "-")}`);
                    setDir(made.path);
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
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
                  background: "var(--ss-card)",
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

            {/* subfolder list */}
            <div
              className="ss-scroll"
              style={{
                border: "1px solid var(--ss-line)",
                borderRadius: 10,
                background: "var(--ss-card)",
                maxHeight: 168,
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

            {/* manual path */}
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
              <div style={{ font: "400 12px var(--ss-sans)", color: "#f26d6d", marginTop: 6 }}>
                {error}
              </div>
            )}
            {!error && browse && !browse.writable && (
              <div style={{ font: "400 12px var(--ss-sans)", color: "#e0a945", marginTop: 6 }}>
                This folder is not writable — pick another location.
              </div>
            )}
          </div>

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
              <span style={{ color: "var(--ss-ink)" }}>{target ?? "…/"}{"  "}</span>
              <span style={{ opacity: 0.6 }}>{"(new folder)"}</span>
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
          <button
            className="ss-btn ss-btn-acc"
            disabled={creating || busy || !browse?.path || (!!error && !browse) || (browse ? !browse.writable : true)}
            onClick={create}
          >
            {creating ? <Check size={15} /> : <FolderPlus size={15} />}
            {creating ? "Creating…" : "Create project"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
