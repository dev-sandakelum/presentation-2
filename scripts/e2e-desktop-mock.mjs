#!/usr/bin/env node
/**
 * End-to-end desktop-mode test — the REAL app (dev server) + a mock of the
 * Java desktop bridge.
 *
 * What it verifies (the golden path of the Task-5 fix, browser-side):
 *   1. the app detects the bridge (hello → "fs" capability → root configured)
 *      and makes the desktop store ACTIVE at startup
 *   2. "New deck" creates the deck through fs.createDeck — real files appear
 *      in the mock's decks folder (a temp dir on this machine)
 *   3. typing in the editor runs the save queue: Unsaved → Saving… → Saved,
 *      and the edited file content lands ON DISK
 *   4. a reload re-reads everything from disk — persistence across restarts
 *      (the thing the in-memory JCEF profile used to destroy)
 *   5. the in-app PromptDialog opens for "New file" (window.prompt is dead in
 *      the webview)
 *
 * Requires:
 *   - the dev server:      bun run dev          (or `next dev -p $PORT`)
 *   - playwright-core + a chromium binary (the repo's scripts/debug-*.mjs use
 *     ~/.cache/ms-playwright/chromium_headless_shell-1200)
 *
 * Run:  node scripts/e2e-desktop-mock.mjs
 * Env:   E2E_BASE_URL (default http://localhost:3100)
 */
import { chromium } from "playwright-core";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASE_URL = process.env.E2E_BASE_URL || "http://localhost:3100";
const CHROME = process.env.CHROME_BIN ||
  process.env.HOME + "/.cache/ms-playwright/chromium_headless_shell-1200/chrome-headless-shell-linux64/chrome-headless-shell";

const TMP = join(ROOT, ".tmp-e2e-desktop");
rmSync(TMP, { recursive: true, force: true });
mkdirSync(join(TMP, "decks"), { recursive: true });

const DECK_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

function checkRelPath(rel) {
  if (rel == null || rel === "") throw err("BAD_REQUEST", "path must not be empty");
  if (rel.length > 240) throw err("BAD_REQUEST", "too long");
  if (rel.includes("\0") || rel.includes("\\")) throw err("BAD_REQUEST", "illegal characters");
  if (rel.startsWith("/")) throw err("BAD_REQUEST", "must be relative");
  for (const seg of rel.split("/")) {
    if (seg === "" || seg === "." || seg === "..") throw err("BAD_REQUEST", "illegal segment");
  }
}
function err(code, message) {
  return Object.assign(new Error(message || code), { code });
}

