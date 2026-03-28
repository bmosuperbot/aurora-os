/**
 * @import { BaseContract } from '../types/base-contract.js'
 * @import { ExecutionNotifier } from './execution-notifier.js'
 */

/**
 * No-op execution notifier used when no executor integration is installed.
 * @implements {ExecutionNotifier}
 */
export class NoOpExecutionNotifier {
    /** @param {BaseContract} _contract */
    async onExecuting(_contract) {
        // Intentionally empty fallback.
    }
}