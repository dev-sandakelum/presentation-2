"use client";

import { useCallback, useEffect, useMemo, useRef, useState, memo } from "react";
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
import { requestDeckAccess, pickFolderAgain } from "@/lib/stagesmith/permission";
import { useAccessStates } from "@/hooks/useDeviceAccess";
import { AccessChip } from "./AccessBanner";
import { Filmstrip } from "./Filmstrip";
import { PreviewPane } from "./PreviewPane";
import { CodePane, type CodeTab, type GotoError } from "./CodePane";
import { QrPanel } from "./QrPanel";
import { BrandLogo } from "./BrandLogo";
import { SplashVeil } from "./LoadingScreen";
import { useSync } from "@/hooks/useSync";
import { useUiTheme, hydrateUiTheme } from "@/hooks/useUiTheme";
import { useSaveQueue, readRecoverySnapshot } from "@/hooks/useSaveQueue";
import { setLiveCompileOverrides, resolveModule } from "@/lib/stagesmith/client";
import { isExternalSignature, mayWriteContent } from "@/lib/stagesmith/save-safety";
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

const CODE_MIN_KEY = "ss-code-minimized"; // fix-list item 1: remembered between sessions
/* code panel dock position (right side vs bottom) + side width — persisted */
const CODE_SIDE_KEY = "ss-code-side";
const CODE_SIDE_W_KEY = "ss-code-side-w";
const CODE_SIDE_DEFAULT_W = 480;
const CODE_SIDE_MIN_W = 300;
const CODE_SIDE_MAX_W = 1000;

function readCodeMinimized(): boolean {
  try {
    return window.localStorage.getItem(CODE_MIN_KEY) === "1";
  } catch {
    return false;
  }
}

function readCodeSide(): boolean {
  try {
    return window.localStorage.getItem(CODE_SIDE_KEY) === "1";
  } catch {
    return false;
  }
}

function readCodeSideW(): number {
  try {
    const n = Number(window.localStorage.getItem(CODE_SIDE_W_KEY));
    return Number.isFinite(n) && n >= CODE_SIDE_MIN_W && n <= CODE_SIDE_MAX_W ? n : CODE_SIDE_DEFAULT_W;
  } catch {
    return CODE_SIDE_DEFAULT_W;
  }
}

/** path of a source when it points at a file (code / html / image) */
function codePathOf(src: Source | undefined | null): string | undefined {
  return src && src.type !== "none" && "path" in src ? src.path : undefined;
}

