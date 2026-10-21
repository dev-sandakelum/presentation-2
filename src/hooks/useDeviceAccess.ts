"use client";

import { useEffect, useSyncExternalStore } from "react";
import { getAccessStates, refreshAccessStates, subscribeAccess, type AccessMap } from "@/lib/stagesmith/permission";

const EMPTY: AccessMap = {};

/** live permission state of every device deck ("granted" | "prompt" |
 *  "denied" | "missing" per deckId). Updates arrive without a reload —
 *  banner and badges re-render the moment a grant lands. */
export function useAccessStates(): AccessMap {
  return useSyncExternalStore(subscribeAccess, getAccessStates, () => EMPTY);
}

/**
 * The app-open / focus lifecycle for the permission check:
 *   · once per app start — every device deck is queried right after the
 *     shell mounts; the dashboard renders first, states fill in async
 *   · again whenever the window regains focus or becomes visible (the user
 *     may have flipped the site's file-system permission in a settings tab)
 *   · debounced and coalesced — focus flicker can't spam IndexedDB
 */
export function useAccessLifecycle(): void {
  useEffect(() => {
    void refreshAccessStates();
    let last = 0;
    const recheck = () => {
      const now = Date.now();
      if (now - last < 1500) return;
      last = now;
      void refreshAccessStates();
    };
    const onFocus = () => recheck();
    const onVisibility = () => {
      if (document.visibilityState === "visible") recheck();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
}
