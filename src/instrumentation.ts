/**
 * Next.js instrumentation hook (Problem 02) — auto-start the phone-remote
 * sync service so ONE command (`bun run dev` / `npm run dev`) brings up both
 * the app (:3000) and the socket.io sync server (:3003).
 *
 * The implementation lives in ./instrumentation-node and is imported
 * dynamically ONLY for the Node.js runtime — this file is also parsed for
 * the Edge runtime, which must never pull in node builtins.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
