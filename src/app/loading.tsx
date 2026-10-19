"use client";

import { useEffect, useState } from "react";
import { SplashVisual } from "@/components/stagesmith/SplashVisual";

/**
 * Route-level loading fallback (App Router segment boundary).
 *
 * The studio is a single query-driven route, so this boundary covers the
 * framework's loading gaps — hard navigations and same-route view switches
 * (dashboard ↔ editor ↔ present) while the server streams the new page.
 *
 * It renders the same branded visual as the pre-hydration splash in the root
 * layout — but DELAYED: the anti-flash contract (show only if loading takes
 * longer than ~200 ms) applies to route changes too, so quick transitions
 * never flash a loading screen at all. What shows during the quiet window is
 * the plain app background — seamless with the splash itself.
 */
export default function Loading() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), 200);
    return () => clearTimeout(t);
  }, []);
  if (!show) return null;
  return <SplashVisual mode="app" />;
}
