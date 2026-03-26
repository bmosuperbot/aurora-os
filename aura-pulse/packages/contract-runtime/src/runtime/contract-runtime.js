/**
 * @import { BaseContract } from '../types/base-contract.js'
 * @import { ContractStatusValue } from '../types/contract-status.js'
 * @import { ParticipantRef } from '../types/participant.js'
 * @import { ContractStorage, ContractFilter, LogFilter } from '../storage/interface.js'
 * @import { CompletionNotifier } from './completion-notifier.js'
 * @import { ContractTypeDefinition } from './type-registry.js'
 * @import { AutonomousLogEntry } from '../types/autonomous-log.js'
 * @import { ContractRuntimeConfig } from './contract-runtime.js'
 */

import { randomUUID } from 'node:crypto'
import { NoOpCompletionNotifier } from './completion-notifier.js'
import { TypeRegistry } from './type-registry.js'
import { TtlManager } from './ttl-manager.js'
import { assertValidTransition } from './state-machine.js'
import { generateResumeToken } from './resume-token.js'
import { ContractNotFoundError, InvalidResumeTokenError, InvalidTransitionError } from '../types/errors.js'

export class ContractRuntime {
    /**
     * @param {ContractStorage} storage
     * @param {CompletionNotifier} [notifier]
     * @param {ContractRuntimeConfig} [config]
     */
    constructor(storage, notifier = new NoOpCompletionNotifier(), config = {}) {
        this._storage = storage
        this._notifier = notifier
        this._typeRegistry = new TypeRegistry()
        this._ttlManager = new TtlManager(storage, this, config.ttl)
    }

    // ─── Lifecycle ────────────────────────────────────────────────────

    async initialize() {
        await this._storage.initialize()
        this._ttlManager.start()
    }

    async shutdown() {
        this._ttlManager.stop()
        await this._storage.close()
    }

    // ─── Type Registry ────────────────────────────────────────────────

    /** @param {ContractTypeDefinition} definition */
    registerType(definition) {
        this._typeRegistry.register(definition)
    }

    // ─── Contract CRUD ────────────────────────────────────────────────

    /**
     * Create a new contract. Validates against the registered domain type.
     * Initial status is always 'created'.
     *
     * @param {BaseContract} contract
     * @returns {Promise<void>}
     */
    async create(contract) {
        this._typeRegistry.validate(contract)
        const now = new Date().toISOString()
        const normalized = {
            ...contract,
            status: /** @type {ContractStatusValue} */ ('created'),
            created_at: now,
            updated_at: now,
            version: '1.0',
        }
        await this._storage.write(normalized)
        await this._storage.appendLog({
            contract_id: contract.id,
            timestamp: now,
            participant: contract.participants.writer.id,
            event: 'created',
        })
    }

    /**
     * Transition a contract to a new status.
     * Uses compare-and-swap to enforce exactly-once semantics under concurrency.
     * Fires completion notifier on 'complete'.
     * Generates a resume token when entering 'waiting_approval'.
     *
     * @param {string} id
     * @param {ContractStatusValue} to
     * @param {ParticipantRef} actor
     * @returns {Promise<void>}
     */
    async transition(id, to, actor) {
        const contract = await this._getOrThrow(id)
        assertValidTransition(id, contract.status, to)

        const now = new Date().toISOString()
        const updated = { ...contract, status: to, updated_at: now }

        const committed = await this._storage.conditionalWrite(updated, contract.status)
        if (!committed) {
            throw new InvalidTransitionError(id, contract.status, to)
        }
        await this._storage.appendLog({
            contract_id: id,
            timestamp: now,
            participant: actor.id,
            event: `transition:${contract.status}→${to}`,
        })

        if (to === 'waiting_approval') {
            const { token, expiresAt } = generateResumeToken()
            await this._storage.storeResumeToken(id, token, expiresAt)
        }

        if (to === 'complete') {
            await this._notifier.onComplete(updated)
        }
    }

    /**
     * Resume a contract from waiting_approval using a single-use token.
     * Validates the state machine, then consumes the token atomically.
     * Transitions to 'executing'.
     *
     * @param {string} id
     * @param {string} token
     * @param {ParticipantRef} resolver
     * @param {string} action
     * @param {unknown} [value]
     * @param {Record<string, unknown>} [artifacts]
     * @returns {Promise<void>}
     */
    async resume(id, token, resolver, action, value, artifacts) {
        const contract = await this._getOrThrow(id)
        assertValidTransition(id, contract.status, 'executing')
        const consumed = await this._storage.consumeResumeToken(id, token)
        if (!consumed) throw new InvalidResumeTokenError(id)

        const now = new Date().toISOString()
        const updated = {
            ...contract,
            status: /** @type {ContractStatusValue} */ ('executing'),
            updated_at: now,
            resume: {
                action,
                value,
                timestamp: now,
                resolver_id: resolver.id,
                ...(artifacts !== undefined ? { artifacts } : {}),
            },
        }

        await this._storage.write(updated)
        await this._storage.appendLog({
            contract_id: id,
            timestamp: now,
            participant: resolver.id,
            event: 'resumed',
            detail: { action, value },
        })
    }

    // ─── Clarification ────────────────────────────────────────────────

