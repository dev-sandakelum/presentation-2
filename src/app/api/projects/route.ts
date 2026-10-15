import fs from "fs/promises";
import path from "path";
import {
  DECKS_ROOT,
  createDeckAtRoot,
  deckExists,
  slugify,
} from "@/lib/stagesmith/store";
import { isLinked, linkDeck } from "@/lib/stagesmith/registry";
import { starterDeckFiles } from "@/lib/stagesmith/templates";

/**
 * POST /api/projects — "New project…"
 * body: { name, location }
 * Creates the full project folder structure at <location>/<name>/:
 *   deck.json, theme.css, slides/, bg/, overlay/, notes/, assets/
 * Projects outside decks/ are linked into the library (.registry.json).
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const name = String(body.name || "").trim() || "stagelink";
    const location = String(body.location || "").trim();
    if (!location) {
      return Response.json({ error: "Pick a location folder first" }, { status: 400 });
    }
    if (location.includes("\0")) {
      return Response.json({ error: "Bad location" }, { status: 400 });
    }

    const parent = path.resolve(location);
    const st = await fs.stat(parent).catch(() => null);
    if (!st || !st.isDirectory()) {
      return Response.json({ error: `Location is not a folder: ${parent}` }, { status: 400 });
    }
    try {
      await fs.access(parent, fs.constants.W_OK);
    } catch {
      return Response.json({ error: `No write permission in ${parent}` }, { status: 400 });
    }

    const deckId = slugify(name, "project");
    if (await deckExists(deckId)) {
      return Response.json(
        { error: `A project named “${deckId}” already exists in your library` },
        { status: 400 },
      );
    }
    if (isLinked(deckId)) {
      return Response.json({ error: `“${deckId}” is already linked` }, { status: 400 });
    }

    // the project folder itself
    const root = path.join(parent, name);
    const est = await fs.stat(root).catch(() => null);
    if (est) {
      if (!est.isDirectory()) {
        return Response.json({ error: `“${name}” exists and is not a folder` }, { status: 400 });
      }
      const inside = await fs.readdir(root);
      if (inside.length > 0) {
        return Response.json(
          { error: `Folder “${name}” already exists and is not empty` },
          { status: 400 },
        );
      }
    }

    const files = starterDeckFiles(name);
    files["assets/.gitkeep"] = "";

    const deck = await createDeckAtRoot(deckId, name, files, root);

    // link into the library when the project lives outside decks/
    const resolved = path.resolve(root);
    const internal =
      resolved === DECKS_ROOT || resolved.startsWith(DECKS_ROOT + path.sep);
    if (!internal) {
      linkDeck(deckId, resolved);
    }

    return Response.json({ deck, deckId, root: resolved, external: !internal });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
