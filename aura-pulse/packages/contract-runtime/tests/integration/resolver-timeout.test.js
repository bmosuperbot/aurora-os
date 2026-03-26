import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { makeTempRuntime } from '../helpers/temp-db.js'
import { makeContract, agentWriter, humanResolver } from '../helpers/fixtures.js'
import { offerReceivedType } from '../../src/domain-types/offer-received.js'

describe('resolver timeout', () => {
    let runtime, storage, cleanup
    beforeEach(async () => {
        ;({ runtime, storage, cleanup } = makeTempRuntime({ ttl: { resolverTimeoutMs: 100 } }))
        await runtime.initialize()
        runtime.registerType(offerReceivedType)
    })
    afterEach(async () => { await runtime.shutdown(); cleanup() })

    it('returns resolver_active → waiting_approval after resolverTimeoutMs', async () => {
        const c = makeContract()
        await runtime.create(c)
        await runtime.transition(c.id, 'active', agentWriter())
        await runtime.transition(c.id, 'waiting_approval', agentWriter())
        await runtime.transition(c.id, 'resolver_active', humanResolver())
        await new Promise(r => setTimeout(r, 150))
        await runtime._ttlManager.tick()
        expect((await runtime.get(c.id))?.status).toBe('waiting_approval')
    })

    it('generates a new resume token after returning to waiting_approval', async () => {
        const c = makeContract()
        await runtime.create(c)
        await runtime.transition(c.id, 'active', agentWriter())
        await runtime.transition(c.id, 'waiting_approval', agentWriter())
        await runtime.transition(c.id, 'resolver_active', humanResolver())

        const tokensBefore = /** @type {any} */ (storage._db()
            .prepare('SELECT COUNT(*) as n FROM resume_tokens WHERE contract_id = ?')
            .get(c.id)).n

        await new Promise(r => setTimeout(r, 150))
        await runtime._ttlManager.tick()

        const tokensAfter = /** @type {any} */ (storage._db()
            .prepare('SELECT COUNT(*) as n FROM resume_tokens WHERE contract_id = ?')
            .get(c.id)).n

        expect(tokensAfter).toBeGreaterThan(tokensBefore)
    })
})
