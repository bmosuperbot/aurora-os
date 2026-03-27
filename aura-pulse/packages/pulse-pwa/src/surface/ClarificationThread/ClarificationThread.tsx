import { useState, useRef } from "react";
import type { ClarificationEntry } from "../../ws/protocol.js";

interface ClarificationThreadProps {
  clarifications: ClarificationEntry[];
  isWaitingForAnswer: boolean;
  onSubmitQuestion: (text: string) => void;
}

export function ClarificationThread({
  clarifications,
  isWaitingForAnswer,
  onSubmitQuestion,
}: ClarificationThreadProps) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = () => {
    const q = draft.trim();
    if (!q) return;
    setDraft("");
    onSubmitQuestion(q);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="clarification-thread">
      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.5rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>
        Clarification
      </div>

      {clarifications.map((entry) => (
        <div
          key={entry.id}
          className={`clarification-entry clarification-entry--${entry.role === "resolver" || entry.role === "question" ? "resolver" : "agent"}`}
        >
          <div className="bubble">{entry.text ?? entry.content ?? ""}</div>
          <div className="bubble-meta">
            {entry.role === "resolver" || entry.role === "question" ? "You" : entry.attributed_to ?? entry.participant ?? "Agent"} ·{" "}
            {new Date(entry.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </div>
        </div>
      ))}

      {isWaitingForAnswer && (
        <div className="clarification-entry clarification-entry--agent">
          <div className="bubble" style={{ color: "var(--text-muted)", fontStyle: "italic" }}>
            <span className="pulse-dot" style={{ display: "inline-block", width: 6, height: 6, marginRight: 6 }} />
            Thinking…
          </div>
        </div>
      )}

      {!isWaitingForAnswer && (
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.25rem" }}>
          <input
            ref={inputRef}
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question…"
            style={{
              flex: 1,
              background: "var(--n-800)",
              border: "1px solid var(--n-600)",
              borderRadius: "var(--radius-sm)",
              color: "var(--text-primary)",
              fontFamily: "var(--font-sans)",
              fontSize: "0.9rem",
              padding: "0.4rem 0.75rem",
            }}
          />
          <button
            className="aura-btn aura-btn--secondary"
            onClick={handleSubmit}
            disabled={!draft.trim()}
            style={{ flexShrink: 0 }}
          >
            Ask
          </button>
        </div>
      )}
    </div>
  );
}
