import { WsBadge } from "./WsBadge.js";

/** Silent mode — connected but nothing to show. The interface has disappeared. */
export function SilentSurface() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100dvh",
        gap: "1rem",
      }}
    >
      <div className="pulse-dot" />
      <WsBadge />
    </div>
  );
}
