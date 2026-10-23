import fs from "fs/promises";
import {
  deckExists,
  deckFiles,
  signatureOfFiles,
  readDeck,
  validDeckId,
  deckPath,
  listDecks,
} from "./store";
import { rewriteThemeCss } from "./themeurl";
import type { DeckBundle } from "./types";

/**
 * Server-side deck bundle builder — shared by the /api/decks/<id> route and
 * the server-rendered pages, so the first paint arrives as real HTML with
 * the deck data already in place (no client-side loading spinner).
 * Only ever sees SERVER decks — browser decks live in the client's IndexedDB.
 */

export async function getDeckBundle(deckId: string): Promise<DeckBundle | null> {
  if (!validDeckId(deckId) || !(await deckExists(deckId))) return null;
  // deck.json, the full folder walk and theme.css are independent reads —
  // they all go at once, and the signature reuses the ONE walk (the old
  // code walked the whole folder a second time inside deckSignature).
  const [deck, files, themeRaw] = await Promise.all([
    readDeck(deckId),
    deckFiles(deckId),
    fs.readFile(deckPath(deckId, "theme.css"), "utf8").catch(() => ""),
  ]);
  return {
    deck,
    files,
    signature: signatureOfFiles(files),
    themeCss: rewriteThemeCss(themeRaw, deckId),
    store: "server",
  };
}

export async function listDecksSafe(): Promise<Awaited<ReturnType<typeof listDecks>>> {
  try {
    return await listDecks();
  } catch {
    return [];
  }
}
