import { describe, it, expect } from 'vitest'
import { normalizeConfig } from '../../src/config/schema.js'

describe('normalizeConfig', () => {
    it('applies all defaults when given an empty object', () => {
        const cfg = normalizeConfig({})
        expect(cfg.auraRoot).toBe('~/.aura')
        expect(cfg.workspaceId).toBe('default')
        expect(cfg.wsPort).toBe(7700)
        expect(cfg.signalDebounceMs).toBe(75)
        expect(cfg.engramBridgeEnabled).toBe(true)
        expect(cfg.engramHttpUrl).toBe('http://localhost:4318')
        expect(cfg.pulseStaticDir).toBeNull()
        expect(cfg.projectRootOverride).toBeNull()
        expect(cfg.accountIds).toEqual({})
    })

    it('preserves explicit values over defaults', () => {
        const cfg = normalizeConfig({
            auraRoot: '/my/aura',
            workspaceId: 'ws-42',
            wsPort: 9999,
            signalDebounceMs: 200,
            engramBridgeEnabled: false,
            engramHttpUrl: 'http://engram:8080',
            pulseStaticDir: '/dist/pulse',
            projectRootOverride: '/projects',
            accountIds: { gmail: 'studio-ops@gmail.com' },
        })
        expect(cfg.auraRoot).toBe('/my/aura')
        expect(cfg.workspaceId).toBe('ws-42')
        expect(cfg.wsPort).toBe(9999)
        expect(cfg.signalDebounceMs).toBe(200)
        expect(cfg.engramBridgeEnabled).toBe(false)
        expect(cfg.engramHttpUrl).toBe('http://engram:8080')
        expect(cfg.pulseStaticDir).toBe('/dist/pulse')
        expect(cfg.projectRootOverride).toBe('/projects')
        expect(cfg.accountIds).toEqual({ gmail: 'studio-ops@gmail.com' })
    })

    it('fills in only missing fields when given partial config', () => {
        const cfg = normalizeConfig({ workspaceId: 'partial-ws' })
        expect(cfg.workspaceId).toBe('partial-ws')
        expect(cfg.auraRoot).toBe('~/.aura')
        expect(cfg.wsPort).toBe(7700)
    })

    it('coerces wsPort string to a number', () => {
        const cfg = normalizeConfig({ wsPort: '8888' })
        expect(typeof cfg.wsPort).toBe('number')
        expect(cfg.wsPort).toBe(8888)
    })

    it('uses default wsPort when value is not coercible', () => {
        const cfg = normalizeConfig({ wsPort: 'not-a-number' })
        expect(cfg.wsPort).toBe(7700)
    })
})
