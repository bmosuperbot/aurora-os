import { describe, it, expect, vi } from 'vitest'

import { ContractExecutor, resolveMainSessionKey, substituteTokens } from '../../src/services/contract-executor.js'

const contract = {
    id: 'contract-123',
    type: 'offer-received',
    intent: {
        goal: 'Fallback goal',
        trigger: 'test',
        context: {
            gmail_thread_id: 'thread-abc123',
            listing_title: 'Vintage Jacket',
        },
    },
    resume: {
        action: 'counter',
        resolver_id: 'owner',
        timestamp: new Date().toISOString(),
        artifacts: {
            response_body: 'How about $40?',
        },
    },
    complete_requires: ['email_response_sent'],
}

describe('ContractExecutor', () => {
    it('substitutes template tokens and leaves unknown tokens intact', () => {
        expect(substituteTokens('Thread {{gmail_thread_id}} / {{missing}}', contract.intent.context)).toBe('Thread thread-abc123 / {{missing}}')
    })

    it('derives the main session key from OpenClaw config', () => {
        expect(resolveMainSessionKey({
            agents: { list: [{ id: 'main', default: true }] },
            session: { scope: 'agent', mainKey: 'main' },
        })).toBe('agent:main:main')
    })

    it('queues a system event and heartbeat when a contract enters executing', async () => {
        const enqueueSystemEvent = vi.fn().mockResolvedValue(undefined)
        const requestHeartbeatNow = vi.fn()
        const writeAutonomousLog = vi.fn().mockResolvedValue(undefined)

        const executor = new ContractExecutor({
            api: {
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
            },
            auraRoot: '/tmp/nonexistent-aura-root',
            storage: { writeAutonomousLog },
            logger: { info: () => {}, warn: () => {}, error: () => {} },
        })

        await executor.onExecuting(contract)

        expect(enqueueSystemEvent).toHaveBeenCalledTimes(1)
        expect(enqueueSystemEvent.mock.calls[0][0]).toContain('thread-abc123')
        expect(enqueueSystemEvent.mock.calls[0][0]).toContain('contract-123')
        expect(enqueueSystemEvent.mock.calls[0][1]).toEqual({ sessionKey: 'agent:main:main' })
        expect(requestHeartbeatNow).toHaveBeenCalledWith({
            sessionKey: 'agent:main:main',
            reason: 'executor:contract-123',
        })
        expect(writeAutonomousLog).toHaveBeenCalledTimes(1)
        expect(writeAutonomousLog.mock.calls[0][0].action).toBe('executor_wake')
    })

    it('swallows wake failures and logs a warning', async () => {
        const warn = vi.fn()
        const executor = new ContractExecutor({
            api: {
                config: {},
                runtime: {},
                logger: { info: () => {}, warn, error: () => {} },
            },
            auraRoot: '/tmp/nonexistent-aura-root',
            storage: { writeAutonomousLog: vi.fn() },
            logger: { info: () => {}, warn, error: () => {} },
        })

        await expect(executor.onExecuting(contract)).resolves.toBeUndefined()
        expect(warn).toHaveBeenCalled()
    })
})