import fs from "fs";
import path from "path";

/**
 * External project registry.
 *
 * Stagesmith projects normally live under decks/<id>/, but a project created
 * via "New project…" can be placed anywhere on disk. Those folders are linked
 * into the library through decks/.registry.json:
 *
 *   { "links": { "<deckId>": "<absolute project folder>" } }
 *
 * The cache is loaded synchronously (deckPath must stay sync) and refreshed
 * after every mutation done by this process. Only directories are ever
 * exposed — the registry never points at files.
 */

const REGISTRY_PATH = path.join(process.cwd(), "decks", ".registry.json");
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

interface RegistryFile {
  links?: Record<string, string>;
}

let linksCache: Record<string, string> | null = null;
let cacheAt = 0;

/** dev-mode route bundles get separate module instances — re-read from disk
 *  after this TTL so every instance converges on the same links */
const CACHE_TTL_MS = 1000;

function loadSync(): Record<string, string> {
  const now = Date.now();
  if (linksCache && now - cacheAt < CACHE_TTL_MS) return linksCache;
  try {
    const raw = fs.readFileSync(REGISTRY_PATH, "utf8");
    const parsed = JSON.parse(raw) as RegistryFile;
    const links =
      parsed.links && typeof parsed.links === "object" ? { ...parsed.links } : {};
    // only keep sane entries
    linksCache = {};
    for (const [id, root] of Object.entries(links)) {
      if (ID_RE.test(id) && typeof root === "string" && path.isAbsolute(root)) {
        linksCache[id] = path.resolve(root);
      }
    }
    cacheAt = now;
  } catch {
    linksCache = {};
    cacheAt = now;
  }
  return linksCache;
}

function persist(next: Record<string, string>): void {
  fs.mkdirSync(path.dirname(REGISTRY_PATH), { recursive: true });
  const tmp = `${REGISTRY_PATH}.tmp-${Date.now()}-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify({ links: next }, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, REGISTRY_PATH);
  linksCache = { ...next };
  cacheAt = Date.now();
}

/** all links, shallow-copied */
export function listLinks(): Record<string, string> {
  return { ...loadSync() };
}

/** resolve the on-disk folder of a deckId (linked root or decks/<id>) */
export function deckRootOf(deckId: string, decksRoot: string): string {
  const link = loadSync()[deckId];
  if (link) return link;
  return path.join(decksRoot, deckId);
}

/** true when this deckId is an external, linked project */
export function isLinked(deckId: string): boolean {
  return deckId in loadSync();
}

/** register an existing project folder under a deck id */
export function linkDeck(deckId: string, absRoot: string): void {
  if (!ID_RE.test(deckId)) throw new Error("Invalid deck id");
  const target = path.resolve(absRoot);
  const st = fs.statSync(target);
  if (!st.isDirectory()) throw new Error(`Not a folder: ${target}`);
  const next = loadSync();
  next[deckId] = target;
  persist(next);
}

/** remove a link (files on disk are untouched); returns true when a link existed */
export function unlinkDeck(deckId: string): boolean {
  const cur = loadSync();
  if (!(deckId in cur)) return false;
  delete cur[deckId];
  persist(cur);
  return true;
}

/** re-read from disk (e.g. after an external change) */
export function refreshLinks(): void {
  linksCache = null;
  loadSync();
}

export function registryFilePath(): string {
  return REGISTRY_PATH;
}
