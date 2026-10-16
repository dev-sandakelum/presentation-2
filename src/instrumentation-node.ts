/**
 * Node-only implementation of the instrumentation hook (Problem 02) —
 * auto-start the phone-remote sync service. Imported dynamically from
 * ./instrumentation.ts, so the Edge runtime never sees these node builtins.
 *
 * Guards:
 *  - never on Vercel (serverless can't run a long-lived local server, and a
 *    QR to the hosted URL would be wrong for a phone remote anyway)
 *  - opt-out via SS_NO_SYNC=1
 *  - idempotent: skip when :3003 is already listening (e.g. the service was
 *    started manually / by a dev script) + a module-level double-spawn guard
 *
 * NEVER throws — a failed auto-start must not take the app server down.
 */

let spawnAttempted = false;

export async function register() {
  if (process.env.VERCEL) {
    console.log("[sync] Vercel/hosted environment — stagesmith-sync not started");
    return;
  }
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.SS_NO_SYNC) {
    console.log("[sync] SS_NO_SYNC set — stagesmith-sync auto-start disabled");
    return;
  }
  if (spawnAttempted) return;
  spawnAttempted = true;

  try {
    // plain node builtins — this module is only ever imported for the
    // nodejs runtime (see ./instrumentation.ts)
    const [{ spawn, spawnSync }, fs, net, path] = await Promise.all([
      import("node:child_process"),
      import("node:fs"),
      import("node:net"),
      import("node:path"),
    ]);

    /* ---- is a sync service already listening on :3003? ---- */
    const portInUse = await new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        try {
          probe.destroy();
        } catch {
          /* already closed */
        }
        resolve(ok);
      };
      const probe = net.createConnection({ port: 3003, host: "127.0.0.1" });
      probe.once("connect", () => finish(true));
      probe.once("error", () => finish(false));
      const timer = setTimeout(() => finish(false), 1500);
      timer.unref?.();
    });
    if (portInUse) {
      console.log("[sync] stagesmith-sync already running on :3003 — not spawning");
      return;
    }

    /* ---- locate the project root (cwd for `next dev`, walk up otherwise) ---- */
    const marker = path.join("mini-services", "stagesmith-sync", "index.ts");
    const starts: string[] = [process.cwd()];
    try {
      if (typeof __dirname === "string" && __dirname) starts.push(__dirname);
    } catch {
      /* ESM-compiled context — process.cwd() is enough */
    }
    let root: string | null = null;
    for (const start of starts) {
      let dir = path.resolve(start);
      for (let i = 0; i < 12; i++) {
        try {
          if (fs.existsSync(path.join(dir, marker))) {
            root = dir;
            break;
          }
        } catch {
          /* keep walking up */
        }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
      if (root) break;
    }
    if (!root) {
      console.warn("[sync] could not locate mini-services/stagesmith-sync — skipping auto-start");
      return;
    }

    const serviceDir = path.join(root, "mini-services", "stagesmith-sync");

    /* ---- pick a runner: bun --hot (preferred) → local tsx → npx tsx ---- */
    let cmd: string;
    let args: string[];
    let bunOk = false;
    try {
      const v = spawnSync("bun", ["--version"], { encoding: "utf8", timeout: 8000 });
      bunOk = v.status === 0 && Boolean(v.stdout && v.stdout.trim());
    } catch {
      bunOk = false;
    }
    if (bunOk) {
      cmd = "bun";
      args = ["--hot", "index.ts"];
    } else {
      const tsxBin = path.join(serviceDir, "node_modules", ".bin", "tsx");
      if (fs.existsSync(tsxBin)) {
        cmd = tsxBin;
        args = ["index.ts"];
      } else {
        cmd = "npx";
        args = ["tsx", "index.ts"];
      }
    }

    /* ---- spawn detached, output appended to the service's sync.log ---- */
    let stdio: "ignore" | ["ignore", number, number] = "ignore";
    let logFd: number | null = null;
    try {
      logFd = fs.openSync(path.join(serviceDir, "sync.log"), "a");
      stdio = ["ignore", logFd, logFd];
    } catch {
      /* fall back to silent stdio */
    }

    const child = spawn(cmd, args, {
      cwd: serviceDir,
      detached: true,
      stdio,
      env: { ...process.env },
    });
    child.on("error", (err) => {
      // async spawn failures (ENOENT etc.) must never crash the app server
      console.warn("[sync] stagesmith-sync process error:", (err as Error).message);
    });
    child.unref();
    if (logFd !== null) {
      try {
        fs.closeSync(logFd); // the child keeps its own inherited copies
      } catch {
        /* nothing to do */
      }
    }

    console.log(`[sync] stagesmith-sync spawned on :3003 (${cmd} ${args.join(" ")}, pid ${child.pid})`);
  } catch (e) {
    console.warn("[sync] auto-start of stagesmith-sync failed (app continues without it):", (e as Error)?.message ?? e);
  }
}
