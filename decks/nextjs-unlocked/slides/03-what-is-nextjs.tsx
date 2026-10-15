import { Ic } from "@/shared/icons";

export default function Slide() {
  return (
    <section className="slide">
      <header className="s-head">
        <p className="kick rv">Foundation — 01</p>
        <h2 className="h2 mask" style={{ "--d": ".12s" } as React.CSSProperties}>
          <span>
            The React framework
            <br />
            for the web.
          </span>
        </h2>
      </header>
      <div className="s-body split">
        <div className="split-l">
          <p className="lead rv" style={{ "--d": ".28s" } as React.CSSProperties}>
            A full-stack React framework, built and maintained by Vercel — everything you need ships
            in the box. And every bit of your existing React knowledge still applies.
          </p>
          <div className="stack-note rv" style={{ "--d": ".42s" } as React.CSSProperties}>
            <span className="chip">
              <Ic name="tri" /> Built on React
            </span>
            <span className="chip chip-ghost">Maintained by Vercel</span>
          </div>
          <div className="trust rv" style={{ "--d": ".55s" } as React.CSSProperties}>
            <span className="trust-k">Powering production at</span>
            <span className="trust-n">Netflix · TikTok · Twitch</span>
          </div>
        </div>
        <div className="split-r rows">
          <div className="row rv" style={{ "--d": ".3s" } as React.CSSProperties}>
            <span className="row-ic">
              <Ic name="circle-check" />
            </span>
            <div>
              <h4>Production-Ready</h4>
              <p>Battle-tested at scale — the default choice for shipping React to the real world.</p>
            </div>
          </div>
          <div className="row rv" style={{ "--d": ".42s" } as React.CSSProperties}>
            <span className="row-ic">
              <Ic name="layers" />
            </span>
            <div>
              <h4>Full-Stack</h4>
              <p>Routing, rendering, and API routes — front-end and back-end living in one project.</p>
            </div>
          </div>
          <div className="row rv" style={{ "--d": ".54s" } as React.CSSProperties}>
            <span className="row-ic">
              <Ic name="wrench" />
            </span>
            <div>
              <h4>Opinionated</h4>
              <p>Sensible conventions decided for you — less time configuring, more time building.</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
