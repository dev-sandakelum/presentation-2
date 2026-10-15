/**
 * In-browser TSX formatter (fix-list item 2).
 *
 * Prettier standalone + typescript/estree plugins, dynamically imported so
 * the parser code only loads when formatting actually happens. Formatting
 * is instant (no server round-trip) and best-effort: a file that cannot be
 * parsed (e.g. it contains the deliberate demo error) is returned unchanged
 * so a broken slide never blocks the editor.
 */

import type { Plugin } from "prettier";

interface Engine {
  format: typeof import("prettier/standalone").format;
  plugins: Plugin[];
}

let engine: Promise<Engine> | null = null;

function loadEngine(): Promise<Engine> {
  if (!engine) {
    engine = Promise.all([
      import("prettier/standalone"),
      import("prettier/plugins/typescript"),
      import("prettier/plugins/estree"),
    ]).then(([standalone, typescript, estree]) => ({
      format: standalone.format,
      plugins: [typescript, estree] as Plugin[],
    }));
  }
  return engine;
}

export const FORMATABLE_EXT = /\.(tsx|ts|jsx|js)$/i;

export async function formatTsx(code: string): Promise<string> {
  if (!code.trim()) return code;
  try {
    const { format, plugins } = await loadEngine();
    const out = await format(code, {
      parser: "typescript",
      plugins,
      printWidth: 100,
      tabWidth: 2,
      semi: true,
      singleQuote: false,
      jsxSingleQuote: false,
      trailingComma: "all",
      bracketSameLine: false,
      endOfLine: "lf",
    });
    return typeof out === "string" ? out : code;
  } catch {
    return code; // parse error → leave as-is
  }
}
