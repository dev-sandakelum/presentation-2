"use client";

/**
 * UI for lapsed device-folder permissions (File System Access API).
 *
 * AccessBanner — the ONE banner at the top of the dashboard: shown only
 * when at least one deck folder's write permission came back as "prompt"
 * after a restart. One "Allow access" click restores everything it can
 * (a remembered shared parent folder covers all decks inside it in one
 * go); a grant removes the banner WITHOUT a reload.
 *
 * DeckAccessNotice — the per-card state: "Needs access" (+ its own Allow
 * button), a quiet "Access blocked" explanation for previously denied
 * access (no repeated prompting), or "Folder not found" with "Choose
 * folder again". A granted deck shows nothing extra.
 *
 * Everything respects the app theme (the --ss-* variables flip with the
 * dark/light theme) and is keyboard accessible: native buttons inside the
 * .ss-library/.ss-app/.ss-display scopes get the global :focus-visible
 * ring, and the banner is a polite live region so state changes are
 * announced.
 */

import { FolderOpen, Lock, Unlock } from "lucide-react";
import type { CSSProperties } from "react";
import { offersPersistentGrant, type DeckAccessState } from "@/lib/stagesmith/permission";

/* ------------------------------------------------------------------ */
/* the dashboard banner                                                */
/* ------------------------------------------------------------------ */

export function AccessBanner({
  count,
  restored = 0,
  onAllow,
  busy = false,
  compact = false,
  /** the "folder not found" variant (present/editor floating banner) */
  missing = false,
  actionLabel,
}: {
  /** decks that need access right now */
  count: number;
  /** decks already restored this visit (multi-deck, no shared parent — one
   *  requestPermission per click, so the banner stays until all are back) */
  restored?: number;
  onAllow: () => void;
  busy?: boolean;
  /** present-mode/editor variant: slimmer, no hint paragraph */
  compact?: boolean;
  missing?: boolean;
  actionLabel?: string;
}) {
  if (count <= 0 && !missing) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      data-access-banner=""
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        flexWrap: "wrap",
        border: `1px solid color-mix(in srgb, var(--ss-acc) 42%, transparent)`,
        background: "var(--ss-acc-soft)",
        borderRadius: 12,
        padding: compact ? "8px 14px" : "12px 16px",
        marginBottom: compact ? 0 : 16,
      }}
    >
      <span
        aria-hidden
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 30,
          height: 30,
          borderRadius: 9,
          flex: "none",
          border: "1px solid color-mix(in srgb, var(--ss-acc) 42%, transparent)",
          color: "var(--ss-acc)",
          background: "color-mix(in srgb, var(--ss-acc) 12%, transparent)",
        }}
      >
        {missing ? <FolderOpen size={15} /> : <Unlock size={15} />}
      </span>
      <div style={{ flex: "1 1 260px", minWidth: 0 }}>
        <div style={{ font: "600 13.5px var(--ss-fb)", color: "var(--ss-ink)" }}>
          {missing
            ? "Deck folder not found"
            : "Chassé needs access to your deck folders again"}
        </div>
        <div style={{ font: "400 12px/1.55 var(--ss-fb)", color: "var(--ss-ink2)", marginTop: 2 }}>
          {missing
            ? "The folder was moved, renamed, or its handle was cleared from browser storage. Pick it again to re-attach the deck — presenting keeps working from this browser either way."
            : `${
                count === 1
                  ? "The folder's write permission didn't survive the restart."
                  : `${count} deck folders lost their write permission since the last visit.`
              } Changes still save in this browser — saving and deleting to the folders work again once access is restored.${
                restored > 0 ? ` Access restored for ${restored} — click Allow again for the rest.` : ""
              }`}
        </div>
        {!compact && !missing && offersPersistentGrant() && (
          <div style={{ font: "400 11.5px/1.5 var(--ss-fb)", color: "var(--ss-mut)", marginTop: 4 }}>
            Choose “Allow on every visit” on the browser's prompt to stop seeing this.
          </div>
        )}
      </div>
      <button
        type="button"
        className="ss-btn ss-btn-acc"
        disabled={busy}
        onClick={onAllow}
        style={{ height: 32, flex: "none" }}
      >
        {missing ? <FolderOpen size={14} /> : <Unlock size={14} />} {actionLabel ?? "Allow access"}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* per-deck card state                                                 */
