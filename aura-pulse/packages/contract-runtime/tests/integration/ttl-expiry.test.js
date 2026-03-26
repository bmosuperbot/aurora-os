import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { makeTempRuntime } from '../helpers/temp-db.js'
import { makeContract, agentWriter } from '../helpers/fixtures.js'
import { offerReceivedType } from '../../src/domain-types/offer-received.js'

describe('TTL enforcement', () => {
    let runtime, cleanup
    beforeEach(async () => {
        ;({ runtime, cleanup } = makeTempRuntime({ ttl: { checkIntervalMs: 50 } }))
        await runtime.initialize()
        runtime.registerType(offerReceivedType)
    })
    afterEach(async () => { await runtime.shutdown(); cleanup() })

    it('moves waiting_approval → failed when expires_at has passed', async () => {
        const past = new Date(Date.now() - 1000).toISOString()
        const c = makeContract({ expires_at: past })
        await runtime.create(c)
        await runtime.transition(c.id, 'active', agentWriter())
        await runtime.transition(c.id, 'waiting_approval', agentWriter())
        await runtime._ttlManager.tick()
        expect((await runtime.get(c.id))?.status).toBe('failed')
    })

    it('does not expire a contract before expires_at', async () => {
        const future = new Date(Date.now() + 60_000).toISOString()
        const c = makeContract({ expires_at: future })
        await runtime.create(c)
        await runtime.transition(c.id, 'active', agentWriter())
        await runtime.transition(c.id, 'waiting_approval', agentWriter())
        await runtime._ttlManager.tick()
        expect((await runtime.get(c.id))?.status).toBe('waiting_approval')
    })

    it('does not expire a contract with no expires_at', async () => {
        const c = makeContract()
        await runtime.create(c)
        await runtime.transition(c.id, 'active', agentWriter())
        await runtime.transition(c.id, 'waiting_approval', agentWriter())
        await runtime._ttlManager.tick()
        expect((await runtime.get(c.id))?.status).toBe('waiting_approval')
    })
})
