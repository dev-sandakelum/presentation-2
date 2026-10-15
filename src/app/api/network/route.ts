import os from "os";

/**
 * GET /api/network — tells the QR panel which URL a phone on the same
 * network can scan. When the editor is browsed from localhost or a LAN
 * IP, we hand out http://<lan-ip>:<port>; behind a public gateway the
 * request origin itself is phone-reachable, so we hand that back.
 */

interface LanCandidate {
  url: string;
  ip: string;
  iface: string;
}

const PRIVATE_RE =
  /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/;

function lanCandidates(port: number): LanCandidate[] {
  const out: LanCandidate[] = [];
  for (const [iface, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== "IPv4" || a.internal) continue;
      if (!PRIVATE_RE.test(a.address)) continue;
      out.push({ ip: a.address, iface, url: `http://${a.address}:${port}` });
    }
  }
  // typical Wi-Fi ranges first (192.168, then 10, then 172)
  const rank = (ip: string) =>
    ip.startsWith("192.168.") ? 0 : ip.startsWith("10.") ? 1 : 2;
  out.sort((a, b) => rank(a.ip) - rank(b.ip) || a.ip.localeCompare(b.ip));
  return out;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const host = req.headers.get("host") || "";
  const hostname = host.split(":")[0] || url.hostname;

  const isLoopback =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]";
  const isPrivateIp = PRIVATE_RE.test(hostname);
  const isRawIp = /^\d+\.\d+\.\d+\.\d+$/.test(hostname);

  // the port this app was reached on (fallback: env or 3000)
  const hostPort = host.includes(":") ? Number(host.split(":").pop()) : NaN;
  const port =
    Number.isFinite(hostPort) && hostPort > 0
      ? hostPort
      : process.env.PORT
        ? Number(process.env.PORT)
        : 3000;

  const lan = lanCandidates(port);
  // when the page itself is browsed via a private IP, that address is
  // proven reachable from this network — offer it as a candidate too
  if (isPrivateIp && !lan.some((c) => c.ip === hostname)) {
    lan.push({ ip: hostname, iface: "current", url: `http://${hostname}:${port}` });
  }
  const lanMode = (isLoopback || isPrivateIp || (isRawIp && !isPrivateIp)) && lan.length > 0;

  return Response.json(
    {
      mode: lanMode ? "lan" : "origin",
      /** how this page was reached */
      origin: url.origin,
      hostname,
      port,
      /** lanMode: phone-reachable URLs on this machine; originMode: [origin] */
      urls: lanMode ? lan : [{ url: url.origin, ip: hostname, iface: "" }],
      hint: lanMode
        ? "Phone must be on the same Wi-Fi network as this computer."
        : "Reachable through the public preview URL — any network works.",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
