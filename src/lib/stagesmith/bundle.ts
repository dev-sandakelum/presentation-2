import fs from "fs/promises";
import {
  deckExists,
  deckFiles,
  deckSignature,
  readDeck,
  validDeckId,
  deckPath,
  listDecks,
} from "./store";
import type { DeckBundle } from "./types";
import { rewriteThemeCss } from "./thumbs";

/**
 * Server-side deck bundle builder — shared by the /api/decks/<id> route and
 * the server-rendered pages, so the first paint arrives as real HTML with
 * the deck data already in place (no client-side loading spinner).
 */

export async function getDeckBundle(deckId: string): Promise<DeckBundle | null> {
  if (!validDeckId(deckId) || !(await deckExists(deckId))) return null;
  const deck = await readDeck(deckId);
  const files = await deckFiles(deckId);
  const signature = await deckSignature(deckId);
  let themeCss = "";
  try {
    themeCss = rewriteThemeCss(await fs.readFile(deckPath(deckId, "theme.css"), "utf8"), deckId);
  } catch {
    themeCss = "";
  }
  return { deck, files, signature, themeCss };
}

export async function listDecksSafe(): Promise<Awaited<ReturnType<typeof listDecks>>> {
  try {
    return await listDecks();
  } catch {
    return [];
  }
}
