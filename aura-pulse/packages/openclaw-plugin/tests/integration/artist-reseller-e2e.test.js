/**
 * integration/artist-reseller-e2e.test.js
 *
 * Single hermetic, sequential end-to-end test for the artist-reseller flow.
 * All six beats execute within one `it()` block to enforce ordering and shared state.
 *
 * Beat 1 — aura_surface_decision called with offer-received context (simulates Gmail hook)
 * Beat 2 — Contract persisted in SQLite; gmail_thread_id and buyer_id present in context
 * Beat 3 — WebSocket client connects; 'decision' card pushed with correct payload
 * Beat 4 — 'engage' message sent; contract transitions to resolver_active
 * Beat 5 — 'resolve' message sent with token + counter offer; runtime.resume() fires
 * Beat 6 — contract is in `executing` after resolve; resume.artifacts present;
 *           Engram POST body contains correct tags
 *
 * External I/O mocked:
 *   global fetch  → Engram POST /v1/memories
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join }               from 'node:path'
import { tmpdir }             from 'node:os'
import { createServer }       from 'node:net'
import WebSocket              from 'ws'

import { ContractRuntimeService } from '../../src/services/contract-runtime-service.js'
import { WebSocketService }        from '../../src/services/websocket-service.js'
import { EngramCompletionBridge }  from '../../src/services/completion-bridge.js'
import { buildSurfaceDecision }    from '../../src/tools/aura-surface-decision.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fakeLogger = {
    debug: /** @param {unknown[]} a */ (...a) => void a,
    info:  /** @param {unknown[]} a */ (...a) => void a,
    warn:  console.warn.bind(console),
    error: console.error.bind(console),
}

/**
 * @param {string} dir
 * @param {number} port
 * @returns {import('../../src/config/schema.js').AuraPluginConfig}
 */
function makeCfg(dir, port) {
    return {
        auraRoot:            dir,
        workspaceId:         'ar-e2e',
        wsPort:              port,
        signalDebounceMs:    50,
        engramBridgeEnabled: true,
        engramHttpUrl:       'http://localhost:4318',
        pulseStaticDir:      null,
        projectRootOverride: null,
        accountIds:          { gmail: 'studio-ops@gmail.com' },
    }
}

/** @returns {Promise<number>} */
function getFreePort() {
    return new Promise((resolve, reject) => {
        const srv = createServer()
        srv.listen(0, () => {
            const { port } = /** @type {{ port: number }} */ (srv.address())
            srv.close(() => resolve(port))
        })
        srv.on('error', reject)
    })
}

/**
 * Resolve once `predicate` returns true for a received message, or reject after `timeout` ms.
 *
 * @param {WebSocket} ws
 * @param {(msg: unknown) => boolean} predicate
 * @param {number} [timeout]
 * @returns {Promise<unknown>}
 */
function waitForMessage(ws, predicate, timeout = 4000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('waitForMessage timed out')), timeout)
        const handler = (/** @type {Buffer | string} */ raw) => {
            let msg
            try { msg = JSON.parse(raw.toString()) } catch { return }
            if (predicate(msg)) {
                clearTimeout(timer)
                ws.off('message', handler)
                resolve(msg)
            }
        }
        ws.on('message', handler)
        ws.once('error', (err) => { clearTimeout(timer); reject(err) })
    })
}

