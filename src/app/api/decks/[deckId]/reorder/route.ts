import { deckExists, deckSignature, reorderSlides, validDeckId } from "@/lib/stagesmith/store";

/** POST /api/decks/<id>/reorder — body { order: string[] } */
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
    const order = Array.isArray(body.order) ? body.order.map(String) : [];
    const deck = await reorderSlides(deckId, order);
    return Response.json({ deck, signature: await deckSignature(deckId) });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
