import { BRAND_MARK_HTML } from "./brandMark";

/**
 * The branded Chassé loading visual — server-safe (no hooks, no effects),
 * shared by every loading surface in the app:
 *
 *   - the pre-hydration inline splash in app/layout.tsx (plain HTML twin)
 *   - app/loading.tsx (route-level fallback) and the page's Suspense <Boot/>
 *   - the client <LoadingScreen/> overlay (which adds retry + live progress)
 *
 * Styling comes from the `ss-splash-*` classes defined ONCE in the inline
 * <style> tag that app/layout.tsx puts at the top of <body> — that way the
 * exact same CSS covers the pre-hydration splash AND every later instance,
 * with zero external requests (offline / JCEF cold start safe).
 *
 * All motion animates ONLY transform & opacity (see the inline CSS) so the
 * animation stays smooth even while the page is busy hydrating, and
 * prefers-reduced-motion collapses it to a static mark + simple fade.
 */

export type SplashMode = "app" | "deck" | "present";

export interface SplashVisualProps {
  mode?: SplashMode;
  /** 0..1 — determinate progress; null/undefined → indeterminate sweep */
  progress?: number | null;
  /** status line under the wordmark ("Preparing slide 3 of 17") */
  message?: string | null;
  /** error text — swaps the visual into its error state */
  error?: string | null;
  /** wired up by the client wrapper; renders the Retry button */
  onRetry?: () => void;
  /** true → fade-out state (opacity 0, ~300 ms transition) */
  leaving?: boolean;
}

const DEFAULT_MESSAGE: Record<SplashMode, string> = {
  app: "Loading studio",
  deck: "Opening deck",
  present: "Preparing presentation",
};

export function SplashVisual({
  mode = "app",
  progress = null,
  message = null,
  error = null,
  onRetry,
  leaving = false,
}: SplashVisualProps) {
  const pct = typeof progress === "number" && Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : null;
  const pctLabel = pct !== null ? `${Math.round(pct * 100)}%` : null;
  const statusText = error
    ? `Loading failed — ${error}`
    : `${message ?? DEFAULT_MESSAGE[mode]}${pctLabel ? ` · ${pctLabel}` : ""}`;

  return (
    <div className={`ss-splash${leaving ? " ss-splash--leaving" : ""}`} role="status" aria-live="polite">
      {/* screen-reader text: the required bare "Loading" announcement */}
      <span className="ss-sr-only">Loading</span>

      <div className="ss-splash-inner">
        <div className="ss-splash-orb">
          <span className="ss-splash-glow" aria-hidden="true" />
          <span
            className="ss-splash-mark"
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: BRAND_MARK_HTML }}
          />
        </div>

        <div className="ss-splash-wordmark">Chassé</div>

        {error ? (
          <div className="ss-splash-error" role="alert">
            <div className="ss-splash-error-title">Couldn&apos;t finish loading</div>
            <div className="ss-splash-error-text">{error}</div>
            {typeof onRetry === "function" && (
              <button type="button" className="ss-splash-retry" onClick={onRetry}>
                Retry
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="ss-splash-msg">{statusText}</div>
            <div
              className="ss-splash-bar"
              role={pct !== null ? "progressbar" : "presentation"}
              aria-hidden={pct === null ? "true" : undefined}
              aria-valuemin={pct !== null ? 0 : undefined}
              aria-valuemax={pct !== null ? 100 : undefined}
              aria-valuenow={pct !== null ? Math.round(pct * 100) : undefined}
              aria-label={pct !== null ? "Loading progress" : undefined}
            >
              {pct !== null ? (
                <div className="ss-splash-bar-fill" style={{ transform: `scaleX(${pct})` }} />
              ) : (
                <div className="ss-splash-bar-ind" />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