/** @param {WebSocket} ws @returns {Promise<void>} */
function wsOpen(ws) {
    return new Promise((resolve, reject) => {
        ws.once('open', resolve)
        ws.once('error', reject)
    })
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const HOOK_CONTEXT = {
    platform:         'poshmark',
    listing_id:       'posh-listing-001',
    listing_title:    "Vintage Levi's Jacket",
    buyer_id:         'buyer-susie-q',
    offer_amount:     30,
    asking_price:     50,
    gmail_thread_id:  'thread-abc123',
    gmail_message_id: 'msg-def456',
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('artist-reseller — five-beat E2E (+executing check)', () => {
    /** @type {string} */
    let dir
    /** @type {number} */
    let port
    /** @type {ContractRuntimeService} */
    let runtimeSvc
    /** @type {WebSocketService} */
    let wsSvc
    /** @type {WebSocket | null} */
    let ws

    beforeEach(async () => {
        dir  = mkdtempSync(join(tmpdir(), 'aura-ar-e2e-'))
        port = await getFreePort()
        ws   = null

        vi.stubEnv('AURA_ENGRAM_AUTH_TOKEN', 'engram-test-token')
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 201 }))
    })

    afterEach(async () => {
        ws?.close()
        ws = null
        await wsSvc?.stop().catch(() => {})
        await runtimeSvc?.stop().catch(() => {})
        try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
        vi.restoreAllMocks()
        vi.unstubAllEnvs()
    })

    it('beats 1-6: Gmail hook → contract → surface → engage → resolve → executing + Engram', async () => {
        // -----------------------------------------------------------------------
        // Wire services — use the real EngramCompletionBridge as the notifier
        // so Beat 6 can assert on the actual Engram POST.
        // -----------------------------------------------------------------------
        const cfg    = makeCfg(dir, port)
        const bridge = new EngramCompletionBridge(cfg, fakeLogger)
        runtimeSvc   = new ContractRuntimeService(cfg, bridge)
        await runtimeSvc.start()

        const runtime = runtimeSvc.getRuntime()
        const storage = runtimeSvc.getStorage()
        const paths   = runtimeSvc.getPaths()

        wsSvc = new WebSocketService(cfg, runtime, storage, paths.signalPath, fakeLogger)
        await wsSvc.start()

        // -----------------------------------------------------------------------
        // Beat 1 — Simulate Gmail hook delivering an offer-received event.
        // In production, the OpenClaw hook mapping calls the agent which calls
        // aura_surface_decision. We invoke the tool directly here.
        // -----------------------------------------------------------------------
        const surface      = buildSurfaceDecision(runtime)
        const createResult = await surface.execute('hook-beat1', {
            type:    'offer-received',
            goal:    'Handle Poshmark offer from buyer-susie-q on Vintage Levi\'s Jacket',
            trigger: 'gmail-hook',
            context: HOOK_CONTEXT,
            summary: 'Buyer offered $30 — asking $50. Counter or decline?',
            actions: [
                { id: 'counter', label: 'Counter offer' },
                { id: 'decline', label: 'Decline' },
            ],
        })

        const { contractId } = JSON.parse(createResult.content[0].text)
        expect(contractId, 'Beat 1: surface tool must return a contractId').toBeDefined()

        // -----------------------------------------------------------------------
        // Beat 2 — Contract is persisted in SQLite with the full context.
        // -----------------------------------------------------------------------
        const persisted = await runtime.get(contractId)

        expect(persisted, 'Beat 2: contract must exist in SQLite').not.toBeNull()
        expect(persisted.type).toBe('offer-received')
        expect(persisted.status).toBe('waiting_approval')
        expect(persisted.intent.context['buyer_id']).toBe('buyer-susie-q')
        expect(persisted.intent.context['gmail_thread_id']).toBe('thread-abc123')

        // -----------------------------------------------------------------------
        // Beat 3 — WebSocket 'decision' card pushed containing the contract.
        // -----------------------------------------------------------------------
        ws = new WebSocket(`ws://localhost:${port}`)
        const decisionPromise = waitForMessage(ws, (m) => /** @type {any} */ (m).type === 'decision')
        await wsOpen(ws)

        const decisionMsg = /** @type {any} */ (await decisionPromise)
        expect(decisionMsg.payload.contract.id).toBe(contractId)
        expect(decisionMsg.payload.contract.intent.context['buyer_id']).toBe('buyer-susie-q')
        expect(decisionMsg.payload.resumeToken, 'Beat 3: decision card must carry a resumeToken').toBeDefined()

        const resumeToken = decisionMsg.payload.resumeToken

        // -----------------------------------------------------------------------
        // Beat 4 — Resolver engages: contract transitions to resolver_active.
        // -----------------------------------------------------------------------
        const engagePromise = waitForMessage(ws, (m) => /** @type {any} */ (m).type === 'surface_update')
        ws.send(JSON.stringify({ type: 'engage', payload: { contractId } }))
        await engagePromise

        const engaged = await runtime.get(contractId)
        expect(engaged.status, 'Beat 4: contract must be resolver_active after engage').toBe('resolver_active')

        // -----------------------------------------------------------------------
        // Beat 5 — Resolver commits with a counter offer and send_response=true.
        // -----------------------------------------------------------------------
        const clearPromise = waitForMessage(ws, (m) => /** @type {any} */ (m).type === 'clear')

        ws.send(JSON.stringify({
            type: 'resolve',
            payload: {
                contractId,
                token:  resumeToken,
                action: 'counter',
                artifacts: {
                    counter_amount: 40,
                    send_response:  true,
                    response_body:  "How about $40? I can do that for a great piece.",
                },
            },
        }))

        await clearPromise

        // -----------------------------------------------------------------------
        // Beat 6a — Contract is now in `executing`. The backend handed off to the
        // agent. Assert the state and that resume.artifacts are present for the
        // agent to act on. (Phase 5: ContractExecutor.wake() will pick this up.)
        // -----------------------------------------------------------------------
        const executing = await runtime.get(contractId)
        expect(executing.status, 'Beat 6a: contract must be executing after resolve').toBe('executing')

        const artifacts = executing.resume?.artifacts ?? {}
        expect(artifacts['send_response'], 'Beat 6a: resume.artifacts must include send_response').toBe(true)
        expect(artifacts['response_body'], 'Beat 6a: resume.artifacts must include response_body').toBeDefined()
        expect(executing.intent.context['gmail_thread_id'], 'Beat 6a: context must carry gmail_thread_id for agent use').toBe('thread-abc123')

        // -----------------------------------------------------------------------
        // Drive contract to complete so the Engram notifier fires.
        // In production the agent calls aura_complete_contract after doing the work.
        // -----------------------------------------------------------------------
        await runtime.transition(contractId, 'complete', { id: 'agent-primary', type: 'agent' })
        // Give the completion bridge time to fire its async fetch.
        await new Promise((r) => setTimeout(r, 300))

        // -----------------------------------------------------------------------
        // Beat 6b — Engram POST contains buyer and platform tags.
        // -----------------------------------------------------------------------
        const fetchMock = vi.mocked(fetch)
        const engramCalls = fetchMock.mock.calls.filter(
            ([url]) => typeof url === 'string' && url.includes('/engram/v1/memories')
        )
        expect(engramCalls.length, 'Beat 6b: EngramCompletionBridge must POST to /engram/v1/memories').toBeGreaterThan(0)

        const engramBody = JSON.parse(/** @type {any} */ (engramCalls[0][1]).body)
        expect(engramBody.idempotencyKey).toBe(contractId)
        expect(engramBody.tags).toContain('aura-contract')
        expect(engramBody.tags).toContain('type:offer-received')
        expect(engramBody.tags).toContain(`id:${contractId}`)
        expect(engramBody.tags).toContain('buyer_id:buyer-susie-q')
        expect(engramBody.tags).toContain('platform:poshmark')
        expect(engramBody.tags).toContain('action:counter')
        expect(engramBody.content).toContain('buyer_id: buyer-susie-q')
        expect(engramBody.content).toContain('platform: poshmark')
    })
})
