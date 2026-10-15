import fs from "fs/promises";
import path from "path";
import JSZip from "jszip";
import { createDeckFolder, deckExists, slugify } from "@/lib/stagesmith/store";
import { starterDeckFiles } from "@/lib/stagesmith/templates";
import type { DeckJson } from "@/lib/stagesmith/types";

const DECKS_ROOT = path.join(process.cwd(), "decks");

/* load safety (plan §9) */
const MAX_ENTRIES = 10000;
const MAX_TOTAL = 2 * 1024 * 1024 * 1024; // 2 GiB
const MAX_ENTRY = 200 * 1024 * 1024; // 200 MB

export interface ImportReport {
  deckId: string;
  slides: number;
  files: number;
  warnings: string[];
}

async function uniqueId(base: string): Promise<string> {
  let id = slugify(base, "deck");
  let n = 2;
  while (await deckExists(id)) {
    id = `${slugify(base, "deck")}-${n}`;
    n++;
  }
  return id;
}

function checkEntryPath(p: string): boolean {
  if (!p || p.length > 200) return false;
  if (p.includes("\\") || p.includes("\0")) return false;
  if (p.startsWith("/") || path.isAbsolute(p)) return false;
  const parts = p.split("/");
  return !parts.some((s) => s === "" || s === "." || s === "..");
}

/** parse `// @file <path>` sections from AI text (plan §9) */
export function parseDeckTsx(text: string): { files: Record<string, string>; warnings: string[] } {
  const warnings: string[] = [];
  const files: Record<string, string> = {};
  const lines = text.split("\n");
  let current: string | null = null;
  const buckets = new Map<string, string[]>();
  for (const line of lines) {
    const m = line.match(/^\/\/\s*@file\s+(.+)$/);
    if (m) {
      current = m[1].trim().replace(/^\.?\//, "");
      if (!checkEntryPath(current)) {
        warnings.push(`Skipped illegal path "${current}"`);
        current = null;
      } else if (!buckets.has(current)) {
        buckets.set(current, []);
      }
    } else if (current !== null) {
      buckets.get(current)!.push(line);
    } else if (line.trim()) {
      warnings.push("Text before the first // @file marker was ignored");
    }
  }
  for (const [p, ls] of buckets) files[p] = ls.join("\n");
  return { files, warnings };
}

async function importZip(buf: Buffer, baseName: string): Promise<{ files: Record<string, string>; report: ImportReport }> {
  const warnings: string[] = [];
  const zip = await JSZip.loadAsync(buf);
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
  if (names.length > MAX_ENTRIES) throw new Error(`Zip has too many entries (${names.length} > ${MAX_ENTRIES})`);
  let total = 0;
  const files: Record<string, string> = {};
  for (const name of names) {
    if (!checkEntryPath(name)) {
      warnings.push(`Skipped illegal entry "${name}"`);
      continue;
    }
    const entry = zip.files[name];
    if (entry.name.endsWith("/")) continue;
    const content = await entry.async("nodebuffer");
    total += content.length;
    if (total > MAX_TOTAL) throw new Error("Zip total size exceeds 2 GiB limit (zip bomb protection)");
    if (content.length > MAX_ENTRY) throw new Error(`Entry "${name}" exceeds 200 MB`);
    files[name] = content.toString("utf8");
  }
  if (!files["deck.json"]) {
    // maybe nested one level
    const nested = Object.keys(files).find((n) => n.endsWith("/deck.json") && n.split("/").length === 2);
    if (nested) {
      const prefix = nested.slice(0, -"deck.json".length);
      for (const k of Object.keys(files)) {
        files[k.slice(prefix.length)] = files[k];
        delete files[k];
      }
    } else {
      throw new Error("No deck.json found — this is not a .smdeck archive");
    }
  }
  const deck = JSON.parse(files["deck.json"]) as DeckJson;
  const deckId = await uniqueId(baseName || deck.title || "imported-deck");
  const created = await createDeckFolder(deckId, deck.title || baseName, files);
  return { files, report: { deckId, slides: created.slides.length, files: Object.keys(files).length, warnings } };
}

async function importDeckTsx(text: string, baseName: string): Promise<{ report: ImportReport }> {
  const { files: parsed, warnings } = parseDeckTsx(text);
  const hasSlides = Object.keys(parsed).some((p) => p.startsWith("slides/"));
  if (!hasSlides) {
    // bare slide / single component text → new deck with one custom slide
    const deckId = await uniqueId(baseName || "ai-deck");
    const scaffold = starterDeckFiles(baseName || "AI deck");
    const deck = JSON.parse(scaffold["deck.json"]) as DeckJson;
    const slideId = slugify(baseName || "imported", "slide");
    deck.slides = [{ id: slideId, label: baseName || "Imported slide" }];
    scaffold["deck.json"] = JSON.stringify(deck, null, 2);
    delete scaffold["slides/title.tsx"];
    delete scaffold["slides/end.tsx"];
    scaffold[`slides/${slideId}.tsx`] = text;
    await createDeckFolder(deckId, baseName || "AI deck", scaffold);
    return { report: { deckId, slides: 1, files: Object.keys(scaffold).length, warnings } };
  }

  // has @file sections: build deck.json if absent
  const files = { ...parsed };
  let deck: DeckJson;
  if (files["deck.json"]) {
    deck = JSON.parse(files["deck.json"]);
  } else {
    const slideIds = Object.keys(files)
      .filter((p) => p.startsWith("slides/") && p.endsWith(".tsx"))
      .map((p) => path.basename(p, ".tsx"));
    deck = JSON.parse(starterDeckFiles(baseName)["deck.json"]) as DeckJson;
    deck.slides = slideIds.map((id) => ({ id, label: id.replace(/[-_]/g, " ").replace(/^\w/, (c) => c.toUpperCase()) }));
    files["deck.json"] = JSON.stringify(deck, null, 2);
    if (!files["theme.css"]) files["theme.css"] = starterDeckFiles(baseName)["theme.css"];
  }
  if (!files["theme.css"]) {
    files["theme.css"] = starterDeckFiles(baseName)["theme.css"];
    warnings.push("No theme.css found — the default theme was applied");
  }
  const deckId = await uniqueId(baseName || deck.title || "imported-deck");
  const created = await createDeckFolder(deckId, deck.title || baseName, files);
  return { report: { deckId, slides: created.slides.length, files: Object.keys(files).length, warnings } };
}

/** POST /api/import — multipart (file) or JSON {text, name} */
export async function POST(req: Request) {
  try {
    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) return Response.json({ error: "No file uploaded" }, { status: 400 });
      const buf = Buffer.from(await file.arrayBuffer());
      const baseName = file.name.replace(/\.(smdeck|zip|deck\.tsx|tsx|txt)$/i, "");
      if (/\.(smdeck|zip)$/i.test(file.name)) {
        const { report } = await importZip(buf, baseName);
        return Response.json({ report });
      }
      const text = buf.toString("utf8");
      const { report } = await importDeckTsx(text, baseName);
      return Response.json({ report });
    }
    const body = await req.json();
    const text = String(body.text || "");
    const name = String(body.name || "AI deck");
    if (!text.trim()) return Response.json({ error: "Nothing to import" }, { status: 400 });
    const { report } = await importDeckTsx(text, name);
    return Response.json({ report });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