/* the Java side (FsService semantics, real files in TMP/decks) */
const received = []; // every command the page sends — the observable for step 1
const root = resolve(join(TMP, "decks"));
const java = {
  async dispatch(req) {
    received.push(req.cmd || req.action);
    try {
      // protocol v1 actions (sync) — enough for useSync's desktop transport.
      // Responses are wrapped {id, ok, data} exactly like Java's respondOk.
      if (req.action) {
        let data;
        switch (req.action) {
          case "getBridgeInfo":
            data = { trusted: true, version: "1.3.0", platform: "test", appUrl: "" };
            break;
          case "getServerStatus":
            data = { status: "running", port: 8765, addresses: [{ address: "192.168.1.5", iface: "eth0" }], selectedAddress: "192.168.1.5", error: null };
            break;
          case "getServerLog":
            data = { lines: [] };
            break;
          case "joinRoom":
            data = {
              state: {
                deckId: req.payload?.deckId || "",
                slideId: null,
                index: 0,
                step: 0,
                steps: 1,
                order: req.payload?.slides || [],
                note: null,
                updatedAt: Date.now(),
              },
              token: "e2emock123456",
            };
            break;
          case "setSlide":
          case "nav":
          case "reportSteps":
          case "syncDeck":
          case "setNotes":
          case "setUi":
          case "startServer":
          case "stopServer":
          case "restartServer":
          case "selectAddress":
          case "ping":
            data = { ok: true };
            break;
          default:
            return { id: req.id ?? null, ok: false, error: `mock: unhandled action ${req.action}` };
        }
        return { id: req.id ?? null, ok: true, data };
      }
      switch (req.cmd) {
        case "hello":
          return { app: "chasse-desktop", version: "1.3.0", capabilities: ["sync", "fs", "downloads"] };
        case "fs.getRoot":
          return { configured: true, path: root, valid: existsSync(root) };
        case "fs.chooseRoot":
          return { configured: true, path: root, valid: existsSync(root) };
        case "fs.listDecks": {
          const out = [];
          for (const name of readdirSync(root)) {
            const dir = join(root, name);
            if (!statSync(dir).isDirectory() || !DECK_ID.test(name)) continue;
            if (!existsSync(join(dir, "deck.json"))) continue;
            const deck = JSON.parse(readFileSync(join(dir, "deck.json"), "utf8"));
            out.push({ id: name, title: deck.title || name, folder: dir, slides: (deck.slides || []).length, modified: deck.modified || "" });
          }
          return out;
        }
        case "fs.readText": {
          checkRelPath(req.path);
          const f = join(root, req.deck, req.path);
          if (!existsSync(f)) throw err("NOT_FOUND", "file not found");
          return { text: readFileSync(f, "utf8") };
        }
        case "fs.writeText": {
          checkRelPath(req.path);
          const f = join(root, req.deck, req.path);
          mkdirSync(dirname(f), { recursive: true });
          writeFileSync(f, req.text ?? "", "utf8");
          return { ok: true };
        }
        case "fs.createDeck": {
          const dir = join(root, req.deck);
          if (existsSync(dir)) throw err("ALREADY_EXISTS", "exists");
          mkdirSync(dir, { recursive: true });
          for (const [p, t] of Object.entries(req.files || {})) {
            if (p === "deck.json") continue;
            mkdirSync(dirname(join(dir, p)), { recursive: true });
            writeFileSync(join(dir, p), t, "utf8");
          }
          writeFileSync(join(dir, "deck.json"), req.files["deck.json"], "utf8");
          return { ok: true, id: req.deck };
        }
        case "fs.deleteDeck":
          rmSync(join(root, req.deck), { recursive: true, force: true });
          return { ok: true };
        case "fs.duplicateDeck": {
          const dst = join(root, req.copyId);
          mkdirSync(dst, { recursive: true });
          const walk = (d, pre) => {
            for (const n of readdirSync(d)) {
              const p = join(d, n);
              if (statSync(p).isDirectory()) walk(p, `${pre}${n}/`);
              else {
                mkdirSync(dirname(join(dst, pre + n)), { recursive: true });
                writeFileSync(join(dst, pre + n), readFileSync(p));
              }
            }
          };
          walk(join(root, req.deck), "");
          return { ok: true, id: req.copyId };
        }
        case "fs.listFiles": {
          const base = join(root, req.deck, req.dir || "");
          if (!existsSync(base)) return [];
          return readdirSync(base).map((name) => {
            const st = statSync(join(base, name));
            return { name, size: st.isDirectory() ? 0 : st.size, modified: Math.round(st.mtimeMs), directory: st.isDirectory() || undefined };
          });
        }
        case "fs.delete":
          rmSync(join(root, req.deck, req.path));
          return { ok: true };
        case "fs.fileUrl":
          throw err("IO_ERROR", "file server disabled in this mock");
        default:
          throw err("UNKNOWN_CMD", `unknown command: ${req.cmd}`);
      }
    } catch (e) {
      throw e.code ? e : err("IO_ERROR", String(e));
    }
  },
};

let passed = 0;
let failed = 0;
const ok = (cond, name) => {
  if (cond) {
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } else {
    failed++;
    console.error(`  \x1b[31m✗\x1b[0m ${name}`);
  }
};

console.log("\n\x1b[1mE2E desktop-mode (mock bridge)\x1b[0m");

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox", "--disable-gpu"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

const consoleErrors = [];
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(`console.error: ${m.text()}`);
});

// the cefQuery mock: wired BEFORE any app code runs (JCEF parity)
await page.exposeFunction("__mockCefQuery", async (request) => {
  try {
    const data = await java.dispatch(JSON.parse(request));
    return JSON.stringify(data);
  } catch (e) {
    // the contract's error shape travels via onSuccess — desktop-fs detects {code,message}
    return JSON.stringify({ code: e.code || "IO_ERROR", message: e.message });
  }
});
await page.addInitScript(`
  window.cefQuery = function ({ request, onSuccess, onFailure }) {
    window.__mockCefQuery(request).then(
      (json) => onSuccess(json),
      (e) => onFailure(-1, String(e)),
    );
  };
`);

