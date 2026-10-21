"use client";

/**
 * Device-folder permission manager — the "ask again, only when it was lost" fix.
 *
 * With the File System Access API a stored folder HANDLE survives a restart,
 * but its WRITE permission does not: it silently falls back to "prompt", and
 * the app used to find out only when a save or delete failed. This module
 * flips that around:
 *
 *   · on app open (and when the window regains focus) every device deck is
 *     queried — granted: nothing happens; prompt: ONE banner offers to
 *     restore it; denied: a quiet card note explains the browser's site
 *     settings; missing (folder moved / handle evicted): the card offers
 *     "Choose folder again"
 *   · requestPermission only ever runs from a real user gesture (banner /
 *     card button, Ctrl+S, a confirmed delete) — without one Chromium
 *     rejects with SecurityError, which we treat as "still prompt"
 *   · decks created inside a picked root remember that PARENT folder: one
 *     permission click on the parent re-derives every child handle, so one
 *     "Allow access" covers the whole folder of decks
 *   · after a grant the banner/badges disappear WITHOUT a reload, and any
 *     mirror changes that piled up while access was lapsed are re-run
 *
 * UI state lives here as an external store (useSyncExternalStore-friendly):
 * the snapshot object is only replaced when something actually changes.
 */

import {
  getRecord,
  putRecord,
  setDeviceHandle,
  getDeviceHandle,
  getDeviceParent,
  clearDeviceParent,
  handleAccessState,
  requestHandlePermission,
  folderUsable,
  listDeviceDeckIds,
  type DirHandle,
  type DeviceParentInfo,
} from "./browser-store";

export type DeckAccessState = "granted" | "prompt" | "denied" | "missing";
export type AccessMap = Record<string, DeckAccessState>;

/* ------------------------------------------------------------------ */
/* external store                                                      */
/* ------------------------------------------------------------------ */

const EMPTY: AccessMap = {};
let states: AccessMap = EMPTY;
const listeners = new Set<() => void>();

export function getAccessStates(): AccessMap {
  return states;
}

export function subscribeAccess(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(): void {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      /* listener error — ignore */
    }
  }
}

function updateOne(deckId: string, state: DeckAccessState): DeckAccessState {
  if (states[deckId] !== state) {
    states = { ...states, [deckId]: state };
    notify();
  }
  return state;
}

/* ------------------------------------------------------------------ */
/* checking                                                            */
/* ------------------------------------------------------------------ */

/** fresh state of ONE deck's device folder (cheap: query + one-entry probe) */
export async function checkDeckAccess(deckId: string): Promise<DeckAccessState> {
  const handle = await getDeviceHandle(deckId);
  if (!handle) return "missing";
  return handleAccessState(handle);
}

let checkInFlight: Promise<AccessMap> | null = null;

/**
 * Query EVERY device deck's permission. Runs async — callers never await it
 * before rendering (the dashboard appears immediately, the banner pops in
 * only when some deck actually needs access). Concurrent calls coalesce
 * into the single in-flight run.
 */
export function refreshAccessStates(): Promise<AccessMap> {
  if (checkInFlight) return checkInFlight;
  checkInFlight = (async () => {
    const ids = await listDeviceDeckIds();
    const out: AccessMap = {};
    for (const id of ids) out[id] = await checkDeckAccess(id);
    const kept: AccessMap = {};
    for (const [id, state] of Object.entries(states)) {
      if (!out[id]) continue; // deck deleted in the meantime
      kept[id] = out[id];
    }
    states = { ...kept, ...out };
    notify();
    return states;
  })().finally(() => {
    checkInFlight = null;
  });
  return checkInFlight;
}

/* ------------------------------------------------------------------ */
/* granting                                                            */
/* ------------------------------------------------------------------ */

/** re-run whatever mirror changes piled up while access was lapsed */
async function resumeMirror(deckId: string): Promise<void> {
  try {
    const { retryMirror } = await import("./device");
    await retryMirror(deckId);
  } catch {
    /* mirror module not ready — next save retries anyway */
  }
}

/**
 * Ask for ONE deck's own folder back. MUST be called from a user gesture
 * (that's the whole point — the browser only prompts on a click/key press).
 * Returns the deck's new state and updates the external store, so banner
 * and badges disappear without a reload.
 */
