import { compileFile, compileUrlFor } from "@/lib/stagesmith/compile";
import { deckExists, validDeckId } from "@/lib/stagesmith/store";

const CORS = {
  "Access-Control-Allow-Origin": "*",
};

/**
 * GET /api/compile?deck=<id>&file=<rel>&meta=1 → compile result (JSON)
 * GET /api/compile?deck=<id>&file=<rel>&v=<ver> → compiled ESM module
 *
 * The parent (StageFrame) fetches meta first so compile errors surface in
 * the dashboard; the sandboxed runtime imports the module URL directly.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const deckId = url.searchParams.get("deck") || "";
  const file = url.searchParams.get("file") || "";
  const meta = url.searchParams.get("meta");
  const v = url.searchParams.get("v");

  if (!validDeckId(deckId) || !file) {
    return Response.json({ ok: false, error: "Bad request" }, { status: 400, headers: CORS });
  }
  if (!(await deckExists(deckId))) {
    return Response.json({ ok: false, error: "Deck not found" }, { status: 404, headers: CORS });
  }

  try {
    const entry = await compileFile(deckId, file);

    if (meta) {
      if (entry.error) {
        return Response.json({ ok: false, error: entry.error, hash: entry.ver }, { headers: CORS });
      }
      return Response.json(
        { ok: true, url: compileUrlFor(deckId, file, entry.ver), steps: entry.steps, hash: entry.ver },
        { headers: CORS },
      );
    }

    if (entry.error) {
      // a module URL that fails: return a module that throws on import
      const safe = JSON.stringify(entry.error).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      return new Response(`throw new Error('Compile failed: ' + ${safe});`, {
        status: 200,
        headers: { "Content-Type": "application/javascript; charset=utf-8", ...CORS },
      });
    }
    return new Response(entry.js, {
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
        ...CORS,
        "Cache-Control": v === entry.ver ? "public, max-age=31536000, immutable" : "no-store",
      },
    });
  } catch (e) {
    const msg = (e as Error)?.message || "Compile failed";
    return Response.json({ ok: false, error: msg }, { status: 400, headers: CORS });
  }
}
