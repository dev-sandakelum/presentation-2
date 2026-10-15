import {
  addSlide,
  deckExists,
  deckSignature,
  readDeck,
  slugify,
  uniqueSlideId,
  validDeckId,
} from "@/lib/stagesmith/store";
import { templateByKey } from "@/lib/stagesmith/templates";

/** POST /api/decks/<id>/slides — add a slide from a starter template */
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
    const label = String(body.label || (body.code ? "Imported slide" : "Slide"));
    const deck = await readDeck(deckId);
    const id = await uniqueSlideId(deck, slugify(label, "slide"));
    const position = typeof body.position === "number" ? body.position : null;
    let code: string;
    if (typeof body.code === "string" && body.code.trim()) {
      code = body.code;
    } else {
      const template = templateByKey(String(body.template || "section"));
      if (!template) return Response.json({ error: "Unknown template" }, { status: 400 });
      code = template.code;
    }
    const updated = await addSlide(deckId, { id, label }, code, position);
    return Response.json({ deck: updated, signature: await deckSignature(deckId) });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
