import { describe, it, expect, vi } from 'vitest'

import { loadContributedTools } from '../../src/services/tool-loader.js'

describe('loadContributedTools', () => {
    it('registers a contributed tool when its connector is active', async () => {
        const registerFn = vi.fn()
        const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

        await loadContributedTools({
            tools: [{
                id: 'etsy-lookup',
                packageId: 'artist-reseller',
                module: './tools/etsy-lookup.js',
                connector: 'etsy',
            }],
        }, '/tmp/nonexistent-aura-root', {
            readConnector: async () => ({ id: 'etsy', status: 'active' }),
        }, logger, registerFn)

        expect(registerFn).toHaveBeenCalledTimes(1)
        expect(registerFn.mock.calls[0][0].name).toBe('aura_query_listing')
    })

    it('skips a contributed tool when its connector is inactive', async () => {
        const registerFn = vi.fn()
        const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

        await loadContributedTools({
            tools: [{
                id: 'etsy-lookup',
                packageId: 'artist-reseller',
                module: './tools/etsy-lookup.js',
                connector: 'etsy',
            }],
        }, '/tmp/nonexistent-aura-root', {
            readConnector: async () => ({ id: 'etsy', status: 'not-offered' }),
        }, logger, registerFn)

        expect(registerFn).not.toHaveBeenCalled()
    })

    it('logs a warning when the module import fails', async () => {
        const registerFn = vi.fn()
        const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

        await loadContributedTools({
            tools: [{
                id: 'broken-tool',
                packageId: 'artist-reseller',
                module: './tools/does-not-exist.js',
            }],
        }, '/tmp/nonexistent-aura-root', {
            readConnector: async () => null,
        }, logger, registerFn)

        expect(registerFn).not.toHaveBeenCalled()
        expect(logger.warn).toHaveBeenCalled()
    })
})