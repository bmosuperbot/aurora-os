import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ContractRuntimeService } from '../../src/services/contract-runtime-service.js'
import { buildSurfaceDecision } from '../../src/tools/aura-surface-decision.js'
import { buildCli } from '../../src/cli/aura-cli.js'

function makeCfg(dir) {
    return {
        auraRoot:             dir,
        workspaceId:          'test-cli-smoke',
        wsPort:               7702,
        signalDebounceMs:     50,
        engramBridgeEnabled:  false,
        engramHttpUrl:        'http://localhost:4318',
        pulseStaticDir:       null,
        projectRootOverride:  null,
    }
}

const fakeNotifier = { onComplete: async () => {} }

function makeLogger() {
    return { info: () => {}, debug: () => {}, warn: () => {}, error: () => {} }
}

describe('CLI smoke', () => {
    let dir = ''
    let svc = /** @type {ContractRuntimeService|null} */ (null)

    afterEach(async () => {
        if (svc) { await svc.stop().catch(() => {}); svc = null }
        if (dir) rmSync(dir, { recursive: true, force: true })
    })

    it('creates waiting_approval via tool and resumes to executing via CLI token', async () => {
        dir = mkdtempSync(join(tmpdir(), 'aura-cli-smoke-'))
        svc = new ContractRuntimeService(makeCfg(dir), fakeNotifier)
        await svc.start()

        const runtime = svc.getRuntime()
        const storage = svc.getStorage()

        const surfaceDecision = buildSurfaceDecision(runtime)
        const result = await surfaceDecision.execute('smoke-1', {
            type: 'offer-received',
            goal: 'Need owner input',
            trigger: 'Incoming offer',
            context: {
                platform: 'poshmark',
                listing_id: 'listing-1',
                listing_title: 'Vintage Jacket',
                buyer_id: 'buyer-1',
                offer_amount: 30,
                asking_price: 45,
            },
            summary: 'Buyer offered $30 on $45 listing',
        })

        const payload = JSON.parse(result.content[0].text)
        const contractId = payload.contractId

        const waiting = await runtime.get(contractId)
        expect(waiting?.status).toBe('waiting_approval')

        const row = storage._db().prepare('SELECT token FROM resume_tokens WHERE contract_id = ?').get(contractId)
        const token = /** @type {{ token: string }} */ (row).token

        const cli = buildCli({ runtime, storage, logger: makeLogger(), agentId: 'test-agent' })
        await cli.execute(['resume', '--contract', contractId, '--token', token, '--action', 'resolve'])

        const resumed = await runtime.get(contractId)
        expect(resumed?.status).toBe('executing')
        expect(resumed?.resume?.action).toBe('resolve')

        await runtime.transition(contractId, 'complete', { id: 'agent-primary', type: 'agent' })
        expect((await runtime.get(contractId))?.status).toBe('complete')
    })
})
