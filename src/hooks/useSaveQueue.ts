"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/stagesmith/client";
import { onMirrorStatus, getMirrorStatus, retryMirror } from "@/lib/stagesmith/device";

/**
 * useSaveQueue — the editor's ONE save pipeline (save-reliability fix).
 *
 * Contract:
 *   · ONE save runs at a time; changes made while it runs merge into the
 *     next run (autosave and Ctrl+S can never race or pile up)
 *   · debounced autosave (~600 ms after the last keystroke)
 *   · Ctrl+S / explicit flush skips the debounce
 *   · a save never waits forever: ~30 s timeout, then a clear error
 *   · automatic retry with backoff (1 s → 3 s → 10 s), then a Failed state
 *     with the reason and a Retry button — buffers always stay in memory
 *   · pending edits are flushed when the tab hides / the app closes, and a
 *     recovery copy of unsaved text buffers is kept in localStorage so a
 *     crash right after an edit never loses it (restored on next open)
 *   · every run logs what it wrote: files, bytes, milliseconds
 *   · device-folder mirror health is surfaced as a non-blocking warning
 *     (the browser store is the primary — a folder sync issue never blocks)
 */

const SAVE_DEBOUNCE_MS = 600;
const SAVE_TIMEOUT_MS = 30_000;
const RETRY_BACKOFF_MS = [1_000, 3_000, 10_000];

export type SavePhase = "idle" | "unsaved" | "saving" | "saved" | "failed";

export interface SaveQueueOptions {
  /** snapshot of the CURRENTLY dirty buffers — called at the start of each run */
  collect: () => Array<{ path: string; content: string; allowEmptyOverwrite?: boolean }>;
  /** a run succeeded — clear dirty flags (paths whose buffer still matches
   *  the saved content), adopt the new deck signature */
  onSaved: (saved: Array<{ path: string; content: string; allowEmptyOverwrite?: boolean }>, signature: string) => void;
}

export interface SaveQueueState {
  phase: SavePhase;
  /** failure reason (phase === "failed") */
  error: string | null;
  /** device-folder mirror warning (null while healthy) */
  mirrorWarning: string | null;
  /** a change happened — (re)start the debounced autosave */
  notifyChange: () => void;
  /** save RIGHT NOW, skipping the debounce (Ctrl+S, tab close, Retry) */
  saveNow: () => void;
  /** explicit retry after a failed run */
  retry: () => void;
  /** retry the device-folder mirror after a sync failure */
  retryMirror: () => void;
}

/* ------------------------------------------------------------------ */
/* crash recovery (localStorage — synchronous, survives a hard close)   */
/* ------------------------------------------------------------------ */

const RECOVERY_PREFIX = "ss-recovery::";
const RECOVERY_MAX_BYTES = 2 * 1024 * 1024;

function recoveryKey(deckId: string): string {
  return `${RECOVERY_PREFIX}${deckId}`;
}

export function writeRecoverySnapshot(deckId: string, entries: Array<{ path: string; content: string }>): void {
  try {
    if (!entries.length) {
      window.localStorage.removeItem(recoveryKey(deckId));
      return;
    }
    const total = entries.reduce((n, e) => n + e.content.length, 0);
    if (total > RECOVERY_MAX_BYTES) return; // too big for localStorage — in-memory + queue still protect
    window.localStorage.setItem(
      recoveryKey(deckId),
      JSON.stringify({ savedAt: Date.now(), files: Object.fromEntries(entries.map((e) => [e.path, e.content])) }),
    );
  } catch {
    /* quota / private mode — in-memory retention + the save queue still protect */
  }
}

export function clearRecoverySnapshot(deckId: string): void {
  try {
    window.localStorage.removeItem(recoveryKey(deckId));
  } catch {
    /* ignore */
  }
}