/* ------------------------------------------------------------------ */

const pillStyle = (tone: "warn" | "err" | "mut"): CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  flex: "none",
  font: "500 10px var(--ss-fm)",
  letterSpacing: ".06em",
  textTransform: "uppercase",
  borderRadius: 99,
  padding: "2px 8px",
  ...(tone === "warn"
    ? { color: "var(--ss-acc)", border: "1px solid color-mix(in srgb, var(--ss-acc) 45%, transparent)" }
    : tone === "err"
      ? { color: "var(--ss-errink)", border: "1px solid var(--ss-errline)", background: "var(--ss-errbg)" }
      : { color: "var(--ss-mut)", border: "1px solid var(--ss-line)" }),
});

export function DeckAccessNotice({
  state,
  onAllow,
  onChooseFolder,
}: {
  state: DeckAccessState;
  /** user-gesture context: card "Allow access" click */
  onAllow: () => void;
  /** user-gesture context: card "Choose folder again" click */
  onChooseFolder: () => void;
}) {
  if (state === "granted") return null;

  if (state === "prompt") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
        <span style={pillStyle("warn")}>
          <Unlock size={10} /> Needs access
        </span>
        <span style={{ font: "400 11.5px/1.5 var(--ss-fb)", color: "var(--ss-mut)", flex: "1 1 160px" }}>
          The folder permission lapsed — folder saving and deleting pause until it's allowed again.
        </span>
        <button type="button" className="ss-btn" style={{ height: 26, padding: "0 10px", flex: "none" }} onClick={onAllow}>
          <Unlock size={12} /> Allow access
        </button>
      </div>
    );
  }

  if (state === "denied") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
        <span style={pillStyle("err")}>
          <Lock size={10} /> Access blocked
        </span>
        <span style={{ font: "400 11.5px/1.5 var(--ss-fb)", color: "var(--ss-mut)", flex: "1 1 200px" }}>
          You blocked folder access for this site. To allow it again, open the browser's site settings for Chassé →
          “File System editing for sites” (chrome://settings/content/filesystem) and remove the block, then reload.
        </span>
      </div>
    );
  }

  // "missing" — folder moved / handle evicted from browser storage
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
      <span style={pillStyle("mut")}>
        <FolderOpen size={10} /> Folder not found
      </span>
      <span style={{ font: "400 11.5px/1.5 var(--ss-fb)", color: "var(--ss-mut)", flex: "1 1 160px" }}>
        The folder was moved or its handle was cleared from browser storage.
      </span>
      <button
        type="button"
        className="ss-btn"
        style={{ height: 26, padding: "0 10px", flex: "none" }}
        onClick={onChooseFolder}
      >
        <FolderOpen size={12} /> Choose folder again
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* slim editor/present chrome notice                                   */
/* ------------------------------------------------------------------ */

/** one-line variant for the editor toolbar / present chrome */
export function AccessChip({
  state,
  onAllow,
  onChooseFolder,
}: {
  state: DeckAccessState;
  onAllow: () => void;
  onChooseFolder: () => void;
}) {
  if (state === "granted") return null;
  if (state === "prompt") {
    return (
      <button
        type="button"
        className="ss-chip warn"
        role="button"
        title="The deck folder's write permission lapsed — click to allow it again. Changes still save in this browser."
        onClick={onAllow}
        style={{ cursor: "pointer" }}
      >
        <span className="dot" />
        Needs access — Allow
      </button>
    );
  }
  if (state === "denied") {
    return (
      <span
        className="ss-chip err"
        title="Access was blocked for this site. Allow Chassé again in the browser's site settings (chrome://settings/content/filesystem), then reload."
      >
        <span className="dot" />
        Access blocked
      </span>
    );
  }
  return (
    <button
      type="button"
      className="ss-chip warn"
      role="button"
      title="The deck folder couldn't be found — click to choose it again."
      onClick={onChooseFolder}
      style={{ cursor: "pointer" }}
    >
      <span className="dot" />
      Folder not found — Choose again
    </button>
  );
}
