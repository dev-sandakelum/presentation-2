import { compileFile, compileUrlFor, compileVirtual } from "@/lib/stagesmith/compile";
import { deckExists, deckFiles, readFileInDeck, validDeckId, validRelPath } from "@/lib/stagesmith/store";
import { mapPool } from "@/lib/stagesmith/parallel";

const CORS = {
  "Access-Control-Allow-Origin": "*",
};

/** limits for the stateless POST compile (browser-stored decks) */
const MAX_FILES = 600;
const MAX_TOTAL_CHARS = 12 * 1024 * 1024;

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

/**
 * POST /api/compile — STATELESS compile for browser-stored decks.
 * body: { files: Record<relPath, content>, entry: relPath }
 * → { ok, js, steps, ver } — a single self-contained ESM module the runtime
 * imports from a blob URL. No disk access, so it works on read-only
 * serverless deployments.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { files?: unknown; entry?: unknown; deckId?: unknown; overrides?: unknown };
    let files = body.files as Record<string, string> | undefined;
    const entry = String(body.entry || "");
    if (body.deckId !== undefined) {
      const deckId = String(body.deckId);
      if (!validDeckId(deckId) || !(await deckExists(deckId)) || !validRelPath(entry)) {
        return Response.json({ ok: false, error: "Bad deck or entry path" }, { status: 400, headers: CORS });
      }
      const overrides = (body.overrides ?? {}) as Record<string, unknown>;
      files = {};
      const rows = await deckFiles(deckId);
      const textRows = rows.filter((row) => /\.(tsx?|jsx?|css|json)$/i.test(row.path) && row.size <= 1_500_000);
      // Parallel bounded reads: the old one-file-at-a-time loop made every
      // stateless compile of a server deck pay the full sum of disk read
      // latencies. A read failure leaves the file absent (the compiler
      // reports a normal resolution error), exactly like the old catch.
      const contents = await mapPool(
        textRows,
        (row) => readFileInDeck(deckId, row.path),
        { concurrency: 8, label: `compile-read:${deckId}` },
      );
      for (let i = 0; i < textRows.length; i++) {
        const content = contents[i];
        if (!(content instanceof Error)) files[textRows[i].path] = content;
      }
      for (const [path, content] of Object.entries(overrides)) {
        if (!validRelPath(path) || typeof content !== "string") {
          return Response.json({ ok: false, error: `Invalid live override: ${path}` }, { status: 400, headers: CORS });
        }
        files[path] = content;
      }
    }
    if (!files || typeof files !== "object" || Array.isArray(files)) {
      return Response.json({ ok: false, error: "Bad request" }, { status: 400, headers: CORS });
    }
    const keys = Object.keys(files);
    if (keys.length === 0 || keys.length > MAX_FILES) {
      return Response.json(
        { ok: false, error: `Project must have 1–${MAX_FILES} files` },
        { status: 400, headers: CORS },
      );
    }
    let total = 0;
    for (const [k, v] of Object.entries(files)) {
      if (typeof k !== "string" || k.length > 200 || k.includes("\\") || k.includes("\0") || k.startsWith("/") || k.split("/").some((s) => s === "" || s === "." || s === "..")) {
        return Response.json({ ok: false, error: `Illegal path: ${k}` }, { status: 400, headers: CORS });
      }
      if (typeof v !== "string") {
        return Response.json({ ok: false, error: `File ${k} is not text` }, { status: 400, headers: CORS });
      }
      total += v.length;
    }
    if (total > MAX_TOTAL_CHARS) {
      return Response.json({ ok: false, error: "Project too large to compile" }, { status: 400, headers: CORS });
    }

    const result = await compileVirtual(files, entry);
    return Response.json(result, { headers: CORS });
  } catch (e) {
    return Response.json(
      { ok: false, error: (e as Error)?.message || "Compile failed" },
      { status: 400, headers: CORS },
    );
  }
}