export async function requestDeckAccess(deckId: string): Promise<DeckAccessState> {
  const handle = await getDeviceHandle(deckId);
  if (!handle) return updateOne(deckId, "missing");
  const perm = await requestHandlePermission(handle);
  if (perm === "granted") {
    if (!(await folderUsable(handle))) return updateOne(deckId, "missing");
    const done = updateOne(deckId, "granted");
    void resumeMirror(deckId);
    return done;
  }
  return updateOne(deckId, perm === "denied" ? "denied" : "prompt");
}

/** a parent folder shared by several decks + which child folder each deck is */
interface ParentGroup {
  parent: DirHandle;
  entries: Array<{ deckId: string; childName: string }>;
}

/** group decks whose remembered parent handle is the SAME folder (by
 *  isSameEntry — handles picked twice are different objects for one path) */
async function groupByParent(deckIds: string[]): Promise<ParentGroup[]> {
  const groups: ParentGroup[] = [];
  for (const deckId of deckIds) {
    let info: DeviceParentInfo | null = null;
    try {
      info = await getDeviceParent(deckId);
    } catch {
      info = null;
    }
    if (!info?.parent) continue;
    let placed = false;
    for (const g of groups) {
      try {
        if (await g.parent.isSameEntry(info.parent)) {
          g.entries.push({ deckId, childName: info.childName });
          placed = true;
          break;
        }
      } catch {
        /* comparison failed — treat as a different folder */
      }
    }
    if (!placed) groups.push({ parent: info.parent, entries: [{ deckId, childName: info.childName }] });
  }
  return groups;
}

/**
 * ONE click → the shared parent's permission sheet → every deck inside is
 * re-derived from the granted parent (a fresh handle walked down from an
 * authorized folder needs no prompt of its own). Returns null when the decks
 * have no shared parent remembered — the caller falls back to per-deck
 * requests, one per click.
 */
export async function requestSharedParentAccess(deckIds: string[]): Promise<DeckAccessState | null> {
  const groups = await groupByParent(deckIds);
  const group = groups[0];
  if (!group) return null;
  const perm = await requestHandlePermission(group.parent);
  if (perm !== "granted") {
    const state: DeckAccessState = perm === "denied" ? "denied" : "prompt";
    for (const { deckId } of group.entries) updateOne(deckId, state);
    return state;
  }
  for (const { deckId, childName } of group.entries) {
    try {
      const child = await group.parent.getDirectoryHandle(childName);
      await setDeviceHandle(deckId, child);
      if (await folderUsable(child)) {
        updateOne(deckId, "granted");
        void resumeMirror(deckId);
      } else {
        updateOne(deckId, "missing");
      }
    } catch {
      // the subfolder itself is gone — the card offers "Choose folder again"
      updateOne(deckId, "missing");
    }
  }
  return "granted";
}

/**
 * The banner's Allow-access click: one parent sheet when the decks share a
 * folder, otherwise ONE deck per click (a second requestPermission after an
 * await no longer counts as the same user gesture — never chain them).
 */
export async function grantNextPending(deckIds: string[]): Promise<void> {
  const pending = deckIds.filter((id) => states[id] !== "granted");
  if (!pending.length) return;
  const viaParent = await requestSharedParentAccess(pending);
  if (viaParent === null) await requestDeckAccess(pending[0]);
}

/* ------------------------------------------------------------------ */
/* re-attaching a lost folder                                          */
/* ------------------------------------------------------------------ */

/**
 * The "Choose folder again" action for a deck whose folder is gone/moved:
 * opens showDirectoryPicker (user gesture), accepts either the project
 * folder itself (has deck.json) or a parent containing it one level deep,
 * and stores the fresh handle (+ parent info when applicable).
 */
