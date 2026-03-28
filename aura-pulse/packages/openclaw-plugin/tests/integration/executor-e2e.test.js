import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { ContractRuntimeService } from '../../src/services/contract-runtime-service.js'
import { ContractExecutor } from '../../src/services/contract-executor.js'
import { buildSurfaceDecision } from '../../src/tools/aura-surface-decision.js'

const fakeNotifier = { onComplete: async () => {} }

function makeCfg(dir) {
    return {
        auraRoot: dir,
        workspaceId: 'executor-e2e',
        wsPort: 7712,
        signalDebounceMs: 50,
        engramBridgeEnabled: false,
        engramHttpUrl: 'http://localhost:4318',
        pulseStaticDir: null,
        projectRootOverride: null,
        workspaceDir: dir,
        accountIds: { gmail: 'studio-ops@gmail.com' },
        ttl: {
            checkIntervalMs: 60000,
            resolverTimeoutMs: 600000,
            completeRetentionDays: 30,
            failedRetentionDays: 7,
        },
    }
}

describe('ContractExecutor integration', () => {
    let dir = ''
    let svc = null

    afterEach(async () => {
        await svc?.stop().catch(() => {})
        svc = null
        if (dir) rmSync(dir, { recursive: true, force: true })
    })

    it('wakes the main agent session when a contract moves to executing', async () => {
        dir = mkdtempSync(join(tmpdir(), 'aura-executor-e2e-'))
        svc = new ContractRuntimeService(makeCfg(dir), fakeNotifier)
        await svc.start()

        const enqueueSystemEvent = vi.fn().mockResolvedValue(undefined)
        const requestHeartbeatNow = vi.fn()
        const api = {
            config: {},
            runtime: {
                config: {
                    loadConfig: async () => ({
                        agents: { list: [{ id: 'main', default: true }] },
                        session: { scope: 'agent', mainKey: 'main' },
                    }),
                },
                system: {
                    enqueueSystemEvent,
                    requestHeartbeatNow,
                },
            },
            logger: { info: () => {}, warn: () => {}, error: () => {} },
        }

        const executor = new ContractExecutor({
            api,
            auraRoot: dir,
            storage: svc.getStorage(),
            logger: api.logger,
        })
        svc.setExecutionNotifier(executor)

        const runtime = svc.getRuntime()
        const storage = svc.getStorage()
        const surface = buildSurfaceDecision(runtime)

        const created = await surface.execute('surface-1', {
            type: 'offer-received',
            goal: 'Handle marketplace offer',
            trigger: 'gmail-hook',
            context: {
                platform: 'poshmark',
                listing_id: 'listing-1',
                listing_title: 'Vintage Jacket',
                offer_amount: 30,
                asking_price: 50,
                buyer_id: 'buyer-susie-q',
                gmail_thread_id: 'thread-abc123',
            },
            complete_requires: ['email_response_sent'],
        })

        const contractId = JSON.parse(created.content[0].text).contractId
        await runtime.transition(contractId, 'resolver_active', { id: 'owner', type: 'human' })
        const token = await storage.readResumeToken(contractId)
        await runtime.resume(contractId, token, { id: 'owner', type: 'human' }, 'counter', undefined, {
            response_body: 'How about $40?',
        })

        expect(enqueueSystemEvent).toHaveBeenCalledTimes(1)
        expect(enqueueSystemEvent.mock.calls[0][0]).toContain('thread-abc123')
        expect(requestHeartbeatNow).toHaveBeenCalledWith({
            sessionKey: 'agent:main:main',
            reason: `executor:${contractId}`,
        })

        const logs = await storage.queryAutonomousLog({ contract_id: contractId })
        expect(logs.some((entry) => entry.action === 'executor_wake')).toBe(true)
    })
})