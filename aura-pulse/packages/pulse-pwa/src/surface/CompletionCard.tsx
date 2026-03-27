import { useEffect, useState } from "react";
import type { CompletionSurface } from "../ws/protocol.js";

interface CompletionCardProps {
  surface: CompletionSurface;
  onDismiss: () => void;
}

const AUTO_DISMISS_MS = 8_000;

export function CompletionCard({ surface, onDismiss }: CompletionCardProps) {
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const fade = setTimeout(() => setFading(true), AUTO_DISMISS_MS - 1500);
    const dismiss = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => {
      clearTimeout(fade);
      clearTimeout(dismiss);
    };
  }, [onDismiss]);

  return (
    <div
      className={`aura-card${fading ? " completion-card--fading" : ""}`}
      style={{ maxWidth: 640, margin: "0 auto" }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem" }}>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: "50%",
            background: "#14532d",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            fontSize: "1rem",
          }}
        >
          ✓
        </div>
        <div>
          <div style={{ fontWeight: 600, color: "var(--success-400)", marginBottom: "0.25rem" }}>
            Done
          </div>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", lineHeight: 1.5 }}>
            {surface.summary}
          </p>
        </div>
      </div>
      <button
        className="aura-btn aura-btn--ghost"
        style={{ marginTop: "1rem", fontSize: "0.8rem" }}
        onClick={onDismiss}
      >
        Dismiss
      </button>
    </div>
  );
}
