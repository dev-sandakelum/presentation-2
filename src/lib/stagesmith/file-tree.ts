import type { FileRow } from "./types";

/**
 * Pure derivations for the editor's FILE LIST — the single source of truth
 * shared by the stores (bundle rows) and the BG/Overlay dropdown.
 *
 * The desktop store hydrates file CONTENTS progressively (deck.json, theme
 * and the first slide first), but the folder WALK it performs is complete.
 * These helpers merge both views so a file list is never built from a
 * partially hydrated record — the bug that left the BG/Overlay dropdown
 * empty on first open while the editor showed the open file's code.
 */

/** walk-tree metadata for a file whose content may not be hydrated yet */
export interface TreeRow {
  size: number;
  modified: number;
}

/**
 * Full file-row list of a desktop deck record:
 * hydrated text files (authoritative — sizes from their content) plus every
 * walk-tree row not yet hydrated plus binary assets. Files take precedence
 * over the tree, so an in-session save shows the new content immediately.
 */
export function mergeFileRows(
  files: Record<string, string>,
  tree: Record<string, TreeRow> | undefined,
  assets: Record<string, TreeRow>,
  modified: string,
): FileRow[] {
  const mt = Date.parse(modified) || Date.now();
  const rows: FileRow[] = Object.keys(files)
    .sort()
    .map((p) => ({ path: p, mtime: mt, size: files[p].length }));
  // the walk tree covers text files whose content hasn't been read yet —
  // without this merge the first-paint list misses every non-boot file
  // (bg/, overlay/, later slides, notes), leaving the dropdown empty
  for (const p of Object.keys(tree ?? {}).sort()) {
    if (files[p] !== undefined || assets[p] !== undefined) continue;
    rows.push({ path: p, mtime: tree![p].modified, size: tree![p].size });
  }
  for (const p of Object.keys(assets).sort()) {
    rows.push({ path: p, mtime: assets[p].modified, size: assets[p].size });
  }
  return rows;
}

/**
 * The BG/Overlay dropdown options for a layer: every .tsx/.ts file of that
 * layer, with the OPEN file always present — the editor and the dropdown can
 * never disagree about what is on disk (a stale list shows the open file as
 * an extra entry instead of a blank trigger).
 */
export function codeFileOptions(files: FileRow[], layer: "bg" | "overlay", openPath: string | null): string[] {
  const list = files
    .filter((f) => f.path.startsWith(`${layer}/`) && /\.(tsx|ts)$/.test(f.path))
    .map((f) => f.path);
  if (openPath && openPath.startsWith(`${layer}/`) && /\.(tsx|ts)$/.test(openPath) && !list.includes(openPath)) {
    list.unshift(openPath);
  }
  return list;
}
