// NxOverlay.tsx — Presentation 02 · MSA brand overlay
// Scales to its own slide canvas (thumbnail, editor preview, Present mode)
// using container query units instead of viewport units.
// Usage: <NxOverlay theme="light" />
// The parent must be the slide box: position: relative + aspect-ratio: 16 / 9.
"use client";

// 1u = 1% of the slide width on a 16:9 canvas (letterboxes via min())
const U = "min(1cqw,1.7778cqh)";
const u = (n: number) => `calc(${U} * ${n})`;

// Hairline that scales with the slide but never drops below 1px
const hair = `max(1px, ${u(0.08)})`;

const FONT = "'Segoe UI Variable Display','Segoe UI',system-ui,sans-serif";

export default function NxOverlay({ theme = "light" }: { theme?: "light" | "dark" }) {
  const isLight = theme === "light";
  const ink = isLight ? "#1b1b1f" : "#F3F2F1";
  const blue = isLight ? "#3b5f8f" : "#4CC2FF";
  const line = isLight ? "#a9bcd3" : "#55524E";
  const star = isLight ? "#3d7be8" : "#4CC2FF";

  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 20,
        pointerEvents: "none",
        overflow: "hidden",
        containerType: "size", // makes cqw/cqh resolve against this slide
      }}
    >
      {/* ── Header row ── */}
      <div
        style={{
          position: "absolute",
          top: u(1),
          left: u(2.6),
          right: u(3.2),
          height: u(5.6),
          display: "flex",
          alignItems: "center",
        }}
      >
        {/* SA badge */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/api/assets/hi/assets/MIC_StudentAmbassadors_Badge_Program_ColorBG.png"
          alt="Microsoft Student Ambassadors"
          style={{
            height: u(5.6),
            width: u(5.6),
            objectFit: "contain",
            borderRadius: "50%",
            flexShrink: 0,
          }}
        />

        {/* Brand text */}
        <span
          style={{
            fontSize: u(1.2),
            fontWeight: 500,
            color: ink,
            marginLeft: u(1.6),
            whiteSpace: "nowrap",
            fontFamily: FONT,
          }}
        >
          Student Ambassadors
        </span>

        {/* Vertical divider */}
        <span
          style={{
            width: hair,
            height: u(2),
            background: line,
            margin: `0 ${u(1.6)}`,
            flexShrink: 0,
          }}
        />

        {/* MS logo + wordmark */}
        <div style={{ display: "flex", alignItems: "center", gap: u(0.7), flexShrink: 0 }}>
          <svg
            style={{ width: u(2.4), height: u(2.4), display: "block", flexShrink: 0 }}
            viewBox="0 0 23 23"
            fill="none"
          >
            <rect x="1" y="1" width="10" height="10" rx="1.2" fill="#F25022" />
            <rect x="12" y="1" width="10" height="10" rx="1.2" fill="#7FBA00" />
            <rect x="1" y="12" width="10" height="10" rx="1.2" fill="#00A4EF" />
            <rect x="12" y="12" width="10" height="10" rx="1.2" fill="#FFB900" />
          </svg>
          <span
            style={{
              fontSize: u(2.2),
              fontWeight: 500,
              color: "#737373",
              letterSpacing: "-.01em",
              fontFamily: FONT,
              whiteSpace: "nowrap",
            }}
          >
            Microsoft
          </span>
        </div>

        {/* Horizontal rule */}
        <div
          style={{
            flex: 1,
            height: hair,
            background: line,
            margin: `0 ${u(1.2)} 0 ${u(2.1)}`,
          }}
        />

        {/* Right label */}
        <span
          style={{
            fontSize: u(1.35),
            fontWeight: 500,
            color: blue,
            whiteSpace: "nowrap",
            fontFamily: FONT,
          }}
        >
          Microsoft Student Ambassadors
        </span>
      </div>

      {/* ── Footer row ── */}
      <div
        style={{
          position: "absolute",
          left: u(4.9),
          right: u(2.2),
          bottom: u(2.4),
          height: u(3),
          display: "flex",
          alignItems: "center",
        }}
      >
        {/* Footer text */}
        <span
          style={{
            fontSize: u(1.1),
            fontWeight: 500,
            color: blue,
            whiteSpace: "nowrap",
            fontFamily: FONT,
          }}
        >
          Microsoft Student Ambassadors
        </span>

        {/* Line with gradient accent tail */}
        <div
          style={{
            flex: 1,
            height: hair,
            background: line,
            marginLeft: u(1.6),
            position: "relative",
          }}
        >
          <div
            style={{
              position: "absolute",
              right: u(1.7),
              top: "50%",
              transform: "translateY(-50%)",
              width: u(4.2),
              height: u(0.25),
              background: "linear-gradient(90deg,#8b5cf6,#22b8f0)",
            }}
          />
        </div>

        {/* Sparkle icon */}
        <svg
          aria-hidden
          style={{
            width: u(2.6),
            height: u(2.6),
            marginLeft: u(2.4),
            flexShrink: 0,
          }}
          viewBox="0 0 24 24"
          fill="none"
        >
          <path
            d="M12 1 C12.8 7.5 16.5 11.2 23 12 C16.5 12.8 12.8 16.5 12 23 C11.2 16.5 7.5 12.8 1 12 C7.5 11.2 11.2 7.5 12 1Z"
            stroke={star}
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  );
}
