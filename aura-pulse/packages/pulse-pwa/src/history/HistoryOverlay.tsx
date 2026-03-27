import { useState, useEffect, useCallback, useRef } from "react";
import { fetchHistory } from "../api/ws-http.js";
import type { HistoryContract } from "../api/ws-http.js";

interface HistoryOverlayProps {
  onClose: () => void;
}

const PAGE_SIZE = 50;

export function HistoryOverlay({ onClose }: HistoryOverlayProps) {
  const [items, setItems] = useState<HistoryContract[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = useCallback(
    async (currentOffset: number) => {
      if (loading) return;
      setLoading(true);
      try {
        const page = await fetchHistory(PAGE_SIZE, currentOffset);
        setItems((prev) => (currentOffset === 0 ? page.contracts : [...prev, ...page.contracts]));
        setOffset(currentOffset + page.contracts.length);
        setHasMore(page.hasMore);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [loading]
  );

  // Initial load
  useEffect(() => { void load(0); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Infinite scroll via IntersectionObserver
  useEffect(() => {
    if (!bottomRef.current || !hasMore) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) void load(offset); },
      { threshold: 0.1 }
    );
    obs.observe(bottomRef.current);
    return () => obs.disconnect();
  }, [offset, hasMore, load]);

  return (
    <div className="history-overlay">
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "1rem 1.5rem",
          borderBottom: "1px solid var(--n-700)",
          flexShrink: 0,
        }}
      >
        <h2 style={{ fontWeight: 700, fontSize: "1.1rem" }}>History</h2>
        <button className="aura-btn aura-btn--ghost" onClick={onClose}>
          Close
        </button>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: "auto", padding: "1rem 1.5rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        {error && (
          <p style={{ color: "var(--danger-400)", fontSize: "0.9rem" }}>Error: {error}</p>
        )}
        {items.map((item) => (
          <HistoryItem key={item.id} item={item} />
        ))}
        {loading && (
          <p style={{ color: "var(--text-muted)", fontSize: "0.875rem", textAlign: "center" }}>
            Loading…
          </p>
        )}
        {!hasMore && items.length > 0 && (
          <p style={{ color: "var(--text-muted)", fontSize: "0.8rem", textAlign: "center" }}>
            — End of history —
          </p>
        )}
        <div ref={bottomRef} style={{ height: 1 }} />
      </div>
    </div>
  );
}

// ── History item ──────────────────────────────────────────────────────────────

function HistoryItem({ item }: { item: HistoryContract }) {
  const statusColor =
    item.status === "complete"
      ? "var(--success-400)"
      : "var(--danger-400)";

  const date = new Date(item.updated_at).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div
      className="aura-card"
      style={{ fontSize: "0.9rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}
    >
      {/* Top row */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <span
          style={{
            background: "var(--n-700)",
            borderRadius: 4,
            fontSize: "0.7rem",
            fontWeight: 700,
            letterSpacing: "0.04em",
            padding: "0.1rem 0.4rem",
            textTransform: "uppercase",
            color: "var(--text-muted)",
          }}
        >
          {item.type}
        </span>
        <span style={{ color: statusColor, fontSize: "0.75rem", fontWeight: 600 }}>
          {item.status}
        </span>
        <span style={{ marginLeft: "auto", color: "var(--text-muted)", fontSize: "0.75rem" }}>
          {date}
        </span>
      </div>

      {/* Goal */}
      <div style={{ color: "var(--text-secondary)" }}>
        <span style={{ color: "var(--text-muted)", fontSize: "0.78rem" }}>Goal: </span>
        {item.intent.goal}
      </div>

      {/* Decision */}
      {item.resume && (
        <div style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>
          <span style={{ color: "var(--text-muted)", fontSize: "0.78rem" }}>Decision: </span>
          <strong>{item.resume.action}</strong>
          {" · "}
          <span style={{ color: "var(--text-muted)" }}>by {item.resume.resolver_id}</span>
        </div>
      )}

      {/* Clarification thread (collapsed if long) */}
      {item.clarifications.length > 0 && (
        <div style={{ borderTop: "1px solid var(--n-700)", paddingTop: "0.5rem", display: "flex", flexDirection: "column", gap: "0.25rem" }}>
          {item.clarifications.map((c: { id: string; role: string; text?: string; content?: string; timestamp: string }) => (
            <div key={c.id} style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
              <strong style={{ color: c.role === "resolver" ? "var(--p-300)" : "var(--text-secondary)" }}>
                {c.role === "resolver" ? "You" : "Agent"}:
              </strong>{" "}
              {c.text ?? c.content ?? ""}
            </div>
          ))}
        </div>
      )}

      {/* Result */}
      {item.completion_surface && (
        <div style={{ color: "var(--success-400)", fontSize: "0.85rem" }}>
          {item.completion_surface.summary}
        </div>
      )}
    </div>
  );
}
