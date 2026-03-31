import type { CSSProperties, FC } from "react";

interface AuroraBarsProps {
  className?: string;
  style?: CSSProperties;
  width?: number;
}

const GRADIENT_ID_PREFIX = "ab-grad-";
const FILTER_ID_PREFIX = "ab-glow-";
let instanceCounter = 0;

function useIds() {
  const id = ++instanceCounter;
  return {
    gradientId: `${GRADIENT_ID_PREFIX}${id}`,
    filterId: `${FILTER_ID_PREFIX}${id}`,
  };
}

const BARS = [
  { x: -92.5, y: -30, w: 6, h: 30 },
  { x: -77.5, y: -45, w: 6, h: 45 },
  { x: -62.5, y: -60, w: 7, h: 60 },
  { x: -47.5, y: -75, w: 8, h: 75 },
  { x: -32.5, y: -92.5, w: 9, h: 92.5 },
  { x: -15, y: -107.5, w: 10, h: 107.5 },
  { x: 5, y: -107.5, w: 10, h: 107.5 },
  { x: 23.5, y: -92.5, w: 9, h: 92.5 },
  { x: 39.5, y: -75, w: 8, h: 75 },
  { x: 55.5, y: -60, w: 7, h: 60 },
  { x: 71.5, y: -45, w: 6, h: 45 },
  { x: 86.5, y: -30, w: 6, h: 30 },
];

function BarGroup({
  gradientId,
  filterId,
  children,
}: {
  gradientId: string;
  filterId: string;
  children?: React.ReactNode;
}) {
  return (
    <svg viewBox="-100 -120 200 125" fill="none">
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#2dd4bf" />
          <stop offset="100%" stopColor="#0e7490" />
        </linearGradient>
        <filter id={filterId}>
          <feGaussianBlur stdDeviation="1.5" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>
      <g filter={`url(#${filterId})`}>
        {children ??
          BARS.map((b, i) => (
            <rect
              key={i}
              x={b.x}
              y={b.y}
              width={b.w}
              height={b.h}
              rx={1}
              fill={`url(#${gradientId})`}
              opacity={0.85}
              style={{ transformOrigin: "bottom" }}
            />
          ))}
      </g>
    </svg>
  );
}

export const AuroraBarsStill: FC<AuroraBarsProps> = ({ className, style, width = 80 }) => {
  const { gradientId, filterId } = useIds();
  return (
    <span className={className} style={{ display: "inline-flex", width, ...style }}>
      <BarGroup gradientId={gradientId} filterId={filterId}>
        {BARS.map((b, i) => (
          <rect
            key={i}
            x={b.x}
            y={b.y}
            width={b.w}
            height={b.h}
            rx={1}
            fill={`url(#${gradientId})`}
            opacity={0.85}
            style={{ transformOrigin: "bottom" }}
          />
        ))}
      </BarGroup>
    </span>
  );
};

export const AuroraBarsLoading: FC<AuroraBarsProps> = ({ className, style, width = 80 }) => {
  const { gradientId, filterId } = useIds();
  return (
    <span className={className} style={{ display: "inline-flex", width, ...style }}>
      <BarGroup gradientId={gradientId} filterId={filterId}>
        <style>{`
          .ab-wave { transform-origin: bottom; animation: ab-wave 1.2s ease-in-out infinite; }
          ${BARS.map((_, i) => `.ab-wave-${i} { animation-delay: ${(i * 0.1).toFixed(1)}s; }`).join("\n")}
          @keyframes ab-wave {
            0%, 100% { transform: scaleY(1); opacity: 0.85; }
            25% { transform: scaleY(0.6); opacity: 0.6; }
            60% { transform: scaleY(1.2); opacity: 1; }
            85% { transform: scaleY(1); opacity: 0.85; }
          }
        `}</style>
        {BARS.map((b, i) => (
          <rect
            key={i}
            className={`ab-wave ab-wave-${i}`}
            x={b.x}
            y={b.y}
            width={b.w}
            height={b.h}
            rx={1}
            fill={`url(#${gradientId})`}
            opacity={0.85}
          />
        ))}
      </BarGroup>
    </span>
  );
};

export const AuroraBarsListen: FC<AuroraBarsProps> = ({ className, style, width = 80 }) => {
  const { gradientId, filterId } = useIds();
  const durations = [2.2, 2.8, 2.0, 2.6, 2.4, 3.0, 2.0, 2.6, 2.8, 2.2, 2.4, 3.0];
  const delays = [0, 0.4, 0.2, 0.6, 0.32, 0.8, 0, 0.2, 0.48, 0.12, 0.4, 0.72];
  const peaks = [1.08, 1.04, 1.12, 1.06, 1.09, 1.05, 1.11, 1.07, 1.04, 1.14, 1.08, 1.1];
  return (
    <span className={className} style={{ display: "inline-flex", width, ...style }}>
      <BarGroup gradientId={gradientId} filterId={filterId}>
        <style>{`
          ${peaks.map((p, i) => `
            @keyframes ab-listen-${i} {
              0%, 100% { transform: scaleY(1); }
              50% { transform: scaleY(${p}); }
            }
          `).join("")}
        `}</style>
        {BARS.map((b, i) => (
          <rect
            key={i}
            x={b.x}
            y={b.y}
            width={b.w}
            height={b.h}
            rx={1}
            fill={`url(#${gradientId})`}
            opacity={0.85}
            style={{
              transformOrigin: "bottom",
              animation: `ab-listen-${i} ${durations[i]}s ease-in-out infinite`,
              animationDelay: `${delays[i]}s`,
            }}
          />
        ))}
      </BarGroup>
    </span>
  );
};

export const AuroraBarsTalk: FC<AuroraBarsProps> = ({ className, style, width = 80 }) => {
  const { gradientId, filterId } = useIds();
  const durations = [0.55, 0.7, 0.5, 0.65, 0.6, 0.75, 0.5, 0.65, 0.7, 0.55, 0.6, 0.75];
  const delays = [0, 0.1, 0.05, 0.15, 0.08, 0.2, 0, 0.05, 0.12, 0.03, 0.1, 0.18];
  const peaks = [1.08, 1.04, 1.12, 1.06, 1.09, 1.05, 1.11, 1.07, 1.04, 1.14, 1.08, 1.1];
  return (
    <span className={className} style={{ display: "inline-flex", width, ...style }}>
      <BarGroup gradientId={gradientId} filterId={filterId}>
        <style>{`
          ${peaks.map((p, i) => `
            @keyframes ab-talk-${i} {
              0%, 100% { transform: scaleY(1); }
              50% { transform: scaleY(${p}); }
            }
          `).join("")}
        `}</style>
        {BARS.map((b, i) => (
          <rect
            key={i}
            x={b.x}
            y={b.y}
            width={b.w}
            height={b.h}
            rx={1}
            fill={`url(#${gradientId})`}
            opacity={0.85}
            style={{
              transformOrigin: "bottom",
              animation: `ab-talk-${i} ${durations[i]}s ease-in-out infinite`,
              animationDelay: `${delays[i]}s`,
            }}
          />
        ))}
      </BarGroup>
    </span>
  );
};
