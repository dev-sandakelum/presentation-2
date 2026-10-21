"use client";

import * as React from "react";
import { Loader2, X } from "lucide-react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
} from "@/components/ui/alert-dialog";

/**
 * <ConfirmDialog> — the ONE reusable confirmation for destructive actions
 * (deck delete, asset trash, …). Built on Radix AlertDialog, so it gets
 * role="alertdialog", aria-modal, focus trapping, Esc handling and focus
 * return for free; this wrapper adds the app's behaviours:
 *
 *   · Cancel is the FOCUSED default — Enter can never confirm by accident
 *   · Esc, the X button, Cancel and outside clicks only ever cancel
 *   · busy: both buttons disabled, spinner in the confirm button,
 *     double-clicks blocked (one in-flight action per dialog)
 *   · error: the dialog STAYS OPEN, shows the reason, and the confirm
 *     button becomes a Retry
 *   · requireText: for big/destructive targets the user must type the
 *     given text (e.g. the deck title) before Delete unlocks
 */

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** e.g. "Delete deck?" */
  title: string;
  /** the target details + the warning line */
  description: React.ReactNode;
  /** e.g. "Delete deck" — becomes "Retry" while an error is shown */
  confirmLabel?: string;
  cancelLabel?: string;
  /** red/danger styling for the confirm button */
  danger?: boolean;
  /** an action is running — buttons disabled, spinner shown */
  busy?: boolean;
  /** failure reason — keeps the dialog open and turns confirm into Retry */
  error?: string | null;
  /** when set, the confirm button unlocks only after typing this exact text */
  requireText?: string | null;
  onConfirm: () => void;
  /** aria-label for the X button (defaults to "Close") */
  closeLabel?: string;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  busy = false,
  error = null,
  requireText = null,
  onConfirm,
  closeLabel = "Close",
}: ConfirmDialogProps) {
  const cancelRef = React.useRef<HTMLButtonElement | null>(null);
  const [typed, setTyped] = React.useState("");

  // reset the type-to-confirm input whenever the dialog (re)opens
  React.useEffect(() => {
    if (open) setTyped("");
  }, [open]);

  const typeOk = !requireText || typed.trim() === requireText.trim();
  const confirmDisabled = busy || !typeOk;
  const confirmText = error ? "Retry" : busy ? "Working…" : confirmLabel;

  // focus trap + focus return are handled by Radix; make Cancel the
  // initially focused element so Enter cancels, not confirms
  const onOpenAutoFocus = (e: Event) => {
    e.preventDefault();
    cancelRef.current?.focus();
  };

  return (
    <AlertDialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <AlertDialogContent
        onOpenAutoFocus={onOpenAutoFocus}
        aria-modal="true"
        style={{
          background: "var(--ss-pop, #171522)",
          borderColor: "var(--ss-line, rgba(128,128,128,.25))",
          color: "var(--ss-ink, #f2f0fa)",
          borderRadius: 16,
          maxWidth: 480,
          gap: 14,
        }}
      >
        {/* title row with the X (cancel-only) */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <AlertDialogTitle
            style={{ color: "var(--ss-ink, #f2f0fa)", font: "italic 600 18px var(--ss-fbrand, Georgia, serif)", flex: 1 }}
          >
            {title}
          </AlertDialogTitle>
          <button
            type="button"
            aria-label={closeLabel}
            disabled={busy}
            onClick={() => onOpenChange(false)}
            style={{
              appearance: "none",
              background: "transparent",
              border: 0,
              cursor: busy ? "wait" : "pointer",
              color: "var(--ss-mut, #9894b0)",
              padding: 4,
              borderRadius: 6,
              display: "inline-flex",
            }}
          >
            <X size={16} />
          </button>
        </div>

        <AlertDialogDescription asChild>
          <div
            style={{
              font: "400 13px/1.65 var(--ss-fb, -apple-system, 'Segoe UI', sans-serif)",
              color: "var(--ss-ink2, #c9c6dd)",
              display: "grid",
              gap: 10,
            }}
          >
            {description}
            {requireText && (
              <div style={{ display: "grid", gap: 6, marginTop: 2 }}>
                <label style={{ font: "500 11px var(--ss-fm, ui-monospace, monospace)", color: "var(--ss-mut, #9894b0)" }}>
                  Type “{requireText}” to confirm
                </label>
                <input
                  className="ss-input"
                  value={typed}
                  disabled={busy}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={requireText}
                  onChange={(e) => setTyped(e.target.value)}
                  style={{ width: "100%" }}
                />
              </div>
            )}
            {error && (
              <div
                role="alert"
                style={{
                  font: "500 12.5px/1.6 var(--ss-fb, sans-serif)",
                  color: "var(--ss-errink, #ffb4c0)",
                  background: "var(--ss-errbg, rgba(120,30,50,.18))",
                  border: "1px solid var(--ss-errline, rgba(255,122,144,.28))",
                  borderRadius: 8,
                  padding: "8px 12px",
                }}
              >
                {error}
              </div>
            )}
          </div>
        </AlertDialogDescription>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 2 }}>
          <button
            ref={cancelRef}
            type="button"
            className="ss-btn"
            disabled={busy}
            onClick={() => onOpenChange(false)}
            style={{ minWidth: 92 }}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className="ss-btn"
            disabled={confirmDisabled}
            onClick={onConfirm}
            style={{
              minWidth: 116,
              justifyContent: "center",
              ...(danger
                ? {
                    color: "var(--ss-err, #ff7a90)",
                    borderColor: "var(--ss-errline, rgba(255,122,144,.4))",
                  }
                : {}),
              ...(confirmDisabled ? { opacity: 0.55, cursor: "not-allowed" } : {}),
            }}
          >
            {busy && <Loader2 size={14} className="ss-spin" style={{ animation: "ss-rot 1s linear infinite" }} />}
            {confirmText}
          </button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