export async function pickFolderAgain(deckId: string): Promise<DeckAccessState> {
  const { pickDirectory } = await import("./device");
  let root: DirHandle | null = null;
  try {
    root = await pickDirectory("readwrite");
  } catch {
    root = null;
  }
  if (!root) return states[deckId] ?? "missing"; // user cancelled

  const perm = await requestHandlePermission(root);
  if (perm !== "granted") return updateOne(deckId, perm === "denied" ? "denied" : "prompt");

  // the picked folder may be the project folder itself…
  let target: DirHandle = root;
  let childName: string | null = null;
  try {
    await root.getFileHandle("deck.json");
  } catch {
    // …or its parent — look one level deep for the project subfolder
    let found: DirHandle | null = null;
    try {
      for await (const [name, h] of root.entries()) {
        if (h.kind !== "directory") continue;
        try {
          await h.getFileHandle("deck.json");
          found = h;
          childName = name;
          break;
        } catch {
          /* keep looking */
        }
      }
    } catch {
      /* root unreadable — accept it as picked */
    }
    if (found) target = found;
  }

  await setDeviceHandle(deckId, target);
  if (childName) await setDeviceParent(deckId, root, childName);
  else await clearDeviceParent(deckId);

  const usable = await folderUsable(target);
  const state: DeckAccessState = usable ? "granted" : "missing";
  updateOne(deckId, state);
  if (usable) void resumeMirror(deckId);
  return state;
}

/* ------------------------------------------------------------------ */
/* pre-action guards                                                   */
/* ------------------------------------------------------------------ */

function userActivationLive(): boolean {
  try {
    return (
      typeof navigator !== "undefined" &&
      (navigator as { userActivation?: { isActive?: boolean } }).userActivation?.isActive === true
    );
  } catch {
    return false;
  }
}

/**
 * Guard for actions that are ABOUT to touch the device folder (delete,
 * finish-delete, explicit save…). Checks fresh; when the state is "prompt"
 * it uses the CURRENT user gesture to show the permission sheet right away,
 * so the action continues on a granted folder instead of failing half-way.
 * For non-device decks it's a no-op returning "granted".
 */
export async function ensureWriteAccess(deckId: string): Promise<DeckAccessState> {
  const rec = await getRecord(deckId).catch(() => null);
  if (!rec || !rec.device) return "granted"; // nothing to guard
  const state = await checkDeckAccess(deckId);
  if (state === "granted") return updateOne(deckId, "granted");
  if (state === "prompt") return requestDeckAccess(deckId);
  return updateOne(deckId, state);
}

/**
 * Fire-and-forget variant woven into the api layer's write paths: whenever a
 * mutation runs while a user gesture is still live (explicit save, Ctrl+S,
 * an upload, a confirmed click) and the folder permission has lapsed, the
 * sheet appears THEN — the browser-store copy is saved regardless, and the
 * pending folder mirror resumes the moment access comes back. Never blocks,
 * never throws.
 */
export function maybeRequestWriteAccess(deckId: string): void {
  void (async () => {
    try {
      const rec = await getRecord(deckId).catch(() => null);
      if (!rec?.device) return;
      if (!userActivationLive()) return; // autosave behind no gesture — mirror keeps queueing
      const state = await checkDeckAccess(deckId);
      if (state === "prompt") await requestDeckAccess(deckId);
      else if (state !== "granted") updateOne(deckId, state);
    } catch {
      /* a permission guard must never break the action it guards */
    }
  })();
}

/* ------------------------------------------------------------------ */
/* browser capability hints                                            */
/* ------------------------------------------------------------------ */

/**
 * Recent Chromium builds offer "Allow on every visit" on the permission
 * sheet — pick it once and step 1 finds "granted" forever, so the banner
 * stops appearing. The hint is only truthful there (not in the embedded
 * desktop window, whose prompts the Java side has to handle separately).
 */
export function offersPersistentGrant(): boolean {
  if (typeof window === "undefined") return false;
  if (!("showDirectoryPicker" in window)) return false;
  if ("cefQuery" in window) return false; // embedded desktop webview
  const m = navigator.userAgent.match(/Chrom(?:e|ium)\/(\d+)/);
  return !!m && Number(m[1]) >= 122;
}

/* ------------------------------------------------------------------ */
/* dev-only simulation (window.__ssAccessSim)                          */
/* ------------------------------------------------------------------ */

