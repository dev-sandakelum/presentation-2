import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import type { DeckJson, DeckSummary, FileRow, SlideEntry, Source } from "./types";

/**
 * Stagesmith deck store — the folder IS the project (plan §2).
 * No hidden database: everything lives under decks/<id>/.
 */

export const DECKS_ROOT = path.join(process.cwd(), "decks");

const MAX_PATH = 200;
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/* ---------------- path rules (plan §4) ---------------- */

export function validRelPath(p: string): boolean {
  if (!p || p.length > MAX_PATH) return false;
  if (p.includes("\\") || p.includes("\0")) return false;
  if (path.isAbsolute(p) || p.startsWith("/")) return false;
  const parts = p.split("/");
  if (parts.some((s) => s === "" || s === "." || s === "..")) return false;
  // unique ignoring case (checked by callers against siblings)
  return true;
}

/** join a deck-relative path safely, or throw */
export function deckPath(deckId: string, rel: string): string {
  if (!validRelPath(rel)) throw new Error(`Illegal path: ${rel}`);
  const root = path.join(DECKS_ROOT, deckId);
  const full = path.resolve(root, rel);
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new Error(`Path escapes deck folder: ${rel}`);
  }
  return full;
}

export function validDeckId(id: string): boolean {
  return ID_RE.test(id);
}

/* ---------------- atomic writes (plan §2) ---------------- */

export async function writeFileAtomic(absPath: string, content: string) {
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  const tmp = `${absPath}.tmp-${crypto.randomBytes(4).toString("hex")}`;
  await fs.writeFile(tmp, content, "utf8");
  await fs.rename(tmp, absPath);
}

export async function writeDeckJson(deckId: string, deck: DeckJson) {
  deck.modified = new Date().toISOString();
  const p = deckPath(deckId, "deck.json");
  await writeFileAtomic(p, JSON.stringify(deck, null, 2) + "\n");
}

/* ---------------- hashing / signature ---------------- */

export async function hashFile(absPath: string): Promise<string> {
  const buf = await fs.readFile(absPath);
  return crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16);
}

/** walk a deck folder, collecting all files (excluding .stagesmith cache) */
async function walk(root: string, rel = "", acc: FileRow[] = []): Promise<FileRow[]> {
  const entries = await fs.readdir(path.join(root, rel), { withFileTypes: true });
  for (const e of entries) {
    if (e.name === ".stagesmith" || e.name === ".tmp-*" || e.name.startsWith(".tmp-")) continue;
    const relPath = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) await walk(root, relPath, acc);
    else if (e.isFile()) {
      const st = await fs.stat(path.join(root, relPath));
      acc.push({ path: relPath, mtime: st.mtimeMs, size: st.size });
    }
  }
  return acc;
}

export async function deckFiles(deckId: string): Promise<FileRow[]> {
  const root = path.join(DECKS_ROOT, deckId);
  try {
    return await walk(root);
  } catch {
    return [];
  }
}

export async function deckSignature(deckId: string): Promise<string> {
  const files = await deckFiles(deckId);
  const h = crypto.createHash("sha256");
  for (const f of files) {
    h.update(f.path);
    h.update(String(f.size));
    h.update(String(Math.floor(f.mtime)));
  }
  return h.digest("hex").slice(0, 16);
}

/* ---------------- read / list ---------------- */

export async function readDeck(deckId: string): Promise<DeckJson> {
  if (!validDeckId(deckId)) throw new Error(`Invalid deck id: ${deckId}`);
  const p = deckPath(deckId, "deck.json");
  const raw = await fs.readFile(p, "utf8");
  const deck = JSON.parse(raw) as DeckJson;
  if (deck.format !== "smdeck") throw new Error("Not a Stagesmith deck");
  return deck;
}

export async function deckExists(deckId: string): Promise<boolean> {
  try {
    await fs.access(path.join(DECKS_ROOT, deckId, "deck.json"));
    return true;
  } catch {
    return false;
  }
}

