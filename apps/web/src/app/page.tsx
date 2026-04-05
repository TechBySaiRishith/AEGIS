export default function Home() {
  return (
    <main
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        minHeight: "100vh",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <h1 style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>
        AEGIS AI Safety Lab
      </h1>
      <p style={{ color: "#666" }}>
        Adversarial evaluation and governance for AI systems
      </p>
    </main>
  );
}
