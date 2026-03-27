import type { AuraPluginConfig } from '../config/schema.js';
import type { ContractRuntime, ConnectorState, SQLiteContractStorage } from '@aura/contract-runtime';
import type { PluginLogger } from '../types/plugin-types.js';

export interface ConnectorCardPayload {
    id: string;
    source: ConnectorState['source'];
    status: ConnectorState['status'];
    offered_at?: string;
    never_resurface?: boolean;
    capability_without: string;
    capability_with: string;
    connector_id: string;
    connector_name: string;
    offer_text: string;
    flow_type?: 'browser_redirect' | 'secure_input' | 'manual_guide';
    auth_url?: string;
    input_label?: string;
    guide_steps?: string[];
}

export class WebSocketService {
    constructor(
        config: AuraPluginConfig,
        runtime: ContractRuntime,
        storage: SQLiteContractStorage,
        signalPath: string,
        logger: PluginLogger,
    );
    start(): Promise<void>;
    stop(): Promise<void>;
    nudge(): void;
    pushConnectorRequest(connector: ConnectorCardPayload): void;
    pushConnectorComplete(connectorId: string, status: string): void;
}
