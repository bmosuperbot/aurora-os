import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { makeTempRuntime } from '../helpers/temp-db.js'
import { makeContract, agentWriter, humanResolver } from '../helpers/fixtures.js'
import { offerReceivedType } from '../../src/domain-types/offer-received.js'

describe('Clarification round-trip', () => {
    let runtime, cleanup
    beforeEach(async () => {
        ;({ runtime, cleanup } = makeTempRuntime())
        await runtime.initialize()
        runtime.registerType(offerReceivedType)
    })
    afterEach(async () => { await runtime.shutdown(); cleanup() })

    async function setupToResolverActive(c) {
        await runtime.create(c)
        await runtime.transition(c.id, 'active', agentWriter())
        await runtime.transition(c.id, 'waiting_approval', agentWriter())
        await runtime.transition(c.id, 'resolver_active', humanResolver())
    }

    it('transitions resolver_active → clarifying on askClarification', async () => {
        const c = makeContract()
        await setupToResolverActive(c)
        await runtime.askClarification(c.id, 'What was their last counter?', 'owner')
        expect((await runtime.get(c.id))?.status).toBe('clarifying')
    })

    it('appends question entry to clarifications array', async () => {
        const c = makeContract()
        await setupToResolverActive(c)
        await runtime.askClarification(c.id, 'What was their last counter?', 'owner')
        const saved = await runtime.get(c.id)
        expect(saved?.clarifications?.length).toBeGreaterThan(0)
        expect(saved?.clarifications?.at(-1)?.role).toBe('question')
        expect(saved?.clarifications?.at(-1)?.content).toBe('What was their last counter?')
    })

    it('transitions clarifying → resolver_active on answerClarification', async () => {
        const c = makeContract()
        await setupToResolverActive(c)
        await runtime.askClarification(c.id, 'What was their last counter?', 'owner')
        await runtime.answerClarification(c.id, 'They accepted $42 in March.', 'agent-primary')
        expect((await runtime.get(c.id))?.status).toBe('resolver_active')
    })

    it('appends answer entry and preserves question', async () => {
        const c = makeContract()
        await setupToResolverActive(c)
        await runtime.askClarification(c.id, 'Question?', 'owner')
        await runtime.answerClarification(c.id, 'Answer.', 'agent-primary')
        const saved = await runtime.get(c.id)
        expect(saved?.clarifications?.length).toBe(2)
        expect(saved?.clarifications?.[0].role).toBe('question')
        expect(saved?.clarifications?.[1].role).toBe('answer')
    })

    it('increments surface version on updateSurface', async () => {
        const c = makeContract()
        await setupToResolverActive(c)
        const surface = {
            voice_line: 'Recommend counter at $38.',
            summary: 'Buyer offered $30.',
            recommendation: { action: 'counter', value: 38, reasoning: 'History shows they accept $38.' },
            actions: [],
            version: 0,
        }
        await runtime.updateSurface(c.id, surface, 'agent-primary')
        const saved = await runtime.get(c.id)
        expect(saved?.surface?.version).toBe(1)
        await runtime.updateSurface(c.id, surface, 'agent-primary')
        expect((await runtime.get(c.id))?.surface?.version).toBe(2)
    })

    it('supports multiple clarification rounds', async () => {
        const c = makeContract()
        await setupToResolverActive(c)
        await runtime.askClarification(c.id, 'Q1?', 'owner')
        await runtime.answerClarification(c.id, 'A1.', 'agent-primary')
        await runtime.askClarification(c.id, 'Q2?', 'owner')
        await runtime.answerClarification(c.id, 'A2.', 'agent-primary')
        const saved = await runtime.get(c.id)
        expect(saved?.clarifications?.length).toBe(4)
    })
})
