"use client";

import type { DeckJson, DeckSummary, FileRow, Source, ThemeMode } from "./types";

/** Typed fetch helpers for the Stagesmith API */

async function j<T>(res: Response): Promise<T> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    throw new Error((body as { error?: string } | null)?.error || `Request failed (${res.status})`);
  }
  if (body === null || typeof body !== "object") {
    throw new Error("Malformed response from server");
  }
  return body as T;
}

export interface DeckBundle {
  deck: DeckJson;
  files: FileRow[];
  signature: string;
  themeCss: string;
}

export const api = {
  listDecks: async (): Promise<DeckSummary[]> => {
    const res = await fetch("/api/decks", { cache: "no-store" });
    return (await j<{ decks?: DeckSummary[] }>(res)).decks ?? [];
  },

  getDeck: async (deckId: string): Promise<DeckBundle> => {
    const res = await fetch(`/api/decks/${deckId}`);
    return j<DeckBundle>(res);
  },

  createDeck: async (title: string, duplicateOf?: string): Promise<DeckJson> => {
    const res = await fetch("/api/decks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, duplicateOf }),
    });
    return j<{ deck: DeckJson }>(res).deck;
  },

  deleteDeck: async (deckId: string): Promise<void> => {
    const res = await fetch(`/api/decks/${deckId}`, { method: "DELETE" });
    await j<{ ok: boolean }>(res);
  },

  readFile: async (deckId: string, path: string): Promise<string> => {
    const res = await fetch(`/api/decks/${deckId}/files?path=${encodeURIComponent(path)}`, { cache: "no-store" });
    const body = await j<{ content?: string }>(res);
    if (typeof body.content !== "string") throw new Error("Empty file response");
    return body.content;
  },

  saveFile: async (deckId: string, path: string, content: string): Promise<string> => {
    const res = await fetch(`/api/decks/${deckId}/files`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, content }),
    });
    return j<{ signature: string }>(res).signature;
  },

  deleteFile: async (deckId: string, path: string): Promise<void> => {
    const res = await fetch(`/api/decks/${deckId}/files?path=${encodeURIComponent(path)}`, { method: "DELETE" });
    await j(res);
  },

  addSlide: async (
    deckId: string,
    opts: { template?: string; label?: string; position?: number; code?: string },
  ): Promise<DeckJson> => {
    const res = await fetch(`/api/decks/${deckId}/slides`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts),
    });
    return j<{ deck: DeckJson }>(res).deck;
  },

  patchSlide: async (
    deckId: string,
    slideId: string,
    patch: { label?: string; theme?: ThemeMode | null; bg?: Source; overlay?: Source },
  ): Promise<DeckJson> => {
    const res = await fetch(`/api/decks/${deckId}/slides/${slideId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    return j<{ deck: DeckJson }>(res).deck;
  },

  deleteSlide: async (deckId: string, slideId: string): Promise<DeckJson> => {
    const res = await fetch(`/api/decks/${deckId}/slides/${slideId}`, { method: "DELETE" });
    return j<{ deck: DeckJson }>(res).deck;
  },

  duplicateSlide: async (deckId: string, slideId: string): Promise<DeckJson> => {
    const res = await fetch(`/api/decks/${deckId}/slides/${slideId}/duplicate`, { method: "POST" });
    return j<{ deck: DeckJson }>(res).deck;
  },

  reorder: async (deckId: string, order: string[]): Promise<DeckJson> => {
    const res = await fetch(`/api/decks/${deckId}/reorder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order }),
    });
    return j<{ deck: DeckJson }>(res).deck;
  },

  patchDeck: async (
    deckId: string,
    patch: { title?: string; bg?: Source; overlay?: Source; settings?: Partial<DeckJson["settings"]> },
  ): Promise<DeckJson> => {
    const res = await fetch(`/api/decks/${deckId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    return j<{ deck: DeckJson }>(res).deck;
  },

  poll: async (deckId: string): Promise<string> => {
    const res = await fetch(`/api/decks/${deckId}/poll`, { cache: "no-store" });
    return (await j<{ signature?: string }>(res)).signature ?? "";
  },

  listAssets: async (deckId: string): Promise<FileRow[]> => {
    const res = await fetch(`/api/decks/${deckId}/assets`, { cache: "no-store" });
    return (await j<{ assets?: FileRow[] }>(res)).assets ?? [];
  },

  uploadAssets: async (deckId: string, files: File[]): Promise<Array<{ path: string }>> => {
    const form = new FormData();
    for (const f of files) form.append("file", f);
    const res = await fetch(`/api/decks/${deckId}/assets`, { method: "POST", body: form });
    return j<{ uploaded: Array<{ path: string }> }>(res).uploaded;
  },

  listSnapshots: async (deckId: string): Promise<string[]> => {
    const res = await fetch(`/api/decks/${deckId}/snapshots`, { cache: "no-store" });
    return (await j<{ snapshots?: string[] }>(res)).snapshots ?? [];
  },

  snapshot: async (deckId: string, tag: string): Promise<string> => {
    const res = await fetch(`/api/decks/${deckId}/snapshots`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create", tag }),
    });
    return j<{ name: string }>(res).name;
  },

  restoreSnapshot: async (deckId: string, name: string): Promise<void> => {
    const res = await fetch(`/api/decks/${deckId}/snapshots`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "restore", name }),
    });
    await j(res);
  },

  importFile: async (file: File): Promise<{ deckId: string; slides: number; files: number; warnings: string[] }> => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/import", { method: "POST", body: form });
    return j(res);
  },

  importText: async (text: string, name: string): Promise<{ deckId: string; slides: number; files: number; warnings: string[] }> => {
    const res = await fetch("/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, name }),
    });
    return j(res);
  },

  exportUrl: (deckId: string, format: "smdeck" | "deck.tsx") =>
    `/api/decks/${deckId}/export?format=${encodeURIComponent(format)}`,
};
