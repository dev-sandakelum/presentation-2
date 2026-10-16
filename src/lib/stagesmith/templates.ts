import type { DeckJson, SlideEntry } from "./types";

/**
 * Starter content: default theme.css tokens (plan §5.2), slide templates
 * and a scaffold for new decks.
 */

export function defaultThemeCss(): string {
  return `/* Chassé deck theme — warm stage aesthetic.
   Dark lives on :root, light overrides on [data-theme="light"]. */
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Instrument+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500&family=Fraunces:ital,wght@1,500;1,600&display=swap');
:root {
  --acc: #ffb454;
  --acc2: #ff8fa3;
  --ink: #f3eff9;
  --ink2: #efeaf7;
  --mut: #a59dbb;
  --line: rgba(165, 157, 187, 0.22);
  --card: rgba(255, 255, 255, 0.05);
  --card2: rgba(255, 255, 255, 0.015);
  --bg: #100e17;
  --grid: rgba(255, 255, 255, 0.035);
  --glow: rgba(255, 180, 84, 0.16);
  --glow2: rgba(255, 122, 144, 0.1);
  --fd: 'Space Grotesk', -apple-system, 'Segoe UI', sans-serif;
  --fb: 'Instrument Sans', -apple-system, 'Segoe UI', sans-serif;
  --fm: 'JetBrains Mono', ui-monospace, 'SF Mono', Consolas, monospace;
  --fbrand: 'Fraunces', Georgia, serif;
}
[data-theme="light"] {
  --acc: #c25a08;
  --acc2: #b4234a;
  --ink: #1d1a2c;
  --ink2: #16132a;
  --mut: #5f5877;
  --line: rgba(95, 88, 119, 0.25);
  --card: rgba(255, 255, 255, 0.72);
  --card2: rgba(255, 255, 255, 0.35);
  --bg: #f6f4fa;
  --grid: rgba(40, 30, 90, 0.06);
  --glow: rgba(194, 90, 8, 0.1);
  --glow2: rgba(200, 50, 79, 0.06);
}
#root { background: var(--bg); color: var(--ink); font-family: var(--fb); }
`;
}

const P = `import { Step, useStep, Img, asset } from "stagesmith"`;

export interface SlideTemplate {
  key: string;
  label: string;
  slideLabel: string;
  code: string;
}

