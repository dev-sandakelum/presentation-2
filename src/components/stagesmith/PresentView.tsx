"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Grid2X2, Maximize2, Moon, QrCode, Sun, X, Loader2 } from "lucide-react";
import { api, getAssetMap, resolveModule, assetRouteUrl } from "@/lib/stagesmith/client";
import type { DeckBundle } from "@/lib/stagesmith/client";
import type { DeckJson, Source, ThemeMode } from "@/lib/stagesmith/types";
import { StageFrame, type TransitionTiming } from "./StageFrame";
import { QrPanel } from "./QrPanel";
import { LiveThumb } from "./LiveThumb";
import { useDeckUpdated, useSync } from "@/hooks/useSync";
import { useAssetPreloader } from "@/hooks/useAssetPreloader";
import { useAccessStates } from "@/hooks/useDeviceAccess";
import { useToast } from "@/hooks/use-toast";
import { requestDeckAccess, pickFolderAgain } from "@/lib/stagesmith/permission";
import { AccessBanner } from "./AccessBanner";
import { BrandLogo } from "./BrandLogo";
import { SplashVeil } from "./LoadingScreen";
import { download, type SsNav } from "./shared";

/**
 * The presenter display (plan §7).
 *
 * ONE live StageFrame renders the full composed stage — background, slide
 * content and overlays — exactly like the editor's "Final" preview (Problem 07:
 * present must match the editor pixel-for-pixel). Inside the sandboxed
 * runtime the stage is three stable layers, and slide changes run the
 * transition controller (exit → background crossfade → enter) with the
 * ordering rules from the present-mode spec:
 *
 *   - different background: content out → background crossfades (the old
 *     one kept below until the new one is fully visible) → content in;
 *     new content is never shown over the old background
 *   - same background (compared by value): the background layer is not
 *     touched at all — only the content swaps
 *   - the overlay layer never animates, never remounts and keeps its own
 *     state (progress bar, clocks, looping animations keep running)
 *
 * Every input path — keyboard, click zones, swipe, dot nav, overview grid
 * and the phone remote's "go to slide N" — funnels into the same index →
 * config → controller route; there is no second code path. Neighbouring
 * slides' modules and background images are preloaded (fetched + decoded)
 * so transitions never wait on the network.
 *
 * Navigation is room-synced when a sync transport is reachable (the desktop
 * app bridge or the local-run socket service) and falls back to fully local
 * navigation when it isn't (hosted deployments) — the presenter always
 * works, with or without a phone remote.
 */

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** reactive prefers-reduced-motion (client-only; SSR renders false) */
function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return reduced;
}

