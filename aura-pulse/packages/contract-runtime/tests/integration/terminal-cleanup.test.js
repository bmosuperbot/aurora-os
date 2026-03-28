import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { SQLiteContractStorage } from '../../src/storage/sqlite-storage.js'
import { ContractRuntime } from '../../src/runtime/contract-runtime.js'

describe('terminal retention cleanup', () => {
    it('deletes expired complete and failed contracts on TTL tick', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'aura-terminal-cleanup-'))
        const storage = new SQLiteContractStorage(':memory:', join(dir, '.signal'))
        const runtime = new ContractRuntime(storage, undefined, {
            ttl: {
                checkIntervalMs: 60000,
                resolverTimeoutMs: 600000,
                completeRetentionDays: 0,
                failedRetentionDays: 0,
            },
        })

        await runtime.initialize()

        const now = new Date(0).toISOString()
        await storage.write({
            id: 'complete-1',
            version: '1.0',
            type: 'offer-received',
            status: 'complete',
            created_at: now,
            updated_at: now,
            participants: {
                writer: { id: 'agent-primary', type: 'agent' },
                resolver: { id: 'owner', type: 'human' },
            },
            intent: { goal: 'done', trigger: 'test', context: {} },
        })
        await storage.write({
            id: 'failed-1',
            version: '1.0',
            type: 'offer-received',
            status: 'failed',
            created_at: now,
            updated_at: now,
            participants: {
                writer: { id: 'agent-primary', type: 'agent' },
                resolver: { id: 'owner', type: 'human' },
            },
            intent: { goal: 'done', trigger: 'test', context: {} },
        })
        await storage.appendLog({ contract_id: 'complete-1', timestamp: now, participant: 'agent-primary', event: 'transition:executing→complete' })
        await storage.writeAutonomousLog({
            id: 'log-1',
            timestamp: now,
            agent_id: 'agent-primary',
            package: 'aura-pulse',
            action: 'executor_wake',
            summary: 'queued',
            detail: null,
            contract_id: 'complete-1',
            connector_used: 'none',
        })

        await runtime._ttlManager.tick()

        expect(await runtime.get('complete-1')).toBeNull()
        expect(await runtime.get('failed-1')).toBeNull()

        await runtime.shutdown()
        rmSync(dir, { recursive: true, force: true })
    })
})