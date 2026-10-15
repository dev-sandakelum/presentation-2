import { Step } from "stagesmith";

const PHASES = [
  { n: "01", h: "Initialization", p: "Run <code>npm run dev</code> and explore the default setup.", chip: "Setup" },
  { n: "02", h: "Building Routes", p: "Create a folder and a <code>page.tsx</code> — a new view appears.", chip: "Frontend" },
  { n: "03", h: "Interactivity", p: "Wire up <code>onClick</code> events with the \"use client\" directive.", chip: "Frontend" },
  { n: "04", h: "API Route", p: "A <code>route.ts</code> file handles backend GET requests.", chip: "Backend" },
  { n: "05", h: "Fetching Data", p: "A Server Component pulls data from our new API.", chip: "Full-Stack" },
];

export default function Slide() {
  return (
    <section className="slide">
      <header className="s-head">
        <p className="kick rv">Live Demo</p>
        <h2 className="h2 mask" style={{ "--d": ".12s" } as React.CSSProperties}>
          <span>Watch it come together.</span>
        </h2>
        <p className="lead rv" style={{ "--d": ".3s" } as React.CSSProperties}>
          Five phases — from an empty folder to a fetching, full-stack app.
        </p>
      </header>
      <div className="s-body">
        <div className="phases">
          {PHASES.map((ph, i) => (
            <Step key={ph.n} at={i}>
              <div className="phase rv" style={{ "--d": ".22s" } as React.CSSProperties}>
                <span className="pn">{ph.n}</span>
                <h4>{ph.h}</h4>
                <p dangerouslySetInnerHTML={{ __html: ph.p }} />
                <span className="chip">{ph.chip}</span>
              </div>
            </Step>
          ))}
        </div>
      </div>
    </section>
  );
}
