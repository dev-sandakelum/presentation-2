"use client";

/**
 * Client-side deck transfer — .smdeck (zip) + .deck.tsx export/import that
 * runs entirely in the browser, so browser-stored decks (hosted deployments,
 * device folders) can round-trip without any server storage.
 */

import JSZip from "jszip";
import { starterDeckFiles } from "./templates";
import { slugify, type BrowserDeckRecord } from "./browser-store";
import type { DeckJson } from "./types";

export interface ImportReport {
  deckId: string;
  slides: number;
  files: number;
  warnings: string[];
}

/* ------------------------------------------------------------------ */
/* export                                                              */
/* ------------------------------------------------------------------ */

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** build a .smdeck zip from a file map + asset blobs (same layout as the server exporter) */
export async function exportFilesAsZip(
  files: Record<string, string>,
  assets: Record<string, Blob>,
  title: string,
): Promise<Blob> {
  const zip = new JSZip();
  zip.file("mimetype", "application/vnd.stagesmith.deck", { compression: "STORE" });
  const manifest: Record<string, string> = {};
  const isHidden = (rel: string) => rel.split("/").some((seg) => seg.startsWith("."));
  for (const rel of Object.keys(files).sort()) {
    if (isHidden(rel)) continue; // legacy caches (.stagesmith/…), dotfiles
    const bytes = new TextEncoder().encode(files[rel]);
    manifest[rel] = await sha256Hex(bytes.buffer as ArrayBuffer);
    zip.file(rel, files[rel], { compression: "DEFLATE" });
  }
  for (const rel of Object.keys(assets).sort()) {
    if (isHidden(rel)) continue;
    const buf = await assets[rel].arrayBuffer();
    manifest[rel] = await sha256Hex(buf);
    zip.file(rel, assets[rel], { compression: "DEFLATE" });
  }
  zip.file("manifest.json", JSON.stringify({ format: "smdeck", files: manifest }, null, 2) + "\n");
  return zip.generateAsync({ type: "blob", mimeType: "application/vnd.stagesmith.deck" });
}

/** export a browser-store deck record */
export async function exportDeck(
  rec: BrowserDeckRecord,
  format: "smdeck" | "deck.tsx",
): Promise<{ blob: Blob; filename: string }> {
  if (format === "deck.tsx") {
    const deck = JSON.parse(rec.files["deck.json"]) as DeckJson;
    const parts: string[] = [
      `// Stagesmith deck — ${deck.title}`,
      `// Slides: ${deck.slides.length}. Sections below carry // @file <path> markers.`,
      `// Re-import: paste this file into Chassé import, or split it back into a folder.`,
      "",
    ];
    for (const rel of Object.keys(rec.files).sort()) {
      if (
        rel === "deck.json" ||
        rel === "theme.css" ||
        rel.startsWith("slides/") ||
        rel.startsWith("bg/") ||
        rel.startsWith("overlay/") ||
        rel.startsWith("shared/")
      ) {
        parts.push(`// @file ${rel}`, rec.files[rel].trimEnd(), "");
      }
    }
    return {
      blob: new Blob([parts.join("\n")], { type: "text/plain;charset=utf-8" }),
      filename: `${rec.id}.deck.tsx`,
    };
  }
  return {
    blob: await exportFilesAsZip(rec.files, rec.assets, rec.title),
    filename: `${rec.id}.smdeck`,
  };
}

/* ------------------------------------------------------------------ */
/* import                                                              */
/* ------------------------------------------------------------------ */

const BINARY_EXT = /\.(png|jpe?g|svg|webp|gif|avif|bmp|ico|mp4|webm|mp3|wav|ogg|woff2?|ttf|otf|zip)$/i;

/** MIME by extension for re-typing typeless zip blobs */
const ZIP_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

function checkEntryPath(p: string): boolean {
  if (!p || p.length > 200) return false;
  if (p.includes("\\") || p.includes("\0") || p.startsWith("/")) return false;
  const parts = p.split("/");
  return !parts.some((s) => s === "" || s === "." || s === "..");
}

