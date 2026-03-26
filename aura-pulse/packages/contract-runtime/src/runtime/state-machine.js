/**
 * @import { BaseContract } from '../types/base-contract.js'
 * @import { ContractStatusValue } from '../types/contract-status.js'
 * @import { ParticipantRef, ParticipantRoleValue } from '../types/participant.js'
 */

import { VALID_TRANSITIONS, TERMINAL_STATUSES } from '../types/contract-status.js'
import {
    InvalidTransitionError,
    TerminalStateError,
    UnauthorizedRoleError,
} from '../types/errors.js'

/**
 * Operations each role is permitted to perform.
 * @type {Record<ParticipantRoleValue, string[]>}
 */
const ROLE_PERMISSIONS = {
    writer:   ['create', 'update_intent', 'answer_clarification', 'submit'],
    executor: ['update_result', 'spawn_subtask'],
    resolver: ['engage', 'ask_clarification', 'commit', 'abandon'],
    observer: [],
}

/**
 * Assert that a transition is valid. Throws if not.
 * Pure function — no side effects.
 *
 * @param {string} contractId
 * @param {ContractStatusValue} from
 * @param {ContractStatusValue} to
 * @returns {void}
 * @throws {TerminalStateError}
 * @throws {InvalidTransitionError}
 */
export function assertValidTransition(contractId, from, to) {
    if (TERMINAL_STATUSES.includes(from)) {
        throw new TerminalStateError(contractId, from)
    }
    const allowed = VALID_TRANSITIONS[from] ?? []
    if (!allowed.includes(to)) {
        throw new InvalidTransitionError(contractId, from, to)
    }
}

/**
 * Assert that a participant role is permitted for an operation.
 * Throws if not.
 *
 * @param {string} participantId
 * @param {ParticipantRoleValue} role
 * @param {string} operation
 * @returns {void}
 * @throws {UnauthorizedRoleError}
 */
export function assertRolePermitted(participantId, role, operation) {
    const permitted = ROLE_PERMISSIONS[role] ?? []
    if (!permitted.includes(operation)) {
        throw new UnauthorizedRoleError(participantId, role, operation)
    }
}

/**
 * Extract the resolver_type column value from a contract.
 *
 * @param {{ participants: { resolver: { type: string } } }} contract
 * @returns {'human' | 'agent'}
 */
export function resolverType(contract) {
    return contract.participants.resolver.type === 'human' ? 'human' : 'agent'
}

/**
 * Transitions that require the actor to hold a specific role.
 * Transitions not listed here are open to any actor.
 * @type {Record<string, { role: ParticipantRoleValue, operation: string }>}
 */
const GATED_TRANSITIONS = {
    'waiting_approval→resolver_active': { role: 'resolver', operation: 'engage' },
    'resolver_active→executing':        { role: 'resolver', operation: 'commit' },
    'failed→active':                    { role: 'resolver', operation: 'engage' },
}

/**
 * Derive the role a participant plays in a contract.
 * Returns 'system' for system actors — they bypass all role enforcement.
 *
 * @param {BaseContract} contract
 * @param {ParticipantRef} actor
 * @returns {'writer' | 'executor' | 'resolver' | 'observer' | 'system'}
 */
export function resolveActorRole(contract, actor) {
    if (actor.type === 'system') return 'system'
    if (contract.participants.writer?.id === actor.id) return 'writer'
    if (contract.participants.resolver?.id === actor.id) return 'resolver'
    if (contract.participants.executor != null && contract.participants.executor.id === actor.id) return 'executor'
    return 'observer'
}

/**
 * Assert that the actor is authorized to perform a state transition.
 * System actors bypass all role checks.
 * Only gated transitions are enforced — ungated transitions accept any actor.
 *
 * @param {BaseContract} contract
 * @param {ParticipantRef} actor
 * @param {string} from
 * @param {string} to
 * @returns {void}
 * @throws {UnauthorizedRoleError}
 */
export function assertTransitionRole(contract, actor, from, to) {
    const role = resolveActorRole(contract, actor)
    if (role === 'system') return
    const gate = GATED_TRANSITIONS[`${from}→${to}`]
    if (gate == null) return
    assertRolePermitted(actor.id, role, gate.operation)
}
