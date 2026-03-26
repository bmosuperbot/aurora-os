export interface AutonomousLogEntry {
    id: string;
    timestamp: string;
    agent_id: string;
    package: string;
    action: string;
    summary: string;
    detail?: Record<string, unknown>;
    contract_id?: string;
    connector_used: string;
}
