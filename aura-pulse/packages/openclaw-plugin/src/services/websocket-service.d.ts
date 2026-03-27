import type { AuraPluginConfig } from '../config/schema.js';
import type { ContractRuntime, ConnectorState, SQLiteContractStorage } from '@aura/contract-runtime';
import type { PluginLogger } from '../types/plugin-types.js';

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
    pushConnectorRequest(connector: ConnectorState): void;
    pushConnectorComplete(connectorId: string, status: string): void;
}
