import fs from "fs/promises";
import os from "os";
import path from "path";
import { DECKS_ROOT } from "@/lib/stagesmith/store";

const MAX_DIRS = 600;

/**
 * GET /api/fs?path=<absolute dir> — directory browser used by the
 * "New project…" dialog. Lists folders only (never file contents).
 */
export async function GET(req: Request) {
  try {
    const raw = new URL(req.url).searchParams.get("path");
    const home = os.homedir();
    const target = raw ? path.resolve(String(raw)) : home;

    if (target.includes("\0")) {
      return Response.json({ error: "Bad path" }, { status: 400 });
    }
    const st = await fs.stat(target);
    if (!st.isDirectory()) {
      return Response.json({ error: `Not a folder: ${target}` }, { status: 400 });
    }

    const entries = await fs.readdir(target, { withFileTypes: true });
    const dirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules")
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

    let writable = true;
    try {
      await fs.access(target, fs.constants.W_OK);
    } catch {
      writable = false;
    }

    const parent = path.dirname(target) === target ? null : path.dirname(target);
    return Response.json({
      path: target,
      parent,
      home,
      decksRoot: DECKS_ROOT,
      writable,
      dirs: dirs.slice(0, MAX_DIRS),
      truncated: dirs.length > MAX_DIRS,
    });
  } catch {
    return Response.json({ error: "Folder not found" }, { status: 400 });
  }
}

/**
 * POST /api/fs — create a new (empty) folder, so "New project…" can set up
 * a fresh location inline. Only folders — never files.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const target = path.resolve(String(body.path || ""));
    if (!body.path || String(body.path).includes("\0") || !path.isAbsolute(target)) {
      return Response.json({ error: "Bad path" }, { status: 400 });
    }
    const parent = path.dirname(target);
    const pst = await fs.stat(parent).catch(() => null);
    if (!pst || !pst.isDirectory()) {
      return Response.json({ error: `Parent folder does not exist: ${parent}` }, { status: 400 });
    }
    const est = await fs.stat(target).catch(() => null);
    if (est) {
      return Response.json({ error: `“${path.basename(target)}” already exists` }, { status: 400 });
    }
    try {
      await fs.access(parent, fs.constants.W_OK);
    } catch {
      return Response.json({ error: `No write permission in ${parent}` }, { status: 400 });
    }
    await fs.mkdir(target, { recursive: false });
    return Response.json({ ok: true, path: target });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
