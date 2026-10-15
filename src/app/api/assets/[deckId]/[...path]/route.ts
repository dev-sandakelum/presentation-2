import fs from "fs/promises";
import path from "path";

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".json": "application/json",
};

/**
 * GET /api/assets/<deckId>/<path…> — serves deck assets to the sandboxed
 * runtime (CORS for module/fetch use) and to the editor.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ deckId: string; path: string[] }> },
) {
  const { deckId, path: parts } = await params;
  const rel = (parts || []).join("/");
  if (!rel || rel.includes("..") || path.isAbsolute(rel)) {
    return new Response("Bad path", { status: 400 });
  }
  const abs = path.join(process.cwd(), "decks", deckId, rel);
  const root = path.join(process.cwd(), "decks", deckId);
  if (!abs.startsWith(root)) return new Response("Bad path", { status: 400 });
  try {
    const body = await fs.readFile(abs);
    const ext = path.extname(abs).toLowerCase();
    return new Response(body, {
      headers: {
        "Content-Type": MIME[ext] || "application/octet-stream",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-cache",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
