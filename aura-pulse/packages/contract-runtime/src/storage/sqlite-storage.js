import { DatabaseSync } from 'node:sqlite'
import { readFileSync, utimesSync, closeSync, openSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ContractStorage } from './interface.js'

/**
 * @import { BaseContract } from '../types/base-contract.js'
 * @import { AutonomousLogEntry } from '../types/autonomous-log.js'
 * @import { ConnectorState } from '../types/connector-state.js'
 * @import { ContractFilter, LogFilter, ContractLogEntry, ConditionalWriteOptions } from './interface.js'
 */

const __dirname = dirname(fileURLToPath(import.meta.url))
const MIGRATION_PATH = join(__dirname, 'migrations', '001-initial-schema.sql')

/**
 * SQLite implementation of ContractStorage.
 * Uses node:sqlite (synchronous) internally.
 * All public methods return Promises to satisfy the ContractStorage interface.
 *
 * @implements {ContractStorage}
 */
export class SQLiteContractStorage extends ContractStorage {
    /**
     * @param {string} dbPath     - Path to contracts.db. Use ':memory:' in tests.
     * @param {string} signalPath - Path to the .signal file.
     */
    constructor(dbPath, signalPath) {
        super()
        /** @type {string} */ this.dbPath = dbPath
        /** @type {string} */ this.signalPath = signalPath
        /** @type {import('node:sqlite').DatabaseSync | null} */ this.db = null
    }

    async initialize() {
        this.db = new DatabaseSync(this.dbPath)
        this.db.exec('PRAGMA journal_mode = WAL')
        this.db.exec('PRAGMA foreign_keys = ON')
        const sql = readFileSync(MIGRATION_PATH, 'utf-8')
        this.db.exec(sql)
        this._touchSignalSync()
    }

    async close() {
        this.db?.close()
        this.db = null
    }

    // ─── Contracts ────────────────────────────────────────────────────

    /** @param {BaseContract} contract */
    async write(contract) {
        const db = this._db()
        this._upsertContract(db, contract)
        this._touchSignalSync()
    }

    /**
     * @param {BaseContract} contract
     * @param {string} fromStatus
     * @param {ConditionalWriteOptions} [options]
     */
    async conditionalWrite(contract, fromStatus, options = {}) {
        const committed = this._withImmediateTransaction((db) => {
            if (options.consumeResumeToken) {
                const tokenResult = db.prepare(`
                    DELETE FROM resume_tokens WHERE contract_id = ? AND token = ? AND expires_at > ?
                `).run(contract.id, options.consumeResumeToken, new Date().toISOString())
                if (tokenResult.changes === 0) {
                    return false
                }
            }

            const result = db.prepare(`
                UPDATE contracts SET
                    status        = @status,
                    updated_at    = @updated_at,
                    expires_at    = @expires_at,
                    surface_after = @surface_after,
                    payload       = @payload
                WHERE id = @id AND status = @fromStatus
            `).run({
                id:            contract.id,
                status:        contract.status,
                updated_at:    contract.updated_at,
                expires_at:    contract.expires_at ?? null,
                surface_after: contract.surface_after ?? null,
                payload:       JSON.stringify(contract),
                fromStatus,
            })
            if (result.changes === 0) {
                return false
            }

            if (options.storeResumeToken) {
                db.prepare('DELETE FROM resume_tokens WHERE contract_id = ?').run(contract.id)
                db.prepare(`
                    INSERT INTO resume_tokens (contract_id, token, expires_at) VALUES (?, ?, ?)
                `).run(contract.id, options.storeResumeToken.token, options.storeResumeToken.expiresAt)
            }

            return true
        })

        if (committed) {
            this._touchSignalSync()
        }

        return committed
    }

    /** @param {string} id */
    async read(id) {
        const row = this._db().prepare('SELECT payload FROM contracts WHERE id = ?').get(id)
        return row ? JSON.parse(/** @type {any} */ (row).payload) : null
    }

