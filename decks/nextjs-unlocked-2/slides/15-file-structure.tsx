import { Ic } from "@/shared/icons";

export default function Slide() {
  return (
    <section className="slide">
      <header className="s-head">
        <p className="kick rv">Hands On — Anatomy</p>
        <h2 className="h2 mask" style={{ "--d": ".12s" } as React.CSSProperties}>
          <span>The file structure.</span>
        </h2>
        <p className="lead rv" style={{ "--d": ".3s" } as React.CSSProperties}>
          A fresh installation gives you a clean, predictable workspace — and <em>app</em> is the
          core of it all.
        </p>
      </header>
      <div className="s-body split">
        <div className="split-l rv" style={{ "--d": ".25s" } as React.CSSProperties}>
          <div className="code">
            <div className="code-bar">
              <span>file tree</span>
              <span className="code-tag">my-app/</span>
            </div>
            <pre>
              my-app/
              {"\n"}├── <span className="d">app/</span>
              {"\n"}│   ├── <span className="d">layout.tsx</span>
              {"\n"}│   ├── <span className="d">page.tsx</span>
              {"\n"}│   └── <span className="f">globals.css</span>
              {"\n"}├── <span className="f">public/</span>
              {"\n"}├── <span className="f">next.config.js</span>
              {"\n"}└── <span className="f">package.json</span>
            </pre>
          </div>
        </div>
        <div className="split-r rows">
          <div className="row rv" style={{ "--d": ".32s" } as React.CSSProperties}>
            <span className="row-ic"><Ic name="folder" /></span>
            <div>
              <h4>app/</h4>
              <p>The root directory of the App Router — every route and every piece of UI lives here.</p>
            </div>
          </div>
          <div className="row rv" style={{ "--d": ".44s" } as React.CSSProperties}>
            <span className="row-ic"><Ic name="layout" /></span>
            <div>
              <h4>layout.tsx</h4>
              <p>Shared UI for a segment and its children — persistent headers and footers that never remount.</p>
            </div>
          </div>
          <div className="row rv" style={{ "--d": ".56s" } as React.CSSProperties}>
            <span className="row-ic"><Ic name="file" /></span>
            <div>
              <h4>page.tsx</h4>
              <p>The unique UI of a route segment — its presence is what makes a route public.</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
