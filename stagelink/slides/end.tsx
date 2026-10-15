export default function Slide() {
  return (
    <div style={{
      position: "absolute", inset: 0, display: "flex",
      flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 18,
    }}>
      <h1 style={{ font: "700 96px/1 var(--fd)", letterSpacing: "-.045em", color: "var(--ink)", margin: 0 }}>
        Thank you
      </h1>
      <p style={{ font: "400 22px var(--fb)", color: "var(--mut)" }}>Questions?</p>
    </div>
  );
}
