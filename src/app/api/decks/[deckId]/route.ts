import {
  deckExists,
  deckFiles,
  deckSignature,
  deleteDeck,
  readDeck,
  readFileInDeck,
  updateDeckMeta,
  validDeckId,
} from "@/lib/stagesmith/store";

const THEME_URL_RE = /url\(\s*['"]?(\.\/|\.\.\/)([^'")]+)['"]?\s*\)/g;

/** rewrite ./… url() refs in theme.css to same-origin asset URLs (plan §5.2) */
function rewriteThemeCss(css: string, deckId: string): string {
  return css.replace(THEME_URL_RE, (_m, prefix, rest) => {
    const rel = prefix === "./" ? rest : prefix === "../" ? rest : rest;
    return `url('/api/assets/${deckId}/assets/${rest.replace(/^assets\//, "")}')`;
  });
}

/** GET /api/decks/<id> — full deck + file list + theme css */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ deckId: string }> },
) {
  const { deckId } = await params;
  if (!validDeckId(deckId) || !(await deckExists(deckId))) {
    return Response.json({ error: "Deck not found" }, { status: 404 });
  }
  const deck = await readDeck(deckId);
  const files = await deckFiles(deckId);
  const signature = await deckSignature(deckId);
  let themeCss = "";
  try {
    themeCss = rewriteThemeCss(await readFileInDeck(deckId, "theme.css"), deckId);
  } catch {
    themeCss = "";
  }
  return Response.json({ deck, files, signature, themeCss });
}

/** PATCH /api/decks/<id> — title / settings / common bg+overlay */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ deckId: string }> },
) {
  const { deckId } = await params;
  if (!validDeckId(deckId) || !(await deckExists(deckId))) {
    return Response.json({ error: "Deck not found" }, { status: 404 });
  }
  try {
    const patch = await req.json();
    const deck = await updateDeckMeta(deckId, patch);
    const signature = await deckSignature(deckId);
    return Response.json({ deck, signature });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}

/** DELETE /api/decks/<id> — external (linked) projects keep their files on disk */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ deckId: string }> },
) {
  const { deckId } = await params;
  if (!validDeckId(deckId) || !(await deckExists(deckId))) {
    return Response.json({ error: "Deck not found" }, { status: 404 });
  }
  const result = await deleteDeck(deckId);
  return Response.json({ ok: true, ...result });
}
