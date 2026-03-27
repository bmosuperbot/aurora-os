import { useEffect, type FC } from "react";
import type { MorningBriefRecommendationContext } from "@aura/contract-runtime";
import { useSurfaceStore } from "../ws/surface-store.js";
import { voiceEngine } from "../voice/voice-engine.js";
import {
  AutonomousLogEntry,
  type AutonomousLogEntryData,
} from "./AutonomousLogEntry.js";
import type { BaseContract } from "../ws/protocol.js";

interface MorningBriefProps {
  contract: BaseContract;
}

export const MorningBrief: FC<MorningBriefProps> = ({ contract }) => {
  const { surface } = contract;
  const { sendMessage } = useSurfaceStore();

  const ctx = (surface?.recommendation.context ?? {}) as MorningBriefRecommendationContext;
  const autonomousActions: AutonomousLogEntryData[] = ctx.autonomous_actions ?? [];
  const pendingDecisions = ctx.pending_decisions ?? [];
  const patternsObserved = ctx.patterns_observed ?? [];

  // Speak the greeting once on mount
  useEffect(() => {
    if (surface?.voice_line) {
      voiceEngine.speak(surface.voice_line, "high");
    }
    return () => {
      voiceEngine.cancel();
    };
  }, [contract.id, surface?.voice_line]);

  const handleDismiss = () => {
    sendMessage({
      type: "resolve",
      contractId: contract.id,
      token: contract.resume_token,
      action: "dismiss",
    });
  };

  const handlePendingClick = (_decisionId: string) => {
    // Dismiss the brief first, then the pending contract will surface naturally
    // (server will push it as the next decision once brief is resolved)
    sendMessage({
      type: "resolve",
      contractId: contract.id,
      token: contract.resume_token,
      action: "dismiss",
    });
  };

  return (
    <div className="morning-brief-card aura-card">
      {/* Header */}
      <header className="morning-brief-header">
        <span className="morning-brief-icon">🌅</span>
        <h2 className="morning-brief-title">Good morning</h2>
        {contract.agent_name && (
          <span className="morning-brief-agent">{contract.agent_name}</span>
        )}
      </header>

      {/* Voice summary */}
      {surface?.summary && (
        <p className="morning-brief-summary">{surface.summary}</p>
      )}

      {/* While you were away */}
      {autonomousActions.length > 0 && (
        <section className="morning-brief-section">
          <h3 className="morning-brief-section-title">While you were away</h3>
          <ul className="morning-brief-log-list">
            {autonomousActions.map((entry) => (
              <AutonomousLogEntry key={entry.id} entry={entry} />
            ))}
          </ul>
        </section>
      )}

      {/* Waiting for you */}
      {pendingDecisions.length > 0 && (
        <section className="morning-brief-section">
          <h3 className="morning-brief-section-title">
            Waiting for you
            <span className="morning-brief-count">
              {pendingDecisions.length}
            </span>
          </h3>
          <ul className="morning-brief-pending-list">
            {pendingDecisions.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  className="morning-brief-pending-item"
                  onClick={() => handlePendingClick(d.id)}
                >
                  {d.agent_name && (
                    <span className="morning-brief-pending-agent">
                      {d.agent_name}
                    </span>
                  )}
                  <span className="morning-brief-pending-goal">{d.goal}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* I noticed */}
      {patternsObserved.length > 0 && (
        <section className="morning-brief-section">
          <h3 className="morning-brief-section-title">I noticed</h3>
          <ul className="morning-brief-patterns-list">
            {patternsObserved.map((p, i) => (
              <li key={i} className="morning-brief-pattern">
                {p}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Dismiss */}
      <div className="morning-brief-footer">
        <button
          type="button"
          className="aura-btn aura-btn--primary"
          onClick={handleDismiss}
        >
          Got it
        </button>
      </div>
    </div>
  );
};
