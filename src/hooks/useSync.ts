"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { io, type Socket } from "socket.io-client";
import type { DeckJson } from "@/lib/stagesmith/types";
import { getCapabilities } from "@/lib/stagesmith/client";
import {
  call,
  getBridgeInfo,
  isDesktopBridgeAvailable,
  subscribe,
  type DesktopServerStatus,
} from "@/lib/stagesmith/desktop-bridge";

/**
 * Room sync for the phone remote. Two transports:
 *
 *  - "desktop" — inside the Chassé Studio desktop app webview: a trusted
 *    CefMessageRouter bridge (window.cefQuery) drives the app's embedded
 *    LAN sync server. No socket.io is used at all; state, presence and the
 *    room token arrive as sync-* bridge events. `serverStatus` mirrors the
 *    embedded server (stopped/starting/running/error).
 *
 *  - "socket" — the original transport, still fully intact: the
 *    stagesmith-sync mini-service (port 3003 via gateway) beside a LOCAL
 *    run of the studio, plus the app-served phone remote view (?remote=).
 *    Connection gating (Problem 02): the sync service only exists next to a
 *    LOCAL run. Browsing from loopback / a LAN IP can always connect
 *    directly; any other hostname (hosted deployment or preview gateway)
 *    may connect only when the server is a local run (fsWritable).
 *    Otherwise no socket is created at all — `unavailable: true` tells the
 *    UI to explain that the phone remote needs the desktop app instead of
 *    reconnecting forever.
 *
 * Transport selection happens once per deck/session: if window.cefQuery
 * exists (and the role is not "remote"), getBridgeInfo() confirms trust —
 * trusted → desktop mode, untrusted/failed → the socket path unchanged.
 */

export interface SyncState {
  deckId: string;
  slideId: string | null;
  index: number;
  step: number;
  steps: number;
  order: Array<{ id: string; label: string }>;
  updatedAt: number;
}

export type SyncRole = "display" | "remote" | "editor";

export interface UseSync {
  socket: Socket | null;
  connected: boolean;
  state: SyncState | null;
  token: string | null;
  remotes: number;
  error: string | null;
  /** true when NO sync service can exist for this deployment (e.g. hosted) — no socket is created */
  unavailable: boolean;
  /** which transport is live: "desktop" (app bridge) | "socket" (:3003 mini-service) | null (none yet) */
  transport: "socket" | "desktop" | null;
  /** desktop bridge only: embedded server status (null on the socket transport) */
  serverStatus: DesktopServerStatus | null;
  sendSlide: (slideId: string, step?: number) => void;
  sendNav: (dir: "next" | "prev") => void;
  sendUi: (ui: { qr?: boolean; overview?: boolean }) => void;
  reportSteps: (slideId: string, steps: number) => void;
  syncDeck: (slides: Array<{ id: string; label: string }>) => void;
  /** desktop bridge only: push presenter notes for a slide to the room (no-op elsewhere) */
  setNotes: (slideId: string, note: string) => void;
}

function bridgeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function useSync(deckId: string | null, role: SyncRole, token?: string | null, slides?: DeckJson["slides"]): UseSync {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [state, setState] = useState<SyncState | null>(null);
  const [roomToken, setRoomToken] = useState<string | null>(null);
  const [remotes, setRemotes] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [transport, setTransport] = useState<"socket" | "desktop" | null>(null);
  const [serverStatus, setServerStatus] = useState<DesktopServerStatus | null>(null);
  const tokenRef = useRef<string | undefined | null>(token);
  const transportRef = useRef<"socket" | "desktop" | null>(null);
  const deckIdRef = useRef<string | null>(deckId);
  const joinedRef = useRef(false);
  const serverStatusRef = useRef<DesktopServerStatus | null>(null);

  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  useEffect(() => {
    deckIdRef.current = deckId;
  }, [deckId]);

  useEffect(() => {
    if (!deckId) return;

    let cancelled = false;
    let stop: (() => void) | null = null;

    /* ---------------- desktop bridge transport (app webview) ---------------- */

    const startDesktop = () => {
      transportRef.current = "desktop";
      setTransport("desktop");
      setUnavailable(false);
      setSocket(null);

      let stopped = false;
      let retried = false;

      const applyServerStatus = (st: DesktopServerStatus) => {
        serverStatusRef.current = st;
        setServerStatus(st);
        setConnected(st.status === "running" && joinedRef.current);
        // reconnect-after-start: if the initial join failed while the server
        // was down, try once more the moment it reports running
        if (st.status === "running" && !joinedRef.current && !retried) {
          retried = true;
          join();
        }
      };

      const join = async () => {
        try {
          const data = await call<{ state: SyncState; token: string }>("joinRoom", {
            deckId,
            role,
            slides: slides?.map((s) => ({ id: s.id, label: s.label })),
          });
          if (stopped) return;
          joinedRef.current = true;
          setState(data.state);
          setRoomToken(data.token);
          setError(null);
          setConnected(serverStatusRef.current?.status === "running");
        } catch (e) {
          if (stopped) return;
          setError(bridgeError(e));
        }
      };

      join();

      // rooms live in the Java process independent of the LAN server — join
      // works even while stopped, but the initial server snapshot is still
      // needed to know whether phones can actually connect
      call<DesktopServerStatus>("getServerStatus")
        .then((st) => {
          if (!stopped && st && !serverStatusRef.current) applyServerStatus(st);
        })
        .catch(() => {
          /* events will deliver the status */
        });

      const unsub = subscribe((ev) => {
        if (stopped) return;
        if (ev.type === "server-status") {
          applyServerStatus({
            status: ev.status,
            port: ev.port,
            addresses: ev.addresses ?? [],
            selectedAddress: ev.selectedAddress ?? null,
            error: ev.error ?? null,
          });
          return;
        }
        if (ev.type === "server-log") return; // consumed by the QR panel, not the room
        if (ev.deckId !== deckId) return;
        if (ev.type === "sync-state") setState(ev.state);
        else if (ev.type === "sync-presence") setRemotes(ev.remotes);
        else if (ev.type === "sync-token") setRoomToken(ev.token);
      });

      stop = () => {
        stopped = true;
        unsub();
        joinedRef.current = false;
        serverStatusRef.current = null;
        transportRef.current = null;
        setTransport(null);
        setServerStatus(null);
        setConnected(false);
        setState(null);
        setRemotes(0);
        setRoomToken(null);
      };
    };

    /* ---------------- socket.io transport (local runs / fallback) ---------------- */

    const startSocket = () => {
      // How do we reach the sync service (socket.io, port 3003)?
      // - localhost / LAN IP → direct http://<hostname>:3003 (phone remote on
      //   the same Wi-Fi lands here: the page host IS the machine's IP)
      // - gateway/preview hostnames → the gateway path, with the direct URL
      //   as a fallback (and vice-versa) in case the primary fails.
      const hostname =
        typeof window !== "undefined" ? window.location.hostname : "localhost";
      const isLoopback =
        hostname === "localhost" ||
        hostname === "127.0.0.1" ||
        hostname === "::1" ||
        hostname === "[::1]";
      const isPrivateIp =
        /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(hostname);
      const direct = isLoopback || isPrivateIp;

      const opts = {
        transports: ["websocket", "polling"] as ("websocket" | "polling")[],
        reconnection: true,
        reconnectionDelay: 1000,
        timeout: 10000,
      };

      let active: Socket | null = null;
      let swapped = false;

      const attach = (sock: Socket): Socket => {
        sock.on("connect", () => {
          setConnected(true);
          setError(null);
          sock.emit("join", {
            deckId,
            role,
            token: tokenRef.current ?? undefined,
            slides: slides || undefined,
          });
        });
        sock.on("disconnect", () => setConnected(false));
        sock.on("connect_error", () => {
          setConnected(false);
          // primary unreachable (e.g. firewall blocks :3003) → try the other route once
          if (!swapped && active === sock) {
            swapped = true;
            sock.removeAllListeners();
            sock.close();
            const next = attach(io(secondary, opts));
            active = next;
            setSocket(next);
          }
        });
        sock.on("joined", (data: { state: SyncState; token?: string | null }) => {
          setState(data.state);
          if (data.token) setRoomToken(data.token);
        });
        sock.on("state", (st: SyncState) => setState(st));
        sock.on("presence", (p: { remotes: number }) => setRemotes(p.remotes));
        sock.on("error", (e: { message?: string }) => setError(e?.message || "Sync error"));
        return sock;
      };

      const directUrl = `http://${hostname}:3003`;
      const gatewayUrl = "/?XTransformPort=3003";
      const primary = direct ? directUrl : gatewayUrl;
      const secondary = direct ? gatewayUrl : directUrl;

      const connect = () => {
        transportRef.current = "socket";
        setTransport("socket");
        setUnavailable(false);
        active = attach(io(primary, opts));
        setSocket(active);
      };

      if (direct) {
        // local / same-network browsing — the sync service is spawnable/reachable
        connect();
      } else {
        // Hosted or preview hostname: only a LOCAL run behind a gateway has a
        // sync service (fsWritable === true). On serverless hosting neither the
        // gateway route nor a direct :3003 exists — stay offline and say so.
        getCapabilities()
          .then((caps) => {
            if (cancelled) return;
            if (caps.fsWritable) {
              connect();
            } else {
              setUnavailable(true);
              setRoomToken(null);
            }
          })
          .catch(() => {
            if (cancelled) return;
            setUnavailable(true);
            setRoomToken(null);
          });
      }

      stop = () => {
        cancelled = true;
        active?.removeAllListeners();
        active?.close();
        setSocket(null);
      };
    };

    /* ---------------- transport selection ---------------- */

    if (role !== "remote" && isDesktopBridgeAvailable()) {
      // Inside the desktop app webview (probably): confirm the bridge trusts
      // this origin before committing to the desktop transport. A foreign
      // page (or a dead bridge) falls back to the socket path unchanged.
      getBridgeInfo()
        .then((info) => {
          if (cancelled) return;
          if (info?.trusted) startDesktop();
          else startSocket();
        })
        .catch(() => {
          if (!cancelled) startSocket();
        });
    } else {
      startSocket();
    }

    return () => {
      cancelled = true;
      stop?.();
    };
    // re-join when slide list identity changes (after add/delete/reorder)
  }, [deckId, role, slides?.map((s) => s.id).join(",")]);

  const sendSlide = useCallback((slideId: string, step?: number) => {
    if (transportRef.current === "desktop") {
      const id = deckIdRef.current;
      if (!id || !joinedRef.current) return;
      call("setSlide", { deckId: id, slideId, step }).catch((e) => setError(bridgeError(e)));
      return;
    }
    socket?.emit("set-slide", { slideId, step, token: tokenRef.current ?? roomToken ?? undefined });
  }, [socket, roomToken]);

  const sendNav = useCallback((dir: "next" | "prev") => {
    if (transportRef.current === "desktop") {
      const id = deckIdRef.current;
      if (!id || !joinedRef.current) return;
      call("nav", { deckId: id, dir }).catch((e) => setError(bridgeError(e)));
      return;
    }
    socket?.emit("nav", { dir, token: tokenRef.current ?? roomToken ?? undefined });
  }, [socket, roomToken]);

  const sendUi = useCallback((ui: { qr?: boolean; overview?: boolean }) => {
    if (transportRef.current === "desktop") {
      const id = deckIdRef.current;
      if (!id || !joinedRef.current) return;
      call("setUi", { deckId: id, ...ui }).catch((e) => setError(bridgeError(e)));
      return;
    }
    socket?.emit("set-ui", { ...ui, token: tokenRef.current ?? roomToken ?? undefined });
  }, [socket, roomToken]);

  const reportSteps = useCallback((slideId: string, steps: number) => {
    if (transportRef.current === "desktop") {
      const id = deckIdRef.current;
      if (!id || !joinedRef.current) return;
      call("reportSteps", { deckId: id, slideId, steps }).catch((e) => setError(bridgeError(e)));
      return;
    }
    socket?.emit("report-steps", { slideId, steps });
  }, [socket]);

  const syncDeck = useCallback((slideList: Array<{ id: string; label: string }>) => {
    if (transportRef.current === "desktop") {
      const id = deckIdRef.current;
      if (!id || !joinedRef.current) return;
      call("syncDeck", { deckId: id, slides: slideList.map(({ id: sid, label }) => ({ id: sid, label })) })
        .catch((e) => setError(bridgeError(e)));
      return;
    }
    socket?.emit("sync-deck", { slides: slideList });
  }, [socket]);

  const setNotes = useCallback((slideId: string, note: string) => {
    if (transportRef.current !== "desktop") return; // socket transport: notes are not relayed
    const id = deckIdRef.current;
    if (!id || !joinedRef.current) return;
    call("setNotes", { deckId: id, slideId, note }).catch((e) => setError(bridgeError(e)));
  }, []);

  return {
    socket,
    connected,
    state,
    token: roomToken,
    remotes,
    error,
    unavailable: transport === "desktop"
      ? serverStatus !== null && serverStatus.status !== "running"
      : unavailable,
    transport,
    serverStatus,
    sendSlide,
    sendNav,
    sendUi,
    reportSteps,
    syncDeck,
    setNotes,
  };
}

/** Subscribe to `deck-updated` broadcasts (live edit while presenting) */
export function useDeckUpdated(socket: Socket | null, cb: () => void) {
  const cbRef = useRef(cb);
  cbRef.current = cb;
  useEffect(() => {
    if (!socket) return;
    const handler = () => cbRef.current();
    socket.on("deck-updated", handler);
    return () => {
      socket.off("deck-updated", handler);
    };
  }, [socket]);
}
