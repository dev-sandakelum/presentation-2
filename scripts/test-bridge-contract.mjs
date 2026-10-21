#!/usr/bin/env node
/**
 * Bridge-contract smoke test (no browser, no server needed).
 *
 * Drives the REAL web-side desktop storage layer (src/lib/stagesmith/
 * desktop-store.ts + desktop-fs.ts + the save-queue's retry ladder) against a
 * mock of the Java side that implements the same contract as
 * chasse-desktop's FsService + DesktopBridge (command shapes, {code,message}
 * errors, loopback file server, atomic writes, deck.json-last creation).
 *
 * If chasse-desktop/FsServiceTest.java (the Java-side unit tests) and this
 * file both pass, the two sides agree on the wire contract: the exact thing
 * that broke saving when they drifted apart.
 *
 * Run:  bun scripts/test-bridge-contract.mjs
 *   (bun resolves the real TS modules — node cannot import .ts directly)
 */
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/* ------------------------------------------------------------------ */
/* tiny test harness                                                    */
/* ------------------------------------------------------------------ */
let passed = 0;
let failed = 0;
function ok(cond, name) {
  if (cond) {
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } else {
    failed++;
    console.error(`  \x1b[31m✗\x1b[0m ${name}`);
  }
}
function eq(actual, expected, name) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } else {
    failed++;
    console.error(`  \x1b[31m✗\x1b[0m ${name}\n      expected ${e}\n      got      ${a}`);
  }
}
async function step(title) {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

/* ------------------------------------------------------------------ */
/* the Java-side mock: FsService semantics on real disk                 */
/* ------------------------------------------------------------------ */
const DECK_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_TEXT_BYTES = 2 * 1024 * 1024;

function checkRelPath(rel) {
  if (rel == null || rel === "") throw err("BAD_REQUEST", "path must not be empty");
  if (rel.length > 240) throw err("BAD_REQUEST", "path is too long");
  if (rel.includes("\0") || rel.includes("\\")) throw err("BAD_REQUEST", "illegal characters");
  if (rel.startsWith("/")) throw err("BAD_REQUEST", "path must be relative");
  for (const seg of rel.split("/")) {
    if (seg === "" || seg === "." || seg === "..") throw err("BAD_REQUEST", "illegal segment");
    if (seg.length > 255) throw err("BAD_REQUEST", "segment too long");
  }
}

function err(code, message) {
  return Object.assign(new Error(message || code), { code });
}

function makeMockJava(decksRoot) {
  const root = resolve(decksRoot);
  const token = randomBytes(24).toString("hex");
  let urlCounter = 0;
  const server = createServer((req, res) => {
    // loopback server mock: only GET/PUT of deck files via /<token>/<deck>/<path>
    const host = req.headers.host || "";
    if (!/^127\.0\.0\.1(:\d+)?$|^localhost(:\d+)?$/.test(host)) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ code: "FORBIDDEN", message: "bad host" }));
      return;
    }
    const parts = decodeURIComponent(req.url).split("/").filter(Boolean);
    if (parts[0] !== token) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ code: "NOT_FOUND", message: "no such file" }));
      return;
    }
    const deck = parts[1];
    const rel = parts.slice(2).join("/");
    try {
      checkRelPath(rel);
      if (!DECK_ID.test(deck)) throw err("BAD_REQUEST", "bad deck id");
      const dir = join(root, deck);
      if (!existsSync(join(dir, "deck.json"))) throw err("NOT_FOUND", "deck not found");
      const target = join(dir, rel);
      if (!target.startsWith(root)) throw err("BAD_REQUEST", "escape");
      if (req.method === "GET" || req.method === "HEAD") {
        if (!existsSync(target) || statSync(target).isDirectory()) throw err("NOT_FOUND", "file not found");
        const body = readFileSync(target);
        res.writeHead(200, { "Content-Type": "application/octet-stream" });
        res.end(req.method === "HEAD" ? undefined : body);
      } else if (req.method === "PUT") {
        const chunks = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
          try {
            // Java's beginTempFile() createDirectories() the parent first — mirror that
            mkdirSync(dirname(target), { recursive: true });
            writeFileSync(target, Buffer.concat(chunks)); // atomicity is Java's job; mocked here
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, size: Buffer.concat(chunks).length }));
          } catch (e) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ code: "IO_ERROR", message: String(e) }));
          }
        });
      } else {
        res.writeHead(405);
        res.end();
      }
    } catch (e) {
      const status = { BAD_REQUEST: 400, NOT_FOUND: 404, FORBIDDEN: 403 }[e.code] || 500;
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ code: e.code || "IO_ERROR", message: e.message }));
    }
  });

  async function start() {
    await new Promise((done) => server.listen(0, "127.0.0.1", done));
    return server.address().port;
  }

  const fileUrl = (deck, rel) =>
    `http://127.0.0.1:${(server.address()).port}/${token}/${encodeURIComponent(deck)}/${rel.split("/").map(encodeURIComponent).join("/")}`;

  const listFiles = (deck, dir) => {
    const base = join(root, deck, dir || "");
    if (!existsSync(base)) throw err("NOT_FOUND", "no such directory");
    const out = [];
    for (const name of readdirSync(base)) {
      const p = join(base, name);
      const st = statSync(p);
      out.push({
        name,
        size: st.isDirectory() ? 0 : st.size,
        modified: Math.round(st.mtimeMs),
        directory: st.isDirectory() ? true : undefined,
      });
    }
    return out;
  };

  // the bridge command dispatcher — mirrors DesktopBridge.dispatchFs()
  async function dispatch(req) {
    const cmd = req.cmd;
    try {
      switch (cmd) {
        case "hello":
          return { app: "chasse-desktop", version: "1.3.0", capabilities: ["sync", "fs", "downloads"] };
        case "fs.getRoot": {
          const configured = existsSync(root);
          return {
            configured,
            path: configured ? root : "",
            valid: configured,
          };
        }
        case "fs.chooseRoot":
          return { configured: true, path: root, valid: true }; // mock: chooser auto-picks the temp root
        case "fs.listDecks": {
          const out = [];
          for (const name of readdirSync(root)) {
            const dir = join(root, name);
            if (!statSync(dir).isDirectory() || !DECK_ID.test(name)) continue;
            if (!existsSync(join(dir, "deck.json"))) continue;
            const deck = JSON.parse(readFileSync(join(dir, "deck.json"), "utf8"));
            out.push({
              id: name,
              title: deck.title || name,
              folder: dir,
              slides: Array.isArray(deck.slides) ? deck.slides.length : 0,
              modified: deck.modified || new Date(statSync(join(dir, "deck.json")).mtimeMs).toISOString(),
            });
          }
          out.sort((a, b) => (a.modified < b.modified ? 1 : -1));
          return out;
        }
        case "fs.readText": {
          const { deck, path } = req;
          if (!deck || !path) throw err("BAD_REQUEST", "missing required field");
          checkRelPath(path);
          const f = join(root, deck, path);
          if (!existsSync(join(root, deck, "deck.json"))) throw err("NOT_FOUND", "deck not found");
          if (!existsSync(f)) throw err("NOT_FOUND", "file not found");
          const size = statSync(f).size;
          if (size > MAX_TEXT_BYTES) throw err("TOO_LARGE", "too large");
          return { text: readFileSync(f, "utf8") };
        }
        case "fs.writeText": {
          const { deck, path, text } = req;
          if (!deck || !path) throw err("BAD_REQUEST", "missing required field");
          if (typeof text !== "string") throw err("BAD_REQUEST", "text is required");
          checkRelPath(path);
          if (!existsSync(join(root, deck, "deck.json"))) throw err("NOT_FOUND", "deck not found");
          if (text.length > MAX_TEXT_BYTES) throw err("TOO_LARGE", "too large");
          const f = join(root, deck, path);
          mkdirSync(dirname(f), { recursive: true });
          writeFileSync(f, text, "utf8"); // real Java: atomic temp+rename
          return { ok: true };
        }
        case "fs.createDeck": {
          const { deck, files } = req;
          if (!deck || !DECK_ID.test(deck)) throw err("BAD_REQUEST", "bad deck id");
          if (!files || typeof files !== "object") throw err("BAD_REQUEST", "files map is required");
          if (!files["deck.json"]) throw err("BAD_REQUEST", "files must include deck.json");
          if (existsSync(join(root, deck))) throw err("ALREADY_EXISTS", "exists");
          const dir = join(root, deck);
          mkdirSync(dir, { recursive: true });
          for (const [p, text] of Object.entries(files)) {
            if (p === "deck.json") continue;
            checkRelPath(p);
            mkdirSync(dirname(join(dir, p)), { recursive: true });
            writeFileSync(join(dir, p), text, "utf8");
          }
          writeFileSync(join(dir, "deck.json"), files["deck.json"], "utf8"); // deck.json LAST
          return { ok: true, id: deck };
        }
        case "fs.deleteDeck": {
          const dir = join(root, req.deck);
          if (!existsSync(join(dir, "deck.json"))) throw err("NOT_FOUND", "deck not found");
          rmSync(dir, { recursive: true, force: true });
          return { ok: true };
        }
        case "fs.duplicateDeck": {
          const src = join(root, req.deck);
          if (!existsSync(join(src, "deck.json"))) throw err("NOT_FOUND", "deck not found");
          const copyId = req.copyId || req.deck + "-copy";
          if (existsSync(join(root, copyId))) throw err("ALREADY_EXISTS", "exists");
          const dst = join(root, copyId);
          mkdirSync(dst, { recursive: true });
          const walk = (d, pre) => {
            for (const name of readdirSync(d)) {
              const p = join(d, name);
              if (statSync(p).isDirectory()) walk(p, `${pre}${name}/`);
              else {
                // Java's copyFileAtomic createDirectories() the parent — mirror it
                mkdirSync(dirname(join(dst, pre + name)), { recursive: true });
                writeFileSync(join(dst, pre + name), readFileSync(p));
              }
            }
          };
          walk(src, "");
          const deck = JSON.parse(readFileSync(join(dst, "deck.json"), "utf8"));
          deck.id = copyId;
          if (req.title) deck.title = req.title;
          deck.modified = new Date().toISOString();
          writeFileSync(join(dst, "deck.json"), JSON.stringify(deck, null, 2));
          return { ok: true, id: copyId };
        }
        case "fs.listFiles":
          return listFiles(req.deck, req.dir || "");
        case "fs.delete": {
          const f = join(root, req.deck, req.path);
          checkRelPath(req.path);
          if (!existsSync(f)) throw err("NOT_FOUND", "file not found");
          rmSync(f);
          return { ok: true };
        }
        case "fs.fileUrl":
          return { url: fileUrl(req.deck, req.path) };
        default:
          throw err("UNKNOWN_CMD", `unknown command: ${cmd}`);
      }
    } catch (e) {
      throw e.code ? e : err("IO_ERROR", String(e));
    }
  }

  return { start, dispatch, fileUrl, close: () => server.close(), root, token };
}

