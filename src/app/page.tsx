"use client";

import { Suspense, useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import "./stagesmith.css";
import { LibraryView } from "@/components/stagesmith/LibraryView";
import { DashboardView } from "@/components/stagesmith/DashboardView";
import { PresentView } from "@/components/stagesmith/PresentView";
import { RemoteView } from "@/components/stagesmith/RemoteView";



/**
 * Stagesmith — code-first presentation studio.
 * One route, query-driven views:
 *   /                      → library home
 *   /?deck=<id>            → dashboard (editor)
 *   /?deck=<id>&present=1  → display (presenter)
 *   /?remote=<id>&t=<tok>  → phone remote
 */

function Boot() {
  return (
    <div className="ss-app" style={{ placeItems: "center", display: "grid" }}>
      <div className="ss-label" style={{ letterSpacing: ".3em" }}>Loading Stagesmith…</div>
    </div>
  );
}

function Views({ view, deck, present, remote, token, from }: { view: string; deck: string | null; present: string | null; remote: string | null; token: string | null; from: string | null }) {
  const router = useRouter();
  const go = useCallback(
    (url: string) => {
      router.push(url, { scroll: false });
    },
    [router],
  );

  const nav = useMemo(
    () => ({
      library: () => go("/"),
      deck: (id: string) => go(`/?deck=${encodeURIComponent(id)}`),
      present: (id: string, from?: number) =>
        go(`/?deck=${encodeURIComponent(id)}&present=1${from !== undefined ? `&from=${from}` : ""}`),
    }),
    [go],
  );

  if (remote) return <RemoteView deckId={remote} token={token} />;
  if (deck && present) return <PresentView deckId={deck} fromParam={from} nav={nav} />;
  if (deck) return <DashboardView deckId={deck} nav={nav} />;
  return <LibraryView nav={nav} />;
}

export default function Page() {
  return (
    <Suspense fallback={<Boot />}>
      <Shell />
    </Suspense>
  );
}

function Shell() {
  const sp = useSearchParams();
  const view = sp.get("view");
  const deck = sp.get("deck");
  const present = sp.get("present");
  const remote = sp.get("remote");
  const token = sp.get("t");
  const from = sp.get("from");
  return <Views view={view || ""} deck={deck} present={present} remote={remote} token={token} from={from} />;
}
