export default function Slide() {
  const feats = [
    ["01", "App Router", "A new routing system built on React conventions — intuitive and nested by design."],
    ["02", "Server Components", "Components render on the server, by default."],
    ["03", "Server Actions", "Run server-side code directly from your components."],
    ["04", "Streaming & Suspense", "Progressive page loading with instant fallback UI."],
    ["05", "Built-in Optimizations", "Automatic image, font, and script optimization — no extra tooling."],
  ];
  return (
    <section className="slide">
      <header className="s-head">
        <p className="kick rv">What's New — 13+</p>
        <h2 className="h2 mask" style={{ "--d": ".12s" } as React.CSSProperties}>
          <span>A new generation of features.</span>
        </h2>
        <p className="lead rv" style={{ "--d": ".3s" } as React.CSSProperties}>
          Next.js 13+ brought faster, smarter defaults for building modern applications.
        </p>
      </header>
      <div className="s-body">
        <div className="feats">
          {feats.map(([fn, h, p], i) => (
            <div key={fn} className="feat rv" style={{ "--d": `${0.22 + i * 0.1}s` } as React.CSSProperties}>
              <span className="fn">{fn}</span>
              <h4>{h}</h4>
              <p>{p}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
