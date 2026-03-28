import type { BaseContract } from '../types/base-contract.js';

export interface ExecutionNotifier {
    onExecuting(contract: BaseContract): Promise<void>;
}

export class NoOpExecutionNotifier implements ExecutionNotifier {
    onExecuting(contract: BaseContract): Promise<void>;
}