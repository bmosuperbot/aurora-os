/** Confirming — Resolver committed, waiting for runtime clear. */
export function ConfirmingCard() {
  return (
    <div
      className="aura-card"
      style={{
        maxWidth: 640,
        margin: "0 auto",
        opacity: 0.6,
        display: "flex",
        alignItems: "center",
        gap: "1rem",
      }}
    >
      <div className="pulse-dot" />
      <div>
        <div style={{ fontWeight: 600 }}>Working on it</div>
        <div style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>
          Your resolution is being processed…
        </div>
      </div>
    </div>
  );
}
