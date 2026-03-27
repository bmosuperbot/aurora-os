/**
 * mock-runtime.js — lightweight in-memory stubs for ContractRuntime + SQLiteContractStorage.
 *
 * Used by unit and integration tests that need a controllable runtime without
 * spinning up a real SQLite database.
 */

import { randomUUID } from 'node:crypto'

/**
 * @import { BaseContract } from '@aura/contract-runtime'
 */

/**
 * @typedef {object} MockContractStore
 * @property {Map<string, BaseContract>} contracts
 * @property {Map<string, object>} connectors
 * @property {object[]} autonomousLog
 * @property {Map<string, string>} resumeTokens
 * @property {Map<string, object[]>} fileLocks
 */

/**
 * Create a minimal in-memory mock of SQLiteContractStorage.
 *
 * @returns {{ storage: any, store: MockContractStore }}
 */
export function makeMockStorage() {
    /** @type {MockContractStore} */
    const store = {
        contracts:    new Map(),
        connectors:   new Map(),
        autonomousLog: [],
        resumeTokens: new Map(),
        fileLocks:    new Map(),
    }

    const storage = {
        async initialize() {},

        async createContract(contract) {
            store.contracts.set(contract.id, { ...contract })
        },

        async getContract(id) {
            return store.contracts.get(id) ?? null
        },

        async updateContract(id, patch) {
            const existing = store.contracts.get(id)
            if (!existing) throw new Error(`Contract not found: ${id}`)
            const updated = { ...existing, ...patch, updated_at: new Date().toISOString() }
            store.contracts.set(id, updated)
            return updated
        },

        async listContracts(filter = {}) {
            let rows = [...store.contracts.values()]
            if (filter.status) {
                const statuses = Array.isArray(filter.status) ? filter.status : [filter.status]
                rows = rows.filter(c => statuses.includes(c.status))
            }
            if (filter.type)          rows = rows.filter(c => c.type          === filter.type)
            if (filter.parent_id)     rows = rows.filter(c => c.parent_id     === filter.parent_id)
            if (filter.resolver_type) rows = rows.filter(c => c.participants?.resolver?.type === filter.resolver_type)
            if (filter.updated_after) rows = rows.filter(c => c.updated_at    > filter.updated_after)
            return rows
        },

        async logAutonomousAction(entry) {
            store.autonomousLog.push(entry)
        },

        async acquireFileLock(path, agentId, operation) {
            const lock = { path, agentId, operation, acquired_at: new Date().toISOString() }
            store.fileLocks.set(path, [lock])
            return true
        },

        async releaseFileLock(path) {
            store.fileLocks.delete(path)
        },

        async getFileLock(path) {
            return store.fileLocks.get(path)?.[0] ?? null
        },

        async writeConnector(connector) {
            store.connectors.set(connector.id, { ...connector })
        },

        async readConnectors() {
            return [...store.connectors.values()]
        },

        async readConnector(id) {
            return store.connectors.get(id) ?? null
        },

        async storeResumeToken(contractId, token) {
            store.resumeTokens.set(contractId, token)
        },

        async readResumeToken(contractId) {
            return store.resumeTokens.get(contractId) ?? null
        },

        async consumeResumeToken(contractId, token) {
            const stored = store.resumeTokens.get(contractId)
            if (!stored || stored !== token) return false
            store.resumeTokens.delete(contractId)
            return true
        },

        async touchSignal() {},

        async close() {},
    }

    return { storage, store }
}

/**
 * Create a minimal in-memory mock of ContractRuntime.
 *
 * @param {object} [storageOverride]  Optionally pass a specific mock storage
 * @returns {{ runtime: any, storage: any, store: MockContractStore }}
 */
export function makeMockRuntime(storageOverride) {
    const { storage, store } = storageOverride
        ? {
            storage: storageOverride,
            store: /** @type {MockContractStore} */ (
                /** @type {any} */ (storageOverride).__store ?? {
                    contracts: new Map(),
                    connectors: new Map(),
                    autonomousLog: [],
                    resumeTokens: new Map(),
                    fileLocks: new Map(),
                }
            ),
        }
        : makeMockStorage()

    const runtime = {
        async create(contract) {
            const full = {
                ...contract,
                id:         contract.id  ?? randomUUID(),
                status:     contract.status ?? 'created',
                created_at: contract.created_at ?? new Date().toISOString(),
                updated_at: new Date().toISOString(),
            }
            await storage.createContract(full)
            return full
        },

        async get(id) {
            return storage.getContract(id)
        },

        async list(filter = {}) {
            return storage.listContracts(filter)
        },

        async transition(id, newStatus, extra = {}) {
            return storage.updateContract(id, { status: newStatus, ...extra })
        },

        async resume(id, token, resolver, action, value, artifacts) {
            const stored = store.resumeTokens.get(id)
            if (!stored || stored !== token) {
                throw new Error(`Invalid resume token for contract ${id}`)
            }
            store.resumeTokens.delete(id)

            return storage.updateContract(id, {
                status: 'executing',
                resume: {
                    action,
                    value,
                    resolver_id: resolver.id,
                    timestamp: new Date().toISOString(),
                    ...(artifacts ? { artifacts } : {}),
                },
            })
        },

        async askClarification(id, question, resolverId) {
            const existing = await storage.getContract(id)
            if (!existing) throw new Error(`Contract not found: ${id}`)
            const entry = {
                id: randomUUID(),
                role: 'question',
                content: question,
                participant: resolverId,
                timestamp: new Date().toISOString(),
            }
            return storage.updateContract(id, {
                status: 'clarifying',
                clarifications: [...(existing.clarifications ?? []), entry],
            })
        },

        async logAutonomousAction(entry) {
            return storage.logAutonomousAction(entry)
        },

        async validateResumeToken(contractId, token) {
            const stored = store.resumeTokens.get(contractId)
            return stored === token
        },

        async generateResumeToken(contractId) {
            const token = randomUUID()
            store.resumeTokens.set(contractId, token)
            return token
        },

        async readResumeToken(contractId) {
            return store.resumeTokens.get(contractId) ?? null
        },

        async getPending() {
            return [...store.contracts.values()].filter(c => c.status === 'waiting_approval')
        },

        async shutdown() {},
    }

    return { runtime, storage, store }
}
