import { describe, expect, it, vi } from 'vitest'

import { PulseCommandRelay } from '../../src/services/pulse-command-relay.js'

function createDeferred() {
    /** @type {(value?: unknown) => void} */
    let resolve
    /** @type {(reason?: unknown) => void} */
    let reject
    const promise = new Promise((res, rej) => {
        resolve = res
        reject = rej
    })

    return {
        promise,
        resolve,
        reject,
    }
}

async function flushMicrotasks() {
    await new Promise((resolve) => setImmediate(resolve))
}

function buildApi(overrides = {}) {
    return {
        config: {},
        runtime: {
            config: {
                loadConfig: async () => ({
                    agents: { list: [{ id: 'main', default: true }] },
                    session: { scope: 'agent', mainKey: 'main' },
                }),
            },
            agent: {
                defaults: {
                    provider: 'ollama',
                    model: 'nemotron-3-nano:4b',
                },
                resolveAgentDir: vi.fn(() => '/tmp/agents/main'),
                resolveAgentWorkspaceDir: vi.fn(() => '/tmp/agents/main/workspace'),
                resolveAgentIdentity: vi.fn(() => ({ name: 'main' })),
                resolveThinkingDefault: vi.fn(() => 'adaptive'),
                runEmbeddedPiAgent: vi.fn().mockResolvedValue({ payloads: [] }),
                resolveAgentTimeoutMs: vi.fn(() => 30_000),
                ensureAgentWorkspace: vi.fn().mockResolvedValue(undefined),
                session: {
                    resolveStorePath: vi.fn(() => '/tmp/agents/main/sessions.json'),
                    loadSessionStore: vi.fn(() => ({})),
                    saveSessionStore: vi.fn().mockResolvedValue(undefined),
                    resolveSessionFilePath: vi.fn(() => '/tmp/agents/main/session.jsonl'),
                },
            },
            ...overrides,
        },
    }
}

function buildLogger() {
    return {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    }
}

describe('PulseCommandRelay', () => {
    it('runs Pulse commands directly inside the dedicated Pulse session', async () => {
        const runEmbeddedPiAgent = vi.fn().mockResolvedValue({ payloads: [] })
        const saveSessionStore = vi.fn().mockResolvedValue(undefined)
        const relay = new PulseCommandRelay(buildApi({
            agent: {
                ...buildApi().runtime.agent,
                runEmbeddedPiAgent,
                session: {
                    ...buildApi().runtime.agent.session,
                    saveSessionStore,
                },
            },
        }), buildLogger())

        const result = await relay.dispatch({
            commandId: 'cmd-1',
            text: 'Render the dashboard',
            modality: 'text',
        })

        await flushMicrotasks()

        expect(saveSessionStore).toHaveBeenCalledTimes(1)
        expect(runEmbeddedPiAgent).toHaveBeenCalledWith(expect.objectContaining({
            sessionKey: 'agent:main:pulse',
            agentId: 'main',
            messageProvider: 'aura-pulse',
            trigger: 'manual',
            senderIsOwner: true,
            provider: 'ollama',
            model: 'nemotron-3-nano:4b',
            thinkLevel: 'adaptive',
            prompt: expect.stringContaining('Render the dashboard'),
        }))
        expect(result).toEqual({
            sessionKey: 'agent:main:pulse',
            message: 'Queued in agent:main:pulse.',
        })
    })

    it('serializes later Pulse commands behind the active direct run', async () => {
        const firstRun = createDeferred()
        const secondRun = createDeferred()
        const runEmbeddedPiAgent = vi.fn()
            .mockReturnValueOnce(firstRun.promise)
            .mockReturnValueOnce(secondRun.promise)

        const relay = new PulseCommandRelay(buildApi({
            agent: {
                ...buildApi().runtime.agent,
                runEmbeddedPiAgent,
            },
        }), buildLogger())

        const firstResult = await relay.dispatch({
            commandId: 'cmd-2',
            text: 'Check inventory',
            modality: 'voice',
        })
        const secondResult = await relay.dispatch({
            commandId: 'cmd-3',
            text: 'Check offers',
            modality: 'text',
        })

        await flushMicrotasks()

        expect(runEmbeddedPiAgent).toHaveBeenCalledTimes(1)
        expect(runEmbeddedPiAgent).toHaveBeenNthCalledWith(1, expect.objectContaining({
            prompt: expect.stringContaining('Check inventory'),
        }))

        firstRun.resolve({ payloads: [] })
        await flushMicrotasks()

        expect(runEmbeddedPiAgent).toHaveBeenCalledTimes(2)
        expect(runEmbeddedPiAgent).toHaveBeenNthCalledWith(2, expect.objectContaining({
            prompt: expect.stringContaining('Check offers'),
        }))

        secondRun.resolve({ payloads: [] })
        await flushMicrotasks()

        expect(firstResult).toEqual({
            sessionKey: 'agent:main:pulse',
            message: 'Queued in agent:main:pulse.',
        })
        expect(secondResult).toEqual({
            sessionKey: 'agent:main:pulse',
            message: 'Queued in agent:main:pulse.',
        })
    })

    it('runs surface actions directly inside the dedicated Pulse session', async () => {
        const runEmbeddedPiAgent = vi.fn().mockResolvedValue({ payloads: [] })
        const relay = new PulseCommandRelay(buildApi({
            agent: {
                ...buildApi().runtime.agent,
                runEmbeddedPiAgent,
            },
        }), buildLogger())

        const result = await relay.dispatchSurfaceAction({
            surfaceId: 'sales-last-week',
            actionName: 'inspect_order',
            sourceComponentId: 'inspect-button',
            context: { orderId: 'A-104', gross: 182 },
        })

        await flushMicrotasks()

        expect(runEmbeddedPiAgent).toHaveBeenCalledWith(expect.objectContaining({
            sessionKey: 'agent:main:pulse',
            prompt: expect.stringContaining('inspect_order'),
        }))
        expect(result).toEqual({
            sessionKey: 'agent:main:pulse',
            message: 'Queued action inspect_order in agent:main:pulse.',
        })
    })

    it('uses configured pulse session keys when present', async () => {
        const runEmbeddedPiAgent = vi.fn().mockResolvedValue({ payloads: [] })
        const relay = new PulseCommandRelay({
            config: {},
            runtime: {
                config: {
                    loadConfig: async () => ({
                        agents: { list: [{ id: 'main', default: true }] },
                        session: { scope: 'agent', mainKey: 'main', pulseKey: 'owner-pulse' },
                    }),
                },
                agent: {
                    ...buildApi().runtime.agent,
                    runEmbeddedPiAgent,
                },
            },
        }, buildLogger())

        const result = await relay.dispatch({
            commandId: 'cmd-4',
            text: 'Show weekly gross sales',
            modality: 'text',
        })

        await flushMicrotasks()

        expect(runEmbeddedPiAgent).toHaveBeenCalledWith(expect.objectContaining({
            sessionKey: 'agent:main:owner-pulse',
            prompt: expect.stringContaining('Show weekly gross sales'),
        }))
        expect(result).toEqual({
            sessionKey: 'agent:main:owner-pulse',
            message: 'Queued in agent:main:owner-pulse.',
        })
    })
})
