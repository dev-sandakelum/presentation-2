import QRCode from "qrcode";

/** GET /api/qr?text=<url> → PNG QR for the remote join panel */
export async function GET(req: Request) {
  const text = new URL(req.url).searchParams.get("text") || "";
  if (!text || text.length > 2048) {
    return Response.json({ error: "Bad text" }, { status: 400 });
  }
  const buf = await QRCode.toBuffer(text, {
    width: 440,
    margin: 1,
    errorCorrectionLevel: "M",
    color: { dark: "#000000", light: "#ffffff" },
  });
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "no-store",
    },
  });
}
