import path from "path";
import {
  deckExists,
  deckPath,
  deckSignature,
  readFileInDeck,
  validDeckId,
  validRelPath,
  writeFileAtomic,
} from "@/lib/stagesmith/store";

const THEME_URL_RE = /url\(\s*['"]?(\.\/|\.\.\/)([^'")]+)['"]?\s*\)/g;

function rewriteThemeCss(css: string, deckId: string): string {
  return css.replace(THEME_URL_RE, (_m, _prefix, rest) =>
    `url('/api/assets/${deckId}/assets/${rest.replace(/^assets\//, "")}')`,
  );
}

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
    // undo theme.css url rewriting from GET (store the portable form)
    const portable =
      path.basename(rel) === "theme.css"
        ? content.replace(new RegExp(`/api/assets/${deckId}/assets/`, "g"), "./assets/")
        : content;
    await writeFileAtomic(deckPath(deckId, rel), portable);
    
    // Trigger thumbnail cleanup for affected slides (async, non-blocking)
    // Only for slide content changes, not for new slide creation
    const slideMatch = rel.match(/^slides\/([^\/]+)\.tsx$/);
    if (slideMatch) {
      const slideId = slideMatch[1];
      // Fire and forget - runs after response is sent
      setImmediate(async () => {
        try {
          const { cleanupSlideThumbs } = await import("@/lib/stagesmith/thumbs");
          await cleanupSlideThumbs(deckId, slideId);
        } catch {
          /* best effort cleanup */
        }
      });
    }
    
    // If bg/ or overlay/ files or theme.css changed, clean all deck thumbnails
    if (rel.startsWith("bg/") || rel.startsWith("overlay/") || path.basename(rel) === "theme.css") {
      setImmediate(async () => {
        try {
          const { cleanupDeckThumbs } = await import("@/lib/stagesmith/thumbs");
          await cleanupDeckThumbs(deckId);
        } catch {
          /* best effort cleanup */
        }
      });
    }
    
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

/**
 * POST /api/decks/<id>/files — trigger thumbnail cleanup
 * Body: { action: "cleanup-thumbs", slideId?: string }
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ deckId: string }> },
) {
  const { deckId } = await params;
  if (!validDeckId(deckId) || !(await deckExists(deckId))) {
    return Response.json({ error: "Deck not found" }, { status: 404 });
  }
  
  try {
    const body = await req.json();
    
    if (body.action === "cleanup-thumbs") {
      const { cleanupSlideThumbs, cleanupDeckThumbs } = await import("@/lib/stagesmith/thumbs");
      
      if (body.slideId) {
        // Clean specific slide thumbnails
        await cleanupSlideThumbs(deckId, String(body.slideId));
        return Response.json({ ok: true, action: "cleanup-thumbs", slideId: body.slideId });
      } else {
        // Clean all deck thumbnails
        const deleted = await cleanupDeckThumbs(deckId);
        return Response.json({ ok: true, action: "cleanup-thumbs", deleted });
      }
    }
    
    return Response.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
