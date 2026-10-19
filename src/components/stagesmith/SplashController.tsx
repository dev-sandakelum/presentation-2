"use client";

import { useEffect } from "react";
import { hydrateUiTheme } from "@/hooks/useUiTheme";

/**
 * SplashController — owns the PRE-HYDRATION splash that app/layout.tsx
 * inlines into the HTML (before any JavaScript runs, so a cold start —
 * including the Java desktop app's JCEF first load — never shows a blank
 * or half-built page).
 *
 * On mount (i.e. once the initial tree has hydrated):
 *   · hydrates the saved UI theme everywhere (library / present / remote
 *     previously only got it inside the editor),
 *   · releases the app root from its pre-reveal `visibility:hidden`,
 *   · dismisses the splash per the anti-flash contract:
 *        - load done in < ~200 ms → remove immediately (fast loads show
 *          no splash at all — the branded frame never registers)
 *        - otherwise hold to ≥ ~400 ms total, then fade out over ~300 ms
 *
 * The splash node itself is kept in the DOM (display:none + aria-hidden)
 * instead of being torn out from under React's hydration.
 */

const FAST_LOAD_MS = 200;
const MIN_VISIBLE_MS = 400;
const FADE_MS = 300;
const FAST_FADE_MS = 120;

export function SplashController() {
  useEffect(() => {
    // theme-correct for the whole app from here on (the inline <head>
    // script already painted the right background before this ran)
    hydrateUiTheme();

    const splash = document.getElementById("ss-splash");
    const root = document.getElementById("ss-app-root");
    if (!splash) {
      root?.removeAttribute("data-ss-boot");
      return;
    }

    let hideTimer = 0;
    const dismiss = (fadeMs: number) => {
      // reveal the app first — the splash then fades OVER the already
      // painted content: a crossfade with zero layout shift
      root?.removeAttribute("data-ss-boot");
      splash.style.transitionDuration = `${fadeMs}ms`;
      splash.classList.add("ss-splash--leaving");
      hideTimer = window.setTimeout(() => {
        splash.style.display = "none";
        splash.setAttribute("aria-hidden", "true");
      }, fadeMs + 80);
    };

    // time since navigation start ≈ how long the splash has been up
    const elapsed = typeof performance !== "undefined" ? performance.now() : MIN_VISIBLE_MS;
    if (elapsed < FAST_LOAD_MS) {
      dismiss(FAST_FADE_MS);
    } else {
      const hold = Math.max(0, MIN_VISIBLE_MS - elapsed);
      hideTimer = window.setTimeout(() => dismiss(FADE_MS), hold);
    }

    return () => {
      if (hideTimer) clearTimeout(hideTimer);
    };
  }, []);

  return null;
}
