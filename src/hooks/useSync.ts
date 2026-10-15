"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { io, type Socket } from "socket.io-client";
import type { DeckJson } from "@/lib/stagesmith/types";

/**
 * Socket sync with the stagesmith-sync mini-service (port 3003 via gateway).
 * Roles: display (presenter, holds token), remote (token required), editor.
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
  const tokenRef = useRef<string | undefined | null>(token);

  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  useEffect(() => {
    if (!deckId) return;
    // Gateway pattern for the public preview (single exposed port).
    // When browsing the dev server directly on localhost there is no
    // gateway in front, so connect to the sync service directly.
    const onLocalhost =
      typeof window !== "undefined" &&
      (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
    const url = onLocalhost ? `http://${window.location.hostname}:3003` : "/?XTransformPort=3003";
    const s = io(url, {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelay: 1000,
      timeout: 10000,
    });
    setSocket(s);

    s.on("connect", () => {
      setConnected(true);
      setError(null);
      s.emit("join", {
        deckId,
        role,
        token: tokenRef.current ?? undefined,
        slides: slides || undefined,
      });
    });
    s.on("disconnect", () => setConnected(false));
    s.on("connect_error", () => setConnected(false));

    s.on("joined", (data: { state: SyncState; token?: string | null }) => {
      setState(data.state);
      if (data.token) setRoomToken(data.token);
    });
    s.on("state", (st: SyncState) => setState(st));
    s.on("presence", (p: { remotes: number }) => setRemotes(p.remotes));
    s.on("error", (e: { message?: string }) => setError(e?.message || "Sync error"));

    return () => {
      s.disconnect();
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
