import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { ContractRuntimeService } from '../../src/services/contract-runtime-service.js'
import { buildSurfaceDecision } from '../../src/tools/aura-surface-decision.js'
import { buildCompleteContract } from '../../src/tools/aura-complete-contract.js'
import { buildLogAction } from '../../src/tools/aura-log-action.js'

const fakeNotifier = { onComplete: async () => {} }

function makeCfg(dir) {
    return {
        auraRoot: dir,
        workspaceId: 'complete-requires',
        wsPort: 7711,
        signalDebounceMs: 50,
        engramBridgeEnabled: false,
        engramHttpUrl: 'http://localhost:4318',
        pulseStaticDir: null,
        projectRootOverride: null,
        workspaceDir: dir,
        accountIds: {},
        ttl: {
            checkIntervalMs: 60000,
            resolverTimeoutMs: 600000,
            completeRetentionDays: 30,
            failedRetentionDays: 7,
        },
    }
}

describe('aura_complete_contract complete_requires', () => {
    let dir = ''
    let svc = null

    afterEach(async () => {
        await svc?.stop().catch(() => {})
        svc = null
        if (dir) rmSync(dir, { recursive: true, force: true })
    })

    it('rejects completion until required actions have been logged', async () => {
        dir = mkdtempSync(join(tmpdir(), 'aura-complete-requires-'))
        svc = new ContractRuntimeService(makeCfg(dir), fakeNotifier)
        await svc.start()

        const runtime = svc.getRuntime()
        const storage = svc.getStorage()
        const surface = buildSurfaceDecision(runtime)
        const logAction = buildLogAction(runtime)
        const complete = buildCompleteContract(runtime, storage)

        const created = await surface.execute('surface-1', {
            type: 'offer-received',
            goal: 'Handle marketplace offer',
            trigger: 'test-hook',
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

        const blocked = await complete.execute('complete-1', {
            contract_id: contractId,
            summary: 'Sent response',
        })

        expect(blocked.isError).toBe(true)
        expect(JSON.parse(blocked.content[0].text).missing).toEqual(['email_response_sent'])
        expect((await runtime.get(contractId))?.status).toBe('executing')

        await logAction.execute('log-1', {
            action: 'email_response_sent',
            summary: 'Sent buyer reply',
            contract_id: contractId,
            connector_used: 'gmail',
        })

        const completed = await complete.execute('complete-2', {
            contract_id: contractId,
            summary: 'Buyer reply sent',
        })

        expect(completed.isError).toBeUndefined()
        const finalContract = await runtime.get(contractId)
        expect(finalContract?.status).toBe('complete')
        expect(finalContract?.result?.summary).toBe('Buyer reply sent')
    })
})