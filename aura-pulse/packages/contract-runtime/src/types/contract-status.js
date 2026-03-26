/**
 * All valid contract statuses.
 * @readonly
 * @enum {string}
 */
export const ContractStatus = /** @type {const} */ ({
    CREATED:          'created',
    ACTIVE:           'active',
    WAITING_APPROVAL: 'waiting_approval',
    RESOLVER_ACTIVE:  'resolver_active',
    CLARIFYING:       'clarifying',
    EXECUTING:        'executing',
    COMPLETE:         'complete',
    FAILED:           'failed',
})

/**
 * Valid transitions. Key = from, value = array of allowed to-states.
 * The state machine checks this table and nothing else.
 *
 * @type {Record<import('./contract-status.js').ContractStatusValue, import('./contract-status.js').ContractStatusValue[]>}
 */
export const VALID_TRANSITIONS = {
    created:          ['active'],
    active:           ['waiting_approval', 'complete', 'failed'],
    waiting_approval: ['resolver_active', 'failed'],
    resolver_active:  ['clarifying', 'executing', 'waiting_approval'],
    clarifying:       ['resolver_active'],
    executing:        ['active', 'complete', 'failed'],
    complete:         [],
    failed:           ['active'],
}

/**
 * Terminal statuses — no further transitions permitted after these.
 * Only `complete` is truly terminal. `failed` is recoverable: a human
 * can instruct retry, transitioning failed → active. The audit trail
 * and clarification history are preserved across the retry.
 * @type {import('./contract-status.js').ContractStatusValue[]}
 */
export const TERMINAL_STATUSES = ['complete']
