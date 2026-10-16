import { renderStill, placeholderSvg, planStill, warmDeck } from "@/lib/stagesmith/thumbs";
import type { ThemeMode } from "@/lib/stagesmith/types";

/**
 * GET /api/decks/<id>/thumb/<slideId> — auto-generated static thumbnail.
 *
 * Query:
 *   w      pixel width of the 16:9 still      (default 480, max 1280)
 *   mode   dark | light                      (default: slide/deck setting)
 *   layers full | content                    (content → transparent ghost)
 *   v      deck signature — cache-buster only, not part of the key
 *
 * The still key covers the actual visual inputs (module versions, theme,
 * mode, size, layers) so the response is immutable and cached hard.
 */

const MAX_WAIT_MS = 14_000;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ deckId: string; slideId: string }> },
) {
  const { deckId, slideId } = await params;
  const url = new URL(req.url);
  const w = Math.max(160, Math.min(1280, parseInt(url.searchParams.get("w") || "480", 10) || 480));
  const modeParam = url.searchParams.get("mode");
  const mode: ThemeMode | undefined = modeParam === "dark" || modeParam === "light" ? modeParam : undefined;
  const layers = url.searchParams.get("layers") === "content" ? ("content" as const) : ("full" as const);

  // _warm → queue every slide still in the background, answer immediately
  if (slideId === "_warm") {
    warmDeck(deckId, { width: w, mode, layers }).catch(() => {});
    return Response.json({ ok: true, queued: true }, { headers: { "Cache-Control": "no-store" } });
  }

  const started = Date.now();
  // bounded wait: the queue may hold several slides on a cold deck
  const result = await Promise.race([
    renderStill(deckId, slideId, { width: w, mode, layers }),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), MAX_WAIT_MS)),
  ]);

  if (result && result.buf) {
    return new Response(new Uint8Array(result.buf), {
      headers: {
        "Content-Type": result.contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-SS-Thumb": result.hit ? "hit" : "gen",
      },
    });
  }

  // timeout or generation failure → branded placeholder (no-store so a later
  // request can succeed once the queue drains). np=1 asks for a 404 instead
  // (used by the presenter ghost probe — never show a placeholder as a ghost)
  const np = url.searchParams.get("np") === "1";
  const plan = await planStill(deckId, slideId, { width: w, mode, layers }).catch(() => null);
  if (!plan || np) {
    return new Response(np && plan ? "Cold" : "Not found", {
      status: np && plan ? 404 : 404,
      headers: { "Cache-Control": "no-store" },
    });
  }
  const svg = placeholderSvg({ ...plan, kind: plan.placeholder === "error" ? "error" : undefined });
  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "no-store",
      "X-SS-Thumb": "placeholder",
      "X-SS-Waited": String(Date.now() - started),
    },
  });
}
