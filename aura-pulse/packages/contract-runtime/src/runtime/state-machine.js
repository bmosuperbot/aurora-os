/**
 * @import { ContractStatusValue } from '../types/contract-status.js'
 * @import { ParticipantRoleValue } from '../types/participant.js'
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