export function DashboardView({ deckId, nav, initialBundle }: { deckId: string; nav: SsNav; initialBundle: DeckBundle | null }) {
  const { toast } = useToast();
  const [bundle, setBundle] = useState<DeckBundle | null>(initialBundle ?? null);
  const [deck, setDeck] = useState<DeckJson | null>(initialBundle?.deck ?? null);
  const [themeCss, setThemeCss] = useState(initialBundle?.themeCss ?? "");
  const [version, setVersion] = useState(initialBundle?.signature ?? "boot");
  const [selId, setSelId] = useState<string | null>(null);
  const [buffers, setBuffers] = useState<Record<string, string>>({});
  const [fileLoadErrors, setFileLoadErrors] = useState<Record<string, string>>({});
  const [compileRevision, setCompileRevision] = useState(0);
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [codeMinimized, setCodeMinimized] = useState(false);
  /** dock the code editor as a right side panel (user request) */
  const [codeSide, setCodeSide] = useState(false);
  const [codeSideW, setCodeSideW] = useState(CODE_SIDE_DEFAULT_W);
  const [sideDragging, setSideDragging] = useState(false);
  const [tab, setTab] = useState<CodeTab>("slide");
  const [qrOpen, setQrOpen] = useState(false);
  const [snapshots, setSnapshots] = useState<string[]>([]);
  const [gotoError, setGotoError] = useState<GotoError | null>(null);
  /** deck missing from every store (wrong browser profile / deleted) */
  const [notFound, setNotFound] = useState(false);
  /** transient load failure (network / server hiccup) — Retry-able */
  const [loadError, setLoadError] = useState<string | null>(null);
  /** editor boot gate (issues 21+22): the loading veil stays up until the
   *  deck is loaded, the selected slide's file is in the buffer AND its module
   *  resolved — with a status line that says what is loading and how far in.
   *  The editor never appears half-built ("Saved" toolbar over a blank
   *  preview with a Loading editor… pane). */
  const [bootFilesReady, setBootFilesReady] = useState(false);
  const [bootCompileDone, setBootCompileDone] = useState(false);

  // app chrome theme (fix-list item 8) — hydrate once per mount
  const [uiTheme, setUiTheme] = useUiTheme();
  useEffect(() => {
    hydrateUiTheme();
  }, []);

  /* this deck's device-folder permission (checked on open by the shell) —
   * drives the toolbar access chip; granted shows nothing at all */
  const access = useAccessStates();
  const deckAccessState = bundle?.device ? access[deckId] : undefined;

  // code pane minimize state — persisted (fix-list item 1)
  useEffect(() => {
    setCodeMinimized(readCodeMinimized());
    setCodeSide(readCodeSide());
    setCodeSideW(readCodeSideW());
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

  /* ---------- right-side code panel: dock toggle + drag resizer ---------- */
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const sideWRef = useRef(codeSideW);
  sideWRef.current = codeSideW;
  const toggleCodeSide = useCallback(() => {
    setCodeSide((s) => {
      const next = !s;
      try {
        window.localStorage.setItem(CODE_SIDE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const clampSideW = useCallback((w: number) => {
    // keep at least ~420px for the preview stage (16:9 needs width most)
    const avail = wrapRef.current ? wrapRef.current.clientWidth : 1400;
    const max = Math.min(CODE_SIDE_MAX_W, Math.max(CODE_SIDE_MIN_W, avail - 420));
    return Math.round(Math.max(CODE_SIDE_MIN_W, Math.min(max, w)));
  }, []);

  const sideDragRef = useRef<{ startX: number; startW: number } | null>(null);
  const onResizerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    sideDragRef.current = { startX: e.clientX, startW: sideWRef.current };
    setSideDragging(true);
    document.body.style.userSelect = "none";
  }, []);
  const onResizerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const d = sideDragRef.current;
      if (!d) return;
      // dragging left widens the panel (it lives on the right edge)
      setCodeSideW(clampSideW(d.startW - (e.clientX - d.startX)));
    },
    [clampSideW],
  );
  const onResizerUp = useCallback(() => {
    if (!sideDragRef.current) return;
    sideDragRef.current = null;
    setSideDragging(false);
    document.body.style.userSelect = "";
    try {
      window.localStorage.setItem(CODE_SIDE_W_KEY, String(sideWRef.current));
    } catch {
      /* ignore */
    }
  }, []);

  // undo/redo of file buffers (plan: 200-step undo)
  const undoRef = useRef<Array<{ path: string; content: string }>>([]);
  const redoRef = useRef<Array<{ path: string; content: string }>>([]);
  const undoTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // clean up any pending undo debounce timers on unmount
  useEffect(() => {
    const timers = undoTimers.current;
    return () => {
      for (const t of Object.values(timers)) clearTimeout(t);
    };
  }, []);

  const refreshSnapshots = useCallback(async () => {
    try {
      setSnapshots((await api.listSnapshots(deckId)) ?? []);
    } catch {
      setSnapshots([]);
    }
  }, [deckId]);

  const load = useCallback(async () => {
    try {
      const b = await api.getDeck(deckId);
      setNotFound(false);
      setLoadError(null);
      setBundle(b);
      setDeck(b.deck);
      setThemeCss(b.themeCss);
      setVersion(b.signature);
      setSelId((prev) => (prev && b.deck.slides.some((s) => s.id === prev) ? prev : b.deck.slides[0]?.id ?? null));
      setBuffers({});
      setDirty({});
      refreshSnapshots();
    } catch (e) {
      // genuinely absent decks keep their branded not-found panel; anything
      // else (network, 5xx…) becomes the loading screen's Retry state
      const msg = (e as Error)?.message ?? "";
      if (/\b404\b|not found/i.test(msg)) setNotFound(true);
      else setLoadError(msg || "The deck request failed.");
    }
  }, [deckId, refreshSnapshots]);

  // Retry for the opening splash's error state
  const retryLoad = useCallback(() => {
    setLoadError(null);
    load();
  }, [load]);

  // SSR already delivered the bundle — hydrate selection, then only reload
  // when the bundle is missing or the folder signature moved on
  useEffect(() => {
    if (initialBundle?.deck && initialBundle.deck.id === deckId) {
      setSelId((prev) => (prev && initialBundle.deck.slides.some((s) => s.id === prev) ? prev : initialBundle.deck.slides[0]?.id ?? null));
      refreshSnapshots();
      return;
    }
    load();
  }, [deckId]);

  const buffersRef = useRef(buffers);
  buffersRef.current = buffers;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    setLiveCompileOverrides(deckId, buffers);
    const timer = setTimeout(() => setCompileRevision((n) => n + 1), 180);
    return () => clearTimeout(timer);
  }, [deckId, buffers]);

  /* ---------- folder polling: serialize polls and never clear editor buffers ---------- */
  const versionRef = useRef(version);
  versionRef.current = version;
  const bundleRef = useRef(bundle);
  bundleRef.current = bundle;
  const pollBusyRef = useRef(false);
  const confirmedEmptyRef = useRef(new Set<string>());
  const reloadChangedFiles = useCallback(async (signature: string) => {
    const b = await api.refreshDeck(deckId);
    const previousRows = bundleRef.current?.files ?? [];
    const previous = new Map(previousRows.map((f) => [f.path, `${f.size}:${f.mtime}`]));
    const nextPaths = new Set(b.files.map((f) => f.path));
    const changedSet = new Set(b.files.filter((f) => previous.get(f.path) !== `${f.size}:${f.mtime}`).map((f) => f.path));
    const deleted = previousRows.filter((f) => !nextPaths.has(f.path)).map((f) => f.path);
    deleted.forEach((p) => changedSet.add(p));
    // Text mtime metadata can be coarse (especially on desktop); compare every
    // already-loaded editor buffer with disk so same-size external edits count.
    for (const [p, localText] of Object.entries(buffersRef.current)) {
      if (!nextPaths.has(p) || !/\.(tsx?|jsx?|css|md|json)$/i.test(p)) continue;
      try { if (await api.readFile(deckId, p) !== localText) changedSet.add(p); }
      catch (e) { console.warn(`[folder-poll] couldn't compare ${p}`, e); }
    }
    const changed = [...changedSet];
    const textChanged = changed.filter((p) => /\.(tsx?|jsx?|css|md|json)$/i.test(p));
    const conflicts = textChanged.filter((p) => dirtyRef.current[p]);
    const reloadConflicts = conflicts.length === 0 || window.confirm(
      `Files changed outside Chassé: ${conflicts.join(", ")}\n\nOK: Reload those files (discard local edits).\nCancel: Keep your edits; they will remain unsaved.`,
    );
    const replacements: Record<string, string> = {};
    for (const p of textChanged) {
      if (conflicts.includes(p) && !reloadConflicts) continue;
      if (!nextPaths.has(p)) continue;
      try { replacements[p] = await api.readFile(deckId, p); }
      catch (e) { console.error(`[folder-poll] couldn't read changed file ${p}`, e); throw e; }
    }
    setBundle(b);
    setDeck(b.deck);
    setThemeCss(b.themeCss);
    versionRef.current = signature;
    setVersion(signature);
    setBuffers((current) => {
      const next = { ...current, ...replacements };
      if (reloadConflicts) for (const p of deleted) delete next[p];
      return next;
    });
    if (reloadConflicts) setDirty((current) => {
      const next = { ...current };
      for (const p of conflicts) delete next[p];
      return next;
    });
    toast({ title: "Deck folder changes applied", description: `${changed.length} file(s) refreshed` });
  }, [deckId, toast]);
  useEffect(() => {
    let disposed = false;
    const timer = setInterval(async () => {
      if (pollBusyRef.current || !deck) return;
      pollBusyRef.current = true;
      try {
        const sig = await api.poll(deckId);
        if (disposed || !isExternalSignature(sig, versionRef.current)) return;
        await new Promise((resolve) => setTimeout(resolve, 400));
        const stableSig = await api.poll(deckId);
        if (disposed || stableSig !== sig || !isExternalSignature(stableSig, versionRef.current)) return;
        await reloadChangedFiles(stableSig);
      } catch (e) {
        console.warn("[folder-poll] refresh failed", e);
      } finally {
        pollBusyRef.current = false;
      }
    }, 1500);
    return () => { disposed = true; clearInterval(timer); };
  }, [deckId, deck, reloadChangedFiles]);

  /** merge an in-app file write (create/upload/delete) into the bundle's
   *  file rows — optimistic, additive/removal only, so a later refresh from
   *  disk (which already contains the change) never overwrites it with an
   *  older view. This is what makes "New file" appear in the dropdown
   *  instantly: the folder poll cannot do it, because applyDeck adopts the
   *  post-write signature and our own writes never look "external". */
  const applyFilesDelta = useCallback((delta: { added?: string[]; removed?: string[] }) => {
    setBundle((b) => {
      if (!b) return b;
      const map = new Map(b.files.map((f) => [f.path, f]));
      for (const p of delta.added ?? []) {
        if (!map.has(p)) map.set(p, { path: p, mtime: Date.now(), size: 0 });
      }
      for (const p of delta.removed ?? []) map.delete(p);
      return { ...b, files: [...map.values()].sort((x, y) => (x.path < y.path ? -1 : 1)) };
    });
  }, []);

  /* ---------- autosave (ONE serialized queue — see useSaveQueue) ---------- */
  const save = useSaveQueue(deckId, {
    collect: () =>
      Object.keys(dirtyRef.current)
        .filter((p) => dirtyRef.current[p] && buffersRef.current[p] !== undefined)
        .map((p) => ({ path: p, content: buffersRef.current[p], allowEmptyOverwrite: confirmedEmptyRef.current.has(p) })),
    onSaved: (saved, signature) => {
      versionRef.current = signature;
      setVersion(signature);
      setDirty((d) => {
        const nd = { ...d };
        for (const e of saved) {
          confirmedEmptyRef.current.delete(e.path);
          // clear the flag ONLY when the buffer still matches what was
          // written — edits made during the save keep their flag and go out
          // with the queue's coalesced next run
          if (buffersRef.current[e.path] === e.content) delete nd[e.path];
        }
        return nd;
      });
    },
  });

  const onBufferChange = useCallback(
    (path: string, content: string) => {
      const prior = buffersRef.current[path];
      if (prior === undefined) {
        console.warn(`[save] ignored edit before ${path} finished loading`);
        return;
      }
      if (!mayWriteContent(prior, content, confirmedEmptyRef.current.has(path))) {
        if (!window.confirm(`Replace the non-empty file ${path} with an empty file?`)) return;
        confirmedEmptyRef.current.add(path);
      }
      // undo capture (debounced per file)
      const prevTimer = undoTimers.current[path];
      if (prevTimer) clearTimeout(prevTimer);
      undoRef.current.push({ path, content: buffersRef.current[path] ?? "" });
      if (undoRef.current.length > 200) undoRef.current.shift();
      redoRef.current = [];
      undoTimers.current[path] = setTimeout(() => delete undoTimers.current[path], 600);
      setBuffers((b) => ({ ...b, [path]: content }));
      setDirty((d) => ({ ...d, [path]: true }));
      save.notifyChange();
    },
    [save],
  );

  const onAssetsChanged = useCallback(async () => {
    const signature = await api.poll(deckId);
    versionRef.current = signature;
    setVersion(signature);
  }, [deckId]);

  // crash recovery — restore unsaved text buffers from the last session
  // (written on tab hide / close / save failure) once the deck is loaded
  const recoveryDoneRef = useRef(false);
  useEffect(() => {
    if (!deck || recoveryDoneRef.current) return;
    recoveryDoneRef.current = true;
    const recovered = readRecoverySnapshot(deckId);
    if (!recovered) return;
    // only paths that still exist in THIS deck — a file/slide deleted in the
    // meantime must not be resurrected by the recovery copy
    const live = new Set((bundle?.files ?? []).map((f) => f.path));
    const paths = Object.keys(recovered).filter((p) => live.has(p) && recovered[p] !== undefined);
    if (!paths.length) return;
    setBuffers((b) => {
      const nb = { ...b };
      for (const p of paths) nb[p] = recovered[p];
      return nb;
    });
    setDirty((d) => {
      const nd = { ...d };
      for (const p of paths) nd[p] = true;
      return nd;
    });
    setTab((cur) => (paths.some((p) => p.startsWith("slides/")) ? "slide" : cur));
    toast({
      title: "Recovered unsaved edits",
      description: "Changes from the last session were restored and are saving now.",
    });
    save.notifyChange();
  }, [deck, deckId, bundle, save, toast]);

  // surface save failures loudly (chip + toast); the queue already retried 1s/3s/10s
  const failedToastRef = useRef(false);
  useEffect(() => {
    if (save.phase === "failed" && !failedToastRef.current) {
      toast({ title: "Save failed", description: save.error ?? "Your edits are kept — click the status chip to retry.", variant: "destructive" });
    }
    failedToastRef.current = save.phase === "failed";
  }, [save.phase, save.error, toast]);

  const undo = useCallback(() => {
    const step = undoRef.current.pop();
    if (!step) return;
    redoRef.current.push({ path: step.path, content: buffersRef.current[step.path] ?? "" });
    setBuffers((b) => ({ ...b, [step.path]: step.content }));
    setDirty((d) => ({ ...d, [step.path]: true }));
    setTab((cur) => (step.path.startsWith("slides/") ? "slide" : step.path === "theme.css" ? "theme" : cur));
    save.notifyChange();
  }, [save]);

  const redo = useCallback(() => {
    const step = redoRef.current.pop();
    if (!step) return;
    undoRef.current.push({ path: step.path, content: buffersRef.current[step.path] ?? "" });
    setBuffers((b) => ({ ...b, [step.path]: step.content }));
    setDirty((d) => ({ ...d, [step.path]: true }));
    save.notifyChange();
  }, [save]);

  /* ---------- keyboard ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
          e.preventDefault();
          save.saveNow(); // skip the debounce — save immediately
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
  }, [save, undo, redo, nav, deckId, toggleCodeMin]);

  /* ---------- sync (presence + token for QR) ---------- */
  const sync = useSync(deckId, "editor", null, deck?.slides);
  const slides = deck?.slides ?? [];

  /* ---------- deck ops ---------- */
  const applyDeck = useCallback((d: DeckJson) => {
    setDeck(d);
    setBundle((b) => (b ? { ...b, deck: d } : b));
    // mutations above change deck.json on disk — adopt the new folder
    // signature so the 1.5 s poll doesn't misread OUR OWN change as an
    // external one ("Deck folder changes applied" false positive)
    void api.poll(deckId).then((sig) => {
      if (sig) {
        versionRef.current = sig;
        setVersion(sig);
      }
    }).catch(() => {});
  }, [deckId]);

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
        const existingIds = new Set(slides.map((s) => s.id));
        const d = await api.duplicateSlide(deckId, slideId);
        applyDeck(d);
        // the copy may add bg/overlay code files — show them in the dropdown
        // immediately (applyDeck's signature adoption suppresses the poll)
        const added = d.slides
          .filter((s) => !existingIds.has(s.id))
          .flatMap((s) => [codePathOf(s.bg), codePathOf(s.overlay)])
          .filter((p): p is string => Boolean(p && (p.startsWith("bg/") || p.startsWith("overlay/"))));
        if (added.length) applyFilesDelta({ added });
        setSelId(d.slides.find((s) => !existingIds.has(s.id))?.id ?? slideId);
      } catch (e) {
        toast({ title: "Duplicate failed", description: (e as Error).message, variant: "destructive" });
      }
    },
    [deckId, applyDeck, applyFilesDelta, toast, slides],
  );

  const remove = useCallback(
    async (slideId: string) => {
      try {
        const entry = slides.find((s) => s.id === slideId) ?? null;
        const d = await api.deleteSlide(deckId, slideId);
        applyDeck(d);
        // the store removes slide + notes files and override code files that
        // no remaining slide uses — drop exactly those from the file rows
        const stillUsed = new Set(
          d.slides.flatMap((s) => [codePathOf(s.bg), codePathOf(s.overlay)].filter((p): p is string => p !== undefined)),
        );
        const removed = [
          `slides/${slideId}.tsx`,
          `notes/${slideId}.md`,
          ...[codePathOf(entry?.bg), codePathOf(entry?.overlay)].filter(
            (p): p is string => Boolean(p && (p.startsWith("bg/") || p.startsWith("overlay/")) && !stillUsed.has(p)),
          ),
        ];
        applyFilesDelta({ removed });
        if (selId === slideId) setSelId(d.slides[0]?.id ?? null);
        refreshSnapshots();
        toast({ title: "Slide deleted", description: "A snapshot was taken before deletion" });
      } catch (e) {
        toast({ title: "Delete failed", description: (e as Error).message, variant: "destructive" });
      }
    },
    [deckId, applyDeck, applyFilesDelta, selId, slides, toast, refreshSnapshots],
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

  /** deck-wide default theme mode — one click fixes light decks authored
   *  in dark mode (faint light ink on a light background — Problem 07) */
  const setDeckMode = useCallback(
    async (mode: ThemeMode) => {
      try {
        applyDeck(await api.patchDeck(deckId, { settings: { defaultMode: mode } }));
      } catch (e) {
        toast({ title: "Could not set deck theme", description: (e as Error).message, variant: "destructive" });
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

  /* ---------- editor boot gate (issues 21 + 22) ----------
   * The loading screen stays until the deck, the selected slide's file and
   * its compiled module are all in — and it SAYS what it is doing and how far
   * along it is. Everything else (thumbnails, background hydration) keeps
   * loading afterwards; the editor itself is never half-built. */
  const selSlidePath = sel ? `slides/${sel.id}.tsx` : "";
  const bootOpenedRef = useRef(false);
  useEffect(() => {
    if (!deck || !sel) return;
    if (bootOpenedRef.current && bootFilesReady && bootCompileDone) return; // gate is one-shot per deck open
    let cancelled = false;
    (async () => {
      try {
        await ensureBuffer(selSlidePath);
      } catch {
        /* file-load errors are surfaced by the editor itself */
      }
      if (cancelled) return;
      setBootFilesReady(true);
      try {
        const meta = await resolveModule(deckId, selSlidePath, `${version}:${compileRevision}`, "selected");
        if (cancelled) return;
        // settled — ok OR a real compile error (both mean the editor is built;
        // the error shows in the preview where it belongs)
        setBootCompileDone(true);
        bootOpenedRef.current = true;
        if (meta.error) console.warn(`[boot] selected slide compile: ${meta.error}`);
      } catch {
        if (!cancelled) {
          setBootCompileDone(true);
          bootOpenedRef.current = true;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckId, selSlidePath, version]);

  const bootReady = !deck || !sel ? true : bootFilesReady && bootCompileDone;
  const bootProgress = bootCompileDone ? 1 : bootFilesReady ? 2 / 3 : deck ? 1 / 3 : 0;
  const bootMessage = bootCompileDone
    ? "Ready"
    : bootFilesReady
      ? `Compiling slide ${(slides.findIndex((s) => s.id === selId) + 1) || 1} of ${slides.length}`
      : deck
        ? `Loading slide files — ${(slides.findIndex((s) => s.id === selId) + 1) || 1} of ${slides.length}`
        : `Opening ${deckId}`;

  /** single-flight file loader — never caches a failed fetch as "" */
  const inflightRef = useRef<Map<string, Promise<void>>>(new Map());
  const ensureBuffer = useCallback(
    (path: string): Promise<void> => {
      if (buffersRef.current[path] !== undefined || dirtyRef.current[path]) return Promise.resolve();
      const existing = inflightRef.current.get(path);
      if (existing) return existing;
      const p = (async () => {
        setFileLoadErrors((current) => { const next = { ...current }; delete next[path]; return next; });
        try {
          const content = await api.readFile(deckId, path);
          setBuffers((b) => (b[path] === undefined ? { ...b, [path]: content } : b));
        } catch (error) {
          setFileLoadErrors((current) => ({ ...current, [path]: (error as Error).message || "Read failed" }));
          console.error(`[file-load] failed to load ${path}`, error);
          toast({ title: "Could not load file", description: `${path}: ${(error as Error).message}`, variant: "destructive" });
        } finally {
          inflightRef.current.delete(path);
        }
      })();
      inflightRef.current.set(path, p);
      return p;
    },
    [deckId, toast],
  );

  const title = deck?.title ?? deckId;
  const anyDirty = Object.values(dirty).some(Boolean);

  if (!deck) {
    if (notFound) {
      return (
        <div className="ss-app" style={{ placeItems: "center", display: "grid", justifyItems: "center", gap: 14, padding: 30, textAlign: "center" }}>
          <div style={{ font: "italic 600 30px var(--ss-fbrand)", letterSpacing: "-.01em" }}>“{deckId}” not found</div>
          <div style={{ font: "400 13px/1.7 var(--ss-fb)", color: "var(--ss-mut)", maxWidth: 480 }}>
            This deck isn’t on the server and isn’t in this browser’s storage. Browser-stored decks live in the
            browser and profile that created them — open it there, or load a .smdeck export.
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="ss-btn" onClick={retryLoad}>
              Retry
            </button>
            <button className="ss-btn ss-btn-acc" onClick={nav.library}>
              Back to library
            </button>
          </div>
        </div>
      );
    }
    // opening a deck in the editor — branded loading screen (indeterminate
    // bar; only shows if the open actually takes a moment)
    return (
      <SplashVeil
        active
        mode="deck"
        message={`Opening ${deckId}`}
        error={loadError}
        onRetry={retryLoad}
      />
    );
  }

  return (
    <div className="ss-app">
      {/* top bar */}
      <header className="ss-topbar">
        <div className="ss-brand" onClick={nav.library} title="Back to library">
          <span className="ss-brand-mark"><BrandLogo size={22} showImage /></span>
          <span className="ss-brand-name">Chassé</span>
          <span className="ss-brand-sub">studio</span>
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
          spellCheck={false}
          style={{
            background: "transparent",
            border: "0",
            borderBottom: "1px dashed transparent",
            borderRadius: 0,
            color: "var(--ss-ink)",
            font: "600 14px var(--ss-fb)",
            padding: "5px 2px",
            width: 280,
            outline: "none",
            transition: "border-color .2s",
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderBottomColor = "var(--ss-hovline)";
          }}
          onBlurCapture={(e) => {
            e.currentTarget.style.borderBottomColor = "transparent";
          }}
        />
        {(() => {
          /* toolbar save status: Saved · Unsaved · Saving… · Failed (with
           * reason + retry) — the chip itself is the retry button */
          const failed = save.phase === "failed";
          const chipClass = failed ? "err" : anyDirty ? (save.phase === "saving" ? "warn" : "warn") : "ok";
          const chipText = failed
            ? "Save failed — click to retry"
            : anyDirty
              ? save.phase === "saving"
                ? "Saving…"
                : "Unsaved"
              : "Saved";
          const title = failed
            ? save.error ?? "The last save failed"
            : save.mirrorWarning
              ? `Saved${save.mirrorWarning ? ` — ${save.mirrorWarning}` : ""}`
              : "All changes saved";
          return (
            <span
              className={`ss-chip ${chipClass}`}
              title={title}
              role={failed ? "button" : undefined}
              tabIndex={failed ? 0 : undefined}
              onClick={failed ? save.retry : undefined}
              onKeyDown={
                failed
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        save.retry();
                      }
                    }
                  : undefined
              }
            >
              <span className="dot" />
              {chipText}
            </span>
          );
        })()}
        {deckAccessState && (
          <AccessChip
            state={deckAccessState}
            onAllow={() => void requestDeckAccess(deckId)}
            onChooseFolder={() => void pickFolderAgain(deckId)}
          />
        )}
        {save.mirrorWarning && (
          <span
            className="ss-chip warn"
            title={`${save.mirrorWarning} (click to retry the sync)`}
            role="button"
            tabIndex={0}
            onClick={save.retryMirror}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                save.retryMirror();
              }
            }}
          >
            <span className="dot" />
            device sync
          </span>
        )}
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
          <DropdownMenuContent style={{ background: "var(--ss-pop)", borderColor: "var(--ss-line)", color: "var(--ss-ink)" }}>
            <ImportSlideItems onAdd={addSlideFrom} />
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="ss-btn">
              <Import size={15} /> Export
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent style={{ background: "var(--ss-pop)", borderColor: "var(--ss-line)", color: "var(--ss-ink)" }}>
            <DropdownMenuItem
              onClick={async () => {
                try {
                  const { url, filename } = await api.exportDeck(deckId, "smdeck");
                  download(url, filename);
                } catch (e) {
                  toast({ title: "Export failed", description: (e as Error).message, variant: "destructive" });
                }
              }}
            >
              .smdeck (zip with manifest)
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={async () => {
                try {
                  const { url, filename } = await api.exportDeck(deckId, "deck.tsx");
                  download(url, filename);
                } catch (e) {
                  toast({ title: "Export failed", description: (e as Error).message, variant: "destructive" });
                }
              }}
            >
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
          <DropdownMenuContent style={{ background: "var(--ss-pop)", borderColor: "var(--ss-line)", color: "var(--ss-ink)", maxHeight: 320, overflowY: "auto" }}>
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
          <DropdownMenuContent style={{ background: "var(--ss-pop)", borderColor: "var(--ss-line)", color: "var(--ss-ink)" }}>
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
          compileVersion={`${version}:${compileRevision}`}
          selId={selId}
          onSelect={(id) => setSelId(id)}
          onReorder={reorder}
          onDuplicate={duplicate}
          onDelete={remove}
          onRename={rename}
          onSetTheme={setSlideTheme}
          onAdd={addSlideFrom}
          onJumpToError={jumpToError}
        />
        {/* side mode is suspended while minimized — the min bar keeps its
            familiar bottom-dock shape and the preview reclaims full width */}
        <div
          ref={wrapRef}
          className={`ss-preview-wrap ${codeSide && !codeMinimized ? "side" : ""}`}
          style={codeSide && !codeMinimized ? ({ "--ss-code-w": `${codeSideW}px` } as React.CSSProperties) : undefined}
        >
          <div className="ss-preview-main">
            <PreviewPane
              deckId={deckId}
              deck={deck}
              sel={sel}
              themeCss={themeCss}
              version={version}
              compileVersion={`${version}:${compileRevision}`}
              onOverride={setSlideOverride}
              onDeckMode={setDeckMode}
            />
          </div>
          {codeSide && !codeMinimized && (
            <div
              className={`ss-side-resizer ${sideDragging ? "drag" : ""}`}
              onPointerDown={onResizerDown}
              onPointerMove={onResizerMove}
              onPointerUp={onResizerUp}
              onPointerCancel={onResizerUp}
              title="Drag to resize the code panel"
            />
          )}
          <CodePane
            deckId={deckId}
            deck={deck}
            files={bundle?.files ?? []}
            onFilesChanged={applyFilesDelta}
            sel={sel}
            tab={tab}
            onTab={setTab}
            buffers={buffers}
            fileLoadErrors={fileLoadErrors}
            dirty={dirty}
            onBufferChange={onBufferChange}
            onAssetsChanged={onAssetsChanged}
            ensureBuffer={ensureBuffer}
            onFlushSave={() => save.saveNow()}
            onCommonSource={setCommonSource}
            onOverride={setSlideOverride}
            version={version}
            compileVersion={`${version}:${compileRevision}`}
            minimized={codeMinimized}
            onToggleMinimize={toggleCodeMin}
            gotoError={gotoError}
            side={codeSide}
            onToggleSide={toggleCodeSide}
          />
        </div>
      </div>

      {/* editor boot gate — the branded loading screen stays over the editor
          until the deck + selected slide file + its module are in, with a
          status line and progress. The UI beneath builds progressively but is
          only revealed fully-formed. */}
      {!bootReady && (
        <SplashVeil
          active
          mode="deck"
          timing={{ showDelayMs: 0 }}
          progress={bootProgress}
          message={bootMessage}
        />
      )}

      {qrOpen && (
        <QrPanel
          deckId={deckId}
          token={sync.token}
          remotes={sync.remotes}
          connected={sync.connected}
          unavailable={sync.unavailable}
          onClose={() => setQrOpen(false)}
        />
      )}

      {/* status bar (Chassé .status) */}
      <footer className="ss-statusbar">
        <span>
          Slide {(deck.slides.findIndex((s) => s.id === selId) + 1 || 1)} of {deck.slides.length}
        </span>
        <span style={{ flex: 1 }} />
        <span className="kbd-hints">
          <kbd>←</kbd> <kbd>→</kbd> slides
        </span>
        <span className="kbd-hints">
          <kbd>F5</kbd> present
        </span>
        <span className="kbd-hints">
          <kbd>O</kbd> overview
        </span>
        <span className="kbd-hints">
          <kbd>T</kbd> theme
        </span>
        <span className="kbd-hints">
          <kbd>Q</kbd> remote
        </span>
        <span className="kbd-hints">
          <kbd>Ctrl</kbd>+<kbd>S</kbd> save
        </span>
      </footer>
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
            .catch(() =>
              toast({
                title: "Clipboard is not available in this window",
                description: "Paste with Ctrl+V into the code editor instead.",
              }),
            );
        }}
      >
        <Import size={14} /> Paste TSX from clipboard
      </DropdownMenuItem>
      <DropdownMenuSeparator />
    </>
  );
}
