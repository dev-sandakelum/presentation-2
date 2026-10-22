import path from "path";
import fs from "fs/promises";
import {
  deckExists,
  deckPath,
  deckSignature,
  readFileInDeck,
  validDeckId,
  validRelPath,
  writeFileAtomic,
  deckRoot,
} from "@/lib/stagesmith/store";
import { rewriteThemeCss, unrewriteThemeCss } from "@/lib/stagesmith/themeurl";

/**
 * GET /api/decks/<id>/files?path=<rel>  — file content (theme.css gets url rewrite)
 * PUT /api/decks/<id>/files             — atomic save, returns new signature
 * DELETE /api/decks/<id>/files?path=    — remove a file (assets tab)
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ deckId: string }> },
) {
  const { deckId } = await params;
  const rel = new URL(req.url).searchParams.get("path") || "";
  if (!validDeckId(deckId) || !(await deckExists(deckId)) || !validRelPath(rel)) {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  try {
    const content = await readFileInDeck(deckId, rel);
    const out = path.basename(rel) === "theme.css" ? rewriteThemeCss(content, deckId) : content;
    return Response.json({ path: rel, content: out });
  } catch {
    return Response.json({ error: "File not found" }, { status: 404 });
  }
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ deckId: string }> },
) {
  const { deckId } = await params;
  if (!validDeckId(deckId) || !(await deckExists(deckId))) {
    return Response.json({ error: "Deck not found" }, { status: 404 });
  }
  try {
    const body = await req.json();
    const rel = String(body.path || "");
    const content = String(body.content ?? "");
    if (!validRelPath(rel)) return Response.json({ error: "Illegal path" }, { status: 400 });
    // undo theme.css url rewriting from GET (store the portable form; decode
    // so re-reading never double-encodes encoded asset names)
    const portable = path.basename(rel) === "theme.css" ? unrewriteThemeCss(content, deckId) : content;
    const target = deckPath(deckId, rel);
    if (content.length === 0 && body.allowEmptyOverwrite !== true) {
      try {
        if ((await fs.stat(target)).size > 0) return Response.json({ error: "Refusing to replace a non-empty file with empty content without confirmation" }, { status: 409 });
      } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    }
    try {
      await fs.access(target);
      const historyRoot = path.join(deckRoot(deckId), ".history");
      const historyDir = path.join(historyRoot, `${Date.now()}-${crypto.randomUUID()}`);
      await fs.mkdir(path.dirname(path.join(historyDir, rel)), { recursive: true });
      await fs.copyFile(target, path.join(historyDir, rel));
      const dirs = (await fs.readdir(historyRoot, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort().reverse();
      for (const old of dirs.slice(10)) await fs.rm(path.join(historyRoot, old), { recursive: true, force: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    await writeFileAtomic(target, portable);
    return Response.json({ ok: true, savedAt: Date.now(), signature: await deckSignature(deckId) });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ deckId: string }> },
) {
  const { deckId } = await params;
  const rel = new URL(req.url).searchParams.get("path") || "";
  if (!validDeckId(deckId) || !(await deckExists(deckId)) || !validRelPath(rel)) {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  if (!(rel.startsWith("assets/") || rel.startsWith("notes/"))) {
    return Response.json({ error: "Only assets/ and notes/ files can be deleted here" }, { status: 400 });
  }
  const fs = await import("fs/promises");
  await fs.rm(deckPath(deckId, rel), { force: true }).catch(() => {});
  return Response.json({ ok: true });
}
