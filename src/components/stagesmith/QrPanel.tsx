"use client";

import { useEffect, useMemo, useState } from "react";
import { Copy, RefreshCw, Wifi, WifiOff, X } from "lucide-react";
import { api, type NetworkInfo } from "@/lib/stagesmith/client";
import { copyText } from "./shared";
import { useToast } from "@/hooks/use-toast";

/**
 * QR join panel (plan §7): remote URL + token, connected-phone count.
 * The URL is phone-reachable: when the studio runs on this machine and is
 * browsed from localhost / a LAN IP, the QR encodes http://<lan-ip>:<port>
 * so a phone on the same Wi-Fi network can join; behind a public preview
 * gateway the origin itself is used.
 *
 * Honest states (Problem 02):
 *  - `unavailable` (hosted deployment) or `connected === false` → no QR at
 *    all, an explanatory card instead: the phone remote needs a LOCAL run.
 *  - token → QR + copy + network hint (as before).
 *  - no token yet → waiting state (the token now mints on any join, so no
 *    "open Present once" advice — just a hint about port 3003).
 */
export function QrPanel({
  deckId,
  token,
  remotes,
  onClose,
  absolute,
  connected = true,
  unavailable = false,
}: {
  deckId: string;
  token: string | null;
  remotes: number;
  onClose: () => void;
  absolute?: boolean;
  /** is the sync socket connected? (from useSync) — QR only when true */
  connected?: boolean;
  /** sync impossible for this deployment (hosted) — show the local-run card */
  unavailable?: boolean;
}) {
  const { toast } = useToast();
  const [net, setNet] = useState<NetworkInfo | null>(null);
  const [sel, setSel] = useState(0);

  // no QR (and no remote link) when the sync service can't exist / isn't up
  const blocked = unavailable || connected === false;

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

        {/* LAN origin picker (multiple network interfaces) — QR only */}
        {!blocked && origins.length > 1 && (
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
                  background: i === sel ? "var(--ss-hov)" : "transparent",
                }}
                title={o.iface ? `Network interface: ${o.iface}` : o.url}
                onClick={() => setSel(i)}
              >
                {o.ip || "origin"}
              </button>
            ))}
          </div>
        )}

        {blocked ? (
          /* hosted / sync down — explain instead of a broken QR */
          <div
            style={{
              width: 220,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 10,
              padding: "22px 18px",
              border: "1px dashed var(--ss-line-strong)",
              borderRadius: 10,
              font: "400 12px var(--ss-sans)",
              color: "var(--ss-mut)",
              textAlign: "center",
            }}
          >
            <WifiOff size={22} style={{ flex: "none", color: "var(--ss-mut)" }} />
            <div style={{ font: "600 13px var(--ss-sans)", color: "var(--ss-ink)" }}>
              Phone remote needs a local run
            </div>
            <div>
              The sync service runs beside the app when you run Chassé Studio locally (bun run dev / npm run
              dev — it starts automatically). A hosted deployment cannot start a server on your machine or
              link your phone.
            </div>
          </div>
        ) : token ? (
          <img src={qrSrc} alt="Remote join QR code" />
        ) : (
          <div
            style={{
              width: 220,
              height: 220,
              display: "grid",
              placeItems: "center",
              border: "1px dashed var(--ss-line-strong)",
              borderRadius: 10,
              font: "400 12px var(--ss-sans)",
              color: "var(--ss-mut)",
              textAlign: "center",
              padding: 20,
            }}
          >
            <span>
              Waiting for the sync service…
              <span style={{ display: "block", marginTop: 6, opacity: 0.85 }}>
                The sync service starts automatically with a local run — if this persists, check that port
                3003 is free.
              </span>
            </span>
          </div>
        )}

        {/* remote URL row — hidden when blocked (a hosted URL is not a remote link) */}
        {!blocked && (
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
        )}

        {/* same-network hint — only meaningful when a QR can actually work */}
        {!blocked && (
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
        )}

        <div className="ss-qr-count">
          {remotes > 0 ? `${remotes} phone${remotes > 1 ? "s" : ""} connected` : "no phones connected yet"}
        </div>
      </div>
    </div>
  );
}
