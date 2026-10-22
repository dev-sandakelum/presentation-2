import test from "node:test";
import assert from "node:assert/strict";
import { isExternalSignature, mayWriteContent } from "../src/lib/stagesmith/save-safety.ts";

test("save signature is acknowledged and does not trigger a self-reload", () => {
  const savedSignature = "after-save";
  assert.equal(isExternalSignature(savedSignature, savedSignature), false);
  assert.equal(isExternalSignature("external-change", savedSignature), true);
});

test("empty content cannot overwrite non-empty source without confirmation", () => {
  assert.equal(mayWriteContent("original source", ""), false);
  assert.equal(mayWriteContent("original source", "", true), true);
  assert.equal(mayWriteContent("", ""), true);
  assert.equal(mayWriteContent("original source", "updated source"), true);
});
