import crypto from "crypto";
import JSZip from "jszip";
import {
  deckExists,
  deckFiles,
  deckPath,
  readDeck,
  validDeckId,
} from "@/lib/stagesmith/store";
import fs from "fs/promises";

/**
 * GET /api/decks/<id>/export?format=smdeck|deck.tsx
 * .smdeck  — deterministic zip: mimetype (stored, first), manifest.json (SHA-256 per file)
 * .deck.tsx — one text file with // @file sections
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ deckId: string }> },
) {
  const { deckId } = await params;
  const format = new URL(req.url).searchParams.get("format") || "smdeck";
  if (!validDeckId(deckId) || !(await deckExists(deckId))) {
    return Response.json({ error: "Deck not found" }, { status: 404 });
  }
  const deck = await readDeck(deckId);
  const files = (await deckFiles(deckId)).map((f) => f.path).sort();

  if (format === "deck.tsx") {
    const parts: string[] = [
      `// Stagesmith deck — ${deck.title}`,
      `// Slides: ${deck.slides.length}. Sections below carry // @file <path> markers.`,
      `// Re-import: paste this file into Stagesmith import, or split it back into a folder.`,
      "",
    ];
    for (const rel of files) {
      if (rel === "deck.json" || rel === "theme.css" || rel.startsWith("slides/") || rel.startsWith("bg/") || rel.startsWith("overlay/") || rel.startsWith("shared/")) {
        const body = await fs.readFile(deckPath(deckId, rel), "utf8");
        parts.push(`// @file ${rel}`, body.trimEnd(), "");
      }
    }
    return new Response(parts.join("\n"), {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${deckId}.deck.tsx"`,
      },
    });
  }

  // .smdeck
  const zip = new JSZip();
  zip.file("mimetype", "application/vnd.stagesmith.deck", { compression: "STORE" });
  const manifest: Record<string, string> = {};
  for (const rel of files) {
    const buf = await fs.readFile(deckPath(deckId, rel));
    manifest[rel] = crypto.createHash("sha256").update(buf).digest("hex");
    zip.file(rel, buf, { compression: "DEFLATE" });
  }
  zip.file("manifest.json", JSON.stringify({ format: "smdeck", files: manifest }, null, 2) + "\n");
  const out = await zip.generateAsync({ type: "nodebuffer", mimeType: "application/vnd.stagesmith.deck" });
  return new Response(new Uint8Array(out), {
    headers: {
      "Content-Type": "application/vnd.stagesmith.deck",
      "Content-Disposition": `attachment; filename="${deckId}.smdeck"`,
    },
  });
}
