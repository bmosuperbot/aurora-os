import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { makeTempRuntime } from '../helpers/temp-db.js'
import { makeGrantContract, agentWriter, directorResolver } from '../helpers/fixtures.js'
import { grantReportDraftType } from '../../src/domain-types/grant-report-draft.js'
import { ContractValidationError } from '../../src/types/errors.js'

describe('grant-report-draft end-to-end', () => {
    let runtime, storage, cleanup
    beforeEach(async () => {
        ;({ runtime, storage, cleanup } = makeTempRuntime())
        await runtime.initialize()
        runtime.registerType(grantReportDraftType)
    })
    afterEach(async () => { await runtime.shutdown(); cleanup() })

    it('rejects creation when deadline is missing', async () => {
        const c = makeGrantContract()
        const ctx = { ...c.intent.context }
        delete ctx.deadline
        c.intent = { ...c.intent, context: ctx }
        await expect(runtime.create(c)).rejects.toBeInstanceOf(ContractValidationError)
    })

    it('runs the full grant-report lifecycle', async () => {
        const contract = makeGrantContract({
            expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
        })

        await runtime.create(contract)
        await runtime.transition(contract.id, 'active', agentWriter())

        await runtime.updateSurface(contract.id, {
            voice_line: 'Q1 grant report for CCC is ready for your review. Deadline is April 15th.',
            summary: 'Q1 2026 grant report compiled from 2 Drive documents.',
            recommendation: {
                action: 'approve_and_submit',
                reasoning: 'All required metrics present. Word count within limit.',
            },
            actions: [
                { id: 'approve', label: 'Approve & Submit', action: 'approve_and_submit', style: 'primary' },
                { id: 'edit', label: 'Edit Draft', action: 'edit', opens_artifact: 'draft', style: 'secondary' },
            ],
            version: 0,
        }, 'agent-primary')

        await runtime.transition(contract.id, 'waiting_approval', agentWriter())
        await runtime.transition(contract.id, 'resolver_active', directorResolver())

        const tokenRow = storage._db()
            .prepare('SELECT token FROM resume_tokens WHERE contract_id = ?')
            .get(contract.id)
        expect(tokenRow).toBeTruthy()

        await runtime.resume(
            contract.id,
            /** @type {any} */ (tokenRow).token,
            directorResolver(),
            'approve_and_submit',
            undefined,
            { edited_report_path: 'projects/ccc-q1-report/draft-v2.md' }
        )
        expect((await runtime.get(contract.id))?.status).toBe('executing')
        expect((await runtime.get(contract.id))?.resume?.artifacts?.edited_report_path)
            .toBe('projects/ccc-q1-report/draft-v2.md')

        let notified = null
        runtime._notifier = { onComplete: async (c) => { notified = c } }
        await runtime.transition(contract.id, 'complete', agentWriter())

        expect((await runtime.get(contract.id))?.status).toBe('complete')
        expect(notified?.id).toBe(contract.id)

        const log = await storage.queryLog(contract.id)
        expect(log.length).toBeGreaterThanOrEqual(4)
    })
})
