import test from "node:test";
import assert from "node:assert/strict";
import { mergeFileRows, codeFileOptions } from "../src/lib/stagesmith/file-tree.ts";
import type { FileRow } from "../src/lib/stagesmith/types.ts";

/**
 * Regression tests for the BG/Overlay file-dropdown bug:
 *  1. a freshly opened desktop deck hydrates text contents progressively,
 *     but its folder walk is complete — the file list must be built from the
 *     walk tree, so the dropdown is never empty while a file of that type
 *     exists on disk;
 *  2. the dropdown must always offer the OPEN file (the editor and the
 *     dropdown can never disagree about what is on disk).
 */

const bootHydratedFiles = {
  "deck.json": "{}",
  "theme.css": "body{}",
  "slides/first.tsx": "export default 1",
};

const fullWalkTree = {
  "deck.json": { size: 2, modified: 1 },
  "theme.css": { size: 7, modified: 2 },
  "slides/first.tsx": { size: 15, modified: 3 },
  "slides/second.tsx": { size: 16, modified: 4 },
  "bg/common.tsx": { size: 120, modified: 5 },
  "overlay/MSA.tsx": { size: 96, modified: 6 },
  "notes/first.md": { size: 12, modified: 7 },
};

function paths(rows: FileRow[]): string[] {
  return rows.map((r) => r.path);
}

test("the file list is never empty while a file of that type exists (mid-hydration record)", () => {
  // exactly what a desktop getBundle returns right after the walk: only the
  // boot files hydrated, bg/ and overlay/ contents still loading in the
  // background
  const rows = mergeFileRows(bootHydratedFiles, fullWalkTree, {}, "2024-01-01T00:00:00Z");
  const overlay = codeFileOptions(rows, "overlay", "overlay/MSA.tsx");
  assert.deepEqual(overlay, ["overlay/MSA.tsx"]);
  const bg = codeFileOptions(rows, "bg", null);
  assert.deepEqual(bg, ["bg/common.tsx"]);
  // every walked file is listed, not just the hydrated boot files
  for (const p of Object.keys(fullWalkTree)) {
    assert.ok(paths(rows).includes(p), `${p} must be listed`);
  }
});

test("an empty walk tree with empty files yields an empty list (true empty state)", () => {
  const rows = mergeFileRows({}, {}, {}, "2024-01-01T00:00:00Z");
  assert.deepEqual(codeFileOptions(rows, "overlay", null), []);
});

test("hydrated files win over the walk tree — no duplicates, no resurrected deletions", () => {
  const rows = mergeFileRows(
    { ...bootHydratedFiles, "overlay/MSA.tsx": "// edited" },
    fullWalkTree,
    {},
    "2024-01-01T00:00:00Z",
  );
  const overlayRows = rows.filter((r) => r.path === "overlay/MSA.tsx");
  assert.equal(overlayRows.length, 1);
  assert.equal(overlayRows[0].size, "// edited".length);
  // a file removed from BOTH the hydrated set and the tree is gone for good
  // (deleteCodeFile / deleteFile delete the key — they never leave undefined)
  const afterDeleteTree = { ...fullWalkTree };
  delete afterDeleteTree["overlay/MSA.tsx"];
  const afterDelete = mergeFileRows({ ...bootHydratedFiles }, afterDeleteTree, {}, "2024-01-01T00:00:00Z");
  assert.ok(!paths(afterDelete).includes("overlay/MSA.tsx"));
});

test("binary assets are listed alongside text files", () => {
  const rows = mergeFileRows(bootHydratedFiles, fullWalkTree, { "assets/logo.png": { size: 512, modified: 9 } }, "2024-01-01T00:00:00Z");
  assert.ok(paths(rows).includes("assets/logo.png"));
});

test("the dropdown always contains the open file, even when the row list is stale", () => {
  // the editor shows overlay/MSA.tsx (deck.json wiring + on-demand read) but
  // the file rows have not refreshed yet — the dropdown must still offer it
  const options = codeFileOptions(
    [{ path: "bg/common.tsx", mtime: 1, size: 1 }],
    "overlay",
    "overlay/MSA.tsx",
  );
  assert.deepEqual(options, ["overlay/MSA.tsx"]);

  // already-listed open file is not duplicated
  const listed = codeFileOptions(
    [
      { path: "overlay/MSA.tsx", mtime: 1, size: 1 },
      { path: "overlay/other.tsx", mtime: 1, size: 1 },
    ],
    "overlay",
    "overlay/MSA.tsx",
  );
  assert.deepEqual(listed, ["overlay/MSA.tsx", "overlay/other.tsx"]);
});

test("layer and extension filtering hold for the dropdown", () => {
  const rows: FileRow[] = [
    { path: "bg/a.tsx", mtime: 1, size: 1 },
    { path: "bg/b.ts", mtime: 1, size: 1 },
    { path: "overlay/a.tsx", mtime: 1, size: 1 },
    { path: "overlay/notes.md", mtime: 1, size: 1 },
    { path: "assets/a.tsx.png", mtime: 1, size: 1 },
  ];
  assert.deepEqual(codeFileOptions(rows, "bg", null), ["bg/a.tsx", "bg/b.ts"]);
  assert.deepEqual(codeFileOptions(rows, "overlay", null), ["overlay/a.tsx"]);
  // an open file of the wrong layer is never injected into another layer's list
  assert.deepEqual(codeFileOptions(rows, "bg", "overlay/a.tsx"), ["bg/a.tsx", "bg/b.ts"]);
});
