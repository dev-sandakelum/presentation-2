"use client";

/**
 * Device folders via the File System Access API (Chromium, https).
 *
 * "New project…" can place the whole project folder on the USER'S device:
 * the browser shows a permission prompt (showDirectoryPicker) and every
 * change is mirrored into that folder (write-through). The deck still lives
 * in the browser store as its working copy, so the studio keeps working even
 * when the permission lapses — the mirror is best-effort.
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

/** write one file into the device folder (best-effort mirror) */
export async function writeDeviceFile(root: DirHandle, rel: string, data: string | Blob): Promise<void> {
  const fh = await getFileHandleRecursive(root, rel, true);
  const w = await fh.createWritable();
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

/** write-through hook used by browser-store.putRecord */
export function installDeviceMirror(): void {
  (async () => {
    const { setDeviceMirror } = await import("./browser-store");
    setDeviceMirror(async (rec: BrowserDeckRecord) => {
      if (!rec.device) return;
      const handle = await getDeviceHandle(rec.id);
      if (!handle) return;
      if ((await handlePermission(handle)) !== "granted") return;
      // mirror the full text file map (decks are small; keeps folders exact)
      for (const [rel, content] of Object.entries(rec.files)) {
        if (rel.startsWith(".stagesmith")) continue;
        await writeDeviceFile(handle, rel, content).catch(() => {});
      }
      for (const rel of Object.keys(rec.assets)) {
        await writeDeviceFile(handle, rel, rec.assets[rel]).catch(() => {});
      }
    });
  })();
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
  const finalId = (await createDeck(title, files, { id: await uniqueDeckId(id), device: true })).deckId;
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
      if (TEXT_EXT.test(name) || file.size < 512 * 1024) {
        if (TEXT_EXT.test(name)) files[path] = await file.text();
        else assets[path] = file;
      } else {
        assets[path] = file;
      }
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
