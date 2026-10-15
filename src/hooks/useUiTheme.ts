"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * App-chrome theme (fix-list item 8): dark ⇄ light for the editor UI itself.
 * The deck's own dark/light mode stays where it was (T key in Present,
 * per-slide theme) — this switch only restyles the Stagesmith chrome.
 *
 * The value is persisted in localStorage and applied as
 * `data-ss-theme` on <html> so portal menus (rendered in body, outside
 * .ss-app) also pick up the CSS variables.
 */

export type UiTheme = "dark" | "light";

const KEY = "ss-ui-theme";
let current: UiTheme = "dark";
let hydrated = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function apply(theme: UiTheme) {
  current = theme;
  try {
    document.documentElement.dataset.ssTheme = theme;
  } catch {
    /* SSR / test */
  }
}

/** read saved preference once, on first mount (no SSR flash after paint) */
export function hydrateUiTheme() {
  if (hydrated) return;
  hydrated = true;
  try {
    const saved = window.localStorage.getItem(KEY);
    const next: UiTheme = saved === "light" ? "light" : saved === "dark" ? "dark" : current;
    if (saved === null) window.localStorage.setItem(KEY, next);
    apply(next);
    emit();
  } catch {
    /* private mode etc. — keep dark */
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useUiTheme(): [UiTheme, (t?: UiTheme) => void] {
  const theme = useSyncExternalStore(subscribe, () => current, () => "dark" as UiTheme);
  const set = useCallback((t?: UiTheme) => {
    const next: UiTheme = t ?? (current === "dark" ? "light" : "dark");
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      /* ignore */
    }
    apply(next);
    emit();
  }, []);
  return [theme, set];
}
