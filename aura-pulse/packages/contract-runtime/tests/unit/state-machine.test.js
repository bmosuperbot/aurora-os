import { describe, it, expect } from 'vitest'
import { assertValidTransition, assertRolePermitted } from '../../src/runtime/state-machine.js'
import {
    InvalidTransitionError,
    TerminalStateError,
    UnauthorizedRoleError,
} from '../../src/types/errors.js'

describe('assertValidTransition', () => {
    it.each([
        ['created',          'active'],
        ['active',           'waiting_approval'],
        ['active',           'complete'],
        ['active',           'failed'],
        ['waiting_approval', 'resolver_active'],
        ['waiting_approval', 'failed'],
        ['resolver_active',  'clarifying'],
        ['resolver_active',  'executing'],
        ['resolver_active',  'waiting_approval'],
        ['clarifying',       'resolver_active'],
        ['executing',        'active'],
        ['executing',        'complete'],
        ['executing',        'failed'],
        ['failed',           'active'],
    ])('%s → %s is valid', (from, to) => {
        expect(() => assertValidTransition('cid', from, to)).not.toThrow()
    })

    it.each([
        ['created',   'complete'],
        ['created',   'waiting_approval'],
        ['active',    'created'],
        ['active',    'resolver_active'],
        ['clarifying', 'executing'],
    ])('%s → %s throws InvalidTransitionError', (from, to) => {
        expect(() => assertValidTransition('cid', from, to)).toThrow(InvalidTransitionError)
    })

    it('complete → active throws TerminalStateError', () => {
        expect(() => assertValidTransition('cid', 'complete', 'active')).toThrow(TerminalStateError)
    })

    it('failed → complete throws InvalidTransitionError (failed is not terminal)', () => {
        expect(() => assertValidTransition('cid', 'failed', 'complete')).toThrow(InvalidTransitionError)
    })

    it('error includes correct contractId, from, and to', () => {
        try {
            assertValidTransition('my-contract', 'active', 'created')
        } catch (e) {
            expect(e).toBeInstanceOf(InvalidTransitionError)
            expect(/** @type {InvalidTransitionError} */ (e).contractId).toBe('my-contract')
            expect(/** @type {InvalidTransitionError} */ (e).from).toBe('active')
            expect(/** @type {InvalidTransitionError} */ (e).to).toBe('created')
        }
    })
})

describe('assertRolePermitted', () => {
    it('allows writer to create', () => {
        expect(() => assertRolePermitted('p1', 'writer', 'create')).not.toThrow()
    })

    it('allows resolver to engage', () => {
        expect(() => assertRolePermitted('p1', 'resolver', 'engage')).not.toThrow()
    })

    it('throws UnauthorizedRoleError when writer tries to commit', () => {
        expect(() => assertRolePermitted('p1', 'writer', 'commit')).toThrow(UnauthorizedRoleError)
    })

    it('throws UnauthorizedRoleError for any observer operation', () => {
        expect(() => assertRolePermitted('p1', 'observer', 'create')).toThrow(UnauthorizedRoleError)
    })
})
