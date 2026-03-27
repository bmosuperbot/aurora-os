/**
 * @import { BaseContract } from '../types/base-contract.js'
 * @import { CompletionNotifier } from './completion-notifier.js'
 */

/**
 * No-op implementation. Safe default for Phase 1 and all tests.
 * In Phase 2+, integration layers (e.g. OpenClaw plugin) inject a real notifier
 * such as EngramCompletionBridge; the runtime package keeps this no-op as fallback.
 * @implements {CompletionNotifier}
 */
export class NoOpCompletionNotifier {
    /** @param {BaseContract} _contract */
    async onComplete(_contract) {
        // Intentionally empty fallback.
    }
}
