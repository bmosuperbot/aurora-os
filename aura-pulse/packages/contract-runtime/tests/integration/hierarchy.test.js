import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { makeTempRuntime } from '../helpers/temp-db.js'
import { makeContract, agentWriter, humanResolver } from '../helpers/fixtures.js'
import { offerReceivedType } from '../../src/domain-types/offer-received.js'

async function parentInExecuting(runtime) {
    const parent = makeContract()
    await runtime.create(parent)
    await runtime.transition(parent.id, 'active', agentWriter())
    await runtime.transition(parent.id, 'waiting_approval', agentWriter())
    await runtime.transition(parent.id, 'resolver_active', humanResolver())
    await runtime.transition(parent.id, 'executing', agentWriter())
    return parent
}

describe('contract hierarchy', () => {
    let runtime, cleanup
    beforeEach(async () => {
        ;({ runtime, cleanup } = makeTempRuntime())
        await runtime.initialize()
        runtime.registerType(offerReceivedType)
    })
    afterEach(async () => { await runtime.shutdown(); cleanup() })

    it('spawnSubtask creates child with correct parent_id', async () => {
        const parent = await parentInExecuting(runtime)
        const child = makeContract()
        await runtime.spawnSubtask(parent.id, child, agentWriter())
        const savedChild = await runtime.get(child.id)
        expect(savedChild?.parent_id).toBe(parent.id)
    })

    it('spawnSubtask transitions parent executing → active', async () => {
        const parent = await parentInExecuting(runtime)
        await runtime.spawnSubtask(parent.id, makeContract(), agentWriter())
        expect((await runtime.get(parent.id))?.status).toBe('active')
    })

    it('parent child_ids includes spawned child', async () => {
        const parent = await parentInExecuting(runtime)
        const child = makeContract()
        await runtime.spawnSubtask(parent.id, child, agentWriter())
        const savedParent = await runtime.get(parent.id)
        expect(savedParent?.child_ids).toContain(child.id)
    })

    it('multiple subtasks accumulate in child_ids', async () => {
        const parent = await parentInExecuting(runtime)
        const child1 = makeContract()
        await runtime.spawnSubtask(parent.id, child1, agentWriter())
        // Re-advance parent to executing for second spawn
        await runtime.transition(parent.id, 'waiting_approval', agentWriter())
        await runtime.transition(parent.id, 'resolver_active', humanResolver())
        await runtime.transition(parent.id, 'executing', agentWriter())
        const child2 = makeContract()
        await runtime.spawnSubtask(parent.id, child2, agentWriter())
        const savedParent = await runtime.get(parent.id)
        expect(savedParent?.child_ids?.length).toBe(2)
        expect(savedParent?.child_ids).toContain(child1.id)
        expect(savedParent?.child_ids).toContain(child2.id)
    })

    it('child contract traverses its state machine independently', async () => {
        const parent = await parentInExecuting(runtime)
        const child = makeContract()
        await runtime.spawnSubtask(parent.id, child, agentWriter())
        await runtime.transition(child.id, 'active', agentWriter())
        await runtime.transition(child.id, 'complete', agentWriter())
        expect((await runtime.get(child.id))?.status).toBe('complete')
        expect((await runtime.get(parent.id))?.status).toBe('active')
    })

    it('spawnSubtask appends log entries to both parent and child', async () => {
        const parent = await parentInExecuting(runtime)
        const child = makeContract()
        await runtime.spawnSubtask(parent.id, child, agentWriter())
        const childLog = await runtime._storage.queryLog(child.id)
        const parentLog = await runtime._storage.queryLog(parent.id)
        expect(childLog.some(e => e.event === 'created')).toBe(true)
        expect(parentLog.some(e => e.event.includes('executing→active'))).toBe(true)
    })
})
