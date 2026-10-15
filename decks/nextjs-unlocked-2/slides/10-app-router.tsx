import { Ic } from "@/shared/icons";

export default function Slide() {
  return (
    <section className="slide">
      <header className="s-head">
        <p className="kick rv">Deep Dive — 01</p>
        <h2 className="h2 mask" style={{ "--d": ".12s" } as React.CSSProperties}>
          <span>The App Router</span>
        </h2>
        <p className="lead rv" style={{ "--d": ".3s" } as React.CSSProperties}>
          Replaces the old /pages directory with a powerful, nested structure — everything lives
          in <em>app</em>.
        </p>
      </header>
      <div className="s-body split">
        <div className="split-l rv" style={{ "--d": ".25s" } as React.CSSProperties}>
          <div className="code">
            <div className="code-bar">
              <span>file tree</span>
              <span className="code-tag">app/</span>
            </div>
            <pre>
              <span className="d">app/</span>{"\n"}
              ├── <span className="f">page.tsx</span>            <span className="cm"># /</span>{"\n"}
              └── <span className="d">dashboard/</span>{"\n"}
              {"    "}└── <span className="f">page.tsx</span>        <span className="cm"># /dashboard</span>
            </pre>
          </div>
        </div>
        <div className="split-r rows">
          <div className="row rv" style={{ "--d": ".32s" } as React.CSSProperties}>
            <span className="row-ic"><Ic name="folder" /></span>
            <div>
              <h4>Routes = Folders</h4>
              <p>Every folder under <em>app</em> maps to a URL segment — no manual route configuration.</p>
            </div>
          </div>
          <div className="row rv" style={{ "--d": ".44s" } as React.CSSProperties}>
            <span className="row-ic"><Ic name="layers" /></span>
            <div>
              <h4>Nested Layouts</h4>
              <p>Layouts persist across their children — no remounting between pages.</p>
            </div>
          </div>
          <div className="row rv" style={{ "--d": ".56s" } as React.CSSProperties}>
            <span className="row-ic"><Ic name="file" /></span>
            <div>
              <h4>Special Files</h4>
              <p>page · layout · loading · error. A folder only becomes a public route once it holds a page.</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
