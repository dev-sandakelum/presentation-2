import { readFile, stat } from "fs/promises";
import path from "path";

let cachedVer: { ver: string; at: number } | null = null;

/** vendor build fingerprint (mtime of the bundles) → cache-busted import map */
async function vendorVer(): Promise<string> {
  if (cachedVer && Date.now() - cachedVer.at < 30_000) return cachedVer.ver;
  const dir = path.join(process.cwd(), "public", "vendor");
  let h = 0;
  for (const f of ["react.js", "react-jsx-runtime.js", "react-dom.js", "stagesmith.js", "lucide-react.js"]) {
    try {
      const st = await stat(path.join(dir, f));
      h = Math.max(h, Math.floor(st.mtimeMs));
    } catch {
      h += 1;
    }
  }
  cachedVer = { ver: String(h), at: Date.now() };
  return cachedVer.ver;
}

/** GET /runtime?f=<frameId> — the sandboxed Stage Runtime document */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const frameId = url.searchParams.get("f") || "boot";
  const ver = await vendorVer();
  const template = await readFile(path.join(process.cwd(), "public", "runtime.html"), "utf8");
  const html = template
    .replace(/__V__/g, ver)
    .replace(/<title>Stagesmith Stage Runtime<\/title>/, `<title>Stage ${frameId}</title>`);
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