export async function listDecks(): Promise<DeckSummary[]> {
  let entries;
  try {
    entries = await fs.readdir(DECKS_ROOT, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: DeckSummary[] = [];
  for (const e of entries) {
    if (!e.isDirectory() || !validDeckId(e.name)) continue;
    try {
      const deck = await readDeck(e.name);
      out.push({
        id: deck.id,
        title: deck.title,
        slideCount: deck.slides.length,
        modified: deck.modified,
        signature: await deckSignature(e.name),
      });
    } catch {
      /* not a deck folder — skip */
    }
  }
  out.sort((a, b) => (a.modified < b.modified ? 1 : -1));
  return out;
}

export async function readFileInDeck(deckId: string, rel: string): Promise<string> {
  const p = deckPath(deckId, rel);
  return fs.readFile(p, "utf8");
}

/* ---------------- slide ids ---------------- */

export function slugify(label: string, fallback = "slide"): string {
  const s = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return s || fallback;
}

export async function uniqueSlideId(deck: DeckJson, base: string): Promise<string> {
  const taken = new Set(deck.slides.map((s) => s.id));
  let id = base;
  let n = 2;
  while (taken.has(id)) {
    id = `${base}-${n}`;
    n++;
  }
  return id;
}

/* ---------------- slide ops ---------------- */

export async function addSlide(
  deckId: string,
  entry: SlideEntry,
  code: string,
  position: number | null,
): Promise<DeckJson> {
  const deck = await readDeck(deckId);
  if (deck.slides.some((s) => s.id === entry.id)) throw new Error("Slide id already exists");
  const p = deckPath(deckId, `slides/${entry.id}.tsx`);
  await writeFileAtomic(p, code);
  const idx = position === null ? deck.slides.length : Math.max(0, Math.min(position, deck.slides.length));
  deck.slides.splice(idx, 0, entry);
  await writeDeckJson(deckId, deck); // index written last (plan §2)
  return deck;
}

export async function deleteSlide(deckId: string, slideId: string): Promise<DeckJson> {
  const deck = await readDeck(deckId);
  const idx = deck.slides.findIndex((s) => s.id === slideId);
  if (idx < 0) throw new Error("Slide not found");

  await snapshotDeck(deckId, `before-delete-${slideId}`);

  // collect override files referenced only by this slide
  const entry = deck.slides[idx];
  const overrideFiles: string[] = [];
  for (const src of [entry.bg, entry.overlay]) {
    if (src && (src.type === "code" || src.type === "html" || src.type === "image")) {
      overrideFiles.push(src.path);
    }
  }
  deck.slides.splice(idx, 1);
  for (const f of overrideFiles) {
    const isUsedElsewhere = deck.slides.some(
      (s) => (s.bg && "path" in s.bg && s.bg.path === f) || (s.overlay && "path" in s.overlay && s.overlay.path === f),
    );
    if (!isUsedElsewhere && (f.startsWith("bg/") || f.startsWith("overlay/"))) {
      try {
        await fs.rm(deckPath(deckId, f));
      } catch {
        /* best effort */
      }
    }
  }
  for (const f of [`slides/${slideId}.tsx`, `notes/${slideId}.md`]) {
    try {
      await fs.rm(deckPath(deckId, f));
    } catch {
      /* notes may not exist */
    }
  }
  await writeDeckJson(deckId, deck);
  return deck;
}

export async function duplicateSlide(deckId: string, slideId: string): Promise<DeckJson> {
  const deck = await readDeck(deckId);
  const idx = deck.slides.findIndex((s) => s.id === slideId);
  if (idx < 0) throw new Error("Slide not found");
  const src = deck.slides[idx];
  const newId = await uniqueSlideId(deck, `${src.id}-copy`);
  const code = await readFileInDeck(deckId, `slides/${src.id}.tsx`);
  await writeFileAtomic(deckPath(deckId, `slides/${newId}.tsx`), code);
  let notes: string | null = null;
  try {
    notes = await readFileInDeck(deckId, `notes/${src.id}.md`);
    await writeFileAtomic(deckPath(deckId, `notes/${newId}.md`), notes);
  } catch {
    /* no notes */
  }
  const copy: SlideEntry = { ...src, id: newId, label: `${src.label} (copy)` };
  // deep-copy overrides so a code override is duplicated, not shared
  for (const key of ["bg", "overlay"] as const) {
    const o = copy[key] as Source | undefined;
    if (o && o.type === "code") {
      const ext = path.extname(o.path);
      const newPath = `${path.dirname(o.path)}/${newId}${ext}`;
      try {
        const body = await readFileInDeck(deckId, o.path);
        await writeFileAtomic(deckPath(deckId, newPath), body);
        (copy[key] as Source) = { type: "code", path: newPath };
      } catch {
        /* keep shared */
      }
    }
  }
  deck.slides.splice(idx + 1, 0, copy);
  await writeDeckJson(deckId, deck);
  return deck;
}

export async function reorderSlides(deckId: string, order: string[]): Promise<DeckJson> {
  const deck = await readDeck(deckId);
  const have = new Set(deck.slides.map((s) => s.id));
  if (order.length !== deck.slides.length || order.some((id) => !have.has(id))) {
    throw new Error("Order must be a permutation of current slide ids");
  }
  const map = new Map(deck.slides.map((s) => [s.id, s]));
  deck.slides = order.map((id) => map.get(id)!);
  await writeDeckJson(deckId, deck);
  return deck;
}

export async function updateSlideEntry(
  deckId: string,
  slideId: string,
  patch: Partial<Pick<SlideEntry, "label" | "theme" | "bg" | "overlay">>,
): Promise<DeckJson> {
  const deck = await readDeck(deckId);
  const idx = deck.slides.findIndex((s) => s.id === slideId);
  if (idx < 0) throw new Error("Slide not found");
  deck.slides[idx] = { ...deck.slides[idx], ...patch };
  await writeDeckJson(deckId, deck);
  return deck;
}

export async function updateDeckMeta(
  deckId: string,
  patch: Partial<Pick<DeckJson, "title">> & {
    settings?: Partial<DeckJson["settings"]>;
    bg?: Source;
    overlay?: Source;
  },
): Promise<DeckJson> {
  const deck = await readDeck(deckId);
  if (patch.title !== undefined) deck.title = patch.title;
  if (patch.settings) deck.settings = { ...deck.settings, ...patch.settings };
  if (patch.bg !== undefined) deck.bg = patch.bg;
  if (patch.overlay !== undefined) deck.overlay = patch.overlay;
  await writeDeckJson(deckId, deck);
  return deck;
}

/* ---------------- snapshots (plan §6: last 10 per deck) ---------------- */

export async function snapshotDeck(deckId: string, tag: string): Promise<string> {
  const dir = deckPath(deckId, ".stagesmith/snapshots");
  await fs.mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const name = `${stamp}--${tag.replace(/[^a-z0-9-]/gi, "-").slice(0, 40)}`;
  const files = await deckFiles(deckId);
  const manifest: Record<string, string> = {};
  for (const f of files) {
    try {
      const abs = path.join(DECKS_ROOT, deckId, f.path);
      const body = await fs.readFile(abs);
      manifest[f.path] = body.toString("base64");
    } catch {
      /* skip unreadable */
    }
  }
  await writeFileAtomic(path.join(dir, `${name}.json`), JSON.stringify({ deckId, files: manifest }, null, 1));
  // keep last 10
  const snaps = (await fs.readdir(dir)).filter((f) => f.endsWith(".json")).sort();
  while (snaps.length > 10) {
    await fs.rm(path.join(dir, snaps.shift()!)).catch(() => {});
  }
  return name;
}

export async function listSnapshots(deckId: string): Promise<string[]> {
  try {
    const dir = deckPath(deckId, ".stagesmith/snapshots");
    return (await fs.readdir(dir)).filter((f) => f.endsWith(".json")).sort().reverse();
  } catch {
    return [];
  }
}

export async function restoreSnapshot(deckId: string, name: string): Promise<void> {
  if (!/^[0-9TZ-]+--[a-z0-9-]+$/i.test(name)) throw new Error("Bad snapshot name");
  const dir = deckPath(deckId, ".stagesmith/snapshots");
  const raw = await fs.readFile(path.join(dir, `${name}.json`), "utf8");
  const data = JSON.parse(raw) as { files: Record<string, string> };
  for (const [rel, b64] of Object.entries(data.files)) {
    if (!validRelPath(rel)) continue;
    await writeFileAtomic(deckPath(deckId, rel), Buffer.from(b64, "base64").toString("utf8"));
  }
}

/* ---------------- create deck ---------------- */

export async function createDeckFolder(
  deckId: string,
  title: string,
  files: Record<string, string>,
): Promise<DeckJson> {
  if (!validDeckId(deckId)) throw new Error("Deck id must be kebab-case");
  if (await deckExists(deckId)) throw new Error("A deck with this id already exists");
  const deck: DeckJson = JSON.parse(files["deck.json"]) as DeckJson;
  deck.id = deckId;
  deck.title = title || deck.title;
  deck.created = new Date().toISOString();
  const root = path.join(DECKS_ROOT, deckId);
  await fs.mkdir(root, { recursive: true });
  // write everything except the index first (plan §2: deck.json last)
  for (const [rel, content] of Object.entries(files)) {
    if (rel === "deck.json") continue;
    await writeFileAtomic(deckPath(deckId, rel), content);
  }
  await writeFileAtomic(path.join(root, "deck.json"), JSON.stringify(deck, null, 2) + "\n");
  return deck;
}

export async function deleteDeck(deckId: string): Promise<void> {
  if (!validDeckId(deckId)) throw new Error("Invalid deck id");
  await fs.rm(path.join(DECKS_ROOT, deckId), { recursive: true, force: true });
}
