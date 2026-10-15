/**
 * Builds the ESM vendor bundles served to the sandboxed Stage Runtime
 * (import map targets). Run: node scripts/build-vendor.mjs
 *
 * Shims guarantee NAMED exports (esbuild's CJS->ESM default-only output
 * breaks `import { useState } from "react"`), and react stays external
 * in react-dom so every module shares one React instance.
 */
import { build } from "esbuild";
import { mkdirSync, writeFileSync } from "fs";
import path from "path";

const OUT = path.join(process.cwd(), "public", "vendor");
const SHIMS = path.join(process.cwd(), "scripts", "shims");
mkdirSync(OUT, { recursive: true });
mkdirSync(SHIMS, { recursive: true });

const common = {
  format: "esm",
  bundle: true,
  minify: true,
  sourcemap: false,
  logLevel: "warning",
  legalComments: "none",
};

// ---- react: fully bundled, named re-exports ----
writeFileSync(
  path.join(SHIMS, "react-shim.mjs"),
  `import React from "react";
export default React;
export const {
  useState, useEffect, useMemo, useRef, useCallback, useContext, useReducer,
  useLayoutEffect, useImperativeHandle, useInsertionEffect, useSyncExternalStore,
  useTransition, useDeferredValue, useOptimistic, useActionState, useId,
  useDebugValue, use, cache, startTransition,
  createContext, createElement, cloneElement, isValidElement, createRef,
  forwardRef, memo, lazy, Suspense, Fragment, StrictMode, Profiler,
  Children, Component, PureComponent, version,
} = React;
`,
);

// ---- react-dom/client: react EXTERNAL (shared instance) ----
writeFileSync(
  path.join(SHIMS, "react-dom-shim.mjs"),
  `import * as client from "react-dom/client";
export default client;
export const createRoot = client.createRoot;
export const hydrateRoot = client.hydrateRoot;
`,
);

// ---- react/jsx-runtime: standalone, named re-exports ----
writeFileSync(
  path.join(SHIMS, "jsx-runtime-shim.mjs"),
  `import runtime from "react/jsx-runtime";
export default runtime;
export const { jsx, jsxs, Fragment } = runtime;
`,
);

console.log("react…");
await build({ ...common, entryPoints: [path.join(SHIMS, "react-shim.mjs")], outfile: path.join(OUT, "react.js") });

console.log("react/jsx-runtime…");
await build({ ...common, entryPoints: [path.join(SHIMS, "jsx-runtime-shim.mjs")], outfile: path.join(OUT, "react-jsx-runtime.js") });

console.log("react-dom/client…");
await build({
  ...common,
  entryPoints: [path.join(SHIMS, "react-dom-shim.mjs")],
  external: ["react"],
  // react-dom's CJS internals call require("react"); provide it from the
  // import map so there is exactly one React instance.
  banner: {
    js: `import * as __react_esm from "react";
const require = (id) => {
  if (id === "react") return __react_esm.default ?? __react_esm;
  throw new Error("Cannot require '" + id + "' at runtime");
};`,
  },
  outfile: path.join(OUT, "react-dom.js"),
});

console.log("stagesmith runtime…");
await build({
  ...common,
  entryPoints: ["src/vendor-src/stagesmith.tsx"],
  external: ["react", "react/jsx-runtime"],
  jsx: "automatic",
  outfile: path.join(OUT, "stagesmith.js"),
});

console.log("lucide-react…");
await build({
  ...common,
  entryPoints: ["lucide-react"],
  external: ["react", "react/jsx-runtime"],
  outfile: path.join(OUT, "lucide-react.js"),
});

console.log("Vendor bundles written to public/vendor/");
