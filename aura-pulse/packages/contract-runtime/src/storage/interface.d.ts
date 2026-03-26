import type { BaseContract } from '../types/base-contract.js';
import type { AutonomousLogEntry } from '../types/autonomous-log.js';
import type { ConnectorState } from '../types/connector-state.js';

export interface ContractFilter {
    status?: string | string[];
    resolver_type?: 'human' | 'agent';
    parent_id?: string;
    type?: string;
    updated_after?: string;
    surface_after_before?: string;
    expires_before?: string;
    updated_before?: string;
}

export interface LogFilter {
    agent_id?: string;
    package?: string;
    after?: string;
}

export interface ContractLogEntry {
    id?: number;
    contract_id: string;
    timestamp: string;
    participant: string;
    event: string;
    detail?: Record<string, unknown>;
}

export interface ConditionalWriteOptions {
    consumeResumeToken?: string;
    storeResumeToken?: {
        token: string;
        expiresAt: string;
    };
}

export class ContractStorage {
    initialize(): Promise<void>;
    close(): Promise<void>;
    write(contract: BaseContract): Promise<void>;
    conditionalWrite(contract: BaseContract, fromStatus: string, options?: ConditionalWriteOptions): Promise<boolean>;
    read(id: string): Promise<BaseContract | null>;
    query(filter?: ContractFilter): Promise<BaseContract[]>;
    appendLog(entry: ContractLogEntry): Promise<void>;
    queryLog(contractId: string): Promise<ContractLogEntry[]>;
    writeAutonomousLog(entry: AutonomousLogEntry): Promise<void>;
    queryAutonomousLog(filter?: LogFilter): Promise<AutonomousLogEntry[]>;
    writeConnector(state: ConnectorState): Promise<void>;
    readConnectors(): Promise<ConnectorState[]>;
    readConnector(id: string): Promise<ConnectorState | null>;
    storeResumeToken(contractId: string, token: string, expiresAt: string): Promise<void>;
    consumeResumeToken(contractId: string, token: string): Promise<boolean>;
    writeSubtask(parentContract: BaseContract, parentFromStatus: string, childContract: BaseContract): Promise<boolean>;
    touchSignal(): Promise<void>;
    acquireFileLock(path: string, agentId: string, operation: string): Promise<boolean>;
    releaseFileLock(path: string): Promise<void>;
}
