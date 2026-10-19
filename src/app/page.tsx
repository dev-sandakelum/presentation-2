import { Suspense } from "react";
import "./stagesmith.css";
import { ViewsShell } from "@/components/stagesmith/ViewsShell";
import { SplashVisual } from "@/components/stagesmith/SplashVisual";
import { getDeckBundle, listDecksSafe } from "@/lib/stagesmith/bundle";

export const dynamic = "force-dynamic";

/**
 * Stagesmith — code-first presentation studio.
 * One route, query-driven views:
 *   /                      → library home
 *   /?deck=<id>            → dashboard (editor)
 *   /?deck=<id>&present=1  → display (presenter)
 *   /?remote=<id>&t=<tok>  → phone remote
 *
 * Server-rendered: initial data (deck list / deck bundle) is fetched on the
 * server, so the first paint is real HTML — no client loading spinners.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const str = (k: string): string | null => {
    const v = sp[k];
    return typeof v === "string" && v.length > 0 ? v : null;
  };
  const deck = str("deck");
  const present = str("present");
  const remote = str("remote");
  const token = str("t");
  const from = str("from");

  // Server-side initial data — failures degrade to client fetching
  const [initialDecks, initialDeckBundle, initialRemoteBundle] = await Promise.all([
    !deck && !remote ? listDecksSafe() : Promise.resolve(null),
    deck ? getDeckBundle(deck).catch(() => null) : Promise.resolve(null),
    remote ? getDeckBundle(remote).catch(() => null) : Promise.resolve(null),
  ]);

  return (
    <Suspense fallback={<Boot />}>
      <ViewsShell
        deck={deck}
        present={present}
        remote={remote}
        token={token}
        from={from}
        initialDecks={initialDecks}
        initialDeckBundle={initialDeckBundle}
        initialRemoteBundle={initialRemoteBundle}
      />
    </Suspense>
  );
}

function Boot() {
  // branded Suspense fallback — same visual as the pre-hydration splash
  // (server-safe: no hooks, no client JS, no external resources)
  return <SplashVisual mode="app" />;
}
