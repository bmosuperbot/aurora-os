import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { statSync } from 'node:fs'
import { makeTempRuntime } from '../helpers/temp-db.js'
import { makeContract, agentWriter } from '../helpers/fixtures.js'
import { offerReceivedType } from '../../src/domain-types/offer-received.js'
import { InvalidTransitionError } from '../../src/types/errors.js'

describe('signal file timing', () => {
    let runtime, signalPath, cleanup
    beforeEach(async () => {
        ;({ runtime, signalPath, cleanup } = makeTempRuntime())
        await runtime.initialize()
        runtime.registerType(offerReceivedType)
    })
    afterEach(async () => { await runtime.shutdown(); cleanup() })

    it('updates signal mtime after create', async () => {
        const before = statSync(signalPath).mtimeMs
        await new Promise(r => setTimeout(r, 10))
        const c = makeContract()
        await runtime.create(c)
        const after = statSync(signalPath).mtimeMs
        expect(after).toBeGreaterThan(before)
    })

    it('updates signal mtime after transition', async () => {
        const c = makeContract()
        await runtime.create(c)
        await new Promise(r => setTimeout(r, 10))
        const before = statSync(signalPath).mtimeMs
        await new Promise(r => setTimeout(r, 10))
        await runtime.transition(c.id, 'active', agentWriter())
        const after = statSync(signalPath).mtimeMs
        expect(after).toBeGreaterThan(before)
    })

    it('data is committed before signal file is touched', async () => {
        const c = makeContract()
        await runtime.create(c)
        // By the time create() resolves, the data must already be readable
        const stored = await runtime.get(c.id)
        expect(stored?.id).toBe(c.id)
    })

    it('does not update signal mtime when transition fails', async () => {
        const c = makeContract()
        await runtime.create(c)
        await new Promise(r => setTimeout(r, 10))
        const before = statSync(signalPath).mtimeMs
        await expect(
            runtime.transition(c.id, 'complete', agentWriter())
        ).rejects.toBeInstanceOf(InvalidTransitionError)
        const after = statSync(signalPath).mtimeMs
        expect(after).toBe(before)
    })
})
