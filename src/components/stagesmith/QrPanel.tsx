"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  Copy,
  Download,
  MonitorSmartphone,
  Play,
  RefreshCw,
  RotateCw,
  ScrollText,
  Square,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { api, type NetworkInfo } from "@/lib/stagesmith/client";
import { copyText } from "./shared";
import { useToast } from "@/hooks/use-toast";
import { useDesktopServer } from "@/hooks/useDesktopServer";

/** desktop app download page (releases) */
const DESKTOP_APP_URL = "https://github.com/dev-sandakelum/chasse-studio-desktop/releases";

/**
 * QR join panel (plan §7): remote URL + token, connected-phone count.
 * Three shapes depending on where the studio runs (useDesktopServer):
 *
 *  - desktop app webview, trusted  → embedded LAN server control panel:
 *    start/stop/restart, interface picker, QR + copy, phone count, log tail.
 *  - desktop app webview, untrusted → config-mismatch card (expected vs
 *    current origin — the app must point its app URL at this page).
 *  - normal browser → the classic panel. The URL is phone-reachable when the
 *    studio runs on this machine and is browsed from localhost / a LAN IP:
 *    the QR encodes http://<lan-ip>:<port> so a phone on the same Wi-Fi
 *    network can join. Otherwise (hosted deployment) the blocked card points
 *    at the desktop app download instead of a broken QR.
 *
 * Honest states (Problem 02):
 *  - `unavailable` (hosted deployment / desktop server stopped) or
 *    `connected === false` → no QR at all, an explanatory card instead.
 *  - token → QR + copy + network hint (as before).
 *  - no token yet → waiting state.
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
  /** is the sync transport connected? (from useSync) — QR only when true */
  connected?: boolean;
  /** sync impossible for this deployment (hosted) — show the desktop-app card */
  unavailable?: boolean;
}) {
  const { toast } = useToast();
  const desktop = useDesktopServer();
  const [net, setNet] = useState<NetworkInfo | null>(null);
  const [sel, setSel] = useState(0);
  const [logOpen, setLogOpen] = useState(false);
  const logRef = useRef<HTMLDivElement | null>(null);

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

  /* ---- desktop (ready mode) derived values ---- */
  const st = desktop.status;
  const running = st?.status === "running";
  const host = st?.selectedAddress ?? "0.0.0.0";
  const desktopRemoteUrl = useMemo(() => {
    if (!st) return null;
    return `http://${st.selectedAddress ?? "0.0.0.0"}:${st.port}/remote?deck=${encodeURIComponent(deckId)}&t=${token ?? ""}`;
  }, [st, deckId, token]);
  const desktopQrSrc = useMemo(
    () => (desktopRemoteUrl ? `/api/qr?text=${encodeURIComponent(desktopRemoteUrl)}` : ""),
    [desktopRemoteUrl],
  );
  const selectedAddr = st?.addresses.find((a) => a.address === st.selectedAddress) ?? null;
  const selectedIface = selectedAddr?.display ?? selectedAddr?.iface ?? null;
  const selectedIsVirtual = selectedAddr?.virtual === true;

  // auto-scroll the log tail when it's open
  useEffect(() => {
    if (logOpen && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [desktop.logs, logOpen]);

  const copyRemoteUrl = async (url: string) => {
    const ok = await copyText(url);
    toast(ok ? { title: "Remote URL copied" } : { title: "Clipboard blocked", variant: "destructive" });
  };

  const statusRow = (() => {
    if (!st) return { dot: "var(--ss-faint)", color: "var(--ss-mut)", label: "Checking the server…" };
    if (st.status === "running")
      return { dot: "var(--ss-ok)", color: "var(--ss-ok)", label: `Running on ${host}:${st.port}` };
    if (st.status === "starting") return { dot: "var(--ss-warn)", color: "var(--ss-warn)", label: "Starting…" };
    if (st.status === "error") return { dot: "var(--ss-err)", color: "var(--ss-err)", label: "Server error" };
    return { dot: "var(--ss-faint)", color: "var(--ss-mut)", label: "Server stopped" };
  })();

  return (
    <div className="ss-qr-backdrop" style={absolute ? { position: "fixed" } : undefined} onClick={onClose}>
      <div className="ss-qr-card" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
          <span className="ss-label">
            {desktop.mode === "ready" ? "Phone remote — desktop app" : "Phone remote — scan to join"}
          </span>
          <button className="ss-btn ss-btn-icon" style={{ height: 28, width: 28 }} onClick={onClose} title="Close (Esc)">
            <X size={14} />
          </button>
        </div>

        {/* ============================ desktop app — trusted ============================ */}
        {desktop.mode === "ready" && (
          <>
            {/* status row */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                width: "100%",
                font: "500 12px var(--ss-sans)",
                color: statusRow.color,
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  flex: "none",
                  background: statusRow.dot,
                  animation: st?.status === "starting" ? "ss-pulse 1.4s ease-in-out infinite" : undefined,
                }}
              />
              <span>{statusRow.label}</span>
              {st?.status === "error" && st.error ? (
                <span
                  title={st.error}
                  style={{
                    flex: 1,
                    font: "400 11px var(--ss-mono)",
                    color: "var(--ss-err)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {st.error}
                </span>
              ) : null}
            </div>

            {/* lifecycle buttons */}
            <div style={{ display: "flex", gap: 8, width: "100%" }}>
              {running || st?.status === "starting" ? (
                <>
                  <button
                    className="ss-btn"
                    style={{ height: 30, flex: 1 }}
                    disabled={desktop.busy}
                    onClick={() => void desktop.restart()}
                  >
                    <RotateCw size={13} /> Restart
                  </button>
                  <button
                    className="ss-btn"
                    style={{ height: 30, flex: 1 }}
                    disabled={desktop.busy}
                    onClick={() => void desktop.stop()}
                  >
                    <Square size={12} /> Stop
                  </button>
                </>
              ) : (
                <button
                  className="ss-btn ss-btn-acc"
                  style={{ height: 32, flex: 1 }}
                  disabled={desktop.busy}
                  onClick={() => void desktop.start()}
                >
                  <Play size={13} /> Start server
                </button>
              )}
            </div>

            {/* QR / waiting / stopped note */}
            {running ? (
              token && desktopRemoteUrl ? (
                <img src={desktopQrSrc} alt="Remote join QR code" style={{ width: 220, height: 220 }} />
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
                    Waiting for the deck session…
                    <span style={{ display: "block", marginTop: 6, opacity: 0.85 }}>
                      Open the deck or start presenting — the session starts automatically.
                    </span>
                  </span>
                </div>
              )
            ) : st?.status === "starting" ? (
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
                Starting the server…
              </div>
            ) : st?.status === "stopped" ? (
              <div
                style={{
                  width: "100%",
                  font: "400 11.5px/1.55 var(--ss-sans)",
                  color: "var(--ss-mut)",
                  textAlign: "center",
                  padding: "4px 6px",
                }}
              >
                The server runs only on this machine while the desktop app is open. Phones connect over your
                local network — never through the internet.
              </div>
            ) : null}

            {/* remote URL row */}
            {running && token && desktopRemoteUrl && (
              <div className="ss-qr-url">
                <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{desktopRemoteUrl}</span>
                <button
                  className="ss-btn ss-btn-icon"
                  style={{ height: 26, width: 26, flex: "none" }}
                  title="Copy URL"
                  onClick={() => void copyRemoteUrl(desktopRemoteUrl)}
                >
                  <Copy size={12} />
                </button>
              </div>
            )}

            {/* interface picker (multiple network interfaces; virtual adapters
                are de-prioritised and labelled — they rarely reach a phone) */}
            {st && st.addresses.length > 1 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", width: "100%" }}>
                {st.addresses.map((a) => {
                  const active = a.address === st.selectedAddress;
                  return (
                    <button
                      key={a.address}
                      className="ss-btn"
                      style={{
                        height: 24,
                        padding: "0 9px",
                        font: "500 11px var(--ss-mono)",
                        flex: "none",
                        border: active ? "1px solid var(--ss-acc)" : "1px solid var(--ss-line)",
                        color: active ? "var(--ss-ink)" : "var(--ss-mut)",
                        background: active ? "var(--ss-hov)" : "transparent",
                        opacity: a.virtual && !active ? 0.65 : 1,
                      }}
                      title={`Network interface: ${a.display ?? a.iface}${a.virtual ? " (virtual adapter — usually can't reach a phone)" : ""}`}
                      onClick={() => void desktop.selectAddress(a.address)}
                    >
                      {a.address}
                      {a.virtual ? " ·vm" : ""}
                    </button>
                  );
                })}
              </div>
            )}
            {selectedIface && (
              <div style={{ width: "100%", marginTop: -4, font: "400 11px var(--ss-sans)", color: "var(--ss-mut)" }}>
                Interface: {selectedIface}
                {selectedIsVirtual ? " — virtual adapter (usually can't reach a phone)" : ""}
              </div>
            )}

            {/* phone count */}
            <div className="ss-qr-count" style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: remotes > 0 ? "var(--ss-ok)" : "var(--ss-faint)",
                  boxShadow: remotes > 0 ? "0 0 8px var(--ss-acc-glow)" : undefined,
                }}
              />
              {remotes > 0 ? `${remotes} phone${remotes > 1 ? "s" : ""} connected` : "No phones connected yet"}
            </div>

            {/* collapsible server log */}
            <div style={{ width: "100%" }}>
              <button
                className="ss-btn"
                style={{ height: 24, padding: "0 10px", font: "500 11px var(--ss-mono)", color: "var(--ss-mut)" }}
                onClick={() => setLogOpen((o) => !o)}
                aria-expanded={logOpen}
              >
                <ScrollText size={12} />
                Server log
                <ChevronDown
                  size={12}
                  style={{ transform: logOpen ? "rotate(180deg)" : "none", transition: "transform .15s" }}
                />
              </button>
              {logOpen && (
                <div
                  ref={logRef}
                  className="ss-scroll"
                  style={{
                    marginTop: 6,
                    maxHeight: 110,
                    overflowY: "auto",
                    border: "1px solid var(--ss-line)",
                    borderRadius: 8,
                    background: "var(--ss-panel2)",
                    padding: "6px 8px",
                    font: "400 10.5px/1.6 var(--ss-mono)",
                  }}
                >
                  {desktop.logs.length === 0 ? (
                    <div style={{ color: "var(--ss-faint)" }}>No server activity yet.</div>
                  ) : (
                    desktop.logs.slice(-60).map((l, i) => (
                      <div
                        key={`${l.ts}-${i}`}
                        title={l.text}
                        style={{
                          color:
                            l.level === "error"
                              ? "var(--ss-err)"
                              : l.level === "warn"
                                ? "var(--ss-warn)"
                                : "var(--ss-mut)",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {l.text}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* hints */}
            <div
              style={{
                width: "100%",
                display: "flex",
                flexDirection: "column",
                gap: 5,
                font: "400 11px/1.5 var(--ss-sans)",
                color: "var(--ss-mut)",
                borderTop: "1px solid var(--ss-line)",
                paddingTop: 10,
              }}
            >
              <div style={{ display: "flex", gap: 7 }}>
                <Wifi size={12} style={{ flex: "none", marginTop: 1 }} />
                <span>Scan with your phone — both devices must be on the same Wi-Fi/network.</span>
              </div>
              <div style={{ display: "flex", gap: 7 }}>
                <MonitorSmartphone size={12} style={{ flex: "none", marginTop: 1 }} />
                <span>
                  Campus or guest Wi-Fi often blocks device-to-device traffic (client isolation) — if the link
                  won't open, try a phone hotspot or another network.
                </span>
              </div>
              <div style={{ paddingLeft: 19 }}>
                If your firewall asks, allow inbound connections to port {st ? st.port : "…"}.
              </div>
            </div>
          </>
        )}

        {/* ============================ desktop app — untrusted ============================ */}
        {desktop.mode === "untrusted" && (
          <div
            style={{
              width: 280,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 10,
              padding: "22px 18px",
              border: "1px dashed var(--ss-line-strong)",
              borderRadius: 10,
              font: "400 12px/1.55 var(--ss-sans)",
              color: "var(--ss-mut)",
              textAlign: "center",
            }}
          >
            <MonitorSmartphone size={22} style={{ flex: "none", color: "var(--ss-mut)" }} />
            <div style={{ font: "600 13px var(--ss-sans)", color: "var(--ss-ink)" }}>
              Desktop app — different page
            </div>
            <div>
              The desktop app is running, but this page isn't the app URL it trusts
              {desktop.info?.appUrl ? (
                <>
                  {" "}
                  (expected{" "}
                  <span style={{ font: "500 11px var(--ss-mono)", color: "var(--ss-ink2)" }}>
                    {desktop.info.appUrl}
                  </span>
                  , this page is{" "}
                  <span style={{ font: "500 11px var(--ss-mono)", color: "var(--ss-ink2)" }}>
                    {typeof window !== "undefined" ? window.location.origin : ""}
                  </span>
                  )
                </>
              ) : null}
              . Use File → Change app URL… in the desktop app.
            </div>
          </div>
        )}

        {/* ============================ bridge detection in progress ============================ */}
        {desktop.mode === "checking" && (
          <div
            style={{
              width: 220,
              minHeight: 120,
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
            Connecting to the desktop app…
          </div>
        )}

        {/* ============================ normal browser (no bridge) ============================ */}
        {desktop.mode === "absent" && (
          <>
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
                  width: 280,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 10,
                  padding: "22px 18px",
                  border: "1px dashed var(--ss-line-strong)",
                  borderRadius: 10,
                  font: "400 12px/1.55 var(--ss-sans)",
                  color: "var(--ss-mut)",
                  textAlign: "center",
                }}
              >
                <WifiOff size={22} style={{ flex: "none", color: "var(--ss-mut)" }} />
                <div style={{ font: "600 13px var(--ss-sans)", color: "var(--ss-ink)" }}>
                  Phone remote needs the desktop app
                </div>
                <div>
                  The remote control needs the Chassé Studio desktop app — it starts a small local server on
                  your machine that your phone connects to over Wi-Fi. A website alone can't do that.
                </div>
                <a
                  className="ss-btn ss-btn-acc"
                  href={DESKTOP_APP_URL}
                  target="_blank"
                  rel="noreferrer"
                  style={{ height: 32, padding: "0 14px", textDecoration: "none" }}
                >
                  <Download size={13} /> Download the desktop app
                </a>
                <div style={{ font: "400 11px var(--ss-sans)", color: "var(--ss-faint)" }}>
                  or run the studio locally (bun run dev / npm run dev) and open it from this machine
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
                    It starts automatically with the desktop app or a local dev run (bun run dev / npm run
                    dev).
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
                  onClick={() => void copyRemoteUrl(remoteUrl)}
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
          </>
        )}
      </div>
    </div>
  );
}
