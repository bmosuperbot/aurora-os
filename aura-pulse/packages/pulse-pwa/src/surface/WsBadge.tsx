import { useSurfaceStore } from "../ws/surface-store.js";

/** Connection status badge shown in all surface states. */
export function WsBadge() {
  const wsStatus = useSurfaceStore((s) => s.wsStatus);
  return (
    <span className={`ws-badge ws-badge--${wsStatus}`}>
      {wsStatus === "connected" ? "live" : wsStatus}
    </span>
  );
}
