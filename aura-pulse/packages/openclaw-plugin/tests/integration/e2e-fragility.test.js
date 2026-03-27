import { describe, it, expect, afterEach } from 'vitest'
import { createServer } from 'node:net'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import WebSocket from 'ws'

import { ContractRuntimeService } from '../../src/services/contract-runtime-service.js'
import { WebSocketService } from '../../src/services/websocket-service.js'
import { buildSurfaceDecision } from '../../src/tools/aura-surface-decision.js'
import { buildCli } from '../../src/cli/aura-cli.js'
import { LockManager } from '../../src/fs/locks.js'
import { FileBridgeWatcher } from '../../src/services/file-bridge-watcher.js'
import { buildFsWrite } from '../../src/tools/aura-fs-write.js'
import { buildFsPatch } from '../../src/tools/aura-fs-patch.js'
import { buildFsMove } from '../../src/tools/aura-fs-move.js'
import { buildFsArchive } from '../../src/tools/aura-fs-archive.js'

const fakeNotifier = { onComplete: async () => {} }
const fakeLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }

function makeCfg(dir, port) {
    return {
        auraRoot:            dir,
        workspaceId:         'e2e-fragility',
        wsPort:              port,
        signalDebounceMs:    50,
        engramBridgeEnabled: false,
        engramHttpUrl:       'http://localhost:4318',
        pulseStaticDir:      null,
        projectRootOverride: null,
    }
}

function makeContractContext(index) {
    return {
        platform: 'poshmark',
        listing_id: `listing-${index}`,
        listing_title: `Listing ${index}`,
        buyer_id: `buyer-${index}`,
        offer_amount: 30,
        asking_price: 45,
    }
}

function getFreePort() {
    return new Promise((resolve, reject) => {
        const server = createServer()
        server.listen(0, () => {
            const address = /** @type {{ port: number }} */ (server.address())
            server.close(() => resolve(address.port))
        })
        server.on('error', reject)
    })
}

function collectMessages(ws, n, timeout = 2500) {
    return new Promise((resolve, reject) => {
        const messages = []
        const timer = setTimeout(() => resolve(messages), timeout)

        ws.on('message', (raw) => {
            try {
                messages.push(JSON.parse(raw.toString()))
            } catch {
                // Ignore malformed messages.
            }

            if (messages.length >= n) {
                clearTimeout(timer)
                resolve(messages)
            }
        })

        ws.once('error', (err) => {
            clearTimeout(timer)
            reject(err)
        })
    })
}

/**
 * @param {any} message
 * @returns {string | undefined}
 */
function getDecisionContractId(message) {
    return message?.payload?.contract?.id ?? message?.payload?.id
}

