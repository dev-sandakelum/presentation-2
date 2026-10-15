import { Ic } from "@/shared/icons";

export default function Slide() {
  return (
    <section className="slide">
      <header className="s-head">
        <p className="kick rv">The Key Insight</p>
        <h2 className="h2 mask" style={{ "--d": ".12s" } as React.CSSProperties}>
          <span>Library vs. Framework</span>
        </h2>
      </header>
      <div className="s-body">
        <blockquote className="quote mask" style={{ "--d": ".22s" } as React.CSSProperties}>
          <span>
            "With a library, you're the architect. With a framework, the structure is already
            designed — you fill in the details."
          </span>
        </blockquote>
        <div className="defs">
          <div className="def rv" style={{ "--d": ".38s" } as React.CSSProperties}>
            <span className="def-ic"><Ic name="box" /></span>
            <h4>The Foundation</h4>
            <p>Provides a predefined structure for your application.</p>
          </div>
          <div className="def rv" style={{ "--d": ".48s" } as React.CSSProperties}>
            <span className="def-ic"><Ic name="wrench" /></span>
            <h4>Built-in Tools</h4>
            <p>Routing and bundling are included, out of the box.</p>
          </div>
          <div className="def rv" style={{ "--d": ".58s" } as React.CSSProperties}>
            <span className="def-ic"><Ic name="repeat" /></span>
            <h4>Inversion of Control</h4>
            <p>The framework calls your code — not the other way around.</p>
          </div>
        </div>
        <p className="foot-note rv" style={{ "--d": ".72s" } as React.CSSProperties}>
          <Ic name="arrow-r" />
          Next.js adds conventions on top of React — so your team spends less time on setup
          and more time on shipping.
        </p>
      </div>
    </section>
  );
}
