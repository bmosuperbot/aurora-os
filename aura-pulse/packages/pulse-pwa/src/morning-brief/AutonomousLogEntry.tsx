import type { FC } from "react";
import type { AutonomousLogEntry as RuntimeAutonomousLogEntry } from "@aura/contract-runtime";

export type AutonomousLogEntryData = RuntimeAutonomousLogEntry;

interface Props {
  entry: AutonomousLogEntryData;
}

export const AutonomousLogEntry: FC<Props> = ({ entry }) => {
  const time = new Date(entry.timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <li className="autonomous-log-entry">
      <span className="autonomous-log-time">{time}</span>
      <span className="autonomous-log-badge">{entry.package}</span>
      <span className="autonomous-log-summary">{entry.summary}</span>
      {entry.connector_used && entry.connector_used !== "none" && (
        <span className="autonomous-log-connector" title={entry.connector_used}>
          via {entry.connector_used}
        </span>
      )}
    </li>
  );
};
