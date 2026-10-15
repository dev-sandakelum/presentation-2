"use client";

import { useMemo, useState } from "react";
import { Copy, X } from "lucide-react";
import { copyText } from "./shared";
import { useToast } from "@/hooks/use-toast";

/** QR join panel (plan §7): remote URL + token, connected-phone count */
export function QrPanel({
  deckId,
  token,
  remotes,
  onClose,
  absolute,
}: {
  deckId: string;
  token: string | null;
  remotes: number;
  onClose: () => void;
  absolute?: boolean;
}) {
  const { toast } = useToast();
  const remoteUrl = useMemo(() => {
    const base = typeof window !== "undefined" ? window.location.origin : "";
    return token ? `${base}/?remote=${encodeURIComponent(deckId)}&t=${token}` : `${base}/?remote=${encodeURIComponent(deckId)}`;
  }, [deckId, token]);

  const qrSrc = useMemo(() => `/api/qr?text=${encodeURIComponent(remoteUrl)}`, [remoteUrl]);

  return (
    <div className="ss-qr-backdrop" style={absolute ? { position: "fixed" } : undefined} onClick={onClose}>
      <div className="ss-qr-card" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
          <span className="ss-label">Phone remote — scan to join</span>
          <button className="ss-btn ss-btn-icon" style={{ height: 28, width: 28 }} onClick={onClose} title="Close (Esc)">
            <X size={14} />
          </button>
        </div>
        {token ? (
          <img src={qrSrc} alt="Remote join QR code" />
        ) : (
          <div style={{ width: 220, height: 220, display: "grid", placeItems: "center", border: "1px dashed var(--ss-line-strong)", borderRadius: 10, font: "400 12px var(--ss-sans)", color: "var(--ss-mut)", textAlign: "center", padding: 20 }}>
            Waiting for the sync service to issue a token… open Present once if this persists.
          </div>
        )}
        <div className="ss-qr-url">
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{remoteUrl}</span>
          <button
            className="ss-btn ss-btn-icon"
            style={{ height: 26, width: 26, flex: "none" }}
            title="Copy URL"
            onClick={async () => {
              const ok = await copyText(remoteUrl);
              toast(ok ? { title: "Remote URL copied" } : { title: "Clipboard blocked", variant: "destructive" });
            }}
          >
            <Copy size={12} />
          </button>
        </div>
        <div className="ss-qr-count">
          {remotes > 0 ? `${remotes} phone${remotes > 1 ? "s" : ""} connected` : "no phones connected yet"}
        </div>
      </div>
    </div>
  );
}