/**
 * Testing seam for the lapsed-permission flows — a headless browser can't
 * show a real directory picker, and IndexedDB can't store a simulated
 * handle (functions aren't structured-cloneable). Dev builds expose this
 * hook so the console can drive every state; the whole block is eliminated
 * from production bundles (NODE_ENV is substituted statically).
 *
 *   __ssAccessSim.inject(deckId, "prompt" | "denied" | "granted" | "none",
 *                        { folder?: boolean, grantOnRequest?: boolean })
 */
if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
  type SimPermission = "prompt" | "denied" | "granted" | "none";

  /** writable fake file handle — lets the device mirror actually "write" */
  const simFileHandle = (): unknown => ({
    getFile: async (): Promise<unknown> => ({
      name: "simulated.txt",
      size: 0,
      lastModified: Date.now(),
      text: async (): Promise<string> => "",
    }),
    createWritable: async (): Promise<unknown> => ({
      write: async (): Promise<void> => undefined,
      close: async (): Promise<void> => undefined,
    }),
  });

  /** fake subdirectory — empty but walkable/writable for the mirror paths */
  const simDirHandle = (): unknown => ({
    kind: "directory",
    entries: (): { next: () => Promise<unknown> } => ({
      next: async (): Promise<unknown> => ({ done: true, value: undefined }),
    }),
    getFileHandle: async (): Promise<unknown> => simFileHandle(),
    getDirectoryHandle: async (): Promise<unknown> => simDirHandle(),
    removeEntry: async (): Promise<void> => undefined,
  });

  (window as unknown as { __ssAccessSim?: unknown }).__ssAccessSim = {
    async inject(
      deckId: string,
      permission: SimPermission,
      opts: { folder?: boolean; grantOnRequest?: boolean } = {},
    ): Promise<DeckAccessState | undefined> {
      const rec = await getRecord(deckId).catch(() => null);
      if (rec) {
        rec.device = true;
        await putRecord(rec);
      }
      const usable = opts.folder !== false;
      const grantsOnRequest = opts.grantOnRequest !== false;
      // live permission state — a real browser flips queryPermission to
      // "granted" for the rest of the session once requestPermission
      // resolves granted; the sim must model that transition too
      let live: PermissionState = (permission === "none" ? "denied" : permission) as PermissionState;
      const handle = {
        name: "Typescript-101",
        kind: "directory",
        queryPermission: async (): Promise<PermissionState> => live,
        requestPermission: async (): Promise<PermissionState> => {
          if (live === "prompt" && grantsOnRequest) live = "granted";
          return live;
        },
        entries: (): { next: () => Promise<unknown> } => ({
          next: async (): Promise<unknown> => {
            if (live !== "granted") {
              throw Object.assign(new Error("simulated: no permission"), { name: "NotAllowedError" });
            }
            if (!usable) {
              throw Object.assign(new Error("simulated: folder gone"), { name: "NotFoundError" });
            }
            return { done: true, value: undefined };
          },
        }),
        getFileHandle: async (): Promise<unknown> => simFileHandle(),
        getDirectoryHandle: async (name: string, opts?: { create?: boolean }): Promise<unknown> => {
          // "slides" answers "gone" for the post-removal verification in
          // cleanupDeviceProject (create:false) while still existing for
          // the mirror's write paths (create:true) — like a real folder
          if (name === "slides" && !(opts && opts.create)) {
            throw Object.assign(new Error("simulated: removed"), { name: "NotFoundError" });
          }
          return simDirHandle();
        },
        removeEntry: async (): Promise<void> => undefined,
        isSameEntry: async (): Promise<boolean> => false,
      };
      const { setDevHandleOverride } = await import("./browser-store");
      setDevHandleOverride(deckId, permission === "none" ? null : (handle as unknown as DirHandle));
      await refreshAccessStates();
      return getAccessStates()[deckId];
    },
    clear(deckId: string): void {
      void (async () => {
        const { setDevHandleOverride } = await import("./browser-store");
        setDevHandleOverride(deckId, null);
        const rec = await getRecord(deckId).catch(() => null);
        if (rec) {
          rec.device = false;
          await putRecord(rec);
        }
        await refreshAccessStates();
      })();
    },
    states: (): AccessMap => getAccessStates(),
    refresh: (): Promise<AccessMap> => refreshAccessStates(),
  };
}
