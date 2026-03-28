/* eslint-disable no-unused-vars */
/**
 * @import { BaseContract } from '../types/base-contract.js'
 * @import { AutonomousLogEntry } from '../types/autonomous-log.js'
 * @import { ConnectorState } from '../types/connector-state.js'
 * @import { ContractFilter, LogFilter, ContractLogEntry, ConditionalWriteOptions } from './interface.js'
 */

/**
 * Abstract storage interface. Implementations must provide all methods.
 * All methods return Promises even when the underlying implementation is
 * synchronous (node:sqlite), keeping the interface Postgres-compatible.
 */
export class ContractStorage {
    /** @returns {Promise<void>} */
    async initialize() { throw new Error('not implemented') }

    /** @returns {Promise<void>} */
    async close() { throw new Error('not implemented') }

    // ─── Contracts ────────────────────────────────────────────────────

    /**
     * Upsert a contract. Called on create and every subsequent state change.
     * Must call touchSignal() after writing.
     * @param {BaseContract} contract
     * @returns {Promise<void>}
     */
    async write(contract) { throw new Error('not implemented') }

    /**
     * Write a contract only if its current status in the DB matches fromStatus.
     * Returns true if updated, false if the status had already changed (lost CAS race).
     * Used by transition() to enforce exactly-once state changes under concurrency.
     * @param {BaseContract} contract
     * @param {string} fromStatus
    * @param {ConditionalWriteOptions} [options]
     * @returns {Promise<boolean>}
     */
    async conditionalWrite(contract, fromStatus, options) { throw new Error('not implemented') }

    /**
     * @param {string} id
     * @returns {Promise<BaseContract | null>}
     */
    async read(id) { throw new Error('not implemented') }

    /**
     * @param {ContractFilter} [filter]
     * @returns {Promise<BaseContract[]>}
     */
    async query(filter) { throw new Error('not implemented') }

    // ─── Audit log ────────────────────────────────────────────────────

    /**
     * @param {ContractLogEntry} entry
     * @returns {Promise<void>}
     */
    async appendLog(entry) { throw new Error('not implemented') }

    /**
     * @param {string} contractId
     * @returns {Promise<ContractLogEntry[]>}
     */
    async queryLog(contractId) { throw new Error('not implemented') }

    // ─── Autonomous log ───────────────────────────────────────────────

    /**
     * @param {AutonomousLogEntry} entry
     * @returns {Promise<void>}
     */
    async writeAutonomousLog(entry) { throw new Error('not implemented') }

    /**
     * @param {LogFilter} [filter]
     * @returns {Promise<AutonomousLogEntry[]>}
     */
    async queryAutonomousLog(filter) { throw new Error('not implemented') }

    /**
     * @param {string} completeBefore
     * @param {string} failedBefore
     * @returns {Promise<number>}
     */
    async purgeExpiredTerminalContracts(completeBefore, failedBefore) { throw new Error('not implemented') }

    // ─── Connectors ───────────────────────────────────────────────────

    /**
     * @param {ConnectorState} state
     * @returns {Promise<void>}
     */
    async writeConnector(state) { throw new Error('not implemented') }

    /** @returns {Promise<ConnectorState[]>} */
    async readConnectors() { throw new Error('not implemented') }

    /**
     * @param {string} id
     * @returns {Promise<ConnectorState | null>}
     */
    async readConnector(id) { throw new Error('not implemented') }

    // ─── Resume tokens ────────────────────────────────────────────────

    /**
     * @param {string} contractId
     * @param {string} token
     * @param {string} expiresAt  - ISO-8601
     * @returns {Promise<void>}
     */
    async storeResumeToken(contractId, token, expiresAt) { throw new Error('not implemented') }

    /**
     * Read the current unexpired resume token for a contract without consuming it.
     * Returns null if none exists.
     * @param {string} contractId
     * @returns {Promise<string | null>}
     */
    async readResumeToken(contractId) { throw new Error('not implemented') }

    /**
     * Consume a resume token. Atomically deletes it if valid and unexpired.
     * Returns true if the token existed and was consumed. False otherwise.
     * @param {string} contractId
     * @param {string} token
     * @returns {Promise<boolean>}
     */
    async consumeResumeToken(contractId, token) { throw new Error('not implemented') }

    /**
     * Atomically update the parent contract and write the spawned child contract.
     * Returns false if the parent status changed before the write committed.
     * @param {BaseContract} parentContract
     * @param {string} parentFromStatus
     * @param {BaseContract} childContract
     * @returns {Promise<boolean>}
     */
    async writeSubtask(parentContract, parentFromStatus, childContract) { throw new Error('not implemented') }

    // ─── Signal ───────────────────────────────────────────────────────

    /**
     * Touch the .signal file. Called after every successful write.
     * SQLite commit must complete before this fires.
     * @returns {Promise<void>}
     */
    async touchSignal() { throw new Error('not implemented') }

    // ─── File locks (table created in Phase 1, used in Phase 4) ──────

    /**
     * @param {string} path
     * @param {string} agentId
     * @param {string} operation
     * @returns {Promise<boolean>}
     */
    async acquireFileLock(path, agentId, operation) { throw new Error('not implemented') }

    /**
     * @param {string} path
     * @returns {Promise<void>}
     */
    async releaseFileLock(path) { throw new Error('not implemented') }
}
