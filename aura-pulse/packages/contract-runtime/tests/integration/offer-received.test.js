import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { makeTempRuntime } from '../helpers/temp-db.js'
import { makeContract, makeOfferContext, agentWriter, humanResolver } from '../helpers/fixtures.js'
import { offerReceivedType } from '../../src/domain-types/offer-received.js'
import { ContractValidationError } from '../../src/types/errors.js'

describe('offer-received end-to-end', () => {
    let runtime, storage, cleanup
    beforeEach(async () => {
        ;({ runtime, storage, cleanup } = makeTempRuntime())
        await runtime.initialize()
        runtime.registerType(offerReceivedType)
    })
    afterEach(async () => { await runtime.shutdown(); cleanup() })

    it('rejects creation when offer_amount is zero', async () => {
        const c = makeContract({
            intent: {
                goal: 'test',
                trigger: 'test',
                context: makeOfferContext({ offer_amount: 0 }),
            },
        })
        await expect(runtime.create(c)).rejects.toBeInstanceOf(ContractValidationError)
    })

    it('rejects creation when offer_amount exceeds asking_price', async () => {
        const c = makeContract({
            intent: {
                goal: 'test',
                trigger: 'test',
                context: makeOfferContext({ offer_amount: 100, asking_price: 45 }),
            },
        })
        await expect(runtime.create(c)).rejects.toBeInstanceOf(ContractValidationError)
    })

    it('runs the full offer lifecycle with clarification and resume', async () => {
        const wakeTime = new Date(Date.now() - 1000).toISOString()
        const contract = makeContract({
            surface_after: wakeTime,
            expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            intent: {
                goal: 'Owner decision: accept, counter, or decline offer',
                trigger: 'Buyer offer received on Poshmark listing',
                context: makeOfferContext({
                    asking_price: 45,
                    offer_amount: 30,
                    buyer_id: 'buyer-xyz',
                }),
            },
        })

        await runtime.create(contract)
        expect((await runtime.get(contract.id))?.status).toBe('created')

        await runtime.transition(contract.id, 'active', agentWriter())
        expect((await runtime.get(contract.id))?.status).toBe('active')

        await runtime.updateSurface(contract.id, {
            voice_line: 'Agent has offered $30 on your $45 listing.',
            summary: 'Buyer offered $30 on $45 listing',
            recommendation: { action: 'counter', value: 38 },
            actions: [
                { id: 'accept', label: 'Accept $30', action: 'accept' },
                { id: 'counter', label: 'Counter $38', action: 'counter', value: 38 },
            ],
            version: 0,
        }, 'agent-primary')

        await runtime.transition(contract.id, 'waiting_approval', agentWriter())
        const pending = await runtime.getPending()
        expect(pending.find(p => p.id === contract.id)).toBeTruthy()

        await runtime.transition(contract.id, 'resolver_active', humanResolver())
        expect((await runtime.get(contract.id))?.status).toBe('resolver_active')

        await runtime.askClarification(contract.id, 'What did they accept last time?', 'owner')
        expect((await runtime.get(contract.id))?.status).toBe('clarifying')

        await runtime.answerClarification(contract.id, 'They accepted $38 in March 2026.', 'agent-primary')
        await runtime.updateSurface(contract.id, {
            voice_line: 'They accepted $38 in March. Counter at $38.',
            summary: 'Buyer offered $30. History: accepted $38 in March.',
            recommendation: { action: 'counter', value: 38 },
            actions: [{ id: 'counter', label: 'Counter $38', action: 'counter', value: 38 }],
            version: 1,
        }, 'agent-primary')
        expect((await runtime.get(contract.id))?.surface?.version).toBe(2)

        const tokenRow = storage._db()
            .prepare('SELECT token FROM resume_tokens WHERE contract_id = ?')
            .get(contract.id)
        expect(tokenRow).toBeTruthy()

        await runtime.resume(
            contract.id,
            /** @type {any} */ (tokenRow).token,
            humanResolver(),
            'counter',
            38,
            { draft_message: 'Would you accept $38?' }
        )
        expect((await runtime.get(contract.id))?.status).toBe('executing')
        expect((await runtime.get(contract.id))?.resume?.value).toBe(38)

        await expect(
            runtime.resume(contract.id, /** @type {any} */ (tokenRow).token, humanResolver(), 'counter', 38)
        ).rejects.toThrow()

        let notified = null
        runtime._notifier = { onComplete: async (c) => { notified = c } }
        await runtime.transition(contract.id, 'complete', agentWriter())
        expect((await runtime.get(contract.id))?.status).toBe('complete')
        expect(notified?.id).toBe(contract.id)

        const log = await storage.queryLog(contract.id)
        const events = log.map(e => e.event)
        expect(events).toContain('created')
        expect(events.some(e => e.includes('active'))).toBe(true)
        expect(events.some(e => e.includes('waiting_approval'))).toBe(true)
        expect(events).toContain('clarification:question')
        expect(events).toContain('clarification:answer')
        expect(events.some(e => e.includes('complete'))).toBe(true)
    })
})