await page.goto(BASE_URL + "/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);

console.log("\n1. bridge detection + desktop store active");
ok((await page.evaluate(() => typeof window.cefQuery)) === "function", "window.cefQuery present (JCEF parity)");
await page.waitForTimeout(1500);
ok(received.includes("hello"), `hello reached the bridge (saw: ${[...new Set(received)].join(", ")})`);
ok(received.includes("fs.getRoot"), "fs.getRoot reached the bridge");
ok(received.includes("fs.listDecks"), "fs.listDecks reached the bridge — the desktop store is ACTIVE");
// when the root is configured+valid the library shows NO folder banner
const bannerGone = (await page.getByText("Choose the folder where Chassé Studio should keep your decks").count()) === 0;
ok(bannerGone, "no choose-folder banner — root is already configured+valid");

console.log("\n2. New deck via the UI → fs.createDeck on real disk");
await page.getByRole("button", { name: "New deck" }).first().click();
await page.waitForTimeout(600);
const dialog = page.getByRole("dialog");
await dialog.waitFor({ state: "visible", timeout: 10000 });
const titleInput = dialog.getByRole("textbox").first();
await titleInput.fill("E2E Desktop Deck");
await page.getByRole("button", { name: "Create", exact: true }).click();
await page.waitForURL(/deck=/, { timeout: 15000, waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
const deckDir = join(TMP, "decks");
const decks = existsSync(deckDir) ? readdirSync(deckDir) : [];
ok(decks.length === 1, `exactly one deck folder created through the bridge (got: ${decks.join(", ") || "none"})`);
const deckId = decks[0];
ok(existsSync(join(deckDir, deckId, "deck.json")), "deck.json on disk");
const deckJson = JSON.parse(readFileSync(join(deckDir, deckId, "deck.json"), "utf8"));
ok(deckJson.title === "E2E Desktop Deck", "deck.json has the typed title");

console.log("\n3. edit → save queue → content on disk");
// click into the CodeMirror editor of the selected slide and type
await page.locator(".cm-content").first().click();
await page.keyboard.type("// AUDIT-E2E-EDIT\n");
await page.waitForTimeout(400);
const chipDuringUnsaved = await page.evaluate(() =>
  [...document.querySelectorAll("button,span,div")].map((e) => e.textContent || "").find((t) => /^(Unsaved|Saving…?|Saved|Failed)$/.test(t.trim())) || null,
);
ok(/Unsaved|Saving/.test(chipDuringUnsaved || ""), `save chip moves first (${(chipDuringUnsaved || "").trim()})`);
await page.waitForFunction(
  () => [...document.querySelectorAll("button,span,div")].some((e) => (e.textContent || "").trim() === "Saved"),
  { timeout: 20000 },
);
ok(true, "save chip reached Saved");
await page.waitForTimeout(800);
const slidePath = join(deckDir, deckId, "slides", deckJson.slides[0].id + ".tsx");
ok(existsSync(slidePath), "slide .tsx on disk");
ok(readFileSync(slidePath, "utf8").includes("AUDIT-E2E-EDIT"), "the typed edit is in the file on disk");

console.log("\n4. reload → persistence (the thing the in-memory profile destroyed)");
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector(".cm-content", { timeout: 20000 });
await page.waitForTimeout(2500);
const afterReload = await page.evaluate(() => document.querySelector(".cm-content")?.textContent || "");
ok(afterReload.includes("AUDIT-E2E-EDIT"), "edit survives the reload (re-read from disk)");

console.log("\n5. in-app PromptDialog replaces window.prompt (New file)");
// window.prompt would hang/dead in the webview — assert it is never called
await page.evaluate(() => {
  window.__promptCalled = false;
  window.prompt = () => {
    window.__promptCalled = true;
    return "should-not-happen";
  };
});
// open the BG code editor and click "New file"
await page.getByRole("button", { name: "BG", exact: true }).nth(1).click().catch(() => {});
await page.getByRole("button", { name: "BG", exact: true }).first().click().catch(() => {});
await page.waitForTimeout(400);
await page.locator('button[title="New file"], button:has-text("New file")').first().click().catch(() => {});
await page.waitForTimeout(600);
const promptCalled = await page.evaluate(() => window.__promptCalled);
ok(promptCalled === false, "window.prompt never called");
const dialogVisible = await page.getByText("New bg code file").isVisible().catch(() => false);
ok(dialogVisible, "the in-app PromptDialog opened instead");

console.log("\n6. console health");
const relevantErrors = consoleErrors.filter(
  (e) =>
    !/Download the React DevTools|Fast Refresh|HMR|autoprefixer|favicon|DevTools|net::ERR_CONNECTION_REFUSED|WebSocket connection/i.test(e),
);
ok(relevantErrors.length === 0, `no console/page errors (${relevantErrors.length ? relevantErrors.slice(0, 3).join(" | ") : "clean"})`);

await browser.close();
rmSync(TMP, { recursive: true, force: true });

console.log(`\n${failed === 0 ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m"} — ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
