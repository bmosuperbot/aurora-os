import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { makeTempRuntime } from '../helpers/temp-db.js'
import { makeContract, agentWriter, humanResolver } from '../helpers/fixtures.js'
import { offerReceivedType } from '../../src/domain-types/offer-received.js'

describe('retry lifecycle (failed → active)', () => {
    let runtime, storage, cleanup
    beforeEach(async () => {
        ;({ runtime, storage, cleanup } = makeTempRuntime({ ttl: { checkIntervalMs: 50 } }))
        await runtime.initialize()
        runtime.registerType(offerReceivedType)
    })
    afterEach(async () => { await runtime.shutdown(); cleanup() })

    it('TTL-expired contract can be retried: failed → active → complete', async () => {
        const past = new Date(Date.now() - 1000).toISOString()
        const c = makeContract({ expires_at: past })
        await runtime.create(c)
        await runtime.transition(c.id, 'active', agentWriter())
        await runtime.transition(c.id, 'waiting_approval', agentWriter())
        await runtime._ttlManager.tick()
        expect((await runtime.get(c.id))?.status).toBe('failed')

        // Human resolver instructs retry
        await runtime.transition(c.id, 'active', humanResolver())
        expect((await runtime.get(c.id))?.status).toBe('active')

        // Agent completes
        await runtime.transition(c.id, 'complete', agentWriter())
        expect((await runtime.get(c.id))?.status).toBe('complete')
    })

    it('audit log is preserved and extended across a retry', async () => {
        const past = new Date(Date.now() - 1000).toISOString()
        const c = makeContract({ expires_at: past })
        await runtime.create(c)
        await runtime.transition(c.id, 'active', agentWriter())
        await runtime.transition(c.id, 'waiting_approval', agentWriter())
        await runtime._ttlManager.tick()

        await runtime.transition(c.id, 'active', humanResolver())
        await runtime.transition(c.id, 'complete', agentWriter())

        const log = await storage.queryLog(c.id)
        const events = log.map(e => e.event)
        expect(events[0]).toBe('created')
        expect(events.some(e => e.includes('waiting_approval'))).toBe(true)
        expect(events.some(e => e.includes('failed'))).toBe(true)
        // Retry and completion are also in the same log
        expect(events.some(e => e.includes('failed→active'))).toBe(true)
        expect(events.some(e => e.includes('complete'))).toBe(true)
        // All entries belong to the same contract
        expect(log.every(e => e.contract_id === c.id)).toBe(true)
    })

    it('clarifications are preserved across retry', async () => {
        const c = makeContract()
        await runtime.create(c)
        await runtime.transition(c.id, 'active', agentWriter())
        await runtime.transition(c.id, 'waiting_approval', agentWriter())
        await runtime.transition(c.id, 'resolver_active', humanResolver())
        await runtime.askClarification(c.id, 'What was the original price?', 'owner')
        await runtime.answerClarification(c.id, '$45 originally listed.', 'agent-primary')

        // System forces fail then human retries
        const systemActor = { id: 'system', type: /** @type {'system'} */ ('system') }
        await runtime.transition(c.id, 'waiting_approval', systemActor)
        await runtime.transition(c.id, 'failed', systemActor)
        await runtime.transition(c.id, 'active', humanResolver())

        const retried = await runtime.get(c.id)
        expect(retried?.status).toBe('active')
        expect(retried?.clarifications?.length).toBe(2)
        expect(retried?.clarifications?.[0].role).toBe('question')
        expect(retried?.clarifications?.[1].role).toBe('answer')
    })

    it('retry resets expires_at to allow a new TTL window', async () => {
        const past = new Date(Date.now() - 1000).toISOString()
        const future = new Date(Date.now() + 60_000).toISOString()
        const c = makeContract({ expires_at: past })
        await runtime.create(c)
        await runtime.transition(c.id, 'active', agentWriter())
        await runtime.transition(c.id, 'waiting_approval', agentWriter())
        await runtime._ttlManager.tick()
        expect((await runtime.get(c.id))?.status).toBe('failed')

        // Retry and give a fresh deadline
        await runtime.transition(c.id, 'active', humanResolver())
        // Update the contract surface with a new expiry (simulating agent refresh)
        const updated = { ...(await runtime.get(c.id)), expires_at: future }
        await runtime._storage.write(updated)
        await runtime.transition(c.id, 'waiting_approval', agentWriter())

        // Should not expire immediately
        await runtime._ttlManager.tick()
        expect((await runtime.get(c.id))?.status).toBe('waiting_approval')
    })
})
