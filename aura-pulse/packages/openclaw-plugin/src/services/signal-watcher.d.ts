import type { ContractRuntime, BaseContract } from '@aura/contract-runtime';
import type { PluginLogger } from '../types/plugin-types.js';

export type OnChangedCallback = (contracts: BaseContract[]) => void;

export class SignalWatcher {
    constructor(
        signalPath: string,
        runtime: ContractRuntime,
        logger: PluginLogger,
        debounceMs: number,
        onChanged: OnChangedCallback,
    );
    start(): void;
    stop(): void;
    nudge(): void;
}
