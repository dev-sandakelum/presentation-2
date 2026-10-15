import type { DeckJson, SlideEntry } from "./types";

/**
 * Starter content: default theme.css tokens (plan §5.2), slide templates
 * and a scaffold for new decks.
 */

export function defaultThemeCss(): string {
  return `/* Stagesmith deck theme — tokens, light and dark values (plan §5.2).
   Dark lives on :root, light overrides on [data-theme="light"]. */
:root {
  --acc: #ededed;
  --acc2: #9c9c9c;
  --ink: #f2f2f2;
  --ink2: #c4c4c4;
  --mut: #8f8f8f;
  --line: #2b2b2b;
  --card: #121212;
  --bg: #0a0a0a;
  --grid: rgba(255,255,255,.055);
  --fd: -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  --fb: var(--fd);
  --fm: ui-monospace, 'SF Mono', 'Cascadia Code', Consolas, monospace;
}
[data-theme="light"] {
  --acc: #101010;
  --acc2: #5c5c5c;
  --ink: #161616;
  --ink2: #454545;
  --mut: #6b6b6b;
  --line: #e3e3e3;
  --card: #fafafa;
  --bg: #ffffff;
  --grid: rgba(0,0,0,.05);
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
      {/* .code / .code-bar / .code-tag — the runtime adds the vertical
          scroll cap and the fullscreen expand button to these */}
      <div className="code" style={{ border: "1px solid var(--line)", borderRadius: 14, background: "var(--card)", overflow: "hidden" }}>
        <div className="code-bar" style={{ display: "flex", justifyContent: "space-between", padding: "12px 18px", borderBottom: "1px solid var(--line)", font: "500 11px var(--fm)", letterSpacing: ".16em", textTransform: "uppercase", color: "var(--mut)" }}>
          <span>example.tsx</span><span className="code-tag">tsx</span>
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
    "bg/common.tsx": `import { GridLines, Vignette } from "stagesmith";

export default function CommonBg() {
  return (
    <>
      <GridLines />
      <Vignette strength={0.32} />
    </>
  );
}
`,
    "overlay/common.tsx": `import { CornerMarks } from "stagesmith";

export default function CommonOverlay() {
  return <CornerMarks inset={20} />;
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
