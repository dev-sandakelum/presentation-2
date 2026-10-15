export default function Slide() {
  return (
    <section className="slide">
      <header className="s-head">
        <p className="kick rv">Deep Dive — Routing Patterns</p>
        <h2 className="h2 mask" style={{ "--d": ".12s" } as React.CSSProperties}>
          <span>Three ways to shape a route.</span>
        </h2>
      </header>
      <div className="s-body">
        <div className="rout rv" style={{ "--d": ".25s" } as React.CSSProperties}>
          <div className="rout-pat">
            <span className="pat">app/about/page.tsx</span>
            <span className="pat-tag">Standard · Static</span>
          </div>
          <div>
            <h4>Static Routes</h4>
            <p>A predictable, fixed path — nothing dynamic about it.</p>
          </div>
          <span className="url-chip">→ /about</span>
        </div>
        <div className="rout rv" style={{ "--d": ".38s" } as React.CSSProperties}>
          <div className="rout-pat">
            <span className="pat">app/blog/[slug]/page.tsx</span>
            <span className="pat-tag">Dynamic Segment</span>
          </div>
          <div>
            <h4>Dynamic Routes</h4>
            <p>Captures dynamic data from the URL — matches any value.</p>
          </div>
          <span className="url-chip">→ /blog/hello</span>
        </div>
        <div className="rout rv" style={{ "--d": ".51s" } as React.CSSProperties}>
          <div className="rout-pat">
            <span className="pat">app/(marketing)/page.tsx</span>
            <span className="pat-tag">Route Group</span>
          </div>
          <div>
            <h4>Route Groups</h4>
            <p>Organizes files logically — without affecting the URL path.</p>
          </div>
          <span className="url-chip">→ /</span>
        </div>
      </div>
    </section>
  );
}
