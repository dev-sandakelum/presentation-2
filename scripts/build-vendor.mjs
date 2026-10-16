#!/usr/bin/env node
/**
 * Build the ESM vendor bundles served to the sandboxed Stage Runtime
 * (public/vendor/*.js → /api/vendor/[file]).
 *
 *   node scripts/build-vendor.mjs              → rebuild stagesmith.js only (fast)
 *   node scripts/build-vendor.mjs --all        → rebuild every vendor bundle
 *
 * The runtime's import map (public/runtime.html) maps bare specifiers to
 * these files, so every bundle must keep bare `react` imports EXTERNAL —
 * there must be exactly ONE React instance across all frames.
 */
import { build } from "esbuild";
import { mkdir } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "public", "vendor");
const all = process.argv.includes("--all");

/** react-dom is CJS and require()s react at runtime — shim it to the ESM react */
const REACT_DOM_BANNER = `import * as __react_esm from "react";
const require = (id) => {
  if (id === "react") return __react_esm.default ?? __react_esm;
  throw new Error("Cannot require '" + id + "' at runtime");
};
`;

const COMMON = {
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2020",
  minify: true,
  logLevel: "info",
  legalComments: "none",
};

async function main() {
  await mkdir(outDir, { recursive: true });

  // stagesmith — compiled from src/vendor-src, react stays a bare external
  await build({
    ...COMMON,
    entryPoints: [path.join(root, "src/vendor-src/stagesmith.tsx")],
    outfile: path.join(outDir, "stagesmith.js"),
    jsx: "automatic",
    external: ["react", "react/jsx-runtime", "react-dom/client"],
  });
  console.log("✓ stagesmith.js");

  if (!all) {
    console.log("done (--all to rebuild react/react-dom/lucide too)");
    return;
  }

  // react — named exports + default
  await build({
    ...COMMON,
    stdin: {
      contents: `import * as R from "react";\nexport default R.default ?? R;\nexport * from "react";\n`,
      resolveDir: root,
      loader: "js",
    },
    outfile: path.join(outDir, "react.js"),
  });
  console.log("✓ react.js");

  // react/jsx-runtime
  await build({
    ...COMMON,
    stdin: {
      contents: `import * as J from "react/jsx-runtime";\nexport default J.default ?? J;\nexport * from "react/jsx-runtime";\n`,
      resolveDir: root,
      loader: "js",
    },
    outfile: path.join(outDir, "react-jsx-runtime.js"),
  });
  console.log("✓ react-jsx-runtime.js");

  // react-dom/client — with the require-shim banner (single React instance)
  await build({
    ...COMMON,
    banner: { js: REACT_DOM_BANNER },
    stdin: {
      contents: `import * as D from "react-dom/client";\nexport default D.default ?? D;\nexport const createRoot = D.createRoot;\nexport const hydrateRoot = D.hydrateRoot;\n`,
      resolveDir: root,
      loader: "js",
    },
    outfile: path.join(outDir, "react-dom.js"),
  });
  console.log("✓ react-dom.js");

  // lucide-react — full bundle with named exports
  await build({
    ...COMMON,
    stdin: {
      contents: `import * as L from "lucide-react";\nexport default L.default ?? L;\nexport * from "lucide-react";\n`,
      resolveDir: root,
      loader: "js",
    },
    outfile: path.join(outDir, "lucide-react.js"),
  });
  console.log("✓ lucide-react.js");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
