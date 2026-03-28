import type { AuraPluginConfig } from '../config/schema.js';
import type { AuraPaths } from '../config/paths.js';
import type { ContractRuntime, CompletionNotifier, ExecutionNotifier, SQLiteContractStorage } from '@aura/contract-runtime';

export class ContractRuntimeService {
    constructor(config: AuraPluginConfig, notifier: CompletionNotifier);
    start(): Promise<void>;
    stop(): Promise<void>;
    getRuntime(): ContractRuntime;
    getStorage(): SQLiteContractStorage;
    getPaths(): AuraPaths;
    setExecutionNotifier(notifier: ExecutionNotifier | null): void;
}
