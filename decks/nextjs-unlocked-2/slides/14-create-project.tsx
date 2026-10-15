import { useEffect, useState } from "react";
import { useStatic } from "stagesmith";
import { Ic } from "@/shared/icons";

const CMD = "npx create-next-app@latest";

const OUTPUT = [
  { prompt: false, text: "√ What is your project named? … my-app" },
  { prompt: false, text: "√ Would you like to use TypeScript? … Yes" },
  { prompt: false, text: "√ Would you like to use ESLint? … Yes" },
  { prompt: false, text: "√ Would you like to use Tailwind CSS? … No" },
  { prompt: false, text: "√ Would you like to use App Router? (recommended) … Yes" },
  { prompt: false, text: " " },
  { prompt: false, text: "Success! Created my-app — run npm run dev to start." },
];

export default function Slide() {
  const staticMode = useStatic();
  const [typed, setTyped] = useState(staticMode ? CMD.length : 0);
  const [shown, setShown] = useState(staticMode ? OUTPUT.length : 0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (staticMode) return;
    let i = 0;
    let interval: ReturnType<typeof setInterval> | undefined;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setTyped(CMD.length);
      setShown(OUTPUT.length);
      return;
    }
    interval = setInterval(() => {
      i += 1;
      setTyped(i);
      if (i >= CMD.length) {
        clearInterval(interval);
        OUTPUT.forEach((_, idx) => {
          setTimeout(() => setShown(idx + 1), 300 + idx * 240);
        });
      }
    }, 45);
    return () => clearInterval(interval);
  }, [staticMode]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(CMD);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <section className="slide">
      <header className="s-head">
        <p className="kick rv">Hands On — Scaffold</p>
        <h2 className="h2 mask" style={{ "--d": ".12s" } as React.CSSProperties}>
          <span>One command to start.</span>
        </h2>
        <p className="lead rv" style={{ "--d": ".3s" } as React.CSSProperties}>
          This single CLI command scaffolds a complete, production-ready environment — instantly.
        </p>
      </header>
      <div className="s-body">
        <div className="term rv" style={{ "--d": ".25s" } as React.CSSProperties}>
          <div className="term-bar">
            <span className="term-dots"><i /><i /><i /></span>
            <span className="term-title">bash — create-next-app</span>
          </div>
          <div className="term-body">
            <div className="tl">
              <span className="prompt">$ </span>
              <span className="cmd">{CMD.slice(0, typed)}</span>
              {typed < CMD.length && <span className="caret" />}
            </div>
            {OUTPUT.slice(0, shown).map((line, idx) => (
              <div key={idx} className={`tl out ${staticMode ? "show" : "show"}`}>
                {line.prompt ? <span className="prompt">$ </span> : null}
                {idx === 6 ? (
                  <span>
                    <Ic name="tri" style={{ display: "inline-block", verticalAlign: -2, width: 14, height: 14 }} /> Next.js{" "}
                    <span className="dim">— ready when you are.</span>
                  </span>
                ) : (
                  <span className={idx < 5 ? "" : "a"} style={idx < 5 ? { color: "var(--faint)" } : undefined}>
                    {idx < 6 ? line.text.replace(/√/, "√ ") : line.text}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
        <button
          className="copy-btn rv"
          style={{ "--d": ".5s" } as React.CSSProperties}
          type="button"
          onClick={copy}
        >
          <Ic name="copy" />
          <span className="c-cmd">{CMD}</span>
          <span className="c-hint">{copied ? "Copied ✓" : "Click to copy"}</span>
        </button>
      </div>
    </section>
  );
}
