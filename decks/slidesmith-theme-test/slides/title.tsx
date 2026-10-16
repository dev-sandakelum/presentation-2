export default function Slide() {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        gap: 22,
      }}
    >
      <p
        style={{
          font: "500 12px var(--fm)",
          letterSpacing: ".24em",
          textTransform: "uppercase",
          color: "var(--mut)",
        }}
      >
        Your kick line
      </p>
      <h1
        style={{
          font: "600 92px/1 var(--fd)",
          letterSpacing: "-.045em",
          color: "var(--ink)",
          margin: 0,
        }}
      >
        Deck title
      </h1>
      <p style={{ font: "400 24px/1.5 var(--fb)", color: "var(--mut)" }}>
        A subtitle that says what this deck is about.
      </p>
    </div>
  );
}
