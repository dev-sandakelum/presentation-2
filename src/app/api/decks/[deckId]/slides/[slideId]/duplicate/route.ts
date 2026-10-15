import { deckExists, deckSignature, duplicateSlide, validDeckId } from "@/lib/stagesmith/store";

/** POST /api/decks/<id>/slides/<slideId>/duplicate */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ deckId: string; slideId: string }> },
) {
  const { deckId, slideId } = await params;
  if (!validDeckId(deckId) || !(await deckExists(deckId))) {
    return Response.json({ error: "Deck not found" }, { status: 404 });
  }
  try {
    const deck = await duplicateSlide(deckId, slideId);
    return Response.json({ deck, signature: await deckSignature(deckId) });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
