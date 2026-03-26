import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { makeTempRuntime } from '../helpers/temp-db.js'
import { makeContract, agentWriter, humanResolver } from '../helpers/fixtures.js'
import { offerReceivedType } from '../../src/domain-types/offer-received.js'
import { InvalidResumeTokenError, ResumeRequiredError, UnauthorizedRoleError } from '../../src/types/errors.js'

describe('role enforcement', () => {
    let runtime, storage, cleanup
    beforeEach(async () => {
        ;({ runtime, storage, cleanup } = makeTempRuntime())
        await runtime.initialize()
        runtime.registerType(offerReceivedType)
    })
    afterEach(async () => { await runtime.shutdown(); cleanup() })

    // ─── Transition gate: waiting_approval → resolver_active ──────────

    it('writer cannot engage as resolver (waiting_approval → resolver_active)', async () => {
        const c = makeContract()
        await runtime.create(c)
        await runtime.transition(c.id, 'active', agentWriter())
        await runtime.transition(c.id, 'waiting_approval', agentWriter())
        // agentWriter is the writer slot — not the resolver
        await expect(
            runtime.transition(c.id, 'resolver_active', agentWriter())
        ).rejects.toBeInstanceOf(UnauthorizedRoleError)
        expect((await runtime.get(c.id))?.status).toBe('waiting_approval')
    })

    it('unknown actor (observer) cannot engage', async () => {
        const c = makeContract()
        await runtime.create(c)
        await runtime.transition(c.id, 'active', agentWriter())
        await runtime.transition(c.id, 'waiting_approval', agentWriter())
        const stranger = { id: 'stranger-agent', type: /** @type {'agent'} */ ('agent') }
        await expect(
            runtime.transition(c.id, 'resolver_active', stranger)
        ).rejects.toBeInstanceOf(UnauthorizedRoleError)
    })

    it('declared resolver can engage', async () => {
        const c = makeContract()
        await runtime.create(c)
        await runtime.transition(c.id, 'active', agentWriter())
        await runtime.transition(c.id, 'waiting_approval', agentWriter())
        await expect(
            runtime.transition(c.id, 'resolver_active', humanResolver())
        ).resolves.toBeUndefined()
        expect((await runtime.get(c.id))?.status).toBe('resolver_active')
    })

    // ─── Transition gate: resolver_active → executing ─────────────────

    it('writer cannot commit (resolver_active → executing) via transition()', async () => {
        const c = makeContract()
        await runtime.create(c)
        await runtime.transition(c.id, 'active', agentWriter())
        await runtime.transition(c.id, 'waiting_approval', agentWriter())
        await runtime.transition(c.id, 'resolver_active', humanResolver())
        await expect(
            runtime.transition(c.id, 'executing', agentWriter())
        ).rejects.toBeInstanceOf(ResumeRequiredError)
        expect((await runtime.get(c.id))?.status).toBe('resolver_active')
    })

    it('resolver cannot bypass resume token by calling transition() to executing', async () => {
        const c = makeContract()
        await runtime.create(c)
        await runtime.transition(c.id, 'active', agentWriter())
        await runtime.transition(c.id, 'waiting_approval', agentWriter())
        await runtime.transition(c.id, 'resolver_active', humanResolver())
        await expect(
            runtime.transition(c.id, 'executing', humanResolver())
        ).rejects.toBeInstanceOf(ResumeRequiredError)
        expect((await runtime.get(c.id))?.status).toBe('resolver_active')
    })

    // ─── Transition gate: failed → active (retry) ─────────────────────

    it('writer cannot retry a failed contract', async () => {
        const c = makeContract()
        await runtime.create(c)
        await runtime.transition(c.id, 'active', agentWriter())
        await runtime.transition(c.id, 'waiting_approval', agentWriter())
        const systemActor = { id: 'system', type: /** @type {'system'} */ ('system') }
        await runtime.transition(c.id, 'failed', systemActor)
        await expect(
            runtime.transition(c.id, 'active', agentWriter())
        ).rejects.toBeInstanceOf(UnauthorizedRoleError)
        expect((await runtime.get(c.id))?.status).toBe('failed')
    })

    it('declared resolver can retry a failed contract', async () => {
        const c = makeContract()
        await runtime.create(c)
        await runtime.transition(c.id, 'active', agentWriter())
        await runtime.transition(c.id, 'waiting_approval', agentWriter())
        const systemActor = { id: 'system', type: /** @type {'system'} */ ('system') }
        await runtime.transition(c.id, 'failed', systemActor)
        await expect(
            runtime.transition(c.id, 'active', humanResolver())
        ).resolves.toBeUndefined()
        expect((await runtime.get(c.id))?.status).toBe('active')
    })

    // ─── System actor bypass ──────────────────────────────────────────

    it('system actor bypasses role checks on gated transitions', async () => {
        const c = makeContract()
        await runtime.create(c)
        await runtime.transition(c.id, 'active', agentWriter())
        await runtime.transition(c.id, 'waiting_approval', agentWriter())
        const systemActor = { id: 'system', type: /** @type {'system'} */ ('system') }
        // waiting_approval → failed (not gated, but system works)
        await runtime.transition(c.id, 'failed', systemActor)
        // failed → active IS gated to resolver — system bypasses it
        await expect(
            runtime.transition(c.id, 'active', systemActor)
        ).resolves.toBeUndefined()
        expect((await runtime.get(c.id))?.status).toBe('active')
    })

    // ─── resume() identity enforcement ───────────────────────────────

    it('wrong resolver identity fails resume()', async () => {
        const c = makeContract()
        await runtime.create(c)
        await runtime.transition(c.id, 'active', agentWriter())
        await runtime.transition(c.id, 'waiting_approval', agentWriter())
        await runtime.transition(c.id, 'resolver_active', humanResolver())
        const tokenRow = /** @type {any} */ (storage._db()
            .prepare('SELECT token FROM resume_tokens WHERE contract_id = ?')
            .get(c.id))
        const wrongResolver = { id: 'wrong-party', type: /** @type {'human'} */ ('human') }
        await expect(
            runtime.resume(c.id, tokenRow.token, wrongResolver, 'accept')
        ).rejects.toBeInstanceOf(UnauthorizedRoleError)
        // token must NOT be consumed — the real resolver can still act
        expect((await runtime.get(c.id))?.status).toBe('resolver_active')
        const tokenStillThere = storage._db()
            .prepare('SELECT token FROM resume_tokens WHERE contract_id = ?')
            .get(c.id)
        expect(tokenStillThere).toBeTruthy()
    })

    it('declared resolver identity succeeds resume()', async () => {
        const c = makeContract()
        await runtime.create(c)
        await runtime.transition(c.id, 'active', agentWriter())
        await runtime.transition(c.id, 'waiting_approval', agentWriter())
        await runtime.transition(c.id, 'resolver_active', humanResolver())
        const tokenRow = /** @type {any} */ (storage._db()
            .prepare('SELECT token FROM resume_tokens WHERE contract_id = ?')
            .get(c.id))
        await expect(
            runtime.resume(c.id, tokenRow.token, humanResolver(), 'accept')
        ).resolves.toBeUndefined()
        expect((await runtime.get(c.id))?.status).toBe('executing')
    })

    // ─── Expired token integration path ──────────────────────────────

    it('expired token returns InvalidResumeTokenError and leaves contract unchanged', async () => {
        const c = makeContract()
        await runtime.create(c)
        await runtime.transition(c.id, 'active', agentWriter())
        await runtime.transition(c.id, 'waiting_approval', agentWriter())
        await runtime.transition(c.id, 'resolver_active', humanResolver())
        // Insert an expired token directly — simulates a stale/replayed token
        const expiredToken = 'expired-' + Date.now()
        storage._db()
            .prepare('INSERT INTO resume_tokens (contract_id, token, expires_at) VALUES (?, ?, ?)')
            .run(c.id, expiredToken, new Date(Date.now() - 3_600_000).toISOString())
        await expect(
            runtime.resume(c.id, expiredToken, humanResolver(), 'accept')
        ).rejects.toBeInstanceOf(InvalidResumeTokenError)
        expect((await runtime.get(c.id))?.status).toBe('resolver_active')
    })

    // ─── askClarification identity enforcement ────────────────────────

    it('non-resolver cannot call askClarification', async () => {
        const c = makeContract()
        await runtime.create(c)
        await runtime.transition(c.id, 'active', agentWriter())
        await runtime.transition(c.id, 'waiting_approval', agentWriter())
        await runtime.transition(c.id, 'resolver_active', humanResolver())
        await expect(
            runtime.askClarification(c.id, 'What was their price?', 'agent-primary')
        ).rejects.toBeInstanceOf(UnauthorizedRoleError)
        expect((await runtime.get(c.id))?.status).toBe('resolver_active')
    })

    // ─── answerClarification identity enforcement ─────────────────────

    it('non-writer cannot call answerClarification', async () => {
        const c = makeContract()
        await runtime.create(c)
        await runtime.transition(c.id, 'active', agentWriter())
        await runtime.transition(c.id, 'waiting_approval', agentWriter())
        await runtime.transition(c.id, 'resolver_active', humanResolver())
        await runtime.askClarification(c.id, 'What was their price?', 'owner')
        await expect(
            runtime.answerClarification(c.id, 'Some answer.', 'owner')
        ).rejects.toBeInstanceOf(UnauthorizedRoleError)
        expect((await runtime.get(c.id))?.status).toBe('clarifying')
    })
})