export function readRecoverySnapshot(deckId: string): Record<string, string> | null {
  try {
    const raw = window.localStorage.getItem(recoveryKey(deckId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { savedAt: number; files: Record<string, string> };
    if (!parsed?.files || typeof parsed.files !== "object") return null;
    return parsed.files;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* the hook                                                            */
/* ------------------------------------------------------------------ */

export function useSaveQueue(deckId: string, opts: SaveQueueOptions): SaveQueueState {
  const [phase, setPhase] = useState<SavePhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [mirrorWarning, setMirrorWarning] = useState<string | null>(null);

  const optsRef = useRef(opts);
  optsRef.current = opts;

  const runningRef = useRef(false);
  const pendingRunRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptsRef = useRef(0);
  const cancelledRef = useRef(false);

  const run = useCallback(async (): Promise<void> => {
    if (runningRef.current) {
      pendingRunRef.current = true; // coalesce: changes merge into the next run
      return;
    }
    runningRef.current = true;
    try {
      const entries = optsRef.current.collect();
      if (!entries.length) {
        setPhase((p) => (p === "failed" ? p : "saved"));
        return;
      }
      setPhase("saving");
      const t0 = performance.now();
      const bytes = entries.reduce((n, e) => n + e.content.length, 0);
      try {
        const sig = await withTimeout(api.saveFiles(deckId, entries), SAVE_TIMEOUT_MS, "Save timed out — storage seems busy or blocked. It will retry.");
        if (cancelledRef.current) return;
        const ms = Math.round(performance.now() - t0);
        console.info(`[save] ${entries.length} file(s), ${bytes} B in ${ms} ms${attemptsRef.current ? ` (attempt ${attemptsRef.current + 1})` : ""} — ${entries.map((e) => e.path).join(", ")}`);
        attemptsRef.current = 0;
        setError(null);
        clearRecoverySnapshot(deckId);
        optsRef.current.onSaved(entries, sig);
        setPhase("saved");
      } catch (e) {
        if (cancelledRef.current) return;
        attemptsRef.current += 1;
        const backoff = RETRY_BACKOFF_MS[attemptsRef.current - 1];
        const msg = (e as Error)?.message || String(e);
        if (backoff !== undefined) {
          // automatic retry with backoff — keep the "Saving…" state, buffers stay in memory
          console.warn(`[save] attempt ${attemptsRef.current} failed (${msg}) — retrying in ${backoff} ms`);
          if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
          retryTimerRef.current = setTimeout(() => {
            retryTimerRef.current = null;
            void run();
          }, backoff);
        } else {
          console.warn(`[save] giving up after ${attemptsRef.current} attempts: ${msg}`);
          setError(msg);
          setPhase("failed");
          // keep a recovery copy of what never made it to storage
          writeRecoverySnapshot(deckId, optsRef.current.collect());
        }
      }
    } finally {
      runningRef.current = false;
      if (pendingRunRef.current) {
        pendingRunRef.current = false;
        void run(); // changes that arrived mid-run get their own (merged) run
      }
    }
  }, [deckId]);

  const notifyChange = useCallback(() => {
    setPhase((p) => (p === "saving" ? p : "unsaved"));
    // a fresh change resets the automatic-retry ladder
    attemptsRef.current = 0;
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      void run();
    }, SAVE_DEBOUNCE_MS);
  }, [run]);

  const saveNow = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    void run();
  }, [run]);

  const retry = useCallback(() => {
    attemptsRef.current = 0;
    setError(null);
    saveNow();
  }, [saveNow]);

  /* flush on tab hide / app close — plus a synchronous recovery copy so a
   * hard close right after an edit can't lose it */
  useEffect(() => {
    const flushAndSnapshot = () => {
      const entries = optsRef.current.collect();
      if (entries.length) {
        writeRecoverySnapshot(deckId, entries);
        void run();
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flushAndSnapshot();
    };
    const onPageHide = () => flushAndSnapshot();
    window.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onPageHide);
    return () => {
      window.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onPageHide);
    };
  }, [deckId, run]);

  /* device-mirror health → non-blocking warning (Retry re-runs the sync) */
  useEffect(() => {
    const apply = () => {
      const st = getMirrorStatus(deckId);
      setMirrorWarning(st && !st.ok ? st.error ?? "Device folder sync failed" : null);
    };
    apply();
    return onMirrorStatus((id) => {
      if (id === deckId) apply();
    });
  }, [deckId]);

  /* cleanup on unmount / deck switch */
  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, [deckId]);

  return {
    phase,
    error,
    mirrorWarning,
    notifyChange,
    saveNow,
    retry,
    retryMirror: () => {
      setMirrorWarning(null);
      void retryMirror(deckId);
    },
  };
}

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(message)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}
