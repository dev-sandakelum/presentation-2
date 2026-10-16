"use client";

import { useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import type { DeckBundle, DeckSummary } from "@/lib/stagesmith/types";
import { LibraryView } from "./LibraryView";
import { DashboardView } from "./DashboardView";
import { PresentView } from "./PresentView";
import { RemoteView } from "./RemoteView";
import type { SsNav } from "./shared";

/**
 * Client shell around the query-driven views — owns the router navigation
 * callbacks and hydrates each view with its server-fetched initial data.
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
  const go = useCallback(
    (url: string) => {
      router.push(url, { scroll: false });
    },
    [router],
  );

  const nav = useMemo<SsNav>(
    () => ({
      library: () => go("/"),
      deck: (id: string) => go(`/?deck=${encodeURIComponent(id)}`),
      present: (id: string, from?: number) =>
        go(`/?deck=${encodeURIComponent(id)}&present=1${from !== undefined ? `&from=${from}` : ""}`),
    }),
    [go],
  );

  if (remote) return <RemoteView deckId={remote} token={token} nav={nav} initialBundle={initialRemoteBundle} />;
  if (deck && present) return <PresentView deckId={deck} fromParam={from} nav={nav} initialBundle={initialDeckBundle} />;
  if (deck) return <DashboardView deckId={deck} nav={nav} initialBundle={initialDeckBundle} />;
  return <LibraryView nav={nav} initialDecks={initialDecks} />;
}