export const SLIDE_TEMPLATES: SlideTemplate[] = [
  {
    key: "title",
    label: "Title",
    slideLabel: "Title",
    code: `export default function Slide() {
  return (
    <div style={{
      position: "absolute", inset: 0, display: "flex",
      flexDirection: "column", alignItems: "center", justifyContent: "center",
      textAlign: "center", gap: 22,
    }}>
      <p style={{ font: "500 12px var(--fm)", letterSpacing: ".24em", textTransform: "uppercase", color: "var(--mut)" }}>
        Your kick line
      </p>
      <h1 style={{ font: "600 92px/1 var(--fd)", letterSpacing: "-.045em", color: "var(--ink)", margin: 0 }}>
        Deck title
      </h1>
      <p style={{ font: "400 24px/1.5 var(--fb)", color: "var(--mut)" }}>
        A subtitle that says what this deck is about.
      </p>
    </div>
  );
}
`,
  },
  {
    key: "section",
    label: "Section",
    slideLabel: "Section",
    code: `export default function Slide() {
  return (
    <div style={{ position: "absolute", inset: 0, padding: "88px 84px", display: "flex", flexDirection: "column" }}>
      <p style={{ font: "500 11px var(--fm)", letterSpacing: ".24em", textTransform: "uppercase", color: "var(--mut)" }}>
        Section 01
      </p>
      <h2 style={{ font: "600 56px/1.08 var(--fd)", letterSpacing: "-.035em", color: "var(--ink)", margin: "18px 0 0" }}>
        A section heading
      </h2>
      <p style={{ font: "400 22px/1.55 var(--fb)", color: "var(--mut)", margin: "18px 0 0", maxWidth: "56ch" }}>
        One or two sentences of context so the heading lands.
      </p>
    </div>
  );
}
`,
  },
  {
    key: "bullets",
    label: "Bullets",
    slideLabel: "Bullets",
    code: `import { Step } from "stagesmith";

export default function Slide() {
  const items = [
    ["First point", "A sentence that supports it."],
    ["Second point", "Another sentence that supports it."],
    ["Third point", "A final supporting sentence."],
  ];
  return (
    <div style={{ position: "absolute", inset: 0, padding: "88px 84px", display: "flex", flexDirection: "column" }}>
      <h2 style={{ font: "600 48px/1.1 var(--fd)", letterSpacing: "-.03em", color: "var(--ink)", margin: "0 0 34px" }}>
        Three points
      </h2>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {items.map(([h, p], i) => (
          <Step at={i} key={h}>
            <div style={{ borderTop: "1px solid var(--line)", padding: "18px 0", display: "flex", gap: 26 }}>
              <span style={{ font: "500 13px var(--fm)", color: "var(--mut)", paddingTop: 8 }}>0{i + 1}</span>
              <div>
                <h4 style={{ font: "600 20px var(--fd)", color: "var(--ink)", margin: 0 }}>{h}</h4>
                <p style={{ font: "400 16px/1.5 var(--fb)", color: "var(--mut)", margin: "6px 0 0" }}>{p}</p>
              </div>
            </div>
          </Step>
        ))}
      </div>
    </div>
  );
}
`,
  },
  {
    key: "code",
    label: "Code",
    slideLabel: "Code",
    code: `export default function Slide() {
  const snippet = [
    "export function hello() {",
    "  return <div>world</div>",
    "}",
  ].join("\\n");
  return (
    <div style={{ position: "absolute", inset: 0, padding: "88px 84px", display: "flex", flexDirection: "column" }}>
      <h2 style={{ font: "600 48px/1.1 var(--fd)", letterSpacing: "-.03em", color: "var(--ink)", margin: "0 0 30px" }}>
        A code slide
      </h2>
      <div style={{ border: "1px solid var(--line)", borderRadius: 14, background: "var(--card)", overflow: "hidden" }}>
        <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 18px", borderBottom: "1px solid var(--line)", font: "500 11px var(--fm)", letterSpacing: ".16em", textTransform: "uppercase", color: "var(--mut)" }}>
          <span>example.tsx</span><span>tsx</span>
        </div>
        <pre style={{ margin: 0, padding: "18px 20px", font: "400 16px/1.7 var(--fm)", color: "var(--ink2)" }}>
          {snippet}
        </pre>
      </div>
    </div>
  );
}
`,
  },
  {
    key: "quote",
    label: "Quote",
    slideLabel: "Quote",
    code: `export default function Slide() {
  return (
    <div style={{ position: "absolute", inset: 0, padding: "110px 96px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
      <blockquote style={{
        font: "500 32px/1.45 var(--fd)", color: "var(--ink)",
        borderLeft: "4px solid var(--acc)", paddingLeft: 30, margin: 0, maxWidth: "54ch",
      }}>
        "A quote worth building a slide around."
      </blockquote>
      <p style={{ font: "500 12px var(--fm)", letterSpacing: ".18em", textTransform: "uppercase", color: "var(--mut)", margin: "26px 0 0" }}>
        Attribution
      </p>
    </div>
  );
}
`,
  },
  {
    key: "end",
    label: "End",
    slideLabel: "End",
    code: `export default function Slide() {
  return (
    <div style={{
      position: "absolute", inset: 0, display: "flex",
      flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 18,
    }}>
      <h1 style={{ font: "700 96px/1 var(--fd)", letterSpacing: "-.045em", color: "var(--ink)", margin: 0 }}>
        Thank you
      </h1>
      <p style={{ font: "400 22px var(--fb)", color: "var(--mut)" }}>Questions?</p>
    </div>
  );
}
`,
  },
];

export function templateByKey(key: string): SlideTemplate | undefined {
  return SLIDE_TEMPLATES.find((t) => t.key === key);
}

/* ---------------- new deck scaffold ---------------- */

export function starterDeckFiles(title: string): Record<string, string> {
  const deck: DeckJson = {
    format: "smdeck",
    format_version: 1,
    id: "placeholder",
    title,
    created: new Date().toISOString(),
    modified: new Date().toISOString(),
    settings: {
      size: [1280, 720],
      defaultMode: "dark",
      transitionMs: 220,
      bgCrossfadeMs: 1600,
    },
    bg: { type: "code", path: "bg/common.tsx" },
    overlay: { type: "code", path: "overlay/common.tsx" },
    slides: [
      { id: "title", label: "Title" },
      { id: "end", label: "End" },
    ],
  };
  const titleSlide = templateByKey("title")!;
  const endSlide = templateByKey("end")!;
  return {
    "deck.json": JSON.stringify(deck, null, 2),
    "theme.css": defaultThemeCss(),
    "bg/common.tsx": `import { Glow, GridLines, Vignette } from "stagesmith";

export default function CommonBg() {
  return (
    <>
      <Glow />
      <GridLines />
      <Vignette strength={0.32} />
    </>
  );
}
`,
    "overlay/common.tsx": `import { CornerMarks, Footer, Progress } from "stagesmith";

export default function CommonOverlay() {
  return (
    <>
      <CornerMarks inset={20} />
      <Footer text="Chassé" />
      <Progress />
    </>
  );
}
`,
    "slides/title.tsx": titleSlide.code,
    "slides/end.tsx": endSlide.code,
    "notes/title.md": `Opening remarks for **${title}**.

- Say why you're here
- Set the one thing the audience should remember
`,
  };
}
