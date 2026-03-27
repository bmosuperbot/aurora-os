/**
 * @import { SQLiteContractStorage } from '@aura/contract-runtime'
 * @import { PluginLogger } from '../types/plugin-types.js'
 */

/**
 * Thin wrapper around the storage file-lock methods.
 * Provides a consistent log-on-conflict pattern.
 */
export class LockManager {
    /**
     * @param {SQLiteContractStorage} storage
     * @param {PluginLogger} logger
     */
    constructor(storage, logger) {
        /** @type {SQLiteContractStorage} */ this._storage = storage
        /** @type {PluginLogger} */ this._logger = logger
    }

    /**
     * Acquire a file lock. Returns false if already locked (lock contention).
     *
     * @param {string} path
     * @param {string} agentId
     * @param {string} operation
     * @returns {Promise<boolean>}
     */
    async acquire(path, agentId, operation) {
        const acquired = await this._storage.acquireFileLock(path, agentId, operation)
        if (!acquired) {
            this._logger.warn(`file-lock: contention on ${path} for ${operation} by ${agentId}`)
        }
        return acquired
    }

    /**
     * Release a file lock.
     *
     * @param {string} path
     * @returns {Promise<void>}
     */
    async release(path) {
        await this._storage.releaseFileLock(path)
    }

    /**
     * Run a callback while holding the file lock.
     * Always releases the lock, even if the callback throws.
     * Throws if the lock cannot be acquired.
     *
     * @template T
     * @param {string} path
     * @param {string} agentId
     * @param {string} operation
     * @param {() => Promise<T>} fn
     * @returns {Promise<T>}
     */
    async withLock(path, agentId, operation, fn) {
        const acquired = await this.acquire(path, agentId, operation)
        if (!acquired) {
            throw new Error(`Could not acquire file lock for ${path} (operation: ${operation})`)
        }
        try {
            return await fn()
        } finally {
            await this.release(path)
        }
    }
}
