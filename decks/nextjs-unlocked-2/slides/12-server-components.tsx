import { Ic } from "@/shared/icons";

export default function Slide() {
  return (
    <section className="slide">
      <header className="s-head">
        <p className="kick rv">Deep Dive — 02</p>
        <h2 className="h2 mask" style={{ "--d": ".12s" } as React.CSSProperties}>
          <span>Server Components —<br />the new default.</span>
        </h2>
        <p className="lead rv" style={{ "--d": ".3s" } as React.CSSProperties}>
          Every component in the App Router is a Server Component — unless you explicitly say
          otherwise.
        </p>
      </header>
      <div className="s-body">
        <div className="rows">
          <div className="row rv" style={{ "--d": ".28s" } as React.CSSProperties}>
            <span className="row-ic"><Ic name="server" /></span>
            <div>
              <h4>Zero Client Bundle</h4>
              <p>Server Components never ship to the browser — no impact on your JavaScript bundle size.</p>
            </div>
          </div>
          <div className="row rv" style={{ "--d": ".38s" } as React.CSSProperties}>
            <span className="row-ic"><Ic name="database" /></span>
            <div>
              <h4>Direct Backend Access</h4>
              <p>Query databases and read secrets safely, right inside the component.</p>
            </div>
          </div>
          <div className="row rv" style={{ "--d": ".48s" } as React.CSSProperties}>
            <span className="row-ic"><Ic name="pointer" /></span>
            <div>
              <h4>Opt-in Interactivity</h4>
              <p>Add the "use client" directive only where you need state and events.</p>
            </div>
          </div>
        </div>
        <div className="boundary rv" style={{ "--d": ".6s" } as React.CSSProperties}>
          <div className="b-zone b-server">
            <h5>Server — the default</h5>
            <div className="b-list">
              <span className="b-item">page.tsx</span>
              <span className="b-item">layout.tsx</span>
              <span className="b-item">fetch data</span>
              <span className="b-item">db access</span>
              <span className="b-item">secrets</span>
            </div>
          </div>
          <div className="b-zone b-client">
            <h5>Client — the island</h5>
            <div className="b-list">
              <span className="b-item b-inv">"use client"</span>
              <span className="b-item">state</span>
              <span className="b-item">events</span>
              <span className="b-item">browser APIs</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