    /** @param {ContractFilter} [filter] */
    async query(filter = {}) {
        const conditions = []
        const params = /** @type {Record<string, unknown>} */ ({})

        if (filter.status) {
            if (Array.isArray(filter.status)) {
                const placeholders = filter.status.map((_, i) => `@status${i}`).join(', ')
                conditions.push(`status IN (${placeholders})`)
                filter.status.forEach((s, i) => { params[`status${i}`] = s })
            } else {
                conditions.push('status = @status')
                params.status = filter.status
            }
        }
        if (filter.resolver_type) {
            conditions.push('resolver_type = @resolver_type')
            params.resolver_type = filter.resolver_type
        }
        if (filter.parent_id) {
            conditions.push('parent_id = @parent_id')
            params.parent_id = filter.parent_id
        }
        if (filter.type) {
            conditions.push('type = @type')
            params.type = filter.type
        }
        if (filter.updated_after) {
            conditions.push('updated_at > @updated_after')
            params.updated_after = filter.updated_after
        }
        if (filter.surface_after_before) {
            conditions.push('(surface_after IS NULL OR surface_after <= @surface_after_before)')
            params.surface_after_before = filter.surface_after_before
        }
        if (filter.expires_before) {
            conditions.push('expires_at IS NOT NULL AND expires_at < @expires_before')
            params.expires_before = filter.expires_before
        }
        if (filter.updated_before) {
            conditions.push('updated_at < @updated_before')
            params.updated_before = filter.updated_before
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
        const rows = this._db().prepare(`SELECT payload FROM contracts ${where}`).all(/** @type {any} */ (params))
        return rows.map((row) => JSON.parse(/** @type {any} */ (row).payload))
    }

    // ─── Audit log ────────────────────────────────────────────────────

    /** @param {ContractLogEntry} entry */
    async appendLog(entry) {
        this._db().prepare(`
            INSERT INTO contract_log (contract_id, timestamp, participant, event, detail)
            VALUES (@contract_id, @timestamp, @participant, @event, @detail)
        `).run({
            contract_id: entry.contract_id,
            timestamp:   entry.timestamp,
            participant: entry.participant,
            event:       entry.event,
            detail:      entry.detail ? JSON.stringify(entry.detail) : null,
        })
        // appendLog does NOT touch .signal — only contract writes trigger surface updates
    }

    /** @param {string} contractId */
    async queryLog(contractId) {
        const rows = this._db().prepare(
            'SELECT * FROM contract_log WHERE contract_id = ? ORDER BY id ASC'
        ).all(contractId)
        return rows.map((row) => ({
            .../** @type {any} */ (row),
            detail: /** @type {any} */ (row).detail
                ? JSON.parse(/** @type {any} */ (row).detail)
                : undefined,
        }))
    }

    // ─── Autonomous log ───────────────────────────────────────────────

    /** @param {AutonomousLogEntry} entry */
    async writeAutonomousLog(entry) {
        this._db().prepare(`
            INSERT INTO autonomous_log (id, timestamp, agent_id, package, action, summary, detail, contract_id, connector_used)
            VALUES (@id, @timestamp, @agent_id, @package, @action, @summary, @detail, @contract_id, @connector_used)
        `).run({
            id:             entry.id,
            timestamp:      entry.timestamp,
            agent_id:       entry.agent_id,
            package:        entry.package,
            action:         entry.action,
            summary:        entry.summary,
            detail:         entry.detail ? JSON.stringify(entry.detail) : null,
            contract_id:    entry.contract_id ?? null,
            connector_used: entry.connector_used,
        })
    }

    /** @param {LogFilter} [filter] */
    async queryAutonomousLog(filter = {}) {
        const conditions = []
        const params = /** @type {Record<string, unknown>} */ ({})

        if (filter.agent_id) { conditions.push('agent_id = @agent_id'); params.agent_id = filter.agent_id }
        if (filter.package)  { conditions.push('package = @package');   params.package = filter.package }
        if (filter.after)    { conditions.push('timestamp > @after');   params.after = filter.after }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
        const rows = this._db().prepare(`SELECT * FROM autonomous_log ${where} ORDER BY timestamp DESC`).all(/** @type {any} */ (params))
        return rows.map((row) => ({
            .../** @type {any} */ (row),
            detail: /** @type {any} */ (row).detail ? JSON.parse(/** @type {any} */ (row).detail) : undefined,
        }))
    }

    // ─── Connectors ───────────────────────────────────────────────────

    /** @param {ConnectorState} state */
    async writeConnector(state) {
        this._db().prepare(`
            INSERT INTO connectors (id, source, status, offered_at, connected_at, declined_at,
                declined_reason, never_resurface, resurface_trigger, capability_without, capability_with,
                oauth_token_enc, refresh_token_enc, expires_at, updated_at)
            VALUES (@id, @source, @status, @offered_at, @connected_at, @declined_at, @declined_reason,
                @never_resurface, @resurface_trigger, @capability_without, @capability_with,
                @oauth_token_enc, @refresh_token_enc, @expires_at, @updated_at)
            ON CONFLICT(id) DO UPDATE SET
                status             = excluded.status,
                offered_at         = excluded.offered_at,
                connected_at       = excluded.connected_at,
                declined_at        = excluded.declined_at,
                declined_reason    = excluded.declined_reason,
                never_resurface    = excluded.never_resurface,
                resurface_trigger  = excluded.resurface_trigger,
                capability_without = excluded.capability_without,
                capability_with    = excluded.capability_with,
                oauth_token_enc    = excluded.oauth_token_enc,
                refresh_token_enc  = excluded.refresh_token_enc,
                expires_at         = excluded.expires_at,
                updated_at         = excluded.updated_at
        `).run({
            id:                 state.id,
            source:             state.source,
            status:             state.status,
            offered_at:         state.offered_at ?? null,
            connected_at:       state.connected_at ?? null,
            declined_at:        state.declined_at ?? null,
            declined_reason:    state.declined_reason ?? null,
            never_resurface:    state.never_resurface ? 1 : 0,
            resurface_trigger:  state.resurface_trigger ?? null,
            capability_without: state.capability_without,
            capability_with:    state.capability_with,
            oauth_token_enc:    state.oauth_token_enc ?? null,
            refresh_token_enc:  state.refresh_token_enc ?? null,
            expires_at:         state.expires_at ?? null,
            updated_at:         state.updated_at,
        })
    }

    async readConnectors() {
        return this._db().prepare('SELECT * FROM connectors').all().map(this._rowToConnector)
    }

    /** @param {string} id */
    async readConnector(id) {
        const row = this._db().prepare('SELECT * FROM connectors WHERE id = ?').get(id)
        return row ? this._rowToConnector(row) : null
    }

    // ─── Resume tokens ────────────────────────────────────────────────

    /**
     * @param {string} contractId
     * @param {string} token
     * @param {string} expiresAt
     */
    async storeResumeToken(contractId, token, expiresAt) {
        this._db().prepare(`
            INSERT INTO resume_tokens (contract_id, token, expires_at) VALUES (?, ?, ?)
        `).run(contractId, token, expiresAt)
    }

    /**
     * @param {string} contractId
     * @returns {Promise<string | null>}
     */
    async readResumeToken(contractId) {
        const now = new Date().toISOString()
        const row = /** @type {{ token?: string } | undefined} */ (this._db().prepare(`
            SELECT token FROM resume_tokens WHERE contract_id = ? AND expires_at > ? ORDER BY expires_at DESC LIMIT 1
        `).get(contractId, now))
        return row?.token ?? null
    }

    /**
     * @param {string} contractId
     * @param {string} token
     */
    async consumeResumeToken(contractId, token) {
        const now = new Date().toISOString()
        const result = this._db().prepare(`
            DELETE FROM resume_tokens WHERE contract_id = ? AND token = ? AND expires_at > ?
        `).run(contractId, token, now)
        return result.changes > 0
    }

    /**
     * @param {BaseContract} parentContract
     * @param {string} parentFromStatus
     * @param {BaseContract} childContract
     */
    async writeSubtask(parentContract, parentFromStatus, childContract) {
        const committed = this._withImmediateTransaction((db) => {
            const parentUpdate = db.prepare(`
                UPDATE contracts SET
                    status        = @status,
                    updated_at    = @updated_at,
                    expires_at    = @expires_at,
                    surface_after = @surface_after,
                    payload       = @payload
                WHERE id = @id AND status = @fromStatus
            `).run({
                id:            parentContract.id,
                status:        parentContract.status,
                updated_at:    parentContract.updated_at,
                expires_at:    parentContract.expires_at ?? null,
                surface_after: parentContract.surface_after ?? null,
                payload:       JSON.stringify(parentContract),
                fromStatus:    parentFromStatus,
            })
            if (parentUpdate.changes === 0) {
                return false
            }

            this._upsertContract(db, childContract)
            return true
        })

        if (committed) {
            this._touchSignalSync()
        }

        return committed
    }

    // ─── Signal ───────────────────────────────────────────────────────

    async touchSignal() {
        this._touchSignalSync()
    }

    // ─── File locks ───────────────────────────────────────────────────

    /**
     * @param {string} path
     * @param {string} agentId
     * @param {string} operation
     */
    async acquireFileLock(path, agentId, operation) {
        const now = new Date().toISOString()
        const expiresAt = new Date(Date.now() + 30_000).toISOString()
        try {
            this._db().prepare('DELETE FROM file_locks WHERE lock_expires_at < ?').run(now)
            this._db().prepare(`
                INSERT INTO file_locks (path, locked_by_agent, locked_at, lock_expires_at, operation)
                VALUES (?, ?, ?, ?, ?)
            `).run(path, agentId, now, expiresAt, operation)
            return true
        } catch {
            return false
        }
    }

    /** @param {string} path */
    async releaseFileLock(path) {
        this._db().prepare('DELETE FROM file_locks WHERE path = ?').run(path)
    }

    // ─── Internals ────────────────────────────────────────────────────

    _db() {
        if (!this.db) throw new Error('SQLiteContractStorage not initialized. Call initialize() first.')
        return this.db
    }

    /**
     * @param {import('node:sqlite').DatabaseSync} db
     * @param {BaseContract} contract
     * @returns {void}
     */
    _upsertContract(db, contract) {
        const resolverType = contract.participants.resolver.type === 'human' ? 'human' : 'agent'
        db.prepare(`
            INSERT INTO contracts (id, version, type, status, resolver_type, created_at, updated_at,
                expires_at, surface_after, parent_id, recovery_of, payload)
            VALUES (@id, @version, @type, @status, @resolver_type, @created_at, @updated_at,
                @expires_at, @surface_after, @parent_id, @recovery_of, @payload)
            ON CONFLICT(id) DO UPDATE SET
                status        = excluded.status,
                updated_at    = excluded.updated_at,
                expires_at    = excluded.expires_at,
                surface_after = excluded.surface_after,
                payload       = excluded.payload
        `).run({
            id:            contract.id,
            version:       contract.version,
            type:          contract.type,
            status:        contract.status,
            resolver_type: resolverType,
            created_at:    contract.created_at,
            updated_at:    contract.updated_at,
            expires_at:    contract.expires_at ?? null,
            surface_after: contract.surface_after ?? null,
            parent_id:     contract.parent_id ?? null,
            recovery_of:   contract.recovery_of ?? null,
            payload:       JSON.stringify(contract),
        })
    }

    /**
     * @template T
     * @param {(db: import('node:sqlite').DatabaseSync) => T} callback
     * @returns {T}
     */
    _withImmediateTransaction(callback) {
        const db = this._db()
        db.exec('BEGIN IMMEDIATE')

        try {
            const result = callback(db)
            if (result === false) {
                db.exec('ROLLBACK')
                return result
            }

            db.exec('COMMIT')
            return result
        } catch (error) {
            try {
                db.exec('ROLLBACK')
            } catch {
                // Ignore rollback errors after the original failure.
            }
            throw error
        }
    }

    _touchSignalSync() {
        const now = new Date()
        try {
            utimesSync(this.signalPath, now, now)
        } catch {
            closeSync(openSync(this.signalPath, 'a'))
        }
    }

    /** @param {unknown} row */
    _rowToConnector(row) {
        const r = /** @type {any} */ (row)
        return /** @type {import('../types/connector-state.js').ConnectorState} */ ({
            ...r,
            never_resurface: r.never_resurface === 1,
        })
    }
}