export function PresentView({
  deckId,
  fromParam,
  nav,
  initialBundle,
}: {
  deckId: string;
  fromParam: string | null;
  nav: SsNav;
  initialBundle: DeckBundle | null;
}) {
  const [bundle, setBundle] = useState<DeckBundle | null>(initialBundle ?? null);
  const [version, setVersion] = useState(initialBundle?.signature ?? "boot");
  const [sessionMode, setSessionMode] = useState<ThemeMode | null>(null);
  const [ui, setUi] = useState({ qr: false, overview: false });
  const [chromeHidden, setChromeHidden] = useState(false);
  const [freeze, setFreeze] = useState(false);
  // client-only clock — a server-rendered time would always differ from
  // hydration time (hydration mismatch)
  const [now, setNow] = useState<Date | null>(null);

  const deck: DeckJson | null = bundle?.deck ?? null;
  const slides = useMemo(() => deck?.slides ?? [], [deck]);

  /* ---------- present-mode boot gate (the branded loading screen) ----------
     No TIME LIMIT anywhere: the gate opens when the FIRST FEW slides are
     genuinely ready —
       · useAssetPreloader — priority preload: the start window's slide
         modules, backgrounds and fonts first, the rest in the background
       · stageReady — the sandboxed runtime mounted the first slide and
         posted its `rendered` message (or surfaced an error card)
     Elapsed time alone NEVER errors; a real per-item failure is retried a
     few times, then shown with Retry / “Continue anyway”; a total lack of
     progress (60 s) becomes a soft “seems stuck” notice — never red.
     The hidden StageFrame underneath IS the offscreen mount: it boots in
     parallel behind the veil, so the reveal is instant. */
  const [bootRetry, setBootRetry] = useState(0);
  const [bootError, setBootError] = useState<string | null>(null);
  const [stageReady, setStageReady] = useState(false);
  const { toast } = useToast();

  // fullscreen can be refused (some embedded webviews, OSR mode, browser
  // policy) — the silent .catch in toggleFull leaves the user wondering why
  // F did nothing; this turns the browser's own fullscreenerror event into
  // honest feedback instead
  useEffect(() => {
    const onFsError = () =>
      toast({
        title: "Fullscreen is not available here",
        description: "The window does not allow fullscreen — the stage stays at its current size.",
      });
    document.addEventListener("fullscreenerror", onFsError);
    return () => document.removeEventListener("fullscreenerror", onFsError);
  }, [toast]);

  /* present-mode permission notice — the deck itself always presents from
   * the browser copy (never fails halfway); a lapsed folder permission or a
   * gone folder shows the same compact Allow/Choose-folder step as the
   * dashboard, so access gets restored before the user returns to editing */
  const access = useAccessStates();
  const presentAccessState = bundle?.device ? access[deckId] : undefined;
  const start = fromParam ? Math.max(0, Number(fromParam) || 0) : 0;
  const preload = useAssetPreloader(deck, deckId, version, { startIndex: start });
  // the deck starts once the critical window settled AND any failed item was
  // either retried away or explicitly acknowledged (Continue anyway)
  const revealReady = preload.ready && stageReady && (!preload.failures.length || preload.failuresAcknowledged);
  const bootMessage = deck ? preload.message : `Opening ${deckId}`;
  /** red errors are reserved for genuinely failed loads (deck unreachable) */
  const presentError = bootError;

  /* a calm, informative hint after ~10 s — NOT an error, just honesty about
   * big decks (21–26 slides with large backgrounds take a moment) */
  const loadStartRef = useRef<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (revealReady || presentError) {
      loadStartRef.current = null;
      setElapsed(0);
      return;
    }
    if (loadStartRef.current === null) loadStartRef.current = Date.now();
    const t = setInterval(() => {
      if (loadStartRef.current !== null) setElapsed(Date.now() - loadStartRef.current);
    }, 1000);
    return () => clearInterval(t);
  }, [revealReady, presentError]);
  const slowHint = !revealReady && !presentError && elapsed > 10_000;

  /* soft (non-red) notices under the progress bar:
     · a specific item failed after retries → which one, Retry, Continue anyway
     · nothing has settled for 60 s → “seems stuck”, Retry, Back */
  const warningText = preload.stalled
    ? "Loading seems stuck — nothing has progressed for a while."
    : preload.failures.length
      ? `Couldn't load ${preload.failures[0].label} — ${preload.failures[0].error}${preload.failures.length > 1 ? ` (and ${preload.failures.length - 1} more)` : ""}`
      : null;

  // sync — the display is the presenter: it owns the token
  const sync = useSync(deckId, "display", null, slides);
  const state = sync.state;

  // local navigation state — drives the deck whenever the room state is not
  // available (offline / hosted): the presenter never gets stuck (Problem 07)
  const [localIndex, setLocalIndex] = useState(start);
  const roomIndex =
    sync.connected && state ? Math.max(0, Math.min(state.index ?? 0, Math.max(0, slides.length - 1))) : null;
  const index = roomIndex ?? Math.max(0, Math.min(localIndex, Math.max(0, slides.length - 1)));
  const step = state?.step ?? 0;
  const current = slides[index] ?? null;

  // SSR delivered the bundle — only fetch when missing or stale; a failed
  // fetch surfaces as the loading screen's error state with a Retry
  useEffect(() => {
    if (initialBundle?.deck && initialBundle.deck.id === deckId) return;
    let cancelled = false;
    api
      .getDeck(deckId)
      .then((b) => {
        if (cancelled) return;
        setBundle(b);
        setVersion(b.signature);
        setBootError(null);
      })
      .catch((e) => {
        if (!cancelled) setBootError(`Couldn't open the deck — ${(e as Error).message}`);
      });
    return () => {
      cancelled = true;
    };
  }, [deckId, initialBundle, bootRetry]);

  // Retry: re-open the deck, re-run the full preload, re-arm the stage gate
  const retryBoot = useCallback(() => {
    setBootError(null);
    setStageReady(false);
    setBootRetry((n) => n + 1);
    preload.retry();
  }, [preload]);

  // the soft-warning Retry: failed items → retry just those; a stall →
  // re-arm the WHOLE boot (preloader + stage) so a silent stage recovers too
  const warningRetry = useCallback(() => {
    if (preload.failures.length) preload.retryFailed();
    else retryBoot();
  }, [preload, retryBoot]);

  // the first `rendered` message from the sandboxed runtime — the slide is
  // genuinely on screen (an error card also counts: it's the honest result)
  const onSteps = useCallback(
    (steps: number) => {
      setStageReady(true);
      if (current) sync.reportSteps(current.id, steps);
    },
    [sync, current],
  );
  const onRuntimeError = useCallback(() => {
    // compile/render error card on the stage — reveal it instead of gating
    setStageReady(true);
  }, []);

  // jump into position when the room state is missing (fresh room)
  const didInitRef = useRef(false);
  useEffect(() => {
    if (!sync.connected || !state || didInitRef.current) return;
    didInitRef.current = true;
    if (fromParam !== null && slides[start]?.id) {
      setLocalIndex(start);
      sync.sendSlide(slides[start].id, 0);
    }
  }, [sync.connected, state, slides, fromParam]);

  /* ---------- presenter notes → room (desktop bridge only) ----------
     Phones fetch notes through the Java app's room state, so the presenter
     pushes the notes of the current slide once per slide (cached, capped). */
  const notesCache = useRef<Map<string, string>>(new Map());
  const lastSentNote = useRef<{ slideId: string; text: string } | null>(null);
  useEffect(() => {
    if (sync.transport !== "desktop") return;
    const slideId = current?.id;
    if (!slideId) return;
    let cancelled = false;
    (async () => {
      let text = notesCache.current.get(slideId);
      if (text === undefined) {
        try {
          text = await api.readFile(deckId, `notes/${slideId}.md`);
        } catch {
          text = "";
        }
        notesCache.current.set(slideId, text);
      }
      if (cancelled) return;
      const note = text.slice(0, 8000);
      const last = lastSentNote.current;
      if (last && last.slideId === slideId && last.text === note) return;
      lastSentNote.current = { slideId, text: note };
      sync.setNotes(slideId, note);
    })();
    return () => {
      cancelled = true;
    };
  }, [current?.id, sync.transport, sync.setNotes, deckId]);

  // clock
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // live edit (plan: hot-swap the changed slide, stay in place)
  useDeckUpdated(sync.socket, useCallback(() => {
    if (freeze) return;
    api.getDeck(deckId).then((b) => {
      setBundle(b);
      setVersion(b.signature);
      sync.syncDeck(b.deck.slides.map((s) => ({ id: s.id, label: s.label })));
    }).catch(() => {});
  }, [deckId, freeze, sync]));

  const navNext = useCallback(() => {
    setLocalIndex((i) => Math.min(i + 1, Math.max(0, slides.length - 1)));
    sync.sendNav("next");
  }, [sync, slides.length]);
  const navPrev = useCallback(() => {
    setLocalIndex((i) => Math.max(0, i - 1));
    sync.sendNav("prev");
  }, [sync]);

  const goSlide = useCallback((slideId: string) => {
    const to = slides.findIndex((s) => s.id === slideId);
    if (to >= 0) setLocalIndex(to);
    sync.sendSlide(slideId, 0);
    setUi((u) => ({ ...u, overview: false }));
  }, [sync, slides]);

  const toggleMode = useCallback(() => {
    setSessionMode((m) => (m === "dark" ? "light" : m === "light" ? null : "dark"));
  }, []);

  // theme mode: session override ?? slide override ?? deck default
  const effectiveMode: ThemeMode = sessionMode ?? current?.theme ?? deck?.settings.defaultMode ?? "dark";

  /* ---------- keyboard ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key;
      if (k === "ArrowRight" || k === "PageDown" || (k === " " && !isOnButton(e.target))) {
        e.preventDefault();
        navNext();
      } else if (k === "ArrowLeft" || k === "PageUp") {
        e.preventDefault();
        navPrev();
      } else if (k === "Home") {
        if (slides[0]) goSlide(slides[0].id);
      } else if (k === "End") {
        if (slides[slides.length - 1]) goSlide(slides[slides.length - 1].id);
      } else if (k === "f" || k === "F") {
        toggleFull();
      } else if (k === "g" || k === "G" || k === "o" || k === "O") {
        setUi((u) => ({ ...u, overview: !u.overview, qr: false }));
      } else if (k === "q" || k === "Q") {
        setUi((u) => ({ ...u, qr: !u.qr, overview: false }));
      } else if (k === "t" || k === "T") {
        toggleMode();
      } else if (k === "Escape") {
        if (ui.qr || ui.overview) setUi({ qr: false, overview: false });
        else nav.deck(deckId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navNext, navPrev, goSlide, toggleMode, slides, ui, nav, deckId]);

  /* ---------- swipe (plan §7) ---------- */
  const touchRef = useRef({ x: 0, y: 0 });
  useEffect(() => {
    const onStart = (e: TouchEvent) => {
      touchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    };
    const onEnd = (e: TouchEvent) => {
      const dx = e.changedTouches[0].clientX - touchRef.current.x;
      const dy = e.changedTouches[0].clientY - touchRef.current.y;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        if (dx < 0) navNext();
        else navPrev();
      }
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchend", onEnd);
    };
  }, [navNext, navPrev]);

  /* ---------- auto-hide chrome after 3s (plan §7) ---------- */
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bump = useCallback(() => {
    setChromeHidden(false);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setChromeHidden(true), 3000);
  }, []);
  useEffect(() => {
    bump();
    const events: Array<keyof WindowEventMap> = ["mousemove", "mousedown", "keydown", "touchstart", "wheel"];
    for (const ev of events) window.addEventListener(ev, bump, { passive: true });
    return () => {
      for (const ev of events) window.removeEventListener(ev, bump);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [bump]);

  /* ---------- transition timing (one config, deck settings tune it) ----------
     exitMs / enterMs scale off settings.transitionMs, the background
     crossfade off settings.bgCrossfadeMs — clamped to sane bounds so a
     deck authored with the old 1600 ms ambient crossfade still feels
     responsive now that the phase gates the content. */
  const reducedMotion = usePrefersReducedMotion();
  const transition = useMemo<TransitionTiming>(
    () => {
      const t = deck?.settings.transitionMs ?? 240;
      return {
        exitMs: clamp(t, 120, 1200),
        enterMs: clamp(Math.round(t * 1.4), 140, 1400),
        bgMs: clamp(deck?.settings.bgCrossfadeMs ?? 450, 200, 1600),
        reduced: reducedMotion || undefined,
      };
    },
    [deck?.settings.transitionMs, deck?.settings.bgCrossfadeMs, reducedMotion],
  );

  /* ---------- preload the neighbours ----------
     Warm the module HTTP cache (server decks) / the compile cache (browser
     decks) and decode background images for the slides around the current
     one, plus the current slide's own image background — so the transition
     never waits on a cold network or an undecoded image. */
  useEffect(() => {
    if (!deck || slides.length === 0) return;
    let cancelled = false;
    (async () => {
      const assetMap = await getAssetMap(deckId, version).catch(() => null);
      if (cancelled) return;
      const jobs: Promise<unknown>[] = [];
      const wanted = new Set([index - 1, index, index + 1].filter((i) => i >= 0 && i < slides.length));
      const warm = (source: Source | undefined) => {
        if (!source || source.type === "none") return;
        if (source.type === "code") {
          jobs.push(
            resolveModule(deckId, source.path, version)
              .then((m) => (m.url ? fetch(m.url, { cache: "force-cache" }) : null))
              .catch(() => {}),
          );
        } else if (source.type === "image") {
          const url = assetMap?.[source.path] ?? assetRouteUrl(deckId, source.path);
          if (!/^(data|blob):/i.test(url)) {
            jobs.push(
              new Promise<void>((res) => {
                const img = new Image();
                const done = () => res();
                img.onload = () => (img.decode ? img.decode().then(done, done) : done());
                img.onerror = done;
                img.src = url;
              }),
            );
          }
        }
      };
      for (const i of wanted) {
        const s = slides[i];
        jobs.push(
          resolveModule(deckId, `slides/${s.id}.tsx`, version)
            .then((m) => (m.url ? fetch(m.url, { cache: "force-cache" }) : null))
            .catch(() => {}),
        );
        warm(s.bg !== undefined ? s.bg : deck.bg);
        warm(s.overlay !== undefined ? s.overlay : deck.overlay);
      }
      try {
        if (document.fonts?.ready) jobs.push(document.fonts.ready.catch(() => {}));
      } catch {
        /* fonts api unavailable */
      }
      await Promise.all(jobs);
    })();
    return () => {
      cancelled = true;
    };
  }, [deck, deckId, index, slides, version]);

  /* ---------- report steps ---------- */

  const themeCss = bundle?.themeCss ?? "";
  const total = slides.length;
  const progress = total ? ((index + 1) / total) * 100 : 0;

  // sync chip (bottom bar): the desktop transport has its own states —
  // running (green), starting (amber pulse) and stopped (neutral "local",
  // hinting at the QR panel where the server can be started)
  const syncChip = (() => {
    if (sync.transport === "desktop") {
      if (sync.connected) {
        return {
          dot: "var(--ss-ok)",
          label: sync.remotes ? `${sync.remotes} remote${sync.remotes > 1 ? "s" : ""}` : "sync",
          title: "Synced with the desktop app's phone remote server",
        };
      }
      if (sync.serverStatus?.status === "starting") {
        return { dot: "var(--ss-warn)", label: "starting…", title: "Starting the phone remote server…" };
      }
      return {
        dot: "var(--ss-mut)",
        label: "local",
        title: "Phone remote server stopped — open the QR panel (Q) to start it",
      };
    }
    return {
      dot: sync.connected ? "var(--ss-ok)" : sync.unavailable ? "var(--ss-mut)" : "var(--ss-err)",
      label: sync.connected
        ? sync.remotes
          ? `${sync.remotes} remote${sync.remotes > 1 ? "s" : ""}`
          : "sync"
        : sync.unavailable
          ? "local"
          : "offline",
      title: sync.unavailable
        ? "Presenting from this browser — the phone remote needs the desktop app (or a local run)"
        : sync.connected
          ? "Synced with the phone remote service"
          : "Reconnecting to the sync service…",
    };
  })();

  return (
    <div className={`ss-display ${chromeHidden ? "hide-chrome" : ""}`} onMouseMove={bump}>
      {/* the present-mode loading gate — real progress from the asset
          preloader, shown immediately (no 200 ms delay: a full preload is
          always worth announcing). NO time-based error: the red state is
          reserved for genuinely failed deck loads; slow loads keep the
          progress bar, a calm hint, a soft warning area for failed items
          (Retry / Continue anyway) and an always-available Back button.
          Portaled over everything; the stage beneath stays inert until the
          first slides are ready. */}
      <SplashVeil
        active={!revealReady}
        mode="present"
        timing={{ showDelayMs: 0 }}
        progress={presentError ? null : deck ? preload.progress : null}
        message={presentError ? null : bootMessage}
        error={presentError}
        onRetry={retryBoot}
        hint={slowHint ? "Large deck — this can take a moment" : null}
        warning={!presentError ? warningText : null}
        onWarningRetry={warningRetry}
        onContinue={preload.failures.length ? preload.acknowledgeFailures : undefined}
        continueLabel="Continue anyway"
        onCancel={() => nav.deck(deckId)}
        cancelLabel="Back"
      />

      {/* background loading continues after the reveal — a small, honest,
          non-blocking indicator; jumping ahead to a slide that isn't ready
          just keeps the previous frame until its module resolves */}
      {revealReady && !preload.allDone && (
        <div className="ss-bgload" role="status" aria-live="polite">
          <Loader2 size={12} style={{ animation: "ss-rot 1s linear infinite" }} />
          Loading more slides…
        </div>
      )}

      {/* lapsed device-folder permission — compact, floating under the top
          chrome; presenting itself is unaffected (browser copy) */}
      {(presentAccessState === "prompt" || presentAccessState === "missing") && (
        <div
          style={{
            position: "absolute",
            top: 58,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 45,
            width: "min(560px, calc(100vw - 32px))",
            pointerEvents: "auto",
          }}
        >
          <AccessBanner
            compact
            count={presentAccessState === "prompt" ? 1 : 0}
            missing={presentAccessState === "missing"}
            actionLabel={presentAccessState === "missing" ? "Choose folder again" : undefined}
            onAllow={() =>
              void (presentAccessState === "missing" ? pickFolderAgain(deckId) : requestDeckAccess(deckId))
            }
          />
        </div>
      )}

      {/* stage */}
      <div className="ss-display-stage">
        <div style={{ position: "relative", width: "min(100vw, calc(100vh * 16 / 9))", aspectRatio: "16/9" }}>
          {/* the live stage — background + content + overlays in ONE sandboxed
              runtime, the exact pipeline the editor preview uses (Problem 07).
              The runtime's three layers are stable for the whole deck: slide
              changes run the exit → bg → enter controller, the background
              crossfades only when its key changed, and the overlay layer is
              never touched by transitions. */}
          <div style={{ position: "absolute", inset: 0, zIndex: 2, isolation: "isolate" }}>
            {/* `key={bootRetry}` — a Retry remounts the sandboxed runtime so
                it genuinely re-resolves its modules and re-renders (and
                re-posts `rendered`, re-arming the reveal gate). Without it
                the already-rendered stage would never signal again and the
                loading screen would never lift. */}
            <StageFrame
              key={bootRetry}
              deckId={deckId}
              slide={current}
              deckBg={deck?.bg}
              deckOverlay={deck?.overlay}
              commonOverlay={deck?.overlay}
              themeCss={themeCss}
              mode={effectiveMode}
              version={version}
              step={step}
              slideIndex={index}
              slideTotal={total}
              transition={transition}
              onSteps={onSteps}
              onRuntimeError={onRuntimeError}
            />
          </div>
        </div>
      </div>

      {/* click zones (12%) */}
      <div className="ss-clickzone left" onClick={navPrev} title="Previous" />
      <div className="ss-clickzone right" onClick={navNext} title="Next" />

      {/* chrome — top */}
      <div className="ss-chrome top">
        <div className="ss-chrome-panel">
          <div className="ss-brand" onClick={() => nav.deck(deckId)} title="Back to editor" style={{ gap: 8 }}>
            <span style={{ width: 17, height: 17, display: "inline-flex" }}>
              <BrandLogo size={17} showImage />
            </span>
            <span className="ss-chrome-title">{deck?.title ?? deckId}</span>
          </div>
        </div>
        <div className="ss-chrome-panel">
          <button className="ss-ghost-btn" onClick={toggleMode} title="Toggle theme (T) — session only">
            {effectiveMode === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <button className="ss-ghost-btn" onClick={() => setUi((u) => ({ ...u, overview: !u.overview, qr: false }))} title="Overview (O)">
            <Grid2X2 size={16} />
          </button>
          <button className="ss-ghost-btn" onClick={toggleFull} title="Fullscreen (F)">
            <Maximize2 size={16} />
          </button>
          <button
            className="ss-ghost-btn"
            onClick={() => setFreeze((f) => !f)}
            title={freeze ? "Frozen — file changes are NOT applied (click to unfreeze)" : "Live edit on (click to freeze)"}
            style={freeze ? { borderColor: "var(--ss-acc)", color: "var(--ss-acc)" } : undefined}
          >
            <span style={{ font: "600 10px var(--ss-fm)", letterSpacing: ".12em" }}>{freeze ? "FROZEN" : "LIVE"}</span>
          </button>
        </div>
      </div>

      {/* chrome — bottom */}
      <div className="ss-chrome bottom">
        <div className="ss-chrome-panel">
          <span className="ss-label" style={{ maxWidth: "34vw", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {current?.label ?? "—"}
          </span>
        </div>
        <div className="ss-chrome-panel">
          <span className="ss-chip" style={{ height: 22 }} title={syncChip.title}>
            <span className="dot" style={{ background: syncChip.dot }} />
            {syncChip.label}
          </span>
          <span className="ss-label" style={{ letterSpacing: ".1em", fontVariantNumeric: "tabular-nums" }}>
            {now
              ? now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
              : "--:--:--"}
          </span>
        </div>
        <div className="ss-chrome-panel">
          <button className="ss-ghost-btn" onClick={navPrev} title="Previous (←)">
            <ChevronLeft size={16} />
          </button>
          <span style={{ font: "500 12px var(--ss-fm)", letterSpacing: ".14em", fontVariantNumeric: "tabular-nums", color: "var(--ss-ink2)" }}>
            {String(index + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
            {(state?.steps ?? 1) > 1 ? ` · ${step + 1}/${state?.steps}` : ""}
          </span>
          <button className="ss-ghost-btn" onClick={navNext} title="Next (→)">
            <ChevronRight size={16} />
          </button>
          <button className="ss-ghost-btn" onClick={() => setUi((u) => ({ ...u, qr: !u.qr, overview: false }))} title="QR panel (Q)">
            <QrCode size={15} />
          </button>
        </div>
      </div>

      {/* right dot nav */}
      <nav className="ss-dotnav" aria-label="Slides">
        {slides.map((s, i) => (
          <button
            key={s.id}
            className={`ss-dot ${i === index ? "cur" : ""} ${s.bg && s.bg.type !== "none" ? "has-override" : ""}`}
            onClick={() => goSlide(s.id)}
            title={s.label}
          >
            <span className="ss-dot-label">{s.label}</span>
          </button>
        ))}
      </nav>

      {/* progress bar */}
      <div className="ss-progress">
        <div className="ss-progress-bar" style={{ width: `${progress}%` }} />
      </div>

      {/* overview grid */}
      {ui.overview && (
        <div className="ss-ov ss-scroll" role="dialog" aria-label="Slide overview">
          <div className="ss-ov-head">
            <span className="ss-ov-title">{deck?.title ?? "Overview"}</span>
            <span className="ss-ov-hint">Click a slide to jump · Esc to close</span>
            <button className="ss-ghost-btn" onClick={() => setUi((u) => ({ ...u, overview: false }))} title="Close (Esc)">
              <X size={16} />
            </button>
          </div>
          <div className="ss-ov-grid">
            {slides.map((s, i) => (
              <OvItem
                key={s.id}
                deckId={deckId}
                entry={s}
                index={i}
                current={i === index}
                version={version}
                deckBg={deck?.bg}
                deckOverlay={deck?.overlay}
                defaultMode={effectiveMode}
                themeCss={themeCss}
                onJump={() => goSlide(s.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* QR panel */}
      {ui.qr && (
        <QrPanel
          deckId={deckId}
          token={sync.token}
          remotes={sync.remotes}
          connected={sync.connected}
          unavailable={sync.unavailable}
          onClose={() => setUi((u) => ({ ...u, qr: false }))}
          absolute
        />
      )}
    </div>
  );
}

function isOnButton(target: EventTarget | null): boolean {
  return Boolean(target instanceof Element && target.closest("button, a, input, textarea, [contenteditable]"));
}

function toggleFull() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen().catch(() => {});
}

function OvItem(props: {
  deckId: string;
  entry: DeckJson["slides"][number];
  index: number;
  current: boolean;
  version: string;
  deckBg?: Source;
  deckOverlay?: Source;
  defaultMode: ThemeMode;
  themeCss: string;
  onJump: () => void;
}) {
  const { deckId, entry, index, defaultMode } = props;
  const { ref, inView } = useInViewLite<HTMLButtonElement>();
  return (
    <button ref={ref} className={`ss-ov-item ${props.current ? "cur" : ""}`} onClick={props.onJump}>
      <span className="ss-ov-n">{String(index + 1).padStart(2, "0")}</span>
      <span>
        <div className="ss-ov-t">{entry.label}</div>
        <div className="ss-ov-k">{entry.bg ? "bg override" : entry.theme ? `theme ${entry.theme}` : "\u00A0"}</div>
      </span>
      <span className="ss-ov-thumb">
        {inView ? (
          <LiveThumb
            deckId={deckId}
            slideId={entry.id}
            slideTheme={entry.theme}
            deckDefaultMode={defaultMode}
            deckBg={props.deckBg}
            deckOverlay={props.deckOverlay}
            themeCss={props.themeCss}
            version={props.version}
          />
        ) : (
          <span className="ss-shimmer" aria-hidden />
        )}
      </span>
    </button>
  );
}

/** local lazy-mount observer (kept independent from the library one) */
function useInViewLite<T extends HTMLElement>(rootMargin = "200px") {
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
