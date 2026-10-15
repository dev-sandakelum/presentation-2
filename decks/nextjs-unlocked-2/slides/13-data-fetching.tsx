import { Ic } from "@/shared/icons";

export default function Slide() {
  return (
    <section className="slide">
      <header className="s-head">
        <p className="kick rv">Deep Dive — 03</p>
        <h2 className="h2 mask" style={{ "--d": ".12s" } as React.CSSProperties}>
          <span>Data fetching — before &amp; after.</span>
        </h2>
      </header>
      <div className="s-body df-grid">
        <div className="df-col rv" style={{ "--d": ".22s" } as React.CSSProperties}>
          <div className="code">
            <div className="code-bar">
              <span>The Old Way</span>
              <span className="code-tag">React · Client</span>
            </div>
            <pre>
              <span className="tk-k">useEffect</span>(() =&gt; {"{"}
              {"\n  "}<span className="tk-k">fetch</span>(<span className="tk-str">'/api/data'</span>)
              {"\n    "}.then(res =&gt; res.<span className="tk-k">json</span>())
              {"\n    "}.then(setData)
              {"\n"}){"}"}
            </pre>
          </div>
          <p className="df-cap">
            <Ic name="x" />
            Requires state, effects — and every fetch happens on the client.
          </p>
        </div>
        <div className="df-col rv" style={{ "--d": ".36s" } as React.CSSProperties}>
          <div className="code code-hi">
            <div className="code-bar">
              <span>The New Way</span>
              <span className="code-tag">Next.js · RSC</span>
            </div>
            <pre>
              <span className="tk-k">export default async function</span> Page() {"{"}
              {"\n  "}<span className="tk-k">const</span> res = <span className="tk-k">await</span> <span className="tk-k">fetch</span>(<span className="tk-str">'https://api.xyz/data'</span>)
              {"\n  "}<span className="tk-k">const</span> data = <span className="tk-k">await</span> res.<span className="tk-k">json</span>()
              {"\n"}
              {"\n  "}<span className="tk-k">return</span> <span className="tk-tag">&lt;h1&gt;</span>{"data.name"}<span className="tk-tag">&lt;/h1&gt;</span>
              {"\n"}){"}"}
            </pre>
          </div>
          <p className="df-cap">
            <Ic name="check" />
            Async components — fetching directly on the server.
          </p>
        </div>
      </div>
    </section>
  );
}
