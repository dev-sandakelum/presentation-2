/**
 * Title slide — "Next.js Unlocked".
 *
 * The aurora background (bg/aurora.tsx) is a light pastel silk, so this slide
 * pins its own dark-ink tokens on the root <section>: the text stays readable
 * no matter which dark/light mode the deck is presented in.
 */
const INK_ON_LIGHT = {
  "--fg": "#10141c",
  "--fg-soft": "#232b38",
  "--muted": "#4a5568",
  "--faint": "#77839b",
  "--border": "rgba(16, 20, 28, 0.16)",
  "--border-strong": "rgba(16, 20, 28, 0.32)",
  "--code-bg": "rgba(255, 255, 255, 0.72)",
  "--inv-bg": "#10141c",
  "--inv-fg": "#ffffff",
  "--inv-fg-soft": "rgba(255, 255, 255, 0.72)",
  "--hover": "#eef3fa",
} as React.CSSProperties;

export default function Slide() {
  return (
    <section className="slide s-title" style={INK_ON_LIGHT}>
      <div className="title-wrap">
        <svg
          className="ic ic-fill title-tri rv"
          style={{ "--d": ".05s", width: 52, height: 52 } as React.CSSProperties}
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path d="M12 3 22 20H2Z" />
        </svg>
        <div className="title-badges rv" style={{ "--d": ".15s" } as React.CSSProperties}>
          <span className="chip">Microsoft Learn Student Ambassadors</span>
          <span className="chip chip-ghost">Part 1 of 3 — Concepts</span>
        </div>
        <h1 className="title rv" style={{ "--d": ".25s" } as React.CSSProperties}>
          Next.js{" "}
          <span className="t-ol">
            <span className="ol-o" aria-hidden="true">
              Unlocked
            </span>
            <span className="ol-f" aria-hidden="true">
              Unlocked
            </span>
          </span>
          <span className="t-caret" aria-hidden="true" />
        </h1>
        <p className="title-sub rv" style={{ "--d": ".45s" } as React.CSSProperties}>
          From React library to full-stack framework.
        </p>
        <div className="title-hint rv" style={{ "--d": ".65s" } as React.CSSProperties}>
          <span>
            <kbd>←</kbd>
            <kbd>→</kbd> navigate
          </span>
          <span>
            <kbd>T</kbd> theme
          </span>
          <span>
            <kbd>F</kbd> fullscreen
          </span>
          <span>
            <kbd>O</kbd> overview
          </span>
        </div>
      </div>
    </section>
  );
}
