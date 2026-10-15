import { Ic } from "@/shared/icons";

export default function Slide() {
  return (
    <section className="slide">
      <header className="s-head">
        <p className="kick rv">Your Host</p>
        <h2 className="h2 mask" style={{ "--d": ".12s" } as React.CSSProperties}>
          <span>Nice to meet you.</span>
        </h2>
      </header>
      <div className="s-body pres">
        <div className="avatar rv" style={{ "--d": ".22s" } as React.CSSProperties}>
          <span className="avatar-initials">YN</span>
        </div>
        <div className="pres-right">
          <h3 className="pres-name mask" style={{ "--d": ".2s" } as React.CSSProperties}>
            <span>Your Name</span>
          </h3>
          <p className="pres-role rv" style={{ "--d": ".34s" } as React.CSSProperties}>
            Microsoft Learn Student Ambassador · <b>Web &amp; Cloud enthusiast</b>
          </p>

          <div className="rows pres-rows">
            <div className="row rv" style={{ "--d": ".44s" } as React.CSSProperties}>
              <span className="row-ic"><Ic name="grad" /></span>
              <div>
                <h4>Studying Computer Science</h4>
                <p>Your University, Year 3 — focused on web engineering and developer communities.</p>
              </div>
            </div>
            <div className="row rv" style={{ "--d": ".54s" } as React.CSSProperties}>
              <span className="row-ic"><Ic name="code" /></span>
              <div>
                <h4>Building with React &amp; Next.js</h4>
                <p>Side projects, hackathon wins, and shipping full-stack apps to real users.</p>
              </div>
            </div>
            <div className="row rv" style={{ "--d": ".64s" } as React.CSSProperties}>
              <span className="row-ic"><Ic name="pin" /></span>
              <div>
                <h4>Based in Your City</h4>
                <p>Hosting workshops like this one — and always up for a chat about the web.</p>
              </div>
            </div>
          </div>

          <div className="pres-contact rv" style={{ "--d": ".78s" } as React.CSSProperties}>
            <a className="chip" href="https://github.com/yourhandle" target="_blank" rel="noopener noreferrer">
              <Ic name="at" /> github.com/yourhandle
            </a>
            <a className="chip" href="https://linkedin.com/in/yourhandle" target="_blank" rel="noopener noreferrer">
              <Ic name="link" /> linkedin.com/in/yourhandle
            </a>
            <a className="chip" href="mailto:your@email.dev">
              <Ic name="mail" /> your@email.dev
            </a>
          </div>

          <p className="pres-hello rv" style={{ "--d": ".9s" } as React.CSSProperties}>
            <Ic name="terminal" /> $ echo "Ask me anything — before, during, or after the talk."
          </p>
        </div>
      </div>
    </section>
  );
}
