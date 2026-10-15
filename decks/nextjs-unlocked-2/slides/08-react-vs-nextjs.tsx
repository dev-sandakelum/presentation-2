import { Ic } from "@/shared/icons";

function CL({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span className={ok ? "cl cl-ok" : "cl cl-x"}>
      <Ic name={ok ? "check" : "x"} />
      {children}
    </span>
  );
}

export default function Slide() {
  return (
    <section className="slide">
      <header className="s-head">
        <p className="kick rv">Head to Head</p>
        <h2 className="h2 mask" style={{ "--d": ".12s" } as React.CSSProperties}>
          <span>React vs. Next.js</span>
        </h2>
      </header>
      <div className="s-body">
        <div className="vs-wrap rv" style={{ "--d": ".25s" } as React.CSSProperties}>
          <table className="vs">
            <thead>
              <tr>
                <th className="corner" />
                <th>React — CSR</th>
                <th className="nx">Next.js — SSR / Full-Stack</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Routing</td>
                <td><CL ok={false}>Manual — install a library</CL></td>
                <td className="nx"><CL ok>File-based, built-in</CL></td>
              </tr>
              <tr>
                <td>Rendering</td>
                <td><CL ok={false}>CSR only</CL></td>
                <td className="nx"><CL ok>CSR · SSR · SSG · ISR</CL></td>
              </tr>
              <tr>
                <td>Backend</td>
                <td><CL ok={false}>None — external API needed</CL></td>
                <td className="nx"><CL ok>Built-in API routes</CL></td>
              </tr>
              <tr>
                <td>SEO</td>
                <td><CL ok={false}>Poor by default</CL></td>
                <td className="nx"><CL ok>Excellent out of the box</CL></td>
              </tr>
              <tr>
                <td>Setup</td>
                <td><CL ok={false}>Many tools to configure</CL></td>
                <td className="nx"><CL ok>Zero config to start</CL></td>
              </tr>
              <tr>
                <td>First Load</td>
                <td><CL ok={false}>Blank screen first</CL></td>
                <td className="nx"><CL ok>Instant page view</CL></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
