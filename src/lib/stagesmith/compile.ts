import * as esbuild from "esbuild";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { DECKS_ROOT, deckPath } from "./store";

/**
 * Compile a deck TSX/TS file to an ESM module the sandboxed Stage Runtime
 * can import. Allowed imports (plan §5.1): react, react-dom/client,
 * react/jsx-runtime, stagesmith, lucide-react, @/... (deck root) and
 * relative files inside the deck.
 *
 * Versioning: ver = SHA-256 of the OUTPUT. Dep URLs are embedded with the
 * dep's own ver, so any transitive change produces a new output → new ver →
 * new URL → fresh module in every runtime.
 */

const BARE_ALLOWED = new Set([
  "react",
  "react/jsx-runtime",
  "react-dom/client",
  "stagesmith",
  "lucide-react",
]);

const COMPILABLE_EXT = [".tsx", ".ts", ".jsx", ".js"];
const IMAGE_EXT = [".png", ".jpg", ".jpeg", ".svg", ".webp", ".gif", ".avif"];

export interface CacheEntry {
  /** sha of the source file */
  hash: string;
  /** sha of the output js — used as the public version */
  ver: string;
  js: string;
  steps: number;
  error?: string;
  deps: Array<{ path: string; ver: string }>;
}

const cache = new Map<string, CacheEntry>();
/** cycle guard while building */
const building = new Set<string>();

export function compileUrlFor(deckId: string, file: string, ver: string): string {
  return `/api/compile?deck=${encodeURIComponent(deckId)}&file=${encodeURIComponent(file)}&v=${ver}`;
}

async function sha(content: string | Buffer): Promise<string> {
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
}

async function existsFile(abs: string): Promise<boolean> {
  try {
    const st = await fs.stat(abs);
    return st.isFile();
  } catch {
    return false;
  }
}

async function resolveExt(base: string): Promise<string | null> {
  const tries = [
    base,
    `${base}.tsx`,
    `${base}.ts`,
    `${base}.jsx`,
    `${base}.js`,
    `${base}/index.tsx`,
    `${base}/index.ts`,
    `${base}/index.jsx`,
    `${base}/index.js`,
  ];
  for (const t of tries) {
    if (await existsFile(t)) return t;
  }
  return null;
}

/** literal step count detection (plan §5.3: dynamic counts come from the runtime) */
function detectSteps(src: string): number {
  let max = 1;
  for (const m of src.matchAll(/useStep\(\s*(\d+)\s*\)/g)) {
    max = Math.max(max, parseInt(m[1], 10));
  }
  for (const m of src.matchAll(/<Step\s+at=\{?\s*(\d+)\s*\}?/g)) {
    max = Math.max(max, parseInt(m[1], 10) + 1);
  }
  return max;
}

