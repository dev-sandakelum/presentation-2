import { deckExists, deckSignature, validDeckId } from "@/lib/stagesmith/store";

/** GET /api/decks/<id>/poll — folder signature for live folder watching */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ deckId: string }> },
) {
  const { deckId } = await params;
  if (!validDeckId(deckId) || !(await deckExists(deckId))) {
    return Response.json({ error: "Deck not found" }, { status: 404 });
  }
  const signature = await deckSignature(deckId);
  return Response.json({ signature });
}
