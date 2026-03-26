import type { BaseContract } from '../types/base-contract.js';
import type { ContractStorage, ContractFilter, ContractLogEntry } from '../storage/interface.js';
import type { CompletionNotifier } from './completion-notifier.js';
import type { ContractTypeDefinition } from './type-registry.js';
import type { AutonomousLogEntry } from '../types/autonomous-log.js';
import type { ContractStatusValue } from '../types/contract-status.js';
import type { ParticipantRef } from '../types/participant.js';
import type { TtlManager } from './ttl-manager.js';

export interface ContractRuntimeConfig {
    ttl?: {
        checkIntervalMs?: number;
        resolverTimeoutMs?: number;
    };
}

export class ContractRuntime {
    _storage: ContractStorage;
    _notifier: CompletionNotifier;
    _ttlManager: TtlManager;
    constructor(storage: ContractStorage, notifier?: CompletionNotifier, config?: ContractRuntimeConfig);
    initialize(): Promise<void>;
    shutdown(): Promise<void>;
    registerType(definition: ContractTypeDefinition): void;
    create(contract: BaseContract): Promise<void>;
    transition(id: string, to: ContractStatusValue, actor: ParticipantRef): Promise<void>;
    resume(id: string, token: string, resolver: ParticipantRef, action?: string, value?: unknown, artifacts?: Record<string, unknown>): Promise<void>;
    askClarification(id: string, question: string, resolverId: string): Promise<void>;
    answerClarification(id: string, answer: string, agentId: string): Promise<void>;
    updateSurface(id: string, surface: BaseContract['surface'], agentId?: string): Promise<void>;
    spawnSubtask(parentId: string, childContract: BaseContract, actor: ParticipantRef): Promise<void>;
    get(id: string): Promise<BaseContract | null>;
    list(filter?: ContractFilter): Promise<BaseContract[]>;
    getPending(): Promise<BaseContract[]>;
    getLog(id: string): Promise<ContractLogEntry[]>;
    logAutonomousAction(entry: AutonomousLogEntry): Promise<void>;
    updateConnector(state: import('../types/connector-state.js').ConnectorState): Promise<void>;
    readConnectors(contractId: string): Promise<import('../types/connector-state.js').ConnectorState[]>;
    readConnector(contractId: string, componentRef: import('../types/connector-state.js').ConnectorState['component_ref']): Promise<import('../types/connector-state.js').ConnectorState | null>;
}
