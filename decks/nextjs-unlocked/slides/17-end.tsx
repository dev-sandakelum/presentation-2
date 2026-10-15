export default function Slide() {
  return (
    <section className="slide s-end">
      <div className="end-wrap">
        <svg className="ic ic-fill end-tri rv" style={{ "--d": ".05s", width: 48, height: 48 } as React.CSSProperties} viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3 22 20H2Z" />
        </svg>
        <p className="kick rv" style={{ "--d": ".15s" } as React.CSSProperties}>
          Part 1 of 3 — Concepts · Complete
        </p>
        <h2 className="end-title mask" style={{ "--d": ".25s" } as React.CSSProperties}>
          <span>Questions?</span>
        </h2>
        <p className="end-sub rv" style={{ "--d": ".45s" } as React.CSSProperties}>
          Thank you for your time.
        </p>
        <div className="end-actions rv" style={{ "--d": ".6s" } as React.CSSProperties}>
          <span className="btn">
            <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
              <path d="m15 5-7 7 7 7" />
            </svg>
            Restart presentation
          </span>
        </div>
        <p className="end-credit rv" style={{ "--d": ".75s" } as React.CSSProperties}>
          Adapted from "Next.js Unlocked" &amp; "Introduction to Next.js — Part 1: Concepts" ·
          Microsoft Learn Student Ambassadors
        </p>
      </div>
    </section>
  );
}
