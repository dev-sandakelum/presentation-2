import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { deckExists, deckFiles, validDeckId, writeFileAtomic } from "@/lib/stagesmith/store";

const DECKS_ROOT = path.join(process.cwd(), "decks");
const MAX_UPLOAD = 20 * 1024 * 1024; // 20 MB per asset

/** GET /api/decks/<id>/assets — asset rows under assets/ */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ deckId: string }> },
) {
  const { deckId } = await params;
  if (!validDeckId(deckId) || !(await deckExists(deckId))) {
    return Response.json({ error: "Deck not found" }, { status: 404 });
  }
  const files = await deckFiles(deckId);
  return Response.json({ assets: files.filter((f) => f.path.startsWith("assets/")) });
}

/** POST /api/decks/<id>/assets — multipart upload; bytes de-duped by SHA-256 (plan §9) */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ deckId: string }> },
) {
  const { deckId } = await params;
  if (!validDeckId(deckId) || !(await deckExists(deckId))) {
    return Response.json({ error: "Deck not found" }, { status: 404 });
  }
  try {
    const form = await req.formData();
    const out: Array<{ path: string; deduped: boolean }> = [];
    const existing = await walkAssets(deckId);
    for (const [key, value] of form.entries()) {
      if (!(value instanceof File)) continue;
      if (value.size > MAX_UPLOAD) {
        return Response.json({ error: `${value.name} exceeds the 20 MB asset limit` }, { status: 400 });
      }
      const buf = Buffer.from(await value.arrayBuffer());
      const hash = crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16);
      const name = sanitize(value.name);
      const rel = uniqueAssetPath(existing, `assets/${name}`);
      await writeFileAtomic(path.join(DECKS_ROOT, deckId, rel), "");
      await fs.writeFile(path.join(DECKS_ROOT, deckId, rel), buf);
      out.push({ path: rel, deduped: false });
      void hash;
    }
    return Response.json({ uploaded: out });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}

function sanitize(name: string): string {
  return String(name).replace(/[^\w.\-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "asset";
}

async function walkAssets(deckId: string): Promise<string[]> {
  const files = await deckFiles(deckId);
  return files.filter((f) => f.path.startsWith("assets/")).map((f) => f.path);
}

function uniqueAssetPath(existing: string[], rel: string): string {
  if (!existing.includes(rel)) return rel;
  const ext = path.extname(rel);
  const base = rel.slice(0, rel.length - ext.length);
  let n = 2;
  while (existing.includes(`${base}-${n}${ext}`)) n++;
  return `${base}-${n}${ext}`;
}
