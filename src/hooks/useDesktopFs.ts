"use client";

/**
 * Desktop decks-folder state for the library UI — the Chassé Studio desktop
 * app owns the folder (fs capability). Surfaces:
 *   · available     — the desktop app + "fs" capability are present
 *   · configured    — a folder has been chosen (survives restarts on the
 *                     Java side — nothing expires)
 *   · valid         — the folder exists and is writable
 *   · path/problem  — what to show when the folder needs (re-)choosing
 * plus `choose(options)` — the native folder dialog on the Java side, fed
 * with the in-app dialog's title/startPath/hint — and `refresh()`.
 * Rendering never waits: the snapshot starts `null` and fills in
 * asynchronously, exactly like the device-access states.
 */

import { useCallback, useEffect, useState } from "react";
import {
  chooseDesktopRoot,
  desktopFsStatus,
  invalidateDesktopFsStatus,
  refreshDesktopFsStatus,
  type DesktopFsStatus,
} from "@/lib/stagesmith/desktop-store";
import type { DesktopChooseRootOptions } from "@/lib/stagesmith/desktop-fs";

export function useDesktopFs(): {
  status: DesktopFsStatus | null;
  choose: (options?: DesktopChooseRootOptions) => Promise<DesktopFsStatus | null>;
  refresh: () => void;
  choosing: boolean;
} {
  const [status, setStatus] = useState<DesktopFsStatus | null>(null);
  const [choosing, setChoosing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    desktopFsStatus().then((s) => {
      if (!cancelled) setStatus(s);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(() => {
    refreshDesktopFsStatus().then((s) => setStatus(s)).catch(() => {});
  }, []);

  const choose = useCallback(async (options?: DesktopChooseRootOptions) => {
    if (choosing) return null;
    setChoosing(true);
    try {
      // the native dialog opens on the Java side — this click is the gesture
      const s = await chooseDesktopRoot(options);
      setStatus(s);
      return s;
    } catch (e) {
      // the chooser failed (e.g. NO_OS_PERMISSION for a read-only folder) —
      // keep the banner in sync with the unchanged root, then let the
      // caller's dialog say what went wrong
      refresh();
      throw e;
    } finally {
      setChoosing(false);
    }
  }, [choosing, refresh]);

  // re-check when the window regains focus (the user may have picked the
  // folder in another window, or the disk may have changed)
  useEffect(() => {
    const onFocus = () => {
      invalidateDesktopFsStatus();
      refresh();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  return { status, choose, refresh, choosing };
}