async function buildModule(
  deckId: string,
  file: string,
  abs: string,
): Promise<{ js: string; deps: Array<{ path: string; ver: string }> }> {
  const deps: Array<{ path: string; ver: string }> = [];
  const root = path.join(DECKS_ROOT, deckId);

  const resolver: esbuild.Plugin = {
    name: "stagesmith-resolver",
    setup(build) {
      // bare specifiers other than the allow-list fail loudly
      build.onResolve({ filter: /^[^./@][^:*]*$/ }, async (args) => {
        if (BARE_ALLOWED.has(args.path)) return { path: args.path, external: true };
        if (args.path === "react-dom") {
          return { errors: [{ text: `Import "react-dom" is not allowed — use "react-dom/client".` }] };
        }
        return {
          errors: [
            {
              text: `Import "${args.path}" is not allowed. Allowed: react, react-dom/client, stagesmith, lucide-react, @/… (deck files) and relative paths.`,
            },
          ],
        };
      });

      const intern = async (target: string): Promise<{ path: string; external: boolean } | { errors: unknown[] }> => {
        const rel = path.relative(root, target).split(path.sep).join("/");
        if (rel.startsWith("..") || path.isAbsolute(rel)) {
          return { errors: [{ text: `Import escapes the deck folder: ${rel}` }] };
        }
        if (IMAGE_EXT.includes(path.extname(target))) {
          return {
            errors: [
              {
                text: `Importing images is not supported — use <Img name='${rel}' /> from 'stagesmith' instead.`,
              },
            ],
          };
        }
        if (path.extname(target) === ".css") {
          deps.push({ path: rel, ver: await sha(await fs.readFile(target, "utf8")) });
          return { path: rel, namespace: "ss-css" };
        }
        // recursively compile the dep so we can embed its ver in the URL
        let ver: string;
        if (building.has(rel)) {
          ver = await sha(await fs.readFile(target, "utf8")); // cycle fallback
        } else {
          const depEntry = await compileFile(deckId, rel);
          ver = depEntry.ver;
        }
        deps.push({ path: rel, ver });
        return { path: compileUrlFor(deckId, rel, ver), external: true };
      };

      // @/ alias → deck root
      build.onResolve({ filter: /^@\// }, async (args) => {
        const rel = args.path.slice(2);
        const target = await resolveExt(path.join(root, rel));
        if (!target) {
          return { errors: [{ text: `Cannot resolve "${args.path}" — no such file in the deck folder.` }] };
        }
        return intern(target);
      });

      // relative paths inside the deck
      build.onResolve({ filter: /^\.\.?(\/|$)/ }, async (args) => {
        const importerDir = path.dirname(
          args.importer && args.importer.startsWith(DECKS_ROOT) ? args.importer : abs,
        );
        const target = await resolveExt(path.resolve(importerDir, args.path));
        if (!target) {
          return { errors: [{ text: `Cannot resolve "${args.path}" from ${file}.` }] };
        }
        return intern(target);
      });
    },
  };

  const result = await esbuild.build({
    entryPoints: [abs],
    bundle: true,
    write: false,
    format: "esm",
    jsx: "automatic",
    target: "es2020",
    logLevel: "silent",
    sourcemap: false,
    minify: false,
    external: [...BARE_ALLOWED],
    plugins: [
      resolver,
      {
        name: "ss-css-empty",
        setup(build) {
          build.onLoad({ filter: /.*/, namespace: "ss-css" }, () => ({
            contents: "export default {}",
            loader: "js",
          }));
        },
      },
    ],
    loader: {
      ".tsx": "tsx",
      ".ts": "ts",
      ".jsx": "jsx",
      ".js": "js",
    },
  });

  const js = result.outputFiles?.[0]?.text ?? "";
  return { js, deps };
}

export async function compileFile(deckId: string, file: string): Promise<CacheEntry> {
  const key = `${deckId}:${file}`;
  const abs = deckPath(deckId, file);
  const ext = path.extname(file);
  if (!COMPILABLE_EXT.includes(ext)) throw new Error("Only .tsx/.ts/.js/.jsx files can be compiled");
  const src = await fs.readFile(abs, "utf8");
  const hash = await sha(src);

  const cached = cache.get(key);
  if (cached && cached.hash === hash && !cached.error) {
    // verify embedded dep versions are still current (recursive, cached)
    let fresh = true;
    for (const d of cached.deps) {
      try {
        const depEntry = await compileFile(deckId, d.path);
        if (depEntry.ver !== d.ver) {
          fresh = false;
          break;
        }
      } catch {
        fresh = false;
        break;
      }
    }
    if (fresh) return cached;
  }

  building.add(key);
  try {
    const { js, deps } = await buildModule(deckId, file, abs);
    const ver = await sha(js);
    const entry: CacheEntry = { hash, ver, js, deps, steps: detectSteps(src) };
    cache.set(key, entry);
    return entry;
  } catch (e: unknown) {
    const err = e as {
      errors?: Array<{ text?: string; location?: { file?: string; line?: number; column?: number } }>;
    };
    const error =
      err.errors && err.errors.length
        ? err.errors
            .map((er) =>
              er.location
                ? `${path.basename(er.location.file || file)}:${er.location.line}:${er.location.column} — ${er.text}`
                : er.text || "Compile error",
            )
            .join("\n")
        : String((e as Error)?.message || e);
    const entry: CacheEntry = { hash, ver: `err-${hash}`, js: "", steps: 1, error, deps: [] };
    cache.set(key, entry);
    return entry;
  } finally {
    building.delete(key);
  }
}
