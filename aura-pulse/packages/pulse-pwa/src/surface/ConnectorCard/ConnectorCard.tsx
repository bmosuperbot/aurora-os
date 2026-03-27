import { useState, useRef } from "react";
import { useSurfaceStore } from "../../ws/surface-store.js";
import type { ConnectorCard } from "../../ws/protocol.js";

interface ConnectorCardOverlayProps {
  card: ConnectorCard;
}

export function ConnectorCardOverlay({ card }: ConnectorCardOverlayProps) {
  const sendMessage = useSurfaceStore((s) => s.sendMessage);

  const handleDecline = (never = false) => {
    sendMessage({ type: "decline_connector", connectorId: card.connector_id, never });
  };

  return (
    <div className="connector-overlay">
      <div className="aura-card" style={{ maxWidth: 480, width: "100%", margin: "1rem" }}>
        <div style={{ marginBottom: "1rem" }}>
          <div style={{ fontWeight: 700, fontSize: "1.05rem", marginBottom: "0.25rem" }}>
            Connect {card.connector_name}
          </div>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>{card.offer_text}</p>
        </div>

        {card.flow_type === "browser_redirect" && (
          <BrowserRedirectFlow card={card} onDecline={handleDecline} />
        )}
        {card.flow_type === "secure_input" && (
          <SecureInputFlow card={card} onDecline={handleDecline} />
        )}
        {card.flow_type === "manual_guide" && (
          <ManualGuideFlow card={card} onDecline={handleDecline} />
        )}
        {!card.flow_type && (
          <GenericConnectorFlow card={card} onDecline={handleDecline} />
        )}
      </div>
    </div>
  );
}

// ── Browser redirect ──────────────────────────────────────────────────────────

function BrowserRedirectFlow({
  card,
  onDecline,
}: {
  card: ConnectorCard;
  onDecline: (never?: boolean) => void;
}) {
  const sendMessage = useSurfaceStore((s) => s.sendMessage);
  const [neverFlag, setNeverFlag] = useState(false);
  const [launched, setLaunched] = useState(false);

  const handleConnect = () => {
    setLaunched(true);
    sendMessage({ type: "initiate_connector", connectorId: card.connector_id });
    // Plugin responds with auth URL; browser will open a new tab via plugin HTTP response.
  };

  return (
    <div>
      {!launched ? (
        <button className="aura-btn aura-btn--primary" onClick={handleConnect}>
          Connect via {card.connector_name}
        </button>
      ) : (
        <p style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>
          Complete the authorization in the new tab. This panel will close automatically.
        </p>
      )}
      <DeclineRow neverFlag={neverFlag} setNeverFlag={setNeverFlag} onDecline={onDecline} />
    </div>
  );
}

// ── Secure input ──────────────────────────────────────────────────────────────

function SecureInputFlow({
  card,
  onDecline,
}: {
  card: ConnectorCard;
  onDecline: (never?: boolean) => void;
}) {
  const sendMessage = useSurfaceStore((s) => s.sendMessage);
  const [value, setValue] = useState("");
  const [neverFlag, setNeverFlag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = () => {
    const key = value.trim();
    if (!key) return;
    sendMessage({
      type: "complete_connector",
      connectorId: card.connector_id,
      credentials: { key },
    });
    setValue("");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      <div>
        <label
          htmlFor="secure-input"
          style={{ display: "block", fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "0.25rem" }}
        >
          {card.input_label ?? "API Key"}
        </label>
        <input
          id="secure-input"
          ref={inputRef}
          type="password"
          autoComplete="off"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          style={{
            width: "100%",
            background: "var(--n-800)",
            border: "1px solid var(--n-600)",
            borderRadius: "var(--radius-sm)",
            color: "var(--text-primary)",
            fontFamily: "var(--font-sans)",
            fontSize: "0.9rem",
            padding: "0.5rem 0.75rem",
          }}
          placeholder="Paste your key here…"
        />
      </div>
      <button className="aura-btn aura-btn--primary" onClick={handleSubmit} disabled={!value.trim()}>
        Save
      </button>
      <DeclineRow neverFlag={neverFlag} setNeverFlag={setNeverFlag} onDecline={onDecline} />
    </div>
  );
}

// ── Manual guide ──────────────────────────────────────────────────────────────

function ManualGuideFlow({
  card,
  onDecline,
}: {
  card: ConnectorCard;
  onDecline: (never?: boolean) => void;
}) {
  const [neverFlag, setNeverFlag] = useState(false);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      {card.guide_steps && card.guide_steps.length > 0 && (
        <ol style={{ paddingLeft: "1.25rem", color: "var(--text-secondary)", fontSize: "0.9rem", lineHeight: 1.7 }}>
          {card.guide_steps.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
      )}
      <button
        className="aura-btn aura-btn--primary"
        onClick={() => onDecline(false)}
      >
        Done
      </button>
      <DeclineRow neverFlag={neverFlag} setNeverFlag={setNeverFlag} onDecline={onDecline} />
    </div>
  );
}

function GenericConnectorFlow({
  card: _card,
  onDecline,
}: {
  card: ConnectorCard;
  onDecline: (never?: boolean) => void;
}) {
  const [neverFlag, setNeverFlag] = useState(false);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      <p style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>
        This connection request does not specify an interactive flow. You can skip it for now or choose never ask again.
      </p>
      <DeclineRow neverFlag={neverFlag} setNeverFlag={setNeverFlag} onDecline={onDecline} />
    </div>
  );
}

// ── Shared decline row ────────────────────────────────────────────────────────

interface DeclineRowProps {
  neverFlag: boolean;
  setNeverFlag: (v: boolean) => void;
  onDecline: (never?: boolean) => void;
}

function DeclineRow({ neverFlag, setNeverFlag, onDecline }: DeclineRowProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginTop: "0.5rem" }}>
      <button
        className="aura-btn aura-btn--ghost"
        style={{ fontSize: "0.85rem" }}
        onClick={() => onDecline(neverFlag)}
      >
        Skip
      </button>
      <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.8rem", color: "var(--text-muted)", cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={neverFlag}
          onChange={(e) => setNeverFlag(e.target.checked)}
        />
        Never ask again
      </label>
    </div>
  );
}
