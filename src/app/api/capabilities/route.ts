import fs from "fs/promises";
import path from "path";
import { DECKS_ROOT } from "@/lib/stagesmith/store";

/**
 * GET /api/capabilities — what this deployment can do.
 *
 * Hosted/serverless deployments (Vercel & co.) ship a READ-ONLY file system,
 * so decks cannot be stored under decks/. The client asks this route once and
 * routes new decks to the browser store when the server can't write.
 *
 *   { fsWritable: boolean }
 */

let cached: boolean | null = null;

async function probeFsWritable(): Promise<boolean> {
  if (process.env.SS_FORCE_READONLY === "1") return false;
  if (cached !== null) return cached;
  try {
    const probe = path.join(DECKS_ROOT, `.probe-${Date.now().toString(36)}`);
    await fs.mkdir(DECKS_ROOT, { recursive: true });
    await fs.writeFile(probe, "ok", "utf8");
    await fs.rm(probe, { force: true });
    cached = true;
  } catch {
    // EROFS / EACCES / read-only container → server-side deck storage is off
    cached = false;
  }
  return cached;
}

export async function GET() {
  return Response.json(
    { fsWritable: await probeFsWritable() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
