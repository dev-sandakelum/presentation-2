import fs from "fs/promises";
import path from "path";
import { deckRoot, validDeckId } from "@/lib/stagesmith/store";

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
  if (!validDeckId(deckId)) return new Response("Bad deck id", { status: 400 });
  const rel = (parts || []).join("/");
  if (!rel || rel.includes("..") || path.isAbsolute(rel)) {
    return new Response("Bad path", { status: 400 });
  }
  const root = path.resolve(deckRoot(deckId));
  const abs = path.resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    return new Response("Bad path", { status: 400 });
  }
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
