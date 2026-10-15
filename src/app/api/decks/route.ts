import fs from "fs/promises";
import path from "path";
import {
  createDeckFolder,
  deckExists,
  listDecks,
  readDeck,
  slugify,
  validDeckId,
} from "@/lib/stagesmith/store";
import { starterDeckFiles } from "@/lib/stagesmith/templates";

const DECKS_ROOT = path.join(process.cwd(), "decks");

/** GET /api/decks — library listing */
export async function GET() {
  const decks = await listDecks();
  return Response.json({ decks });
}

/**
 * POST /api/decks
 * body: { title, deckId?, duplicateOf? }
 * Creates a starter deck, or a duplicate of an existing one.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const title = String(body.title || "").trim() || "Untitled deck";
    const deckId = body.deckId ? slugify(String(body.deckId), "deck") : slugify(title, "deck");

    // unique id
    let finalId = deckId;
    let n = 2;
    while (await deckExists(finalId)) {
      finalId = `${deckId}-${n}`;
      n++;
    }

    let files: Record<string, string>;
    if (body.duplicateOf) {
      const srcId = String(body.duplicateOf);
      if (!validDeckId(srcId) || !(await deckExists(srcId))) {
        return Response.json({ error: "Source deck not found" }, { status: 404 });
      }
      files = {};
      const walk = async (dir: string, rel = "") => {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const e of entries) {
          if (e.name === ".stagesmith") continue;
          const relPath = rel ? `${rel}/${e.name}` : e.name;
          if (e.isDirectory()) await walk(path.join(dir, e.name), relPath);
          else files[relPath] = await fs.readFile(path.join(dir, e.name), "utf8");
        }
      };
      await walk(path.join(DECKS_ROOT, srcId));
      const deck = JSON.parse(files["deck.json"]);
      deck.title = title;
      files["deck.json"] = JSON.stringify(deck, null, 2);
    } else {
      files = starterDeckFiles(title);
    }

    const deck = await createDeckFolder(finalId, title, files);
    return Response.json({ deck });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
