import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { makeTempRuntime } from '../helpers/temp-db.js'
import { makeContract, agentWriter, humanResolver } from '../helpers/fixtures.js'
import { offerReceivedType } from '../../src/domain-types/offer-received.js'
import { InvalidResumeTokenError, InvalidTransitionError } from '../../src/types/errors.js'

describe('concurrent writes', () => {
    let runtime, storage, cleanup
    beforeEach(async () => {
        ;({ runtime, storage, cleanup } = makeTempRuntime())
        await runtime.initialize()
        runtime.registerType(offerReceivedType)
    })
    afterEach(async () => { await runtime.shutdown(); cleanup() })

    it('10 simultaneous creates all succeed without corruption', async () => {
        const contracts = Array.from({ length: 10 }, (_, i) =>
            makeContract({ id: `concurrent-create-${i}` })
        )
        await Promise.all(contracts.map(c => runtime.create(c)))
        const stored = await Promise.all(contracts.map(c => runtime.get(c.id)))
        for (const s of stored) {
            expect(s?.status).toBe('created')
        }
    })

    it('exactly 1 of 10 simultaneous active → waiting_approval transitions succeeds (CAS)', async () => {
        const c = makeContract()
        await runtime.create(c)
        await runtime.transition(c.id, 'active', agentWriter())

        const results = await Promise.allSettled(
            Array.from({ length: 10 }, () =>
                runtime.transition(c.id, 'waiting_approval', agentWriter())
            )
        )

        const fulfilled = results.filter(r => r.status === 'fulfilled')
        const rejected = results.filter(r => r.status === 'rejected')

        expect(fulfilled).toHaveLength(1)
        expect(rejected).toHaveLength(9)
        for (const r of rejected) {
            expect(r.reason).toBeInstanceOf(InvalidTransitionError)
        }

        const final = await runtime.get(c.id)
        expect(final?.status).toBe('waiting_approval')
    })

    it('only 1 of 5 concurrent askClarification calls succeeds (CAS)', async () => {
        const c = makeContract()
        await runtime.create(c)
        await runtime.transition(c.id, 'active', agentWriter())
        await runtime.transition(c.id, 'waiting_approval', agentWriter())
        await runtime.transition(c.id, 'resolver_active', humanResolver())

        const results = await Promise.allSettled(
            Array.from({ length: 5 }, (_, i) =>
                runtime.askClarification(c.id, `Question ${i}?`, 'owner')
            )
        )

        const fulfilled = results.filter(r => r.status === 'fulfilled')
        const rejected = results.filter(r => r.status === 'rejected')

        expect(fulfilled).toHaveLength(1)
        expect(rejected).toHaveLength(4)
        for (const r of rejected) {
            expect(r.reason).toBeInstanceOf(InvalidTransitionError)
        }
        expect((await runtime.get(c.id))?.status).toBe('clarifying')
    })

    it('only 1 of 5 concurrent resume calls can consume the same token', async () => {
        const c = makeContract()
        await runtime.create(c)
        await runtime.transition(c.id, 'active', agentWriter())
        await runtime.transition(c.id, 'waiting_approval', agentWriter())
        await runtime.transition(c.id, 'resolver_active', humanResolver())
        const token = /** @type {any} */ (storage._db()
            .prepare('SELECT token FROM resume_tokens WHERE contract_id = ?')
            .get(c.id)).token

        const results = await Promise.allSettled(
            Array.from({ length: 5 }, () =>
                runtime.resume(c.id, token, humanResolver(), 'counter', 38)
            )
        )

        const fulfilled = results.filter(r => r.status === 'fulfilled')
        const rejected = results.filter(r => r.status === 'rejected')

        expect(fulfilled).toHaveLength(1)
        expect(rejected).toHaveLength(4)
        for (const r of rejected) {
            expect(
                r.reason instanceof InvalidResumeTokenError || r.reason instanceof InvalidTransitionError
            ).toBe(true)
        }

        expect((await runtime.get(c.id))?.status).toBe('executing')
    })
})
