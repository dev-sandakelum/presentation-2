"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { DeckBundle, DeckSummary } from "@/lib/stagesmith/types";
import { LibraryView } from "./LibraryView";
import { DashboardView } from "./DashboardView";
import { PresentView } from "./PresentView";
import { RemoteView } from "./RemoteView";
import { installDeviceMirror } from "@/lib/stagesmith/device";
import { SplashVeil, type SplashMode } from "./LoadingScreen";
import type { SsNav } from "./shared";

/**
 * Client shell around the query-driven views — owns the router navigation
 * callbacks and hydrates each view with its server-fetched initial data.
 *
 * It also owns the "route change takes a moment" loading screen: pushes are
 * React transitions, so the old view stays on screen while the new one's
 * server data streams. If that takes longer than ~200 ms a branded veil
 * fades in over the stale view (mode labelled for the destination), and
 * fades back out (≥400 ms visible, 300 ms fade) when the new view commits.
 */
export function ViewsShell({
  deck,
  present,
  remote,
  token,
  from,
  initialDecks,
  initialDeckBundle,
  initialRemoteBundle,
}: {
  deck: string | null;
  present: string | null;
  remote: string | null;
  token: string | null;
  from: string | null;
  initialDecks: DeckSummary[] | null;
  initialDeckBundle: DeckBundle | null;
  initialRemoteBundle: DeckBundle | null;
}) {
  const router = useRouter();

  // device-folder write-through (File System Access API) — installed once
  useEffect(() => {
    installDeviceMirror();
  }, []);

  /* ---------- pending-navigation loading veil ---------- */
  const viewKey = `${remote ?? ""}|${deck ?? ""}|${present ?? ""}`;
  const lastViewKeyRef = useRef(viewKey);
  const [pending, setPending] = useState<SplashMode | null>(null);

  const viewKeyOf = useCallback((url: string): string => {
    try {
      const q = url.split("?")[1] ?? "";
      const p = new URLSearchParams(q);
      return `${p.get("remote") ?? ""}|${p.get("deck") ?? ""}|${p.get("present") ?? ""}`;
    } catch {
      return viewKey;
    }
  }, [viewKey]);

  const go = useCallback(
    (url: string) => {
      // same view pushed again (e.g. present → present at another slide) —
      // no view commit will arrive, so never arm the veil for it
      if (viewKeyOf(url) === lastViewKeyRef.current) {
        router.push(url, { scroll: false });
        return;
      }
      const mode: SplashMode = /present=1/.test(url) ? "present" : /deck=/.test(url) ? "deck" : "app";
      setPending(mode);
      router.push(url, { scroll: false });
    },
    [router, viewKeyOf],
  );

  // the new view's props committed → the destination is live → lift the veil
  useEffect(() => {
    if (viewKey !== lastViewKeyRef.current) {
      lastViewKeyRef.current = viewKey;
      setPending(null);
    }
  }, [viewKey]);

  // hard safety: never keep the transition veil up for more than 8 s even
  // if something goes wrong with the router commit
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => setPending(null), 8000);
    return () => clearTimeout(t);
  }, [pending]);

  const nav = useMemo<SsNav>(
    () => ({
      library: () => go("/"),
      deck: (id: string) => go(`/?deck=${encodeURIComponent(id)}`),
      present: (id: string, from?: number) =>
        go(`/?deck=${encodeURIComponent(id)}&present=1${from !== undefined ? `&from=${from}` : ""}`),
    }),
    [go],
  );

  return (
    <>
      {remote ? (
        <RemoteView deckId={remote} token={token} nav={nav} initialBundle={initialRemoteBundle} />
      ) : deck && present ? (
        <PresentView deckId={deck} fromParam={from} nav={nav} initialBundle={initialDeckBundle} />
      ) : deck ? (
        <DashboardView deckId={deck} nav={nav} initialBundle={initialDeckBundle} />
      ) : (
        <LibraryView nav={nav} initialDecks={initialDecks} />
      )}

      {/* slow view switches (dashboard ↔ editor ↔ present) — branded veil,
          shown only after ~200 ms so quick transitions never flash */}
      <SplashVeil active={pending !== null} mode={pending ?? "app"} message={pending === "present" ? "Entering present mode" : pending === "deck" ? "Opening deck" : "Loading studio"} />
    </>
  );
}
