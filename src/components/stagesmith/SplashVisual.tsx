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
 *
 * Present-mode contract (loading-screen spec): slow loads are NOT errors.
 * The layout below the wordmark therefore has a strict hierarchy —
 *   message → progress bar → calm hint → soft warning (Retry / Continue
 *   anyway) → always-available Back — and only a genuinely FAILED load
 *   switches to the red error block. Time alone can never turn this red.
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
  /** calm information line ("Large deck — this can take a moment") */
  hint?: string | null;
  /** soft warning text — rendered with the progress bar still visible */
  warning?: string | null;
  /** retry handler for the soft warning area */
  onWarningRetry?: () => void;
  /** "Continue anyway" — proceed past failed items */
  onContinue?: () => void;
  continueLabel?: string;
  /** always-available escape from the load (Back/Cancel) */
  onCancel?: () => void;
  cancelLabel?: string;
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
  hint = null,
  warning = null,
  onWarningRetry,
  onContinue,
  continueLabel = "Continue anyway",
  onCancel,
  cancelLabel = "Back",
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
            <div className="ss-splash-actions">
              {typeof onRetry === "function" && (
                <button type="button" className="ss-splash-retry" onClick={onRetry}>
                  Retry
                </button>
              )}
              {typeof onContinue === "function" && (
                <button type="button" className="ss-splash-secondary" onClick={onContinue}>
                  {continueLabel}
                </button>
              )}
            </div>
            {typeof onCancel === "function" && (
              <button type="button" className="ss-splash-cancel" onClick={onCancel}>
                ← {cancelLabel}
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

            {hint && <div className="ss-splash-hint">{hint}</div>}

            {warning && (
              <div className="ss-splash-warn" role="status">
                <div className="ss-splash-warn-text">{warning}</div>
                <div className="ss-splash-actions">
                  {typeof onWarningRetry === "function" && (
                    <button type="button" className="ss-splash-retry" onClick={onWarningRetry}>
                      Retry
                    </button>
                  )}
                  {typeof onContinue === "function" && (
                    <button type="button" className="ss-splash-secondary" onClick={onContinue}>
                      {continueLabel}
                    </button>
                  )}
                </div>
              </div>
            )}

            {typeof onCancel === "function" && (
              <button type="button" className="ss-splash-cancel" onClick={onCancel}>
                ← {cancelLabel}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
