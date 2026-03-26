import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { makeTempRuntime } from '../helpers/temp-db.js'
import { makeContract, agentWriter } from '../helpers/fixtures.js'
import { offerReceivedType } from '../../src/domain-types/offer-received.js'

describe('Deferred surfacing', () => {
    let runtime, cleanup
    beforeEach(async () => {
        ;({ runtime, cleanup } = makeTempRuntime())
        await runtime.initialize()
        runtime.registerType(offerReceivedType)
    })
    afterEach(async () => { await runtime.shutdown(); cleanup() })

    it('getPending() does not return a contract before surface_after', async () => {
        const future = new Date(Date.now() + 60_000).toISOString()
        const c = makeContract({ surface_after: future })
        await runtime.create(c)
        await runtime.transition(c.id, 'active', agentWriter())
        await runtime.transition(c.id, 'waiting_approval', agentWriter())
        const pending = await runtime.getPending()
        expect(pending.find(p => p.id === c.id)).toBeUndefined()
    })

    it('getPending() returns a contract after surface_after has passed', async () => {
        const past = new Date(Date.now() - 1000).toISOString()
        const c = makeContract({ surface_after: past })
        await runtime.create(c)
        await runtime.transition(c.id, 'active', agentWriter())
        await runtime.transition(c.id, 'waiting_approval', agentWriter())
        const pending = await runtime.getPending()
        expect(pending.find(p => p.id === c.id)).toBeTruthy()
    })

    it('getPending() returns contracts with no surface_after', async () => {
        const c = makeContract()
        await runtime.create(c)
        await runtime.transition(c.id, 'active', agentWriter())
        await runtime.transition(c.id, 'waiting_approval', agentWriter())
        const pending = await runtime.getPending()
        expect(pending.find(p => p.id === c.id)).toBeTruthy()
    })

    it('getPending() does not return contracts in active status', async () => {
        const c = makeContract()
        await runtime.create(c)
        await runtime.transition(c.id, 'active', agentWriter())
        const pending = await runtime.getPending()
        expect(pending.find(p => p.id === c.id)).toBeUndefined()
    })

    it('getPending() does not return contracts in complete status', async () => {
        const c = makeContract()
        await runtime.create(c)
        await runtime.transition(c.id, 'active', agentWriter())
        await runtime.transition(c.id, 'complete', agentWriter())
        const pending = await runtime.getPending()
        expect(pending.find(p => p.id === c.id)).toBeUndefined()
    })
})
