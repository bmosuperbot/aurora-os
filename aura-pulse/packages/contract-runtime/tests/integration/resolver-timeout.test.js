import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { makeTempRuntime } from '../helpers/temp-db.js'
import { makeContract, agentWriter, humanResolver } from '../helpers/fixtures.js'
import { offerReceivedType } from '../../src/domain-types/offer-received.js'
import { InvalidResumeTokenError } from '../../src/types/errors.js'

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

    it('replaces the prior resume token after returning to waiting_approval', async () => {
        const c = makeContract()
        await runtime.create(c)
        await runtime.transition(c.id, 'active', agentWriter())
        await runtime.transition(c.id, 'waiting_approval', agentWriter())
        const originalToken = /** @type {any} */ (storage._db()
            .prepare('SELECT token FROM resume_tokens WHERE contract_id = ?')
            .get(c.id)).token
        await runtime.transition(c.id, 'resolver_active', humanResolver())

        await new Promise(r => setTimeout(r, 150))
        await runtime._ttlManager.tick()

        const tokenRows = /** @type {Array<{ token: string }>} */ (storage._db()
            .prepare('SELECT token FROM resume_tokens WHERE contract_id = ?')
            .all(c.id))
        expect(tokenRows).toHaveLength(1)
        expect(tokenRows[0]?.token).not.toBe(originalToken)

        await runtime.transition(c.id, 'resolver_active', humanResolver())
        await expect(
            runtime.resume(c.id, originalToken, humanResolver(), 'accept')
        ).rejects.toBeInstanceOf(InvalidResumeTokenError)
        await expect(
            runtime.resume(c.id, tokenRows[0].token, humanResolver(), 'accept')
        ).resolves.toBeUndefined()
        expect((await runtime.get(c.id))?.status).toBe('executing')
    })
})
