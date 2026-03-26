import type { BaseContract } from '../types/base-contract.js';

export interface CompletionNotifier {
    onComplete(contract: BaseContract): Promise<void>;
}

export class NoOpCompletionNotifier implements CompletionNotifier {
    onComplete(contract: BaseContract): Promise<void>;
}
