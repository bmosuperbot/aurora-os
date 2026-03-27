import { useState, useEffect } from "react";

interface TimeoutBarProps {
  expiresAt: string | undefined;
}

/** Depletes linearly from 100% → 0% toward expiresAt. Display only — server is authoritative on expiry. */
export function TimeoutBar({ expiresAt }: TimeoutBarProps) {
  const [pct, setPct] = useState(100);

  useEffect(() => {
    if (!expiresAt) return;
    const end = new Date(expiresAt).getTime();

    const tick = () => {
      const remaining = end - Date.now();
      if (remaining <= 0) { setPct(0); return; }
      // Estimate total from a 5-minute resolver window as fallback
      const total = Math.max(end - Date.now() + 300_000, 1);
      setPct(Math.max(0, Math.min(100, (remaining / total) * 100)));
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  return (
    <div className="timeout-bar">
      <div className="timeout-bar__fill" style={{ width: `${pct}%` }} />
    </div>
  );
}
