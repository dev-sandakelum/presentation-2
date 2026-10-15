import { Step } from "stagesmith";
import { Ic } from "@/shared/icons";

/** Build steps: each flow card appears on its own step (Next walks steps, then slides). */
export default function Slide() {
  return (
    <section className="slide">
      <header className="s-head">
        <p className="kick rv">Rendering — 01</p>
        <h2 className="h2 mask" style={{ "--d": ".12s" } as React.CSSProperties}>
          <span>How React works — CSR</span>
        </h2>
        <p className="lead rv" style={{ "--d": ".3s" } as React.CSSProperties}>
          Client-Side Rendering — the server sends a bare shell, and React builds the whole UI
          in the browser.
        </p>
      </header>
      <div className="s-body">
        <div className="flow rv" style={{ "--d": ".25s" } as React.CSSProperties}>
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
              <Ic name="file" />
              <h4>Empty HTML</h4>
              <p>The server responds with a bare shell.</p>
            </div>
          </Step>
          <div className="flow-sep"><Ic name="arrow-r" /></div>
          <Step at={2}>
            <div className="step">
              <span className="n">03</span>
              <Ic name="download" />
              <h4>JS Download</h4>
              <p>The browser fetches the React bundle.</p>
            </div>
          </Step>
          <div className="flow-sep"><Ic name="arrow-r" /></div>
          <Step at={3}>
            <div className="step">
              <span className="n">04</span>
              <Ic name="cpu" />
              <h4>Render</h4>
              <p>React builds the UI on the client.</p>
            </div>
          </Step>
        </div>
        <Step at={3}>
          <div className="pc rv" style={{ "--d": ".5s" } as React.CSSProperties}>
            <div className="pros">
              <Ic name="check" />
              <div>
                <span className="tag">Pros</span>
                <p>Rich, dynamic interactivity once the app has loaded.</p>
              </div>
            </div>
            <div className="cons">
              <Ic name="x" />
              <div>
                <span className="tag">Cons</span>
                <p>Slow first load · weak SEO · JavaScript required.</p>
              </div>
            </div>
          </div>
        </Step>
      </div>
    </section>
  );
}
