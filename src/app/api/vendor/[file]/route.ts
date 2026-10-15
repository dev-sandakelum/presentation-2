import { readFile } from "fs/promises";
import path from "path";

const ALLOWED = new Set([
  "react.js",
  "react-dom.js",
  "react-jsx-runtime.js",
  "stagesmith.js",
  "lucide-react.js",
]);

const JS_TYPE = "application/javascript; charset=utf-8";

/**
 * Serves the ESM vendor bundles to the sandboxed Stage Runtime
 * (opaque origin) with CORS + caching.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const { file } = await params;
  if (!ALLOWED.has(file)) {
    return Response.json({ error: "Unknown vendor module" }, { status: 404 });
  }
  const abs = path.join(process.cwd(), "public", "vendor", file);
  const versioned = new URL(req.url).searchParams.has("v");
  try {
    const body = await readFile(abs);
    return new Response(body, {
      headers: {
        "Content-Type": JS_TYPE,
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": versioned ? "public, max-age=31536000, immutable" : "no-store",
      },
    });
  } catch {
    return Response.json(
      { error: "Vendor module missing — run scripts/build-vendor.mjs" },
      { status: 500 },
    );
  }
}
