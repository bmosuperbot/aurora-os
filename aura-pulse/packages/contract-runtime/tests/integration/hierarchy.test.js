import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { makeTempRuntime } from '../helpers/temp-db.js'
import { agentExecutor, agentWriter, humanResolver, makeContract } from '../helpers/fixtures.js'
import { offerReceivedType } from '../../src/domain-types/offer-received.js'
import { InvalidTransitionError, UnauthorizedRoleError } from '../../src/types/errors.js'

async function parentInExecuting(runtime, storage) {
    const parent = makeContract({
        participants: {
            writer: { id: 'agent-primary', type: 'agent' },
            executor: { id: 'agent-executor', type: 'agent' },
            resolver: { id: 'owner', type: 'human' },
        },
    })
    await runtime.create(parent)
    await runtime.transition(parent.id, 'active', agentWriter())
    await runtime.transition(parent.id, 'waiting_approval', agentWriter())
    await runtime.transition(parent.id, 'resolver_active', humanResolver())
    const tokenRow = /** @type {any} */ (storage._db()
        .prepare('SELECT token FROM resume_tokens WHERE contract_id = ?')
        .get(parent.id))
    await runtime.resume(parent.id, tokenRow.token, humanResolver(), 'proceed')
    return parent
}

describe('contract hierarchy', () => {
    let runtime, storage, cleanup
    beforeEach(async () => {
        ;({ runtime, storage, cleanup } = makeTempRuntime())
        await runtime.initialize()
        runtime.registerType(offerReceivedType)
    })
    afterEach(async () => { await runtime.shutdown(); cleanup() })

    it('spawnSubtask creates child with correct parent_id', async () => {
        const parent = await parentInExecuting(runtime, storage)
        const child = makeContract()
        await runtime.spawnSubtask(parent.id, child, agentExecutor())
        const savedChild = await runtime.get(child.id)
        expect(savedChild?.parent_id).toBe(parent.id)
    })

    it('spawnSubtask transitions parent executing → active', async () => {
        const parent = await parentInExecuting(runtime, storage)
        await runtime.spawnSubtask(parent.id, makeContract(), agentExecutor())
        expect((await runtime.get(parent.id))?.status).toBe('active')
    })

    it('parent child_ids includes spawned child', async () => {
        const parent = await parentInExecuting(runtime, storage)
        const child = makeContract()
        await runtime.spawnSubtask(parent.id, child, agentExecutor())
        const savedParent = await runtime.get(parent.id)
        expect(savedParent?.child_ids).toContain(child.id)
    })

    it('multiple subtasks accumulate in child_ids', async () => {
        const parent = await parentInExecuting(runtime, storage)
        const child1 = makeContract()
        await runtime.spawnSubtask(parent.id, child1, agentExecutor())
        // Re-advance parent to executing for second spawn
        await runtime.transition(parent.id, 'waiting_approval', agentWriter())
        await runtime.transition(parent.id, 'resolver_active', humanResolver())
        const tokenRow2 = /** @type {any} */ (storage._db()
            .prepare('SELECT token FROM resume_tokens WHERE contract_id = ?')
            .get(parent.id))
        await runtime.resume(parent.id, tokenRow2.token, humanResolver(), 'proceed')
        const child2 = makeContract()
        await runtime.spawnSubtask(parent.id, child2, agentExecutor())
        const savedParent = await runtime.get(parent.id)
        expect(savedParent?.child_ids?.length).toBe(2)
        expect(savedParent?.child_ids).toContain(child1.id)
        expect(savedParent?.child_ids).toContain(child2.id)
    })

    it('child contract traverses its state machine independently', async () => {
        const parent = await parentInExecuting(runtime, storage)
        const child = makeContract()
        await runtime.spawnSubtask(parent.id, child, agentExecutor())
        await runtime.transition(child.id, 'active', agentWriter())
        await runtime.transition(child.id, 'complete', agentWriter())
        expect((await runtime.get(child.id))?.status).toBe('complete')
        expect((await runtime.get(parent.id))?.status).toBe('active')
    })

    it('spawnSubtask appends log entries to both parent and child', async () => {
        const parent = await parentInExecuting(runtime, storage)
        const child = makeContract()
        await runtime.spawnSubtask(parent.id, child, agentExecutor())
        const childLog = await runtime._storage.queryLog(child.id)
        const parentLog = await runtime._storage.queryLog(parent.id)
        expect(childLog.some(e => e.event === 'created')).toBe(true)
        expect(parentLog.some(e => e.event.includes('executing→active'))).toBe(true)
    })

    it('writer cannot spawn a subtask when executor is declared separately', async () => {
        const parent = await parentInExecuting(runtime, storage)
        await expect(
            runtime.spawnSubtask(parent.id, makeContract(), agentWriter())
        ).rejects.toBeInstanceOf(UnauthorizedRoleError)
    })

    it('does not create a child when parent is no longer executing', async () => {
        const parent = await parentInExecuting(runtime, storage)
        const systemActor = { id: 'system', type: /** @type {'system'} */ ('system') }
        await runtime.transition(parent.id, 'failed', systemActor)

        const child = makeContract()
        await expect(
            runtime.spawnSubtask(parent.id, child, agentExecutor())
        ).rejects.toBeInstanceOf(InvalidTransitionError)
        expect(await runtime.get(child.id)).toBeNull()
    })
})
