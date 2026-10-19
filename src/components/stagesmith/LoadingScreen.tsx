"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SplashVisual, type SplashMode } from "./SplashVisual";

/**
 * <LoadingScreen> — the single branded loading overlay for the whole studio.
 *
 * Two exports:
 *
 *   <LoadingScreen>  the overlay itself: animated brand mark + wordmark +
 *                    thin progress bar (determinate OR indeterminate) +
 *                    error state with a Retry button. Fully accessible:
 *                    role="status" / aria-live="polite" + "Loading", and the
 *                    page content behind it is inert + aria-hidden while the
 *                    overlay is on screen. It renders through a portal to
 *                    <body> so it stays OUTSIDE the inert region — its own
 *                    Retry button remains clickable.
 *
 *   <SplashVeil>     the timing wrapper that implements the anti-flash
 *                    contract everywhere a view-level load happens:
 *                      · don't show anything for fast loads (< ~200 ms)
 *                      · once shown, stay visible ≥ ~400 ms
 *                      · then fade out over ~300 ms (opacity only — no
 *                        layout shift, nothing jumps underneath)
 *
 * The visuals live in <SplashVisual/> (server-safe) so the route-level
 * loading.tsx / Suspense fallbacks and the pre-hydration splash in the root
 * layout render the EXACT same branded markup.
 */

export type { SplashMode };

export interface LoadingScreenProps {
  mode?: SplashMode;
  /** 0..1 for real progress (Present mode preloading); null → indeterminate */
  progress?: number | null;
  message?: string | null;
  error?: string | null;
  onRetry?: () => void;
  /** when true the overlay fades out (300 ms) instead of unmounting cold */
  leaving?: boolean;
}

export function LoadingScreen({
  mode = "app",
  progress = null,
  message = null,
  error = null,
  onRetry,
  leaving = false,
}: LoadingScreenProps) {
  // keep the busy page out of the a11y tree / focus order while the overlay
  // is up (released again once the fade-out begins)
  useInertLock(!leaving);
  if (typeof document === "undefined") return null;
  return createPortal(
    <SplashVisual mode={mode} progress={progress} message={message} error={error} onRetry={onRetry} leaving={leaving} />,
    document.body,
  );
}

/* ------------------------------------------------------------------ */
/* inert lock — keep the busy page out of the a11y tree while loading   */
/* ------------------------------------------------------------------ */

/**
 * While any loading overlay is visible, the rest of the app (everything the
 * root layout renders into #ss-app-root) is inert + aria-hidden, so screen
 * readers and keyboard focus can't reach half-loaded controls. A module-level
 * refcount lets the inline splash controller and several veils overlap safely.
 */
let inertCount = 0;

function applyInert(count: number) {
  const root = typeof document !== "undefined" ? document.getElementById("ss-app-root") : null;
  if (!root) return;
  if (count > 0) {
    root.setAttribute("inert", "");
    root.setAttribute("aria-hidden", "true");
  } else {
    root.removeAttribute("inert");
    root.removeAttribute("aria-hidden");
  }
}

function useInertLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    inertCount += 1;
    applyInert(inertCount);
    return () => {
      inertCount = Math.max(0, inertCount - 1);
      applyInert(inertCount);
    };
  }, [active]);
}

/* ------------------------------------------------------------------ */
/* SplashVeil — the show/hide timing contract                          */
/* ------------------------------------------------------------------ */

export const SPLASH_TIMING = {
  /** only show if loading takes longer than this */
  showDelayMs: 200,
  /** once shown, keep visible at least this long */
  minVisibleMs: 400,
  /** fade-out duration */
  fadeMs: 300,
} as const;

export type SplashTimingKey = keyof typeof SPLASH_TIMING;

export interface SplashVeilProps {
  /** true while the underlying load is in progress */
  active: boolean;
  mode?: SplashMode;
  progress?: number | null;
  message?: string | null;
  error?: string | null;
  onRetry?: () => void;
  /** different timing (e.g. present mode: show immediately, real progress) */
  timing?: Partial<Record<SplashTimingKey, number>>;
}

/**
 * Renders nothing until `active` has lasted `showDelayMs` (fast loads never
 * flash), then renders the overlay; when `active` goes false it holds to
 * `minVisibleMs`, fades over `fadeMs`, and unmounts. Errors bypass the
 * show-delay (a failed load should be loud, not invisible).
 */
export function SplashVeil({ active, mode = "app", progress = null, message = null, error = null, onRetry, timing }: SplashVeilProps) {
  const t = { ...SPLASH_TIMING, ...timing };
  const [shown, setShown] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const shownAtRef = useRef(0);
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([]);

  const clearTimers = useCallback(() => {
    for (const ti of timers.current) clearTimeout(ti);
    timers.current = [];
  }, []);

  useEffect(() => {
    clearTimers();
    if (active) {
      if (error) {
        // errors show right away — an invisible endless spinner is worse
        if (!shown) {
          setShown(true);
          setLeaving(false);
          shownAtRef.current = Date.now();
        }
        return;
      }
      if (!shown) {
        const show = setTimeout(() => {
          setShown(true);
          setLeaving(false);
          shownAtRef.current = Date.now();
        }, Math.max(0, t.showDelayMs));
        timers.current.push(show);
      }
    } else if (shown) {
      // hold to minVisibleMs, then fade out, then unmount
      const elapsed = Date.now() - shownAtRef.current;
      const hold = Math.max(0, t.minVisibleMs - elapsed);
      const leave = setTimeout(() => setLeaving(true), hold);
      const unmount = setTimeout(() => setShown(false), hold + t.fadeMs + 40);
      timers.current.push(leave, unmount);
    }
    return clearTimers;
  }, [active, error, shown, t.showDelayMs, t.minVisibleMs, t.fadeMs, clearTimers]);

  if (!shown) return null;
  return (
    <LoadingScreen
      mode={mode}
      progress={error ? null : progress}
      message={message}
      error={error}
      onRetry={onRetry}
      leaving={leaving}
    />
  );
}
