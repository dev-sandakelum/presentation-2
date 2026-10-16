import {
  deckExists,
  deckSignature,
  deleteSlide,
  updateSlideEntry,
  validDeckId,
} from "@/lib/stagesmith/store";
import type { Source, ThemeMode } from "@/lib/stagesmith/types";

/** PATCH /api/decks/<id>/slides/<slideId> — rename / theme / bg+overlay overrides */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ deckId: string; slideId: string }> },
) {
  const { deckId, slideId } = await params;
  if (!validDeckId(deckId) || !(await deckExists(deckId))) {
    return Response.json({ error: "Deck not found" }, { status: 404 });
  }
  try {
    const body = await req.json();
    const patch: { label?: string; theme?: ThemeMode; bg?: Source; overlay?: Source } = {};
    if (typeof body.label === "string") patch.label = body.label;
    if (body.theme === "dark" || body.theme === "light" || body.theme === null) {
      patch.theme = body.theme === null ? undefined : body.theme;
      if (body.theme === null) delete (patch as Record<string, unknown>).theme;
    }
    if (body.bg !== undefined) patch.bg = body.bg;
    if (body.overlay !== undefined) patch.overlay = body.overlay;
    const deck = await updateSlideEntry(deckId, slideId, patch as never);
    return Response.json({ deck, signature: await deckSignature(deckId) });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}

/** DELETE /api/decks/<id>/slides/<slideId> */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ deckId: string; slideId: string }> },
) {
  const { deckId, slideId } = await params;
  if (!validDeckId(deckId) || !(await deckExists(deckId))) {
    return Response.json({ error: "Deck not found" }, { status: 404 });
  }
  try {
    const deck = await deleteSlide(deckId, slideId);
    return Response.json({ deck, signature: await deckSignature(deckId) });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