describe('E2E fragility scenarios', () => {
    /** @type {Array<() => Promise<void>>} */
    let cleanups = []

    afterEach(async () => {
        for (const cleanup of cleanups.reverse()) {
            await cleanup().catch(() => {})
        }
        cleanups = []
    })

    it('handles burst pending contracts and reconnect bootstrap delivery', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'aura-e2e-burst-'))
        const port = await getFreePort()
        const svc = new ContractRuntimeService(makeCfg(dir, port), fakeNotifier)
        await svc.start()
        cleanups.push(async () => svc.stop())
        cleanups.push(async () => rmSync(dir, { recursive: true, force: true }))

        const runtime = svc.getRuntime()
        const storage = svc.getStorage()
        const paths = svc.getPaths()

        const wsService = new WebSocketService(makeCfg(dir, port), runtime, storage, paths.signalPath, fakeLogger)
        await wsService.start()
        cleanups.push(async () => wsService.stop())

        const surface = buildSurfaceDecision(runtime)
        const ids = []
        for (let i = 0; i < 5; i++) {
            const res = await surface.execute(`burst-${i}`, {
                type: 'offer-received',
                goal: `Goal ${i}`,
                trigger: `Trigger ${i}`,
                context: makeContractContext(i),
                summary: `Offer ${i}`,
            })
            const payload = JSON.parse(res.content[0].text)
            ids.push(payload.contractId)
        }

        const ws1 = new WebSocket(`ws://localhost:${port}`)
        const firstBatchPromise = collectMessages(ws1, 5, 3000)
        await new Promise((resolve, reject) => {
            ws1.once('open', resolve)
            ws1.once('error', reject)
        })
        const firstBatch = await firstBatchPromise
        ws1.close()

        const firstDecisionIds = firstBatch
            .filter((m) => m.type === 'decision')
            .map((m) => getDecisionContractId(m))

        for (const id of ids) {
            expect(firstDecisionIds).toContain(id)
        }

        const ws2 = new WebSocket(`ws://localhost:${port}`)
        const secondBatchPromise = collectMessages(ws2, 5, 3000)
        await new Promise((resolve, reject) => {
            ws2.once('open', resolve)
            ws2.once('error', reject)
        })
        const secondBatch = await secondBatchPromise
        ws2.close()

        const secondDecisionIds = secondBatch
            .filter((m) => m.type === 'decision')
            .map((m) => getDecisionContractId(m))

        for (const id of ids) {
            expect(secondDecisionIds).toContain(id)
        }
    })

    it('enforces single-token semantics under concurrent resolve attempts', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'aura-e2e-cli-race-'))
        const port = await getFreePort()
        const svc = new ContractRuntimeService(makeCfg(dir, port), fakeNotifier)
        await svc.start()
        cleanups.push(async () => svc.stop())
        cleanups.push(async () => rmSync(dir, { recursive: true, force: true }))

        const runtime = svc.getRuntime()
        const storage = svc.getStorage()

        const surface = buildSurfaceDecision(runtime)
        const res = await surface.execute('cli-race', {
            type: 'offer-received',
            goal: 'Need resolver action',
            trigger: 'Offer arrived',
            context: makeContractContext(999),
            summary: 'Offer race test',
        })
        const payload = JSON.parse(res.content[0].text)
        const contractId = payload.contractId

        const row = storage._db().prepare('SELECT token FROM resume_tokens WHERE contract_id = ?').get(contractId)
        const token = /** @type {{ token: string }} */ (row).token

        const cli = buildCli({ runtime, storage, logger: fakeLogger, agentId: 'test-agent' })
        const [a, b] = await Promise.allSettled([
            cli.execute(['resume', '--contract', contractId, '--token', token, '--action', 'resolve']),
            cli.execute(['resume', '--contract', contractId, '--token', token, '--action', 'resolve']),
        ])

        const rejectedCount = [a, b].filter((r) => r.status === 'rejected').length
        expect(rejectedCount).toBeGreaterThanOrEqual(1)

        const latest = await runtime.get(contractId)
        expect(latest?.status).toBe('executing')
        expect(latest?.resume?.action).toBe('resolve')
    })

    it('survives chained filesystem operations and preserves autonomous audit trail', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'aura-e2e-fs-chain-'))
        const port = await getFreePort()
        const svc = new ContractRuntimeService(makeCfg(dir, port), fakeNotifier)
        await svc.start()
        cleanups.push(async () => svc.stop())
        cleanups.push(async () => rmSync(dir, { recursive: true, force: true }))

        const runtime = svc.getRuntime()
        const storage = svc.getStorage()
        const paths = svc.getPaths()

        const locks = new LockManager(storage, fakeLogger)
        const fsWrite = buildFsWrite(paths, locks, runtime, 'test-agent')
        const fsPatch = buildFsPatch(paths, locks, runtime, 'test-agent')
        const fsMove = buildFsMove(paths, locks, runtime, 'test-agent')
        const fsArchive = buildFsArchive(paths, locks, runtime, 'test-agent')

        await fsWrite.execute('fs-1', { path: 'projects/demo.md', content: 'hello world\n' })
        await fsPatch.execute('fs-2', {
            path: 'projects/demo.md',
            patches: [{ search: 'hello world', replace: 'hardened world' }],
        })
        await fsMove.execute('fs-3', { source: 'projects/demo.md', destination: 'areas/demo.md' })
        await fsArchive.execute('fs-4', { path: 'areas/demo.md' })

        expect(existsSync(join(paths.projectsDir, 'areas', 'demo.md'))).toBe(false)

        const archivedEntries = storage.queryAutonomousLog
            ? await storage.queryAutonomousLog({ package: 'aura-pulse' })
            : []

        const actions = archivedEntries.map((entry) => entry.action)
        expect(actions).toContain('fs_write')
        expect(actions).toContain('fs_patch')
        expect(actions).toContain('fs_move')
        expect(actions).toContain('fs_archive')
    })

    it('detects external-write conflict when file is locked and logs conflict entry', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'aura-e2e-ext-conflict-'))
        const port = await getFreePort()
        const svc = new ContractRuntimeService(makeCfg(dir, port), fakeNotifier)
        await svc.start()
        cleanups.push(async () => svc.stop())
        cleanups.push(async () => rmSync(dir, { recursive: true, force: true }))

        const storage = svc.getStorage()
        const paths = svc.getPaths()

        const targetAbs = join(paths.projectsDir, 'projects', 'conflict.md')
        writeFileSync(targetAbs, 'v1\n', 'utf8')

        const locks = new LockManager(storage, fakeLogger)
        await locks.acquire(targetAbs, 'agent-primary', 'patch')

        const watcher = new FileBridgeWatcher(paths.projectsDir, storage, fakeLogger, () => {})
        await watcher._onChange(targetAbs, 'change')

        const logs = await storage.queryAutonomousLog({ package: 'aura-pulse' })
        const conflict = logs.find((entry) => entry.action === 'external_file_conflict' && entry.detail?.path === targetAbs)
        expect(conflict).toBeTruthy()

        await locks.release(targetAbs)
    })

    it('chaos: sustains high-volume decision burst with complete bootstrap replay', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'aura-e2e-chaos-burst-'))
        const port = await getFreePort()
        const svc = new ContractRuntimeService(makeCfg(dir, port), fakeNotifier)
        await svc.start()
        cleanups.push(async () => svc.stop())
        cleanups.push(async () => rmSync(dir, { recursive: true, force: true }))

        const runtime = svc.getRuntime()
        const storage = svc.getStorage()
        const paths = svc.getPaths()

        const wsService = new WebSocketService(makeCfg(dir, port), runtime, storage, paths.signalPath, fakeLogger)
        await wsService.start()
        cleanups.push(async () => wsService.stop())

        const surface = buildSurfaceDecision(runtime)
        const created = []
        for (let i = 0; i < 40; i++) {
            const res = await surface.execute(`chaos-burst-${i}`, {
                type: 'offer-received',
                goal: `Burst goal ${i}`,
                trigger: `Burst trigger ${i}`,
                context: makeContractContext(i + 1000),
                summary: `Burst offer ${i}`,
            })
            const payload = JSON.parse(res.content[0].text)
            created.push(payload.contractId)
        }

        const pending = await runtime.getPending()
        expect(pending.length).toBe(40)

        const ws = new WebSocket(`ws://localhost:${port}`)
        const bootstrapPromise = collectMessages(ws, 40, 8000)
        await new Promise((resolve, reject) => {
            ws.once('open', resolve)
            ws.once('error', reject)
        })
        const bootstrap = await bootstrapPromise
        ws.close()

        const decisionIds = bootstrap
            .filter((m) => m.type === 'decision')
            .map((m) => getDecisionContractId(m))

        expect(decisionIds.length).toBe(40)
        for (const id of created) {
            expect(decisionIds).toContain(id)
        }
    })

    it('chaos: websocket churn under active writes does not lose pending state', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'aura-e2e-chaos-churn-'))
        const port = await getFreePort()
        const svc = new ContractRuntimeService(makeCfg(dir, port), fakeNotifier)
        await svc.start()
        cleanups.push(async () => svc.stop())
        cleanups.push(async () => rmSync(dir, { recursive: true, force: true }))

        const runtime = svc.getRuntime()
        const storage = svc.getStorage()
        const paths = svc.getPaths()

        const wsService = new WebSocketService(makeCfg(dir, port), runtime, storage, paths.signalPath, fakeLogger)
        await wsService.start()
        cleanups.push(async () => wsService.stop())

        const surface = buildSurfaceDecision(runtime)
        const created = []
        for (let i = 0; i < 10; i++) {
            const ws = new WebSocket(`ws://localhost:${port}`)
            await new Promise((resolve, reject) => {
                ws.once('open', resolve)
                ws.once('error', reject)
            })

            const res = await surface.execute(`churn-${i}`, {
                type: 'offer-received',
                goal: `Churn goal ${i}`,
                trigger: `Churn trigger ${i}`,
                context: makeContractContext(i + 2000),
                summary: `Churn offer ${i}`,
            })
            const payload = JSON.parse(res.content[0].text)
            created.push(payload.contractId)

            ws.close()
            await new Promise((resolve) => setTimeout(resolve, 15))
        }

        const pending = await runtime.getPending()
        const pendingIds = pending.map((c) => c.id)
        expect(pending.length).toBe(10)
        for (const id of created) {
            expect(pendingIds).toContain(id)
        }

        const wsFinal = new WebSocket(`ws://localhost:${port}`)
        const finalBatchPromise = collectMessages(wsFinal, 10, 4000)
        await new Promise((resolve, reject) => {
            wsFinal.once('open', resolve)
            wsFinal.once('error', reject)
        })
        const finalBatch = await finalBatchPromise
        wsFinal.close()

        const decisionIds = finalBatch
            .filter((m) => m.type === 'decision')
            .map((m) => getDecisionContractId(m))
        expect(decisionIds.length).toBe(10)
    })

    it('chaos: injected storage interruption fails safely and recovers on retry', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'aura-e2e-chaos-storage-'))
        const port = await getFreePort()
        const svc = new ContractRuntimeService(makeCfg(dir, port), fakeNotifier)
        await svc.start()
        cleanups.push(async () => svc.stop())
        cleanups.push(async () => rmSync(dir, { recursive: true, force: true }))

        const runtime = svc.getRuntime()
        const storage = svc.getStorage()
        const surface = buildSurfaceDecision(runtime)

        const res = await surface.execute('chaos-storage', {
            type: 'offer-received',
            goal: 'Simulate intermittent storage failure',
            trigger: 'Fault injection',
            context: makeContractContext(3000),
            summary: 'Storage fault test',
        })
        const payload = JSON.parse(res.content[0].text)
        const contractId = payload.contractId

        const tokenRow = storage._db().prepare('SELECT token FROM resume_tokens WHERE contract_id = ?').get(contractId)
        const token = /** @type {{ token: string }} */ (tokenRow).token

        const cli = buildCli({ runtime, storage, logger: fakeLogger, agentId: 'test-agent' })

        const internalStorage = /** @type {{ conditionalWrite: Function }} */ (runtime._storage)
        const originalConditionalWrite = internalStorage.conditionalWrite.bind(internalStorage)
        let injected = false
        internalStorage.conditionalWrite = async (contract, fromStatus, options) => {
            if (!injected && options?.consumeResumeToken) {
                injected = true
                throw new Error('injected storage fault')
            }
            return originalConditionalWrite(contract, fromStatus, options)
        }

        try {
            await expect(
                cli.execute(['resume', '--contract', contractId, '--token', token, '--action', 'resolve'])
            ).rejects.toThrow('injected storage fault')

            const afterFault = await runtime.get(contractId)
            expect(afterFault?.status).toBe('resolver_active')

            const stillPresentToken = storage._db().prepare('SELECT token FROM resume_tokens WHERE contract_id = ?').get(contractId)
            expect(/** @type {any} */ (stillPresentToken)?.token).toBe(token)

            await cli.execute(['resume', '--contract', contractId, '--token', token, '--action', 'resolve'])

            const recovered = await runtime.get(contractId)
            expect(recovered?.status).toBe('executing')
            expect(recovered?.resume?.action).toBe('resolve')
        } finally {
            internalStorage.conditionalWrite = originalConditionalWrite
        }
    })
})