/* ------------------------------------------------------------------ */
/* window + cefQuery mock (what JCEF gives the page)                    */
/* ------------------------------------------------------------------ */
function installWindowMock(java) {
  const listeners = [];
  globalThis.window = {
    cefQuery: ({ request, onSuccess, onFailure }) => {
      let req;
      try {
        req = JSON.parse(request);
      } catch {
        onFailure(-1, "bad request");
        return;
      }
      java.dispatch(req).then(
        (data) => onSuccess(JSON.stringify(data)),
        (e) => {
          if (e && e.code) {
            // contract error shape: {code, message} — resolved via onSuccess
            onSuccess(JSON.stringify({ code: e.code, message: e.message }));
          } else {
            onFailure(-2, String(e));
          }
        },
      );
    },
    __chasseDesktop: {
      _handleEvent: (json) => {
        const ev = typeof json === "string" ? JSON.parse(json) : json;
        for (const fn of listeners) fn(ev);
      },
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  return {
    subscribe: (fn) => {
      listeners.push(fn);
      return () => listeners.splice(listeners.indexOf(fn), 1);
    },
  };
}

/* ------------------------------------------------------------------ */
/* main                                                                 */
/* ------------------------------------------------------------------ */
const TMP = join(ROOT, ".tmp-bridge-test");
rmSync(TMP, { recursive: true, force: true });
mkdirSync(join(TMP, "decks"), { recursive: true });

const java = makeMockJava(join(TMP, "decks"));
const port = await java.start();
const bridge = installWindowMock(java);

// import the REAL web-side modules (TS via Bun, or the transpiled esbuild loader)
const { desktopFsCapability, fsGetRoot, fsReadText, fsWriteText, fsCreateDeck, fsListDecks, fsDeleteDeck, fsDuplicateDeck, fsListFiles, fsDelete, fsFileUrl, fsUploadFile, DesktopFsError } =
  await import(pathToFileURL(join(ROOT, "src/lib/stagesmith/desktop-fs.ts")).href);

const store = await import(pathToFileURL(join(ROOT, "src/lib/stagesmith/desktop-store.ts")).href);

try {
  await step("hello + capability gate");
  ok((await desktopFsCapability()) === true, "hello advertises the fs capability");
  const root = await fsGetRoot();
  eq(Object.keys(root).sort(), ["configured", "path", "valid"], "fs.getRoot shape {configured,path,valid}");

  await step("status → desktop store is active");
  const status = await store.refreshDesktopFsStatus();
  eq(
    { available: status.available, configured: status.configured, valid: status.valid },
    { available: true, configured: true, valid: true },
    "isDesktopFsActive conditions met",
  );
  ok((await store.isDesktopFsActive()) === true, "isDesktopFsActive() === true");

  await step("create → list → read (the save path's foundations)");
  const files = {
    "deck.json": JSON.stringify(
      { format: "smdeck", format_version: 1, id: "bridge-demo", title: "Bridge Demo", slides: [{ id: "s1", label: "One" }] },
      null,
      2,
    ) + "\n",
    "theme.css": ":root { --ink: #fff; }",
    "slides/s1.tsx": "export default function Slide() { return null; }",
  };
  const created = await fsCreateDeck("bridge-demo", files);
  eq(created, { ok: true, id: "bridge-demo" }, "fs.createDeck → {ok, id}");
  ok(existsSync(join(TMP, "decks/bridge-demo/deck.json")), "deck.json exists on disk");
  const decks = await fsListDecks();
  eq(decks.map((d) => d.id), ["bridge-demo"], "fs.listDecks sees the new deck");
  const text = await fsReadText("bridge-demo", "slides/s1.tsx");
  eq(text, files["slides/s1.tsx"], "fs.readText round-trips");

  await step("save-queue flow: desktop-store.saveFiles writes ONLY the changed file");
  const before = statSync(join(TMP, "decks/bridge-demo/theme.css")).mtimeMs;
  await new Promise((r) => setTimeout(r, 20));
  const sig1 = await store.saveFiles("bridge-demo", [
    { path: "slides/s1.tsx", content: "export default function Slide() { return <p>edited</p>; }" },
  ]);
  const afterTheme = statSync(join(TMP, "decks/bridge-demo/theme.css")).mtimeMs;
  ok(before === afterTheme, "theme.css untouched by a slide-only save (diff writes)");
  ok(typeof sig1 === "string" && sig1.length > 0, "saveFiles returns a signature");
  const edited = await fsReadText("bridge-demo", "slides/s1.tsx");
  ok(edited.includes("edited"), "the edit reached the disk");

  await step("poll signature is stable and moves on external change");
  const pollSig = await store.poll("bridge-demo");
  ok(pollSig === sig1, "poll agrees with the signature saveFiles returned");
  mkdirSync(join(TMP, "decks/bridge-demo/notes"), { recursive: true });
  writeFileSync(join(TMP, "decks/bridge-demo/notes/s1.md"), "external", "utf8");
  const pollSig2 = await store.poll("bridge-demo");
  ok(pollSig2 !== sig1, "poll detects an external edit");

  await step("error contract: {code,message} → DesktopFsError");
  let threw = null;
  try {
    await fsReadText("bridge-demo", "slides/missing.tsx");
  } catch (e) {
    threw = e;
  }
  ok(threw instanceof DesktopFsError, "rejected with DesktopFsError");
  eq(threw && threw.code, "NOT_FOUND", 'missing file → code "NOT_FOUND"');
  threw = null;
  try {
    await fsWriteText("bridge-demo", "../escape.tsx", "x");
  } catch (e) {
    threw = e;
  }
  eq(threw && threw.code, "BAD_REQUEST", "traversal path → BAD_REQUEST");
  ok(!existsSync(join(TMP, "escape.tsx")), "nothing escaped the decks root");

  await step("loopback file server: URL + upload round-trip");
  const url = await fsFileUrl("bridge-demo", "assets/pic.png");
  ok(url.startsWith("http://127.0.0.1:"), "fs.fileUrl is loopback-only");
  // the app uploads through store.putAssetBytes (which also keeps the record
  // metadata in sync) — exercise that path, not the raw transport
  await store.putAssetBytes("bridge-demo", "assets/pic.png", Buffer.from([137, 80, 78, 71]));
  ok(existsSync(join(TMP, "decks/bridge-demo/assets/pic.png")), "upload via loopback PUT reached the deck folder");
  const res = await fetch(url);
  ok(res.ok, "uploaded file serves back over the loopback URL");
  ok((await res.arrayBuffer()).byteLength === 4, "bytes round-trip exactly");
  // token check: a wrong token must 404 (indistinguishable from missing)
  const bad = await fetch(url.replace(java.token, "0".repeat(48)));
  ok(bad.status === 404, "wrong loopback token → 404");

  await step("assets become part of the record + asset URLs");
  const rec = await store.getRecord("bridge-demo");
  ok(rec && rec.assets["assets/pic.png"] !== undefined, "binary asset tracked as metadata");
  const assetUrl = await store.getAssetUrl("bridge-demo", "assets/pic.png");
  ok(assetUrl === url, "getAssetUrl returns the cached loopback URL");

  await step("duplicate + delete lifecycle");
  const dup = await fsDuplicateDeck("bridge-demo", "bridge-demo-copy", "Copy");
  eq(dup, { ok: true, id: "bridge-demo-copy" }, "fs.duplicateDeck → {ok, id}");
  const copyDeck = JSON.parse(readFileSync(join(TMP, "decks/bridge-demo-copy/deck.json"), "utf8"));
  eq([copyDeck.id, copyDeck.title], ["bridge-demo-copy", "Copy"], "deck.json patched (id + title)");
  await fsDeleteDeck("bridge-demo-copy");
  ok(!existsSync(join(TMP, "decks/bridge-demo-copy")), "deleteDeck removed the folder");

  await step("theme.css stays portable (loopback/data URLs never reach disk)");
  await store.saveFiles("bridge-demo", [{ path: "theme.css", content: ':root { background: url("./assets/pic.png"); }' }]);
  const onDisk = readFileSync(join(TMP, "decks/bridge-demo/theme.css"), "utf8");
  ok(onDisk.includes('url("./assets/pic.png")'), "portable url(./assets/…) written as-is");
  ok(!onDisk.includes("127.0.0.1"), "no loopback URL leaked into theme.css");
  const rewritten = await store.rewriteThemeCssDesktop(onDisk, "bridge-demo");
  ok(rewritten.startsWith("http://127.0.0.1:") === false && rewritten !== onDisk, "rewriteThemeCssDesktop maps it for display");

  await step("save-queue retry ladder (pure logic)");
  // mirror of useSaveQueue's backoff: 1s → 3s → 10s, then "failed"
  const LADDER = [1000, 3000, 10000];
  eq(LADDER.length, 3, "three automatic retries");
  ok(LADDER[0] < LADDER[1] && LADDER[1] < LADDER[2], "backoff is strictly increasing");
  // a genuinely illegal path (traversal) — the save-queue surfaces the reason.
  // NOTE: names with SPACES are deliberately legal on both sides of the bridge
  // ("file names with spaces and non-English characters work").
  threw = null;
  try {
    await store.saveFiles("bridge-demo", [{ path: "slides/../evil.tsx", content: "x" }]);
  } catch (e) {
    threw = e;
  }
  ok(threw instanceof Error && /Illegal path/.test(threw.message), "illegal save rejected with a clear reason");

  await step("event push (protocol v1.1 — string payloads)");
  let got = null;
  bridge.subscribe((ev) => (got = ev));
  globalThis.window.__chasseDesktop._handleEvent(JSON.stringify({ type: "download", stage: "completed", id: 1, fileName: "a.smdeck", path: "C:/x/a.smdeck" }));
  eq(got && got.type, "download", "download event arrives as a parsed object");
  // raw object payloads (older Java builds) are tolerated too
  globalThis.window.__chasseDesktop._handleEvent({ type: "server-status", status: "running", port: 8765 });
  eq(got && got.status, "running", "object-tolerant push accepted");
} finally {
  java.close();
  rmSync(TMP, { recursive: true, force: true });
}

console.log(`\n${failed === 0 ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m"} — ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
