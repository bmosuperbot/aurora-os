/**
 * integration/completion-bridge.test.js
 *
 * Tests EngramCompletionBridge — verifies it POSTs to the Engram HTTP API
 * when enabled, skips posting when disabled, and swallows network errors.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { EngramCompletionBridge } from '../../src/services/completion-bridge.js'

/**
 * Build a minimal AuraPluginConfig stub for the bridge.
 *
 * @param {Partial<import('../../src/config/schema.js').AuraPluginConfig>} [overrides]
 * @returns {import('../../src/config/schema.js').AuraPluginConfig}
 */
function makeCfg(overrides = {}) {
    return {
        auraRoot:            '~/.aura',
        workspaceId:         'test',
        wsPort:              7700,
        signalDebounceMs:    75,
        engramBridgeEnabled: true,
        engramHttpUrl:       'http://localhost:4318',
        pulseStaticDir:      null,
        projectRootOverride: null,
        ...overrides,
    }
}

const FAKE_TOKEN    = 'engram-test-token-abc123'
const FAKE_CONTRACT = {
    id:         'contract-test-1',
    type:       'offer-received',
    status:     'completed',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T01:00:00Z',
    participants: {
        writer:   { id: 'agent-primary', type: 'agent' },
        resolver: { id: 'owner',         type: 'human' },
    },
    intent: { goal: 'Test goal', trigger: 'Test trigger', context: {} },
}

describe('EngramCompletionBridge', () => {
    afterEach(() => {
        vi.unstubAllEnvs()
        vi.restoreAllMocks()
    })

    it('POSTs to Engram when enabled and token is present', async () => {
        vi.stubEnv('AURA_ENGRAM_AUTH_TOKEN', FAKE_TOKEN)
        const fetchMock  = vi.fn().mockResolvedValue({ ok: true, status: 201 })
        vi.stubGlobal('fetch', fetchMock)

        const fakeLogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
        const bridge     = new EngramCompletionBridge(makeCfg(), fakeLogger)
        await bridge.onComplete(FAKE_CONTRACT)

        expect(fetchMock).toHaveBeenCalledOnce()
        const [url, opts] = fetchMock.mock.calls[0]
        expect(url).toContain('/engram/v1/memories')
        expect(JSON.parse(opts.body)).toMatchObject({
            content:  expect.any(String),
            category: 'decision',
        })
        expect(opts.headers['Authorization']).toBe(`Bearer ${FAKE_TOKEN}`)
    })

    it('includes idempotencyKey matching the contract id', async () => {
        vi.stubEnv('AURA_ENGRAM_AUTH_TOKEN', FAKE_TOKEN)
        const fetchMock  = vi.fn().mockResolvedValue({ ok: true, status: 201 })
        vi.stubGlobal('fetch', fetchMock)

        const fakeLogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
        const bridge     = new EngramCompletionBridge(makeCfg(), fakeLogger)
        await bridge.onComplete(FAKE_CONTRACT)

        const body = JSON.parse(fetchMock.mock.calls[0][1].body)
        expect(body.idempotencyKey).toBe(FAKE_CONTRACT.id)
    })

    it('skips POST when engramBridgeEnabled is false', async () => {
        vi.stubEnv('AURA_ENGRAM_AUTH_TOKEN', FAKE_TOKEN)
        const fetchMock  = vi.fn()
        vi.stubGlobal('fetch', fetchMock)

        const fakeLogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
        const bridge     = new EngramCompletionBridge(makeCfg({ engramBridgeEnabled: false }), fakeLogger)
        await bridge.onComplete(FAKE_CONTRACT)

        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('skips POST when token is absent', async () => {
        vi.unstubAllEnvs()
        const saved = process.env['AURA_ENGRAM_AUTH_TOKEN']
        process.env['AURA_ENGRAM_AUTH_TOKEN'] = ''
        const fetchMock = vi.fn()
        vi.stubGlobal('fetch', fetchMock)

        const fakeLogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
        const bridge     = new EngramCompletionBridge(makeCfg(), fakeLogger)
        await bridge.onComplete(FAKE_CONTRACT)

        expect(fetchMock).not.toHaveBeenCalled()
        if (saved !== undefined) process.env['AURA_ENGRAM_AUTH_TOKEN'] = saved
        else delete process.env['AURA_ENGRAM_AUTH_TOKEN']
    })

    it('swallows network errors without throwing', async () => {
        vi.stubEnv('AURA_ENGRAM_AUTH_TOKEN', FAKE_TOKEN)
        const fetchMock  = vi.fn().mockRejectedValue(new Error('connection refused'))
        vi.stubGlobal('fetch', fetchMock)

        const fakeLogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
        const bridge     = new EngramCompletionBridge(makeCfg(), fakeLogger)
        await expect(bridge.onComplete(FAKE_CONTRACT)).resolves.toBeUndefined()
    })

    it('swallows non-2xx HTTP responses without throwing', async () => {
        vi.stubEnv('AURA_ENGRAM_AUTH_TOKEN', FAKE_TOKEN)
        const fetchMock  = vi.fn().mockResolvedValue({ ok: false, status: 500 })
        vi.stubGlobal('fetch', fetchMock)

        const fakeLogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
        const bridge     = new EngramCompletionBridge(makeCfg(), fakeLogger)
        await expect(bridge.onComplete(FAKE_CONTRACT)).resolves.toBeUndefined()
    })
})
