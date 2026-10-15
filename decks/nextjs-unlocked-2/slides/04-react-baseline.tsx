import { Ic } from "@/shared/icons";

export default function Slide() {
  return (
    <section className="slide">
      <header className="s-head">
        <p className="kick rv">The Baseline</p>
        <h2 className="h2 mask" style={{ "--d": ".12s" } as React.CSSProperties}>
          <span>Did you know about React?</span>
        </h2>
        <p className="lead rv" style={{ "--d": ".3s" } as React.CSSProperties}>
          React is a UI library — not a full framework. It's powerful, but intentionally minimal.
        </p>
      </header>
      <div className="s-body split">
        <div className="split-l react-side rv" style={{ "--d": ".22s" } as React.CSSProperties}>
          <svg className="react-logo" viewBox="0 0 220 220" aria-hidden="true">
            <g className="react-spin">
              <ellipse cx="110" cy="110" rx="92" ry="34" />
              <ellipse cx="110" cy="110" rx="92" ry="34" transform="rotate(60 110 110)" />
              <ellipse cx="110" cy="110" rx="92" ry="34" transform="rotate(120 110 110)" />
            </g>
            <circle className="core" cx="110" cy="110" r="9" />
          </svg>
          <div className="react-cap">
            <span className="cap-t">React</span>
            <span className="cap-s">A library for the View layer</span>
          </div>
        </div>
        <div className="split-r rows">
          <div className="row rv" style={{ "--d": ".28s" } as React.CSSProperties}>
            <span className="row-ic"><Ic name="code" /></span>
            <div>
              <h4>Component-Based</h4>
              <p>Build UIs from small, reusable, declarative pieces.</p>
            </div>
          </div>
          <div className="row rv" style={{ "--d": ".38s" } as React.CSSProperties}>
            <span className="row-ic"><Ic name="swap" /></span>
            <div>
              <h4>No Built-in Routing</h4>
              <p>You pick and install your own router — React Router, TanStack, and friends.</p>
            </div>
          </div>
          <div className="row rv" style={{ "--d": ".48s" } as React.CSSProperties}>
            <span className="row-ic"><Ic name="search" /></span>
            <div>
              <h4>SEO Challenges</h4>
              <p>Client-side rendering makes search indexing harder.</p>
            </div>
          </div>
          <div className="row rv" style={{ "--d": ".58s" } as React.CSSProperties}>
            <span className="row-ic"><Ic name="plug" /></span>
            <div>
              <h4>External Tools Required</h4>
              <p>Routing and data fetching must be wired up by you.</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
