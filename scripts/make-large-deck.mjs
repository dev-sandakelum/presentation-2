#!/usr/bin/env node
/**
 * Builds a LARGE server deck (the "largest deck" benchmark corpus):
 *   26 slides, per-slide notes, a shared code bg + overlay, and 26 large
 *   PNG backgrounds (~600 KB each) — the realistic heavy case the preload
 *   comments describe ("21–26 slides, large backgrounds").
 *
 * Usage: node scripts/make-large-deck.mjs [deckId]
 */
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const deckId = process.argv[2] || "perf-large";
const root = join(process.cwd(), "decks", deckId);
const SLIDES = 26;
const W = 1600;
const H = 900;

// deterministic pseudo-random noise over a gradient — a real-ish PNG payload
function makePng(index) {
  // minimal zlib-free PNG: use an uncompressed deflate stream so we can build
  // real, decodable PNGs without a dependency
  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // truecolor
  // raw scanlines: filter byte + RGB per pixel, gradient + stripes for
  // compressible-but-real content
  const row = W * 3 + 1;
  const raw = Buffer.alloc(row * H);
  const base = (index * 37) % 256;
  for (let y = 0; y < H; y++) {
    const o = y * row;
    raw[o] = 0;
    for (let x = 0; x < W; x++) {
      const p = o + 1 + x * 3;
      raw[p] = (base + ((x * y) >> 8)) & 255;
      raw[p + 1] = (base + 64 + (x >> 3)) & 255;
      raw[p + 2] = (base + 128 + (y >> 3)) & 255;
    }
  }
  // uncompressed deflate: 0x78 0x01 header, stored blocks (max 65535), adler32
  const blocks = [];
  let off = 0;
  while (off < raw.length) {
    const size = Math.min(65535, raw.length - off);
    const last = off + size >= raw.length ? 1 : 0;
    const header = Buffer.alloc(5);
    header[0] = last;
    header.writeUInt16LE(size, 1);
    header.writeUInt16LE(size ^ 0xffff, 3);
    blocks.push(header, raw.subarray(off, off + size));
    off += size;
  }
  let a = 1, b = 0;
  for (const byte of raw) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  const adler = Buffer.alloc(4);
  adler.writeUInt32BE(((b << 16) | a) >>> 0);
  const idat = Buffer.concat([Buffer.from([0x78, 0x01]), ...blocks, adler]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

rmSync(root, { recursive: true, force: true });
mkdirSync(join(root, "slides"), { recursive: true });
mkdirSync(join(root, "notes"), { recursive: true });
mkdirSync(join(root, "assets"), { recursive: true });
mkdirSync(join(root, "bg"), { recursive: true });
mkdirSync(join(root, "overlay"), { recursive: true });

const slides = [];
for (let i = 0; i < SLIDES; i++) {
  const id = `s${String(i + 1).padStart(2, "0")}`;
  slides.push({ id, label: `Slide ${i + 1}` });
  const hue = (i * 14) % 360;
  writeFileSync(
    join(root, "slides", `${id}.tsx`),
    `import { Slide, Step, H1, P, useStep } from "stagesmith";\n\nexport default function Slide${i + 1}() {\n  const step = useStep();\n  return (\n    <Slide bg="hsl(${hue} 40% 12%)">\n      <Step n={1}>\n        <H1>Benchmark slide ${i + 1}</H1>\n        <P>Step one of the parallel loading benchmark deck.</P>\n      </Step>\n      <Step n={2}>\n        <P>Step two — more content for the compiler to chew on. ${"Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(6)}</P>\n      </Step>\n    </Slide>\n  );\n}\n`,
  );
  writeFileSync(join(root, "notes", `${id}.md`), `# Notes ${i + 1}\n\nSpeaker notes for slide ${i + 1}.\n`);
  writeFileSync(join(root, "assets", `bg-${id}.png`), makePng(i));
}

writeFileSync(
  join(root, "bg", "common.tsx"),
  `export default function Bg({ mode }: { mode?: string }) {\n  return <div style={{ position: "absolute", inset: 0, background: "radial-gradient(circle at 30% 30%, #35306b, #14121f 70%)" }} />;\n}\n`,
);
writeFileSync(
  join(root, "overlay", "common.tsx"),
  `export default function Overlay() {\n  return <div style={{ position: "absolute", inset: 0, pointerEvents: "none", boxShadow: "inset 0 0 120px rgba(0,0,0,0.55)" }} />;\n}\n`,
);
writeFileSync(
  join(root, "theme.css"),
  `:root { --font-display: "Space Grotesk", system-ui, sans-serif; }\n.deck { font-family: var(--font-display); }\n`,
);

const deck = {
  format: "smdeck",
  format_version: 1,
  id: deckId,
  title: "Parallel Loading Benchmark",
  created: new Date().toISOString(),
  modified: new Date().toISOString(),
  settings: { defaultMode: "dark" },
  bg: { type: "code", path: "bg/common.tsx" },
  overlay: { type: "code", path: "overlay/common.tsx" },
  slides,
};
writeFileSync(join(root, "deck.json"), JSON.stringify(deck, null, 2) + "\n");

const assetCount = SLIDES;
console.log(`deck '${deckId}' created: ${SLIDES} slides, ${assetCount} large PNG assets (1600x900), code bg+overlay`);
