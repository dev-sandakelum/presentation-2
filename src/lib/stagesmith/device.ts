"use client";

/**
 * Device folders via the File System Access API (Chromium, https).
 *
 * "New project…" can place the whole project folder on the USER'S device:
 * the browser shows a permission prompt (showDirectoryPicker) and every
 * change is mirrored into that folder (write-through). The deck still lives
 * in the browser store as its working copy, so the studio keeps working even
 * when the permission lapses — the mirror is best-effort.
 *
 * The mirror is DIFF-BASED and SERIALIZED (the save-reliability fix):
 *   · browser-store hands over only the paths that actually changed
 *   · unchanged files are skipped (assets by disk-size check — no blob read,
 *     text files by content compare — small reads)
 *   · one mirror run per deck at a time; rapid saves coalesce
 *   · failures are reported through a status listener (never swallowed) and
 *     the pending changes stay queued for the next save / explicit retry
 * Previously every save re-wrote EVERY file and asset to disk, which made a
 * one-line edit in a 26-slide deck take minutes (and fought the antivirus).
 */

import {
  getRecord,
  putRecord,
  setDeviceHandle,
  getDeviceHandle,
  handlePermission,
  requestHandlePermission,
  validDeckId,
  type BrowserDeckRecord,
  type MirrorChanges,
} from "./browser-store";

type DirHandle = any;

