"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { io, type Socket } from "socket.io-client";
import type { DeckJson } from "@/lib/stagesmith/types";
import { getCapabilities } from "@/lib/stagesmith/client";

/**
 * Socket sync with the stagesmith-sync mini-service (port 3003 via gateway).
 * Roles: display (presenter, holds token), remote (token required), editor.
 *
 * Connection gating (Problem 02): the sync service only exists next to a
 * LOCAL run of the studio. Browsing from loopback / a LAN IP can always
 * connect directly; any other hostname (hosted deployment or preview
 * gateway) may connect only when the server is a local run (fsWritable).
 * Otherwise no socket is created at all — `unavailable: true` tells the UI
 * to explain that a local run is required instead of reconnecting forever.
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
  sendSlide: (slideId: string, step?: number) => void;
  sendNav: (dir: "next" | "prev") => void;
  sendUi: (ui: { qr?: boolean; overview?: boolean }) => void;
  reportSteps: (slideId: string, steps: number) => void;
  syncDeck: (slides: Array<{ id: string; label: string }>) => void;
}

export function useSync(deckId: string | null, role: SyncRole, token?: string | null, slides?: DeckJson["slides"]): UseSync {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [state, setState] = useState<SyncState | null>(null);
  const [roomToken, setRoomToken] = useState<string | null>(null);
  const [remotes, setRemotes] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const tokenRef = useRef<string | undefined | null>(token);

  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  useEffect(() => {
    if (!deckId) return;
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
      setUnavailable(false);
      active = attach(io(primary, opts));
      setSocket(active);
    };

    let cancelled = false;

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

    return () => {
      cancelled = true;
      active?.removeAllListeners();
      active?.close();
      setSocket(null);
    };
    // re-join when slide list identity changes (after add/delete/reorder)
  }, [deckId, role, slides?.map((s) => s.id).join(",")]);

  const sendSlide = useCallback((slideId: string, step?: number) => {
    socket?.emit("set-slide", { slideId, step, token: tokenRef.current ?? roomToken ?? undefined });
  }, [socket, roomToken]);

  const sendNav = useCallback((dir: "next" | "prev") => {
    socket?.emit("nav", { dir, token: tokenRef.current ?? roomToken ?? undefined });
  }, [socket, roomToken]);

  const sendUi = useCallback((ui: { qr?: boolean; overview?: boolean }) => {
    socket?.emit("set-ui", { ...ui, token: tokenRef.current ?? roomToken ?? undefined });
  }, [socket, roomToken]);

  const reportSteps = useCallback((slideId: string, steps: number) => {
    socket?.emit("report-steps", { slideId, steps });
  }, [socket]);

  const syncDeck = useCallback((slideList: Array<{ id: string; label: string }>) => {
    socket?.emit("sync-deck", { slides: slideList });
  }, [socket]);

  return {
    socket,
    connected,
    state,
    token: roomToken,
    remotes,
    error,
    unavailable,
    sendSlide,
    sendNav,
    sendUi,
    reportSteps,
    syncDeck,
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