/** parse `// @file <path>` sections from AI text (mirrors the server importer) */
export function parseDeckTsx(text: string): { files: Record<string, string>; warnings: string[] } {
  const warnings: string[] = [];
  const files: Record<string, string> = {};
  const buckets = new Map<string, string[]>();
  let current: string | null = null;
  for (const line of text.split("\n")) {
    const m = line.match(/^\/\/\s*@file\s+(.+)$/);
    if (m) {
      current = m[1].trim().replace(/^\.?\//, "");
      if (!checkEntryPath(current)) {
        warnings.push(`Skipped illegal path "${current}"`);
        current = null;
      } else if (!buckets.has(current)) {
        buckets.set(current, []);
      }
    } else if (current !== null) {
      buckets.get(current)!.push(line);
    } else if (line.trim()) {
      if (!warnings.some((w) => w.includes("before the first")))
        warnings.push("Text before the first // @file marker was ignored");
    }
  }
  for (const [p, ls] of buckets) files[p] = ls.join("\n");
  return { files, warnings };
}

interface ParsedProject {
  files: Record<string, string>;
  assets: Record<string, Blob>;
  warnings: string[];
}

/** read a .smdeck/.zip File into a project file map */
export async function importZipFile(file: File): Promise<ParsedProject> {
  const warnings: string[] = [];
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
  if (names.length > 10000) throw new Error(`Zip has too many entries (${names.length})`);
  const files: Record<string, string> = {};
  const assets: Record<string, Blob> = {};
  let total = 0;
  for (const name of names) {
    if (!checkEntryPath(name) || name === "mimetype" || name === "manifest.json") {
      if (name !== "mimetype" && name !== "manifest.json") warnings.push(`Skipped illegal entry "${name}"`);
      continue;
    }
    // legacy internal caches (the old server thumbnail pipeline wrote
    // .stagesmith/thumbs/*.webp) and OS dotfiles are not deck content
    if (name.split("/").some((seg) => seg.startsWith("."))) continue;
    if (BINARY_EXT.test(name)) {
      let blob = await zip.files[name].async("blob");
      // JSZip hands out typeless blobs — re-type from the extension so asset
      // data URLs keep a proper image/font MIME (Problem 06)
      const mime = ZIP_MIME[name.slice(name.lastIndexOf(".")).toLowerCase()] ?? "";
      if (mime && (!blob.type || blob.type === "application/octet-stream")) {
        blob = new Blob([blob], { type: mime });
      }
      total += blob.size;
      assets[name] = blob;
    } else {
      const text = await zip.files[name].async("string");
      total += text.length;
      files[name] = text;
    }
    if (total > 2 * 1024 * 1024 * 1024) throw new Error("Zip total size exceeds 2 GiB limit");
  }
  if (!files["deck.json"]) {
    const nested = Object.keys(files).find((n) => n.endsWith("/deck.json") && n.split("/").length === 2);
    if (nested) {
      const prefix = nested.slice(0, -"deck.json".length);
      for (const k of Object.keys(files)) {
        files[k.slice(prefix.length)] = files[k];
        delete files[k];
      }
      for (const k of Object.keys(assets)) {
        assets[k.slice(prefix.length)] = assets[k];
        delete assets[k];
      }
    } else {
      throw new Error("No deck.json found — this is not a .smdeck archive");
    }
  }
  return { files, assets, warnings };
}

/** build a project file map from pasted/AI text (bare slide or // @file sections) */
export async function importDeckText(text: string, baseName: string): Promise<ParsedProject> {
  const { files: parsed, warnings } = parseDeckTsx(text);
  const hasSlides = Object.keys(parsed).some((p) => p.startsWith("slides/"));
  if (!hasSlides) {
    // bare slide → starter scaffold with a single custom slide
    const scaffold = starterDeckFiles(baseName || "AI deck");
    const deck = JSON.parse(scaffold["deck.json"]) as DeckJson;
    const slideId = slugify(baseName || "imported", "slide");
    deck.slides = [{ id: slideId, label: baseName || "Imported slide" }];
    scaffold["deck.json"] = JSON.stringify(deck, null, 2);
    delete scaffold["slides/title.tsx"];
    delete scaffold["slides/end.tsx"];
    scaffold[`slides/${slideId}.tsx`] = text;
    return { files: scaffold, assets: {}, warnings };
  }
  const files = { ...parsed };
  if (!files["deck.json"]) {
    const slideIds = Object.keys(files)
      .filter((p) => p.startsWith("slides/") && p.endsWith(".tsx"))
      .map((p) => p.split("/").pop()!.replace(/\.tsx$/, ""));
    const deck = JSON.parse(starterDeckFiles(baseName)["deck.json"]) as DeckJson;
    deck.slides = slideIds.map((id) => ({
      id,
      label: id.replace(/[-_]/g, " ").replace(/^\w/, (c) => c.toUpperCase()),
    }));
    files["deck.json"] = JSON.stringify(deck, null, 2);
  }
  if (!files["theme.css"]) {
    files["theme.css"] = starterDeckFiles(baseName)["theme.css"];
    warnings.push("No theme.css found — the default theme was applied");
  }
  return { files, assets: {}, warnings };
}

/** import any supported file into the browser store */
export async function importFileToBrowser(file: File): Promise<ImportReport> {
  const baseName = file.name.replace(/\.(smdeck|zip|deck\.tsx|tsx|txt)$/i, "");
  const parsed = /\.(smdeck|zip)$/i.test(file.name)
    ? await importZipFile(file)
    : await importDeckText(await file.text(), baseName);
  return finishImport(parsed, baseName);
}

export async function importTextToBrowser(text: string, name: string): Promise<ImportReport> {
  if (!text.trim()) throw new Error("Nothing to import");
  return finishImport(await importDeckText(text, name), name);
}

/** import any supported file into the desktop store (fs bridge) */
export async function importFileToDesktop(file: File): Promise<ImportReport> {
  const baseName = file.name.replace(/\.(smdeck|zip|deck\.tsx|tsx|txt)$/i, "");
  const parsed = /\.(smdeck|zip)$/i.test(file.name)
    ? await importZipFile(file)
    : await importDeckText(await file.text(), baseName);
  return finishImportDesktop(parsed, baseName);
}

/** import pasted/AI text into the desktop store (fs bridge) */
export async function importTextToDesktop(text: string, name: string): Promise<ImportReport> {
  if (!text.trim()) throw new Error("Nothing to import");
  return finishImportDesktop(await importDeckText(text, name), name);
}

async function finishImport(parsed: ParsedProject, baseName: string): Promise<ImportReport> {
  const deck = JSON.parse(parsed.files["deck.json"]) as DeckJson;
  const title = deck.title || baseName || "Imported deck";
  const { createDeck, uniqueDeckId } = await import("./browser-store");
  const deckId = await uniqueDeckId(baseName || deck.title || "imported-deck");
  const { deckId: finalId } = await createDeck(title, parsed.files, {
    id: deckId,
    assets: parsed.assets,
  });
  const created = JSON.parse(parsed.files["deck.json"]) as DeckJson;
  return {
    deckId: finalId,
    slides: created.slides.length,
    files: Object.keys(parsed.files).length + Object.keys(parsed.assets).length,
    warnings: parsed.warnings,
  };
}

/** desktop variant — text files via fs.createDeck, assets via PUT uploads */
async function finishImportDesktop(parsed: ParsedProject, baseName: string): Promise<ImportReport> {
  const deck = JSON.parse(parsed.files["deck.json"]) as DeckJson;
  const title = deck.title || baseName || "Imported deck";
  const desktop = await import("./desktop-store");
  const deckId = await desktop.uniqueDeckId(baseName || deck.title || "imported-deck");
  const { deckId: finalId } = await desktop.createDeck(title, parsed.files, { id: deckId });
  for (const [path, blob] of Object.entries(parsed.assets)) {
    try {
      await desktop.putAssetBytes(finalId, path, blob);
    } catch {
      parsed.warnings.push(`Asset could not be uploaded: ${path}`);
    }
  }
  const created = JSON.parse(parsed.files["deck.json"]) as DeckJson;
  return {
    deckId: finalId,
    slides: created.slides.length,
    files: Object.keys(parsed.files).length + Object.keys(parsed.assets).length,
    warnings: parsed.warnings,
  };
}