    /**
     * Resolver asks a clarifying question.
     * Transitions resolver_active → clarifying.
     *
     * @param {string} id
     * @param {string} question
     * @param {string} resolverId
     * @returns {Promise<void>}
     */
    async askClarification(id, question, resolverId) {
        const contract = await this._getOrThrow(id)
        const now = new Date().toISOString()

        /** @type {import('../types/clarification.js').ClarificationEntry} */
        const entry = {
            id: randomUUID(),
            timestamp: now,
            participant: resolverId,
            role: 'question',
            content: question,
        }

        const updated = {
            ...contract,
            status: /** @type {ContractStatusValue} */ ('clarifying'),
            updated_at: now,
            clarifications: [...(contract.clarifications ?? []), entry],
        }

        await this._storage.write(updated)
        await this._storage.appendLog({
            contract_id: id,
            timestamp: now,
            participant: resolverId,
            event: 'clarification:question',
        })
    }

    /**
     * Agent answers the clarifying question.
     * Transitions clarifying → resolver_active.
     *
     * @param {string} id
     * @param {string} answer
     * @param {string} agentId
     * @returns {Promise<void>}
     */
    async answerClarification(id, answer, agentId) {
        const contract = await this._getOrThrow(id)
        const now = new Date().toISOString()

        /** @type {import('../types/clarification.js').ClarificationEntry} */
        const entry = {
            id: randomUUID(),
            timestamp: now,
            participant: agentId,
            role: 'answer',
            content: answer,
        }

        const updated = {
            ...contract,
            status: /** @type {ContractStatusValue} */ ('resolver_active'),
            updated_at: now,
            clarifications: [...(contract.clarifications ?? []), entry],
        }

        await this._storage.write(updated)
        await this._storage.appendLog({
            contract_id: id,
            timestamp: now,
            participant: agentId,
            event: 'clarification:answer',
        })
    }

    /**
     * Agent updates the decision surface.
     * Increments surface.version on every call.
     *
     * @param {string} id
     * @param {BaseContract['surface']} surface
     * @param {string} agentId
     * @returns {Promise<void>}
     */
    async updateSurface(id, surface, agentId) {
        const contract = await this._getOrThrow(id)
        const now = new Date().toISOString()
        const nextVersion = (contract.surface?.version ?? 0) + 1
        const updatedSurface = surface ? { ...surface, version: nextVersion } : undefined

        const updated = {
            ...contract,
            updated_at: now,
            ...(updatedSurface !== undefined ? { surface: updatedSurface } : {}),
        }
        await this._storage.write(updated)
        await this._storage.appendLog({
            contract_id: id,
            timestamp: now,
            participant: agentId,
            event: 'surface:updated',
            detail: { surface_version: nextVersion },
        })
    }

    // ─── Hierarchy ────────────────────────────────────────────────────

    /**
     * Spawn a child contract from a parent currently in `executing`.
     * Links child to parent, transitions parent executing → active.
     *
     * @param {string} parentId
     * @param {BaseContract} childContract
     * @param {ParticipantRef} actor
     * @returns {Promise<void>}
     */
    async spawnSubtask(parentId, childContract, actor) {
        const parent = await this._getOrThrow(parentId)
        assertValidTransition(parentId, parent.status, 'active')

        const now = new Date().toISOString()

        const child = {
            ...childContract,
            parent_id: parentId,
            status: /** @type {ContractStatusValue} */ ('created'),
            created_at: now,
            updated_at: now,
            version: '1.0',
        }
        this._typeRegistry.validate(child)
        await this._storage.write(child)
        await this._storage.appendLog({
            contract_id: child.id,
            timestamp: now,
            participant: actor.id,
            event: 'created',
            detail: { parent_id: parentId },
        })

        const updatedParent = {
            ...parent,
            status: /** @type {ContractStatusValue} */ ('active'),
            updated_at: now,
            child_ids: [...(parent.child_ids ?? []), child.id],
        }
        await this._storage.write(updatedParent)
        await this._storage.appendLog({
            contract_id: parentId,
            timestamp: now,
            participant: actor.id,
            event: 'transition:executing→active',
            detail: { spawned_child: child.id },
        })
    }

    // ─── Queries ──────────────────────────────────────────────────────

    /**
     * @param {string} id
     * @returns {Promise<BaseContract | null>}
     */
    async get(id) {
        return this._storage.read(id)
    }

    /**
     * @param {ContractFilter} [filter]
     * @returns {Promise<BaseContract[]>}
     */
    async list(filter) {
        return this._storage.query(filter)
    }

    /**
     * Contracts in waiting_approval ready to be surfaced (past surface_after).
     * @returns {Promise<BaseContract[]>}
     */
    async getPending() {
        return this._storage.query({
            status: 'waiting_approval',
            surface_after_before: new Date().toISOString(),
        })
    }

    // ─── Autonomous log ───────────────────────────────────────────────

    /** @param {AutonomousLogEntry} entry */
    async logAutonomousAction(entry) {
        await this._storage.writeAutonomousLog(entry)
    }

    // ─── Internal ─────────────────────────────────────────────────────

    /**
     * @param {string} id
     * @returns {Promise<BaseContract>}
     */
    async _getOrThrow(id) {
        const contract = await this._storage.read(id)
        if (!contract) throw new ContractNotFoundError(id)
        return contract
    }
}
