/**
 * integration/websocket.test.js
 *
 * Tests the WebSocketService: server lifecycle, bootstrap push on connect,
 * and broadcast to multiple connected clients.
 *
 * Uses a real ws client against a locally-started server on a free port.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createServer }   from 'node:net'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join }           from 'node:path'
import { tmpdir }         from 'node:os'
import WebSocket          from 'ws'
import { makeMockRuntime, makeMockStorage }  from '../../src/test-support/mock-runtime.js'
import { WebSocketService } from '../../src/services/websocket-service.js'

/**
 * Find a free TCP port.
 *
 * @returns {Promise<number>}
 */
function getFreePort() {
    return new Promise((resolve, reject) => {
        const srv = createServer()
        srv.listen(0, () => {
            const { port } = /** @type {any} */ (srv.address())
            srv.close(() => resolve(port))
        })
        srv.on('error', reject)
    })
}

const fakeLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }

/**
 * Open a WebSocket and wait for it to be connected.
 *
 * @param {number} port
 * @returns {Promise<WebSocket>}
 */
function openWs(port) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://localhost:${port}`)
        ws.once('open',  () => resolve(ws))
        ws.once('error', reject)
    })
}

/**
 * Collect the next N messages from a WebSocket.
 *
 * @param {WebSocket} ws
 * @param {number} n
 * @param {number} [timeout]
 * @returns {Promise<object[]>}
 */
function collectMessages(ws, n, timeout = 2000) {
    return new Promise((resolve, reject) => {
        const msgs = /** @type {object[]} */ ([])
        const timer = setTimeout(() => resolve(msgs), timeout)
        ws.on('message', raw => {
            try { msgs.push(JSON.parse(raw.toString())) } catch { /* ignore */ }
            if (msgs.length >= n) { clearTimeout(timer); resolve(msgs) }
        })
        ws.once('error', e => { clearTimeout(timer); reject(e) })
    })
}

/**
 * @param {any} message
 * @returns {string | undefined}
 */
function getDecisionContractId(message) {
    return message?.payload?.contract?.id ?? message?.payload?.id
}

/**
 * Build a minimal AuraPluginConfig for the WebSocket service.
 *
 * @param {number} port
 * @returns {any}
 */
function makeCfg(port) {
    return {
        wsPort: port,
        signalDebounceMs: 50,
        auraRoot: '~/.aura',
        workspaceId: 'test',
        engramBridgeEnabled: false,
        engramHttpUrl: 'http://localhost:4318',
        pulseStaticDir: null,
        projectRootOverride: null,
        workspaceDir: process.cwd(),
        bootstrapEnabled: false,
        openClawConfigPath: null,
        accountIds: {},
        ttl: {
            checkIntervalMs: 60000,
            resolverTimeoutMs: 600000,
            completeRetentionDays: 30,
            failedRetentionDays: 7,
        },
    }
}

describe('WebSocketService', () => {
    let port       = 0
    let svc        = /** @type {WebSocketService|null} */ (null)
    let ws         = /** @type {WebSocket|null} */ (null)
    let tmpDir     = ''
    let signalPath = ''

    beforeEach(async () => {
        port       = await getFreePort()
        tmpDir     = mkdtempSync(join(tmpdir(), 'aura-ws-test-'))
        signalPath = join(tmpDir, '.signal')
        writeFileSync(signalPath, '', 'utf8')
    })

    afterEach(async () => {
        if (ws?.readyState === WebSocket.OPEN) ws.close()
        if (svc) { await svc.stop().catch(() => {}); svc = null }
        if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
        vi.restoreAllMocks()
    })

    it('starts and accepts a connection', async () => {
        const { runtime, storage } = makeMockRuntime()
        svc = new WebSocketService(makeCfg(port), runtime, storage, signalPath, fakeLogger)
        await svc.start()

        ws = await openWs(port)
        expect(ws.readyState).toBe(WebSocket.OPEN)
    })

    it('sends bootstrap "decision" messages for pending contracts on connect', async () => {
        const { runtime, store } = makeMockRuntime()
        const CONTRACT_ID = 'boot-contract-1'
        store.contracts.set(CONTRACT_ID, {
            id: CONTRACT_ID, status: 'waiting_approval', type: 'offer-received',
            created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
            participants: { writer: { id: 'a', type: 'agent' }, resolver: { id: 'h', type: 'human' } },
            intent: { goal: 'g', trigger: 't', context: {} },
        })
        const { storage } = makeMockStorage()

        svc = new WebSocketService(makeCfg(port), runtime, storage, signalPath, fakeLogger)
        await svc.start()

        ws = new WebSocket(`ws://localhost:${port}`)
        const messagesPromise = collectMessages(ws, 1, 2000)
        await new Promise((resolve, reject) => {
            ws.once('open', resolve)
            ws.once('error', reject)
        })
        const msgs = await messagesPromise

        const decisionMsg = msgs.find(m => m.type === 'decision')
        expect(decisionMsg).toBeTruthy()
        expect(getDecisionContractId(decisionMsg)).toBe(CONTRACT_ID)
    })

    it('broadcasts to all connected clients', async () => {
        const { runtime, storage } = makeMockRuntime()
        svc = new WebSocketService(makeCfg(port), runtime, storage, signalPath, fakeLogger)
        await svc.start()

        const ws1 = await openWs(port)
        const ws2 = await openWs(port)

        const collected1 = collectMessages(ws1, 1, 1000)
        const collected2 = collectMessages(ws2, 1, 1000)

        svc.broadcast({ type: 'test-broadcast', payload: { hello: true } })

        const [m1, m2] = await Promise.all([collected1, collected2])
        const find = (msgs) => msgs.find(m => m.type === 'test-broadcast')
        expect(find(m1)).toBeTruthy()
        expect(find(m2)).toBeTruthy()

        ws1.close()
        ws2.close()
    })

    it('marks connector active and broadcasts connector_complete on complete_connector', async () => {
        const { runtime, storage, store } = makeMockRuntime()
        store.connectors.set('gmail', {
            id: 'gmail',
            source: 'aura-connector',
            status: 'pending',
            offered_at: new Date().toISOString(),
            capability_without: 'Aura cannot send the kickoff email automatically.',
            capability_with: 'Aura can send the kickoff email automatically.',
            updated_at: new Date().toISOString(),
        })

        svc = new WebSocketService(makeCfg(port), runtime, storage, signalPath, fakeLogger)
        await svc.start()

        ws = await openWs(port)
        const messagesPromise = collectMessages(ws, 1, 2000)

        ws.send(JSON.stringify({
            type: 'complete_connector',
            payload: {
                connectorId: 'gmail',
                credentials: { key: 'secret-123' },
            },
        }))

        const msgs = await messagesPromise
        const completed = msgs.find(m => m.type === 'connector_complete')
        expect(completed).toBeTruthy()
        expect(completed?.payload?.connectorId).toBe('gmail')
        expect(completed?.payload?.status).toBe('active')

        const connector = store.connectors.get('gmail')
        expect(connector?.status).toBe('active')
        expect(connector?.connected_at).toBeTruthy()
    })

    it('stops the server cleanly', async () => {
        const { runtime, storage } = makeMockRuntime()
        svc = new WebSocketService(makeCfg(port), runtime, storage, signalPath, fakeLogger)
        await svc.start()
        await expect(svc.stop()).resolves.toBeUndefined()
        svc = null
    })
})
