/**
 * @import { BaseContract } from '../types/base-contract.js'
 * @import { CompletionNotifier } from './completion-notifier.js'
 */

/**
 * No-op implementation. Safe default for Phase 1 and all tests.
 * @implements {CompletionNotifier}
 */
export class NoOpCompletionNotifier {
    /** @param {BaseContract} _contract */
    async onComplete(_contract) {
        // Intentionally empty. Phase 2 replaces this with engram integration.
    }
}