export function supportsDeviceFolders(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

/** open the browser's directory picker (must run on a user gesture) */
export async function pickDirectory(mode: "read" | "readwrite" = "readwrite"): Promise<DirHandle | null> {
  if (!supportsDeviceFolders()) throw new Error("This browser can't pick device folders — use the .zip download instead.");
  try {
    // TS: showDirectoryPicker is not in lib.dom for all targets
    const picker = (window as unknown as { showDirectoryPicker: (o: object) => Promise<DirHandle> }).showDirectoryPicker;
    return await picker({ mode, startIn: "documents" });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") return null; // user cancelled
    throw e;
  }
}

async function getFileHandleRecursive(root: DirHandle, rel: string, create: boolean): Promise<DirHandle> {
  const parts = rel.split("/").filter(Boolean);
  const name = parts.pop()!;
  let dir = root;
  for (const p of parts) dir = await dir.getDirectoryHandle(p, { create });
  return dir.getFileHandle(name, { create });
}

/** write one file into the device folder — atomic: Chromium's createWritable
 *  streams into a temp swap file and swaps on close (temp file + rename). */
export async function writeDeviceFile(root: DirHandle, rel: string, data: string | Blob): Promise<void> {
  const fh = await getFileHandleRecursive(root, rel, true);
  // keepExistingData:false → the previous file is never spooled into the
  // temp file first (avoids reading a large PNG just to overwrite it)
  const w = await fh.createWritable({ keepExistingData: false });
  await w.write(data);
  await w.close();
}

async function removeDeviceFile(root: DirHandle, rel: string): Promise<void> {
  try {
    const parts = rel.split("/").filter(Boolean);
    const name = parts.pop()!;
    let dir = root;
    for (const p of parts) dir = await dir.getDirectoryHandle(p, { create: false });
    await dir.removeEntry(name);
  } catch {
    /* best effort */
  }
}

/* ------------------------------------------------------------------ */
/* the diff-based write-through mirror                                 */
/* ------------------------------------------------------------------ */

export interface MirrorStatus {
  ok: boolean;
  /** human-readable reason when not ok */
  error?: string;
  at: number;
}

const mirrorStatus = new Map<string, MirrorStatus>();
const mirrorListeners = new Set<(deckId: string) => void>();

function setMirrorStatus(deckId: string, ok: boolean, error?: string): void {
  mirrorStatus.set(deckId, { ok, error, at: Date.now() });
  for (const cb of mirrorListeners) {
    try {
      cb(deckId);
    } catch {
      /* listener error — ignore */
    }
  }
}

export function getMirrorStatus(deckId: string): MirrorStatus | null {
  return mirrorStatus.get(deckId) ?? null;
}

/** subscribe to mirror status changes (editor toolbar chip) */
export function onMirrorStatus(cb: (deckId: string) => void): () => void {
  mirrorListeners.add(cb);
  return () => mirrorListeners.delete(cb);
}

interface MirrorQueue {
  rec: BrowserDeckRecord | null;
  pendingFiles: Set<string>;
  pendingAssets: Set<string>;
  pendingRemovedFiles: Set<string>;
  pendingRemovedAssets: Set<string>;
  running: boolean;
}

const mirrorQueues = new Map<string, MirrorQueue>();

function queueOf(deckId: string): MirrorQueue {
  let q = mirrorQueues.get(deckId);
  if (!q) {
    q = { rec: null, pendingFiles: new Set(), pendingAssets: new Set(), pendingRemovedFiles: new Set(), pendingRemovedAssets: new Set(), running: false };
    mirrorQueues.set(deckId, q);
  }
  return q;
}

/** enqueue changed paths; runs the serialized mirror loop (coalesces rapid saves) */
function enqueueMirror(rec: BrowserDeckRecord, changes: MirrorChanges): void {
  const q = queueOf(rec.id);
  q.rec = rec;
  for (const p of changes.files) q.pendingFiles.add(p);
  for (const p of changes.assets) q.pendingAssets.add(p);
  for (const p of changes.removedFiles) q.pendingRemovedFiles.add(p);
  for (const p of changes.removedAssets) q.pendingRemovedAssets.add(p);
  if (!q.running) void runMirror(rec.id);
}

/** re-run whatever is still pending (Retry button / next save) */
export async function retryMirror(deckId: string): Promise<void> {
  const q = mirrorQueues.get(deckId);
  if (!q || q.running) return;
  if (!q.rec) return;
  if (!q.pendingFiles.size && !q.pendingAssets.size && !q.pendingRemovedFiles.size && !q.pendingRemovedAssets.size) return;
  await runMirror(deckId);
}

async function runMirror(deckId: string): Promise<void> {
  const q = queueOf(deckId);
  q.running = true;
  try {
    while (q.rec && (q.pendingFiles.size || q.pendingAssets.size || q.pendingRemovedFiles.size || q.pendingRemovedAssets.size)) {
      const handle = await getDeviceHandle(deckId);
      if (!handle) {
        // no folder attached (removed handle) — nothing to mirror, drop the queue
        q.pendingFiles.clear();
        q.pendingAssets.clear();
        q.pendingRemovedFiles.clear();
        q.pendingRemovedAssets.clear();
        setMirrorStatus(deckId, true);
        return;
      }
      if ((await handlePermission(handle)) !== "granted") {
        // permission lapsed (needs a user gesture to re-grant) — keep the
        // changes queued, surface the reason, never fail the store save
        setMirrorStatus(deckId, false, "Device folder needs permission again — changes are saved in this browser. Open the deck folder picker to re-grant access.");
        return;
      }
      try {
        // deletions first (cheap), then files, then assets
        for (const rel of [...q.pendingRemovedFiles]) {
          await removeDeviceFile(handle, rel);
          q.pendingRemovedFiles.delete(rel);
        }
        for (const rel of [...q.pendingRemovedAssets]) {
          await removeDeviceFile(handle, rel);
          q.pendingRemovedAssets.delete(rel);
        }
        for (const rel of [...q.pendingFiles]) {
          const content = q.rec.files[rel];
          if (content === undefined) {
            q.pendingFiles.delete(rel);
            continue;
          }
          await mirrorTextFile(handle, rel, content);
          q.pendingFiles.delete(rel);
        }
        for (const rel of [...q.pendingAssets]) {
          const blob = q.rec.assets[rel];
          if (blob === undefined) {
            q.pendingAssets.delete(rel);
            continue;
          }
          await mirrorAssetFile(handle, rel, blob);
          q.pendingAssets.delete(rel);
        }
        setMirrorStatus(deckId, true);
      } catch (e) {
        // a write failed — keep the remaining paths queued for retry and
        // surface the reason (disk full, folder locked by antivirus, …)
        setMirrorStatus(deckId, false, `Couldn't sync to the device folder — ${(e as Error).message}. Changes are saved in this browser; saving again will retry.`);
        return;
      }
    }
    setMirrorStatus(deckId, true);
  } finally {
    q.running = false;
  }
}

/** skip when the disk copy is already identical (small text file read) */
async function mirrorTextFile(handle: DirHandle, rel: string, content: string): Promise<void> {
  try {
    const fh = await getFileHandleRecursive(handle, rel, false);
    const disk = await (await fh.getFile()).text();
    if (disk === content) return;
    await writeDeviceFile(handle, rel, content);
  } catch {
    await writeDeviceFile(handle, rel, content);
  }
}

/** skip when the disk file has the same size — no blob read, no rewrite of
 *  large PNGs that didn't change (the 2-to-5-minute save killer) */
async function mirrorAssetFile(handle: DirHandle, rel: string, blob: Blob): Promise<void> {
  try {
    const fh = await getFileHandleRecursive(handle, rel, false);
    const disk = await fh.getFile();
    if (disk.size === blob.size) return;
  } catch {
    /* not on disk yet — write it */
  }
  await writeDeviceFile(handle, rel, blob);
}

/** write-through hook used by browser-store.putRecord */
export function installDeviceMirror(): void {
  (async () => {
    const { setDeviceMirror } = await import("./browser-store");
    setDeviceMirror(async (rec: BrowserDeckRecord, changes: MirrorChanges) => {
      if (!rec.device) return;
      enqueueMirror(rec, changes);
    });
  })();
}

/* ------------------------------------------------------------------ */
/* reading from the device folder                                      */
/* ------------------------------------------------------------------ */

/** read one asset file straight from the device folder (preview fallback for
 *  files that aren't imported into the browser store yet) */
export async function readDeviceAsset(deckId: string, rel: string): Promise<File | null> {
  const handle = await getDeviceHandle(deckId);
  if (!handle) return null;
  if ((await handlePermission(handle)) !== "granted") return null;
  try {
    const fh = await getFileHandleRecursive(handle, rel, false);
    return await fh.getFile();
  } catch {
    return null;
  }
}

/** list every file in the device folder's assets/ dir (dot-segments skipped).
 *  Returns null when the folder/handle isn't readable — callers treat that
 *  as "nothing new to import". */
export async function scanDeviceAssets(deckId: string): Promise<Array<{ path: string; file: File }> | null> {
  const handle = await getDeviceHandle(deckId);
  if (!handle) return null;
  if ((await handlePermission(handle)) !== "granted") return null;
  const out: Array<{ path: string; file: File }> = [];
  const walk = async (dir: DirHandle, rel: string, depth: number): Promise<void> => {
    if (depth > 3) return;
    for await (const [name, h] of dir.entries()) {
      if (name.startsWith(".")) continue;
      const p = rel ? `${rel}/${name}` : name;
      if (h.kind === "directory") await walk(h, p, depth + 1);
      else out.push({ path: `assets/${p}`, file: await h.getFile() });
    }
  };
  try {
    const assetsDir = await handle.getDirectoryHandle("assets", { create: false });
    await walk(assetsDir, "", 0);
  } catch {
    return null; // no assets/ dir yet
  }
  return out;
}

/** best-effort removal of the deck's files from the device folder (called
 *  after a confirmed deck delete). The folder itself and any files the user
 *  put there themselves stay untouched. */
export async function cleanupDeviceProject(deckId: string): Promise<{ error?: string }> {
  const handle = await getDeviceHandle(deckId);
  if (!handle) return {};
  if ((await handlePermission(handle)) !== "granted") {
    return { error: "No write permission for the device folder — its files were kept" };
  }
  let failed = false;
  for (const name of ["deck.json", "theme.css", "slides", "assets", "bg", "overlay", "notes", ".stagesmith"]) {
    try {
      await handle.removeEntry(name, { recursive: true });
    } catch {
      /* not present — fine; permission/IO trouble marks failed below */
    }
  }
  // verify the structural entries are really gone (removeEntry is silent)
  try {
    await handle.getDirectoryHandle("slides", { create: false });
    failed = true;
  } catch {
    /* gone — good */
  }
  return failed ? { error: "Some files in the device folder couldn't be removed — delete them manually" } : {};
}

/** folder name of a deck's device handle (delete-confirmation dialog) */
export async function deviceFolderName(deckId: string): Promise<string | null> {
  const handle = await getDeviceHandle(deckId);
  return handle?.name ?? null;
}

/* ------------------------------------------------------------------ */
/* project creation / opening                                          */
/* ------------------------------------------------------------------ */

/**
 * Create a new project IN a user-picked device folder and register the deck
 * in the browser store with write-through mirroring.
 */
export async function createDeviceProject(
  deckId: string,
  title: string,
  files: Record<string, string>,
): Promise<{ deckId: string; folderName: string }> {
  const root = await pickDirectory("readwrite");
  if (!root) throw new Error("No folder picked");
  const perm = await requestHandlePermission(root);
  if (perm !== "granted") throw new Error("Permission to write the folder was denied");

  // write the scaffold into the folder (subfolder per project name)
  const projectDir = await root.getDirectoryHandle(title, { create: true }).catch(() => null);
  const target = projectDir ?? root;

  for (const [rel, content] of Object.entries(files)) {
    await writeDeviceFile(target, rel, content);
  }
  // empty structural folders
  for (const dir of ["assets"]) {
    try {
      await target.getDirectoryHandle(dir, { create: true });
    } catch {
      /* ignore */
    }
  }

  const { deckId: finalId } = await (await import("./browser-store")).createDeck(title, files, {
    id: deckId,
    device: true,
  });
  await setDeviceHandle(finalId, projectDir ?? root);
  // mirror already-written — mark record device
  const rec = await getRecord(finalId);
  if (rec) {
    rec.device = true;
    await putRecord(rec);
  }
  return { deckId: finalId, folderName: (projectDir ?? root).name ?? title };
}

/**
 * Open an existing project folder from the device: reads its files into a
 * browser-store deck and attaches the handle for write-through.
 */
export async function openDeviceProject(): Promise<{ deckId: string; title: string } | null> {
  const root = await pickDirectory("readwrite");
  if (!root) return null;
  const perm = await requestHandlePermission(root);
  if (perm !== "granted") throw new Error("Permission to read the folder was denied");

  // find deck.json (root or one level deep)
  let projectDir: DirHandle = root;
  let deckRaw: string | null = null;
  try {
    deckRaw = await (await root.getFileHandle("deck.json")).getFile().then((f: File) => f.text());
  } catch {
    for await (const [name, handle] of root.entries()) {
      if (handle.kind !== "directory") continue;
      try {
        deckRaw = await (await handle.getFileHandle("deck.json")).getFile().then((f: File) => f.text());
        projectDir = handle;
        break;
      } catch {
        /* keep looking */
      }
    }
  }
  if (!deckRaw) throw new Error("No deck.json in this folder — is it a Chassé project?");

  const { files, assets } = await readFolderFiles(projectDir);
  files["deck.json"] = deckRaw;
  let title = "Imported project";
  let id = "imported-project";
  try {
    const deck = JSON.parse(deckRaw);
    title = deck.title || title;
    id = deck.id || id;
  } catch {
    /* keep defaults */
  }
  if (!validDeckId(id)) id = "imported-project";
  const { createDeck, uniqueDeckId } = await import("./browser-store");
  const finalId = (await createDeck(title, files, { id: await uniqueDeckId(id), device: true, assets })).deckId;
  const rec = await getRecord(finalId);
  if (rec) {
    rec.assets = { ...rec.assets, ...assets };
    rec.device = true;
    await putRecord(rec);
  }
  await setDeviceHandle(finalId, projectDir);
  return { deckId: finalId, title };
}

/** recursively read every file of a directory handle into text files + blobs */
export async function readFolderFiles(
  root: DirHandle,
  rel = "",
  files: Record<string, string> = {},
  assets: Record<string, Blob> = {},
  depth = 0,
): Promise<{ files: Record<string, string>; assets: Record<string, Blob> }> {
  if (depth > 6) return { files, assets };
  const TEXT_EXT = /\.(tsx|ts|jsx|js|json|css|md|txt|gitkeep)$/i;
  for await (const [name, handle] of root.entries()) {
    if (name.startsWith(".") || name === "node_modules") continue;
    const path = rel ? `${rel}/${name}` : name;
    if (handle.kind === "directory") {
      await readFolderFiles(handle, path, files, assets, depth + 1);
    } else {
      const file: File = await handle.getFile();
      if (TEXT_EXT.test(name)) files[path] = await file.text();
      else assets[path] = file;
    }
  }
  return { files, assets };
}

/** zip fallback — the scaffold as a .smdeck download (non-Chromium browsers) */
export async function downloadStarterZip(title: string, files: Record<string, string>): Promise<void> {
  const { exportFilesAsZip } = await import("./transfer");
  const blob = await exportFilesAsZip(files, {}, title);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${title}.smdeck`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export { handlePermission, requestHandlePermission, getDeviceHandle, setDeviceHandle, removeDeviceFile };
