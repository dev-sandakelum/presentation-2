/* Smoke-test the compile pipeline on the seed deck (run: node scripts/test-compile.mjs) */
import { build } from "esbuild";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

const DECK = "nextjs-unlocked";
const ROOT = path.join(process.cwd(), "decks", DECK);

const BARE_ALLOWED = new Set(["react", "react/jsx-runtime", "react-dom/client", "stagesmith", "lucide-react"]);
const IMAGE_EXT = [".png", ".jpg", ".jpeg", ".svg", ".webp", ".gif", ".avif"];
const cache = new Map();
const building = new Set();

async function sha(s) {
  return crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);
}

async function existsFile(abs) {
  try {
    return (await fs.stat(abs)).isFile();
  } catch {
    return false;
  }
}

async function resolveExt(base) {
  const tries = [base, base + ".tsx", base + ".ts", base + ".jsx", base + ".js", base + "/index.tsx", base + "/index.ts", base + "/index.jsx", base + "/index.js"];
  for (const t of tries) if (await existsFile(t)) return t;
  return null;
}

async function compileFile(file) {
  const key = DECK + ":" + file;
  const abs = path.join(ROOT, file);
  const src = await fs.readFile(abs, "utf8");
  const hash = await sha(src);
  const cached = cache.get(key);
  if (cached && cached.hash === hash && !cached.error) return cached;

  const deps = [];
  const resolver = {
    name: "stagesmith-resolver",
    setup(build) {
      build.onResolve({ filter: /^[^./@][^:*]*$/ }, (args) => {
        if (BARE_ALLOWED.has(args.path)) return { path: args.path, external: true };
        return { errors: [{ text: `Import "${args.path}" is not allowed` }] };
      });
      const intern = async (target) => {
        const rel = path.relative(ROOT, target).split(path.sep).join("/");
        if (IMAGE_EXT.includes(path.extname(target))) {
          return { errors: [{ text: `use <Img> instead: ${rel}` }] };
        }
        if (path.extname(target) === ".css") {
          deps.push({ path: rel, ver: await sha(await fs.readFile(target, "utf8")) });
          return { path: rel, namespace: "ss-css" };
        }
        let ver;
        if (building.has(rel)) {
          ver = await sha(await fs.readFile(target, "utf8"));
        } else {
          ver = (await compileFile(rel)).ver;
        }
        deps.push({ path: rel, ver });
        return { path: `/api/compile?deck=${DECK}&file=${rel}&v=${ver}`, external: true };
      };
      build.onResolve({ filter: /^@\// }, async (args) => {
        const target = await resolveExt(path.join(ROOT, args.path.slice(2)));
        if (!target) return { errors: [{ text: `Cannot resolve ${args.path}` }] };
        return intern(target);
      });
      build.onResolve({ filter: /^\.\.?(\/|$)/ }, async (args) => {
        const target = await resolveExt(path.resolve(path.dirname(abs), args.path));
        if (!target) return { errors: [{ text: `Cannot resolve ${args.path}` }] };
        return intern(target);
      });
    },
  };

  building.add(key);
  try {
    const result = await build({
      entryPoints: [abs],
      bundle: true,
      write: false,
      format: "esm",
      jsx: "automatic",
      target: "es2020",
      logLevel: "silent",
      external: [...BARE_ALLOWED],
      plugins: [
        resolver,
        {
          name: "ss-css-empty",
          setup(b) {
            b.onLoad({ filter: /.*/, namespace: "ss-css" }, () => ({ contents: "export default {}", loader: "js" }));
          },
        },
      ],
      loader: { ".tsx": "tsx", ".ts": "ts", ".jsx": "jsx", ".js": "js" },
    });
    const js = result.outputFiles[0].text;
    const entry = { hash, ver: await sha(js), js, deps, steps: detectSteps(src) };
    cache.set(key, entry);
    return entry;
  } catch (e) {
    const msg =
      e.errors?.length
        ? e.errors.map((er) => (er.location ? `${path.basename(er.location.file)}:${er.location.line}:${er.location.column} — ${er.text}` : er.text)).join("\n")
        : String(e.message || e);
    const entry = { hash, ver: "err-" + hash, js: "", error: msg, deps: [] };
    cache.set(key, entry);
    return entry;
  } finally {
    building.delete(key);
  }
}

function detectSteps(src) {
  let max = 1;
  for (const m of src.matchAll(/useStep\(\s*(\d+)\s*\)/g)) max = Math.max(max, parseInt(m[1], 10));
  for (const m of src.matchAll(/<Step\s+at=\{?\s*(\d+)\s*\}?/g)) max = Math.max(max, parseInt(m[1], 10) + 1);
  return max;
}

const deck = JSON.parse(await fs.readFile(path.join(ROOT, "deck.json"), "utf8"));
let fails = 0;
for (const f of ["bg/common.tsx", "overlay/common.tsx", "shared/icons.tsx", ...deck.slides.map((s) => `slides/${s.id}.tsx`)]) {
  const entry = await compileFile(f);
  const status = entry.error ? "FAIL" : "ok";
  if (entry.error) fails++;
  console.log(`${status === "ok" ? "✓" : "✗"} ${f} — ${status}${entry.error ? "\n   " + entry.error.split("\n")[0] : ` ver=${entry.ver} steps=${entry.steps} deps=${entry.deps.length} bytes=${entry.js.length}`}`);
}
console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
