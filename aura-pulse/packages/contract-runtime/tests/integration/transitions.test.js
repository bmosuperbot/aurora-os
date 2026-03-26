import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { makeTempRuntime } from '../helpers/temp-db.js'
import { makeContract, agentWriter } from '../helpers/fixtures.js'
import { offerReceivedType } from '../../src/domain-types/offer-received.js'
import { InvalidTransitionError, TerminalStateError } from '../../src/types/errors.js'

describe('Contract lifecycle transitions', () => {
    let runtime, storage, cleanup
    beforeEach(async () => {
        ;({ runtime, storage, cleanup } = makeTempRuntime())
        await runtime.initialize()
        runtime.registerType(offerReceivedType)
    })
    afterEach(async () => { await runtime.shutdown(); cleanup() })

    it('creates a contract in created status', async () => {
        const c = makeContract()
        await runtime.create(c)
        const saved = await runtime.get(c.id)
        expect(saved?.status).toBe('created')
    })

    it('transitions created → active', async () => {
        const c = makeContract()
        await runtime.create(c)
        await runtime.transition(c.id, 'active', agentWriter())
        expect((await runtime.get(c.id))?.status).toBe('active')
    })

    it('transitions active → waiting_approval and stores a resume token', async () => {
        const c = makeContract()
        await runtime.create(c)
        await runtime.transition(c.id, 'active', agentWriter())
        await runtime.transition(c.id, 'waiting_approval', agentWriter())
        expect((await runtime.get(c.id))?.status).toBe('waiting_approval')
        const row = storage._db().prepare('SELECT * FROM resume_tokens WHERE contract_id = ?').get(c.id)
        expect(row).toBeTruthy()
    })

    it('transitions active → complete and fires completion notifier', async () => {
        let notified = null
        const notifier = { onComplete: async (contract) => { notified = contract } }
        const { runtime: rt, cleanup: cl } = makeTempRuntime()
        await rt.initialize()
        rt._notifier = notifier
        rt.registerType(offerReceivedType)

        const c = makeContract()
        await rt.create(c)
        await rt.transition(c.id, 'active', agentWriter())
        await rt.transition(c.id, 'complete', agentWriter())
        expect(notified?.id).toBe(c.id)
        await rt.shutdown(); cl()
    })

    it('throws InvalidTransitionError for an invalid transition', async () => {
        const c = makeContract()
        await runtime.create(c)
        await expect(runtime.transition(c.id, 'complete', agentWriter())).rejects.toThrow(InvalidTransitionError)
    })

    it('throws TerminalStateError on complete contract', async () => {
        const c = makeContract()
        await runtime.create(c)
        await runtime.transition(c.id, 'active', agentWriter())
        await runtime.transition(c.id, 'complete', agentWriter())
        await expect(runtime.transition(c.id, 'active', agentWriter())).rejects.toThrow(TerminalStateError)
    })

    it('updates updated_at on every transition', async () => {
        const c = makeContract()
        await runtime.create(c)
        const before = (await runtime.get(c.id))?.updated_at
        await new Promise(r => setTimeout(r, 5))
        await runtime.transition(c.id, 'active', agentWriter())
        const after = (await runtime.get(c.id))?.updated_at
        expect(after).not.toBe(before)
    })

    it('appends an entry to contract_log on every transition', async () => {
        const c = makeContract()
        await runtime.create(c)
        await runtime.transition(c.id, 'active', agentWriter())
        await runtime.transition(c.id, 'waiting_approval', agentWriter())
        const log = await storage.queryLog(c.id)
        expect(log.length).toBeGreaterThanOrEqual(3)
        expect(log.some(e => e.event === 'created' || e.event.includes('active'))).toBe(true)
    })
})
