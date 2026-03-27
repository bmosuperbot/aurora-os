import { useState, useCallback, useRef } from "react";
import { useSurfaceStore } from "../../ws/surface-store.js";
import type { BaseContract, A2UIMessage } from "../../ws/protocol.js";
import type { SurfaceMode } from "../../ws/surface-store.js";
import { ActionBar } from "./ActionBar.js";
import { TimeoutBar } from "./TimeoutBar.js";
import { ClarificationThread } from "../ClarificationThread/ClarificationThread.js";
import { ArtifactPanel } from "../ArtifactPanel/ArtifactPanel.js";
import { clearArtifactDraft, getArtifactDraft } from "../../a2ui/aura-catalog.js";

export interface DecisionCardProps {
  contract: BaseContract;
  a2uiMessages: A2UIMessage[];
  mode: SurfaceMode;
}

export function DecisionCard({ contract, a2uiMessages, mode }: DecisionCardProps) {
  const { surface, expires_at, agent_name, id: contractId } = contract;
  const sendMessage = useSurfaceStore((s) => s.sendMessage);
  const openArtifactReview = useSurfaceStore((s) => s.openArtifactReview);
  const closeArtifactReview = useSurfaceStore((s) => s.closeArtifactReview);
  const clarifications = contract.clarifications ?? [];
  const resolverId = contract.participants?.resolver?.id ?? "owner";

  const [clarifyOpen, setClarifyOpen] = useState(false);
  const [openArtifactId, setOpenArtifactId] = useState<string | null>(null);
  const artifactDataRef = useRef<Record<string, unknown>>({});

  const handleEngage = useCallback(() => {
    sendMessage({ type: "engage", contractId, resolverId });
  }, [sendMessage, contractId, resolverId]);

  const handleAbandon = useCallback(() => {
    sendMessage({ type: "abandon", contractId });
  }, [sendMessage, contractId]);

  const handleResolve = useCallback(
    (action: string, value?: unknown) => {
      const surfaceId = openArtifactId ? `artifact-${contractId}-${openArtifactId}` : null;
      const artifactDraft = surfaceId ? getArtifactDraft(surfaceId) : artifactDataRef.current;
      const artifacts = Object.keys(artifactDraft).length > 0 ? artifactDraft : undefined;
      sendMessage({
        type: "resolve",
        contractId,
        token: contract.resume_token,
        action,
        ...(value !== undefined ? { value } : {}),
        ...(artifacts ? { artifacts } : {}),
      });
      if (surfaceId) {
        clearArtifactDraft(surfaceId);
      }
    },
    [sendMessage, contractId, contract.resume_token, openArtifactId]
  );

  const handleAsk = useCallback(
    (question: string) => {
      sendMessage({ type: "ask_clarification", contractId, question });
    },
    [sendMessage, contractId]
  );

  if (!surface) {
    return (
      <div className="aura-card" style={{ maxWidth: 640, margin: "0 auto", padding: "2rem" }}>
        <p style={{ color: "var(--text-muted)" }}>Contract has no surface data.</p>
      </div>
    );
  }

  const { voice_line, summary, recommendation, actions = [] } = surface;
  const agentDisplayName = agent_name ?? contract.participants?.writer?.id ?? "Aura";
  const recommendationAction = recommendation.label
    ?? actions.find((action) => action.action === recommendation.action || action.id === recommendation.action || action.id === recommendation.action_id)?.label
    ?? recommendation.action
    ?? recommendation.action_id
    ?? "Review";

  return (
    <div className="aura-card" style={{ maxWidth: 640, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem" }}>
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: "50%",
            background: "var(--p-500)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "0.8rem",
            fontWeight: 700,
            color: "#fff",
            flexShrink: 0,
          }}
        >
          {agentDisplayName.charAt(0).toUpperCase()}
        </div>
        <div>
          <div style={{ fontWeight: 600, fontSize: "0.95rem" }}>{agentDisplayName}</div>
          <div style={{ color: "var(--text-muted)", fontSize: "0.8rem", fontStyle: "italic" }}>
            {voice_line}
          </div>
        </div>
      </div>

      {/* Summary */}
      <p style={{ color: "var(--text-secondary)", marginBottom: "1rem", lineHeight: 1.6 }}>
        {summary}
      </p>

      {/* Recommendation */}
      <div
        style={{
          background: "var(--n-900)",
          borderRadius: "var(--radius-md)",
          padding: "0.75rem 1rem",
          marginBottom: "1rem",
          borderLeft: "3px solid var(--accent)",
        }}
      >
        <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.25rem" }}>
          Recommended
        </div>
        <div style={{ fontWeight: 600 }}>{recommendationAction}</div>
        <div style={{ color: "var(--text-secondary)", fontSize: "0.875rem", marginTop: "0.25rem" }}>
          {recommendation.reasoning}
        </div>
      </div>

      {/* Artifact panel */}
      {openArtifactId && a2uiMessages.length > 0 && (
        <div style={{ marginBottom: "1rem" }}>
          <ArtifactPanel
            a2uiMessages={a2uiMessages}
            contractId={contractId}
            surfaceId={`artifact-${contractId}-${openArtifactId}`}
            onAction={(event) => {
              handleResolve(event.actionName);
            }}
            onDataChange={(data) => {
              artifactDataRef.current = data;
            }}
          />
          <button
            className="aura-btn aura-btn--ghost"
            style={{ marginTop: "0.5rem", fontSize: "0.8rem" }}
            onClick={() => {
              setOpenArtifactId(null);
              closeArtifactReview();
            }}
          >
            Close artifact
          </button>
        </div>
      )}

      {/* Clarification thread */}
      {(clarifyOpen || clarifications.length > 0) && (
        <div style={{ marginBottom: "1rem" }}>
          <ClarificationThread
            clarifications={clarifications}
            isWaitingForAnswer={mode === "clarifying" && ["resolver", "question"].includes(clarifications[clarifications.length - 1]?.role ?? "")}
            onSubmitQuestion={handleAsk}
          />
        </div>
      )}

      {/* Timeout bar for resolver_active */}
      {mode === "resolver_active" && (
        <div style={{ marginBottom: "0.75rem" }}>
          <TimeoutBar expiresAt={expires_at} />
        </div>
      )}

      {/* Action bar */}
      <ActionBar
        actions={actions}
        mode={mode}
        contractId={contractId}
        onEngage={handleEngage}
        onAbandon={handleAbandon}
        onResolve={handleResolve}
        onStartClarification={() => setClarifyOpen(true)}
        onOpenArtifact={(componentId) => {
          setOpenArtifactId(componentId);
          openArtifactReview();
        }}
      />
    </div>
  );
}
