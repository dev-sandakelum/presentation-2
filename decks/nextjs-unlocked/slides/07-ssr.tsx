import { Step } from "stagesmith";
import { Ic } from "@/shared/icons";

export default function Slide() {
  return (
    <section className="slide">
      <header className="s-head">
        <p className="kick rv">Rendering — 02</p>
        <h2 className="h2 mask" style={{ "--d": ".12s" } as React.CSSProperties}>
          <span>What is SSR?</span>
        </h2>
        <p className="lead rv" style={{ "--d": ".3s" } as React.CSSProperties}>
          Server-Side Rendering — HTML is generated on the server, per request. The browser
          receives fully populated HTML, immediately.
        </p>
      </header>
      <div className="s-body">
        <div className="flow solid rv" style={{ "--d": ".25s" } as React.CSSProperties}>
          <Step at={0}>
            <div className="step">
              <span className="n">01</span>
              <Ic name="globe" />
              <h4>Request</h4>
              <p>The browser asks the server for the page.</p>
            </div>
          </Step>
          <div className="flow-sep"><Ic name="arrow-r" /></div>
          <Step at={1}>
            <div className="step">
              <span className="n">02</span>
              <Ic name="server" />
              <h4>Server Renders</h4>
              <p>HTML is generated on the server, per request.</p>
            </div>
          </Step>
          <div className="flow-sep"><Ic name="arrow-r" /></div>
          <Step at={2}>
            <div className="step">
              <span className="n">03</span>
              <Ic name="monitor" />
              <h4>Immediate Paint</h4>
              <p>Content is visible right away — no blank screen.</p>
            </div>
          </Step>
          <div className="flow-sep"><Ic name="arrow-r" /></div>
          <Step at={3}>
            <div className="step">
              <span className="n">04</span>
              <Ic name="drop" />
              <h4>Hydration</h4>
              <p>React attaches interactivity to the HTML.</p>
            </div>
          </Step>
        </div>
        <Step at={3}>
          <div className="pc rv" style={{ "--d": ".5s" } as React.CSSProperties}>
            <div className="pros">
              <Ic name="check" />
              <div>
                <span className="tag">Pros</span>
                <p>Fast first paint · better SEO · accessible content.</p>
              </div>
            </div>
            <div className="cons">
              <Ic name="x" />
              <div>
                <span className="tag">Cons</span>
                <p>More server load · interactions wait for hydration.</p>
              </div>
            </div>
          </div>
        </Step>
        <Step at={3}>
          <p className="foot-note rv" style={{ "--d": ".62s" } as React.CSSProperties}>
            <Ic name="arrow-r" />
            Net result: better SEO and initial-load performance.
          </p>
        </Step>
      </div>
    </section>
  );
}
