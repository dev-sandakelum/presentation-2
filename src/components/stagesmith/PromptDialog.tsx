"use client";

import * as React from "react";
import { Loader2, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

/**
 * <PromptDialog> — the app's replacement for window.prompt().
 *
 * Chrome's native prompt() never renders inside the desktop app's embedded
 * window (JCEF has no JS dialog handler by default — it silently returns
 * null), which used to make "new code file…" and "new folder name" dead
 * ends there. This dialog works everywhere and adds the app's behaviours:
 *
 *   · Enter submits (and the input starts focused); Esc and the X cancel
 *   · busy: buttons disabled, spinner in the confirm button
 *   · error: the dialog STAYS OPEN, shows the reason, confirm becomes Retry
 *   · onResolve receives the typed value (or null when cancelled)
 *
 * Non-blocking by design: the caller stores the dialog's state and acts in
 * onResolve — never with a return value the way window.prompt worked.
 */
export interface PromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** e.g. "New code file" */
  title: string;
  /** the explanation above the input */
  description?: React.ReactNode;
  /** the input's label (also the aria-label) */
  label: string;
  /** called with the value on Enter/OK, or null on cancel/close */
  onResolve: (value: string | null) => void;
  /** pre-filled value (selected for quick replace) */
  initial?: string;
  /** placeholder when empty */
  placeholder?: string;
  /** e.g. "Create" — becomes "Retry" while an error is shown */
  confirmLabel?: string;
  cancelLabel?: string;
  /** an action is running — buttons disabled, spinner shown */
  busy?: boolean;
  /** failure reason — keeps the dialog open and turns confirm into Retry */
  error?: string | null;
  /** block empty submissions (trim) */
  required?: boolean;
}

export function PromptDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  onResolve,
  initial = "",
  placeholder,
  confirmLabel = "OK",
  cancelLabel = "Cancel",
  busy = false,
  error = null,
  required = true,
}: PromptDialogProps) {
  const [value, setValue] = React.useState(initial);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  // reset the value whenever the dialog (re)opens
  React.useEffect(() => {
    if (open) {
      setValue(initial);
      // focus + select after mount so typing replaces the suggestion
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [open, initial]);

  const trimmed = value.trim();
  const submitDisabled = busy || (required && !trimmed);

  const close = (resolved: string | null) => {
    if (busy) return;
    onOpenChange(false);
    onResolve(resolved);
  };

  const submit = () => {
    if (submitDisabled) return;
    close(trimmed);
  };

  const confirmText = error ? "Retry" : busy ? "Working…" : confirmLabel;

  return (
    <Dialog open={open} onOpenChange={(o) => close(o ? trimmed : null)}>
      <DialogContent
        aria-modal="true"
        onOpenAutoFocus={(e) => e.preventDefault()}
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
          <DialogTitle
            style={{ color: "var(--ss-ink, #f2f0fa)", font: "italic 600 18px var(--ss-fbrand, Georgia, serif)", flex: 1 }}
          >
            {title}
          </DialogTitle>
          <button
            type="button"
            aria-label="Close"
            disabled={busy}
            onClick={() => close(null)}
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

        <div
          style={{
            font: "400 13px/1.65 var(--ss-fb, -apple-system, 'Segoe UI', sans-serif)",
            color: "var(--ss-ink2, #c9c6dd)",
            display: "grid",
            gap: 10,
          }}
        >
          {description}
          <div style={{ display: "grid", gap: 6 }}>
            <label
              style={{ font: "500 11px var(--ss-fm, ui-monospace, monospace)", color: "var(--ss-mut, #9894b0)" }}
            >
              {label}
            </label>
            <input
              ref={inputRef}
              className="ss-input"
              value={value}
              disabled={busy}
              autoComplete="off"
              spellCheck={false}
              placeholder={placeholder}
              aria-label={label}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submit();
                }
              }}
              style={{ width: "100%" }}
            />
          </div>
          {error && (
            <div
              role="alert"
              style={{
                font: "400 12px/1.5 var(--ss-fb, -apple-system, 'Segoe UI', sans-serif)",
                color: "#ff9a8f",
                background: "rgba(196, 43, 28, .12)",
                border: "1px solid rgba(196, 43, 28, .3)",
                borderRadius: 10,
                padding: "8px 12px",
                whiteSpace: "pre-wrap",
              }}
            >
              {error}
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button
            type="button"
            className="ss-btn"
            disabled={busy}
            onClick={() => close(null)}
            style={{ cursor: busy ? "wait" : "pointer" }}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className="ss-btn ss-btn-primary"
            disabled={submitDisabled}
            onClick={submit}
            style={{ cursor: submitDisabled ? (busy ? "wait" : "not-allowed") : "pointer" }}
          >
            {busy && <Loader2 size={13} style={{ animation: "ss-spin 1s linear infinite" }} />}
            {confirmText}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
