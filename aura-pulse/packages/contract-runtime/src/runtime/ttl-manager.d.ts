import type { ContractStorage } from '../storage/interface.js';

export interface TtlManagerConfig {
    checkIntervalMs?: number;
    resolverTimeoutMs?: number;
}

export class TtlManager {
    constructor(storage: ContractStorage, runtime: unknown, config?: TtlManagerConfig);
    start(): void;
    stop(): void;
    tick(): Promise<void>;
}
