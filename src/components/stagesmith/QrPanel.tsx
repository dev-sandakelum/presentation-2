"use client";

import { useEffect, useMemo, useState } from "react";
import { Copy, RefreshCw, Wifi, X } from "lucide-react";
import { api, type NetworkInfo } from "@/lib/stagesmith/client";
import { copyText } from "./shared";
import { useToast } from "@/hooks/use-toast";

/**
 * QR join panel (plan §7): remote URL + token, connected-phone count.
 * The URL is phone-reachable: when the studio runs on this machine and is
 * browsed from localhost / a LAN IP, the QR encodes http://<lan-ip>:<port>
 * so a phone on the same Wi-Fi network can join; behind a public preview
 * gateway the origin itself is used.
 */
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
  const [net, setNet] = useState<NetworkInfo | null>(null);
  const [sel, setSel] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api
      .networkInfo()
      .then((n) => {
        if (!cancelled) setNet(n);
      })
      .catch(() => {
        /* fall back to current origin below */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const origins = useMemo(() => {
    if (net?.urls?.length) return net.urls;
    return [
      {
        url: typeof window !== "undefined" ? window.location.origin : "",
        ip: "",
        iface: "",
      },
    ];
  }, [net]);

  const origin = origins[Math.min(sel, origins.length - 1)]?.url ?? "";

  const remoteUrl = useMemo(() => {
    return token
      ? `${origin}/?remote=${encodeURIComponent(deckId)}&t=${token}`
      : `${origin}/?remote=${encodeURIComponent(deckId)}`;
  }, [origin, deckId, token]);

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

        {/* LAN origin picker (multiple network interfaces) */}
        {origins.length > 1 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", width: "100%" }}>
            {origins.map((o, i) => (
              <button
                key={o.ip || o.url}
                className="ss-btn"
                style={{
                  height: 24,
                  padding: "0 9px",
                  font: "500 11px var(--ss-mono)",
                  flex: "none",
                  border: i === sel ? "1px solid var(--ss-acc)" : "1px solid var(--ss-line)",
                  color: i === sel ? "var(--ss-ink)" : "var(--ss-mut)",
                  background: i === sel ? "var(--ss-card)" : "transparent",
                }}
                title={o.iface ? `Network interface: ${o.iface}` : o.url}
                onClick={() => setSel(i)}
              >
                {o.ip || "origin"}
              </button>
            ))}
          </div>
        )}

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

        {/* same-network hint */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            width: "100%",
            font: "400 11.5px var(--ss-sans)",
            color: "var(--ss-mut)",
          }}
        >
          <Wifi size={12} style={{ flex: "none" }} />
          <span>
            {net?.hint ??
              "Scan with your phone camera — the remote works as a clicker."}
          </span>
          <button
            className="ss-btn ss-btn-icon"
            style={{ height: 22, width: 22, flex: "none", marginLeft: "auto" }}
            title="Re-check network interfaces"
            onClick={async () => {
              try {
                const n = await api.networkInfo();
                setNet(n);
                setSel(0);
                toast({ title: "Network re-checked" });
              } catch {
                toast({ title: "Network check failed", variant: "destructive" });
              }
            }}
          >
            <RefreshCw size={11} />
          </button>
        </div>

        <div className="ss-qr-count">
          {remotes > 0 ? `${remotes} phone${remotes > 1 ? "s" : ""} connected` : "no phones connected yet"}
        </div>
      </div>
    </div>
  );
}
