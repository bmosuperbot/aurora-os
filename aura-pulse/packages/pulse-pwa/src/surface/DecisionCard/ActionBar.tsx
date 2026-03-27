import type { SurfaceAction } from "../../ws/protocol.js";
import type { SurfaceMode } from "../../ws/surface-store.js";

interface ActionBarProps {
  actions: SurfaceAction[];
  mode: SurfaceMode;
  contractId: string;
  onEngage: () => void;
  onAbandon: () => void;
  onResolve: (action: string, value?: unknown) => void;
  onStartClarification: () => void;
  onOpenArtifact: (componentId: string) => void;
}

export function ActionBar({
  actions,
  mode,
  contractId: _contractId,
  onEngage,
  onAbandon,
  onResolve,
  onStartClarification,
  onOpenArtifact,
}: ActionBarProps) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "1rem" }}>
      {mode === "decision" && (
        <button className="aura-btn aura-btn--primary" onClick={onEngage}>
          Engage
        </button>
      )}

      {(mode === "resolver_active" || mode === "clarifying" || mode === "artifact_review") &&
        actions.map((a) => (
          <button
            key={a.id}
            className={`aura-btn aura-btn--${a.style ?? "secondary"}`}
            onClick={() => {
              if (a.opens_clarification) {
                onStartClarification();
              } else if (a.opens_artifact) {
                onOpenArtifact(a.opens_artifact);
              } else {
                onResolve(a.action, a.value);
              }
            }}
          >
            {a.label}
          </button>
        ))}

      {(mode === "resolver_active" || mode === "artifact_review") && (
        <button className="aura-btn aura-btn--ghost" onClick={onAbandon}>
          Abandon
        </button>
      )}
    </div>
  );
}
