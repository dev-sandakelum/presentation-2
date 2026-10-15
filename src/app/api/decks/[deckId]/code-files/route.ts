import fs from "fs/promises";
import path from "path";
import { deckExists, deckFiles, deckPath, deckRoot, validDeckId, validRelPath, writeFileAtomic } from "@/lib/stagesmith/store";

const MAX_TSX_SIZE = 512 * 1024; // 512 KB per tsx file

/**
 * GET /api/decks/<id>/code-files?dir=overlay|bg
 * Lists .tsx files under the requested directory.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ deckId: string }> },
) {
  const { deckId } = await params;
  const dir = new URL(req.url).searchParams.get("dir") ?? "";
  if (!validDeckId(deckId) || !(await deckExists(deckId))) {
    return Response.json({ error: "Deck not found" }, { status: 404 });
  }
  if (dir !== "overlay" && dir !== "bg") {
    return Response.json({ error: "dir must be 'overlay' or 'bg'" }, { status: 400 });
  }
  const files = await deckFiles(deckId);
  const rows = files.filter(
    (f) => f.path.startsWith(`${dir}/`) && f.path.endsWith(".tsx"),
  );
  return Response.json({ files: rows });
}

/**
 * POST /api/decks/<id>/code-files?dir=overlay|bg
 * Multipart upload of .tsx files into the given directory.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ deckId: string }> },
) {
  const { deckId } = await params;
  const dir = new URL(req.url).searchParams.get("dir") ?? "";
  if (!validDeckId(deckId) || !(await deckExists(deckId))) {
    return Response.json({ error: "Deck not found" }, { status: 404 });
  }
  if (dir !== "overlay" && dir !== "bg") {
    return Response.json({ error: "dir must be 'overlay' or 'bg'" }, { status: 400 });
  }

  try {
    const form = await req.formData();
    const out: Array<{ path: string }> = [];

    for (const [, value] of form.entries()) {
      if (!(value instanceof File)) continue;
      if (!value.name.endsWith(".tsx")) {
        return Response.json({ error: `${value.name} is not a .tsx file` }, { status: 400 });
      }
      if (value.size > MAX_TSX_SIZE) {
        return Response.json({ error: `${value.name} exceeds the 512 KB limit` }, { status: 400 });
      }
      const text = await value.text();
      const sanitizedName = value.name.replace(/[^\w.\-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "component.tsx";
      const rel = `${dir}/${sanitizedName}`;
      if (!validRelPath(rel)) {
        return Response.json({ error: `Invalid filename: ${value.name}` }, { status: 400 });
      }
      // ensure directory exists
      const absDir = path.join(deckRoot(deckId), dir);
      await fs.mkdir(absDir, { recursive: true });
      await writeFileAtomic(deckPath(deckId, rel), text);
      out.push({ path: rel });
    }

    return Response.json({ uploaded: out });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}

/**
 * DELETE /api/decks/<id>/code-files?path=overlay/foo.tsx
 * Removes a bg/ or overlay/ tsx file.
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ deckId: string }> },
) {
  const { deckId } = await params;
  const rel = new URL(req.url).searchParams.get("path") ?? "";
  if (!validDeckId(deckId) || !(await deckExists(deckId)) || !validRelPath(rel)) {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  if (!(rel.startsWith("overlay/") || rel.startsWith("bg/")) || !rel.endsWith(".tsx")) {
    return Response.json({ error: "Only overlay/ and bg/ .tsx files can be deleted here" }, { status: 400 });
  }
  await fs.rm(deckPath(deckId, rel), { force: true }).catch(() => {});
  return Response.json({ ok: true });
}
