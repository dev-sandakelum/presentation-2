"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  call,
  getBridgeInfo,
  hasCefQuery,
  subscribe,
  type DesktopBridgeInfo,
  type DesktopServerStatus,
} from "@/lib/stagesmith/desktop-bridge";

/**
 * Desktop app server control (QR panel) — independent of useSync.
 *
 * Resolves WHERE the panel runs:
 *  - "absent"   normal browser — no window.cefQuery at all
 *  - "checking" bridge present, confirming origin trust
 *  - "ready"    trusted bridge — the embedded LAN server is controllable
 *  - "untrusted" bridge present but this page is not the configured app URL
 *
 * In "ready" mode it exposes the live server status (server-status events +
 * an initial getServerStatus pull), the log tail (server-log events + a
 * getServerLog seed, capped) and start/stop/restart/selectAddress actions.
 *
 * Resilience (PROBLEM 09): events are the fast path, but every lifecycle
 * call ALSO polls getServerStatus for a few seconds afterwards — poll
 * results are only applied while no event has arrived for that call, so the
 * poll can never fight or revert the (newer) event stream, yet the panel
 * still converges if pushes are slow or lost.
 */

export type DesktopBridgeMode = "absent" | "checking" | "ready" | "untrusted";

export interface DesktopServerLogLine {
  ts: number;
  level: "info" | "warn" | "error";
  text: string;
}

const LOG_CAP = 200;
/** lifecycle poll: every 700ms … */
const POLL_INTERVAL_MS = 700;
/** … for at most ~8s — enough for a slow port bind or a busy machine */
const POLL_MAX_TRIES = 12;

export function useDesktopServer(): {
  mode: DesktopBridgeMode;
  info: Pick<DesktopBridgeInfo, "appUrl" | "platform" | "version"> | null;
  status: DesktopServerStatus | null;
  logs: DesktopServerLogLine[];
  /** a start/stop/restart call is in flight */
  busy: boolean;
  start(): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;
  selectAddress(address: string): Promise<void>;
} {
  // lazy init: "checking" right away when the bridge exists (the panel only
  // mounts client-side, so there is no hydration value to agree with)
  const [mode, setMode] = useState<DesktopBridgeMode>(() => (hasCefQuery() ? "checking" : "absent"));
  const [info, setInfo] = useState<Pick<DesktopBridgeInfo, "appUrl" | "platform" | "version"> | null>(null);
  const [status, setStatus] = useState<DesktopServerStatus | null>(null);
  const [logs, setLogs] = useState<DesktopServerLogLine[]>([]);
  const [busy, setBusy] = useState(false);
  const statusRef = useRef<DesktopServerStatus | null>(null);
  /** bumped on EVERY received server-status event (poll-fallback gating) */
  const statusEventSeq = useRef(0);

  /* ---- bridge detection + trust handshake ---- */
  useEffect(() => {
    if (!hasCefQuery()) {
      setMode("absent");
      return;
    }
    setMode("checking");
    let cancelled = false;
    getBridgeInfo()
      .then((i) => {
        if (cancelled) return;
        if (i?.trusted) {
          setInfo({ appUrl: i.appUrl, platform: i.platform, version: i.version });
          setMode("ready");
        } else {
          setMode("untrusted");
        }
      })
      .catch(() => {
        if (!cancelled) setMode("untrusted");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /* ---- live status + log tail ---- */
  useEffect(() => {
    const unsub = subscribe((e) => {
      if (e.type === "server-status") {
        const st: DesktopServerStatus = {
          status: e.status,
          port: e.port,
          addresses: e.addresses ?? [],
          selectedAddress: e.selectedAddress ?? null,
          error: e.error ?? null,
        };
        statusEventSeq.current += 1;
        statusRef.current = st;
        setStatus(st);
      } else if (e.type === "server-log") {
        setLogs((prev) => {
          const next = [...prev, { ts: e.ts, level: e.level, text: e.text }];
          return next.length > LOG_CAP ? next.slice(next.length - LOG_CAP) : next;
        });
      }
    });
    return unsub;
  }, []);

  /* ---- initial state once the bridge is trusted ---- */
  useEffect(() => {
    if (mode !== "ready") return;
    let cancelled = false;
    call<DesktopServerStatus>("getServerStatus")
      .then((st) => {
        // events are authoritative once one has arrived — only seed the
        // initial snapshot (the pull may resolve after a fresher push)
        if (cancelled || !st || statusRef.current) return;
        statusRef.current = st;
        setStatus(st);
      })
      .catch(() => {
        /* events will deliver the status */
      });
    // seed the log tail once (live lines keep streaming via server-log events)
    call<{ lines: DesktopServerLogLine[] }>("getServerLog")
      .then((r) => {
        if (cancelled || !r?.lines?.length) return;
        setLogs((prev) => (prev.length ? prev : r.lines.slice(-LOG_CAP)));
      })
      .catch(() => {
        /* events will deliver the logs */
      });
    return () => {
      cancelled = true;
    };
  }, [mode]);

  const runLifecycle = useCallback(async (action: "startServer" | "stopServer" | "restartServer") => {
    setBusy(true);
    const seqAtCall = statusEventSeq.current;
    const applyPolled = (st: DesktopServerStatus) => {
      // only while NO server-status event has arrived for this call — the
      // event stream stays authoritative and can never be reverted by a poll
      if (statusEventSeq.current !== seqAtCall) return;
      statusRef.current = st;
      setStatus(st);
    };
    const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    try {
      await call(action);
      const wantsRunning = action !== "stopServer";
      for (let i = 0; i < POLL_MAX_TRIES; i += 1) {
        await wait(POLL_INTERVAL_MS);
        if (statusEventSeq.current !== seqAtCall) break; // events took over
        try {
          const st = await call<DesktopServerStatus>("getServerStatus");
          if (st) applyPolled(st);
          if (statusEventSeq.current !== seqAtCall) break;
          if (wantsRunning ? st?.status === "running" : st?.status === "stopped") break;
        } catch {
          break; // bridge hiccup — events remain the only path
        }
      }
    } catch {
      /* no toast — the panel renders errors from status.error */
    } finally {
      setBusy(false);
    }
  }, []);

  const start = useCallback(() => runLifecycle("startServer"), [runLifecycle]);
  const stop = useCallback(() => runLifecycle("stopServer"), [runLifecycle]);
  const restart = useCallback(() => runLifecycle("restartServer"), [runLifecycle]);

  const selectAddress = useCallback(async (address: string) => {
    try {
      const r = await call<{ selectedAddress: string }>("selectAddress", { address });
      if (r?.selectedAddress) {
        // apply immediately (the QR regenerates); server-status confirms
        statusRef.current = statusRef.current
          ? { ...statusRef.current, selectedAddress: r.selectedAddress }
          : statusRef.current;
        setStatus((s) => (s ? { ...s, selectedAddress: r.selectedAddress } : s));
      }
    } catch {
      /* no toast — the panel renders errors from status.error */
    }
  }, []);

  return { mode, info, status, logs, busy, start, stop, restart, selectAddress };
}
