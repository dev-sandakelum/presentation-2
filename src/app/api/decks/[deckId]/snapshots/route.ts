import {
  deckExists,
  listSnapshots,
  restoreSnapshot,
  snapshotDeck,
  validDeckId,
} from "@/lib/stagesmith/store";

/** GET /api/decks/<id>/snapshots — list snapshot names (newest first) */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ deckId: string }> },
) {
  const { deckId } = await params;
  if (!validDeckId(deckId) || !(await deckExists(deckId))) {
    return Response.json({ error: "Deck not found" }, { status: 404 });
  }
  return Response.json({ snapshots: await listSnapshots(deckId) });
}

/** POST /api/decks/<id>/snapshots — {action:'create',tag} | {action:'restore',name} */
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
    if (body.action === "restore") {
      await snapshotDeck(deckId, "before-restore");
      await restoreSnapshot(deckId, String(body.name));
      return Response.json({ ok: true, restored: body.name });
    }
    const name = await snapshotDeck(deckId, String(body.tag || "manual"));
    return Response.json({ ok: true, name });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
