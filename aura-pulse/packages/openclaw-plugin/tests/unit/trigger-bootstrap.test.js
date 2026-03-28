import { describe, it, expect, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { ensureTriggers } from '../../src/services/trigger-bootstrap.js'

function makeConfig(dir, overrides = {}) {
    return {
        auraRoot: '~/.aura',
        workspaceId: 'test',
        wsPort: 7700,
        pulseStaticDir: null,
        signalDebounceMs: 75,
        engramBridgeEnabled: false,
        engramHttpUrl: 'http://localhost:4318',
        projectRootOverride: null,
        workspaceDir: dir,
        bootstrapEnabled: false,
        openClawConfigPath: join(dir, 'openclaw.json'),
        accountIds: { gmail: 'studio-ops@gmail.com' },
        ttl: {
            checkIntervalMs: 60000,
            resolverTimeoutMs: 600000,
            completeRetentionDays: 30,
            failedRetentionDays: 7,
        },
        ...overrides,
    }
}

const registry = {
    triggers: [
        { id: 'gmail-offers', kind: 'gmail-preset', preset: 'gmail', instruction: 'x' },
        { id: 'calendar-monitor', kind: 'heartbeat', directive: '- Run: gog calendar list --account {{gmail_account}} --days 1 --tag "[aura]"' },
        { id: 'morning-brief', kind: 'cron', schedule: '0 7 * * *', message: 'Morning brief', instruction: 'Generate the brief' },
    ],
}

describe('trigger bootstrap safety', () => {
    it('does nothing when bootstrap is disabled', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'aura-trigger-bootstrap-off-'))
        const api = { logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, registerHook: vi.fn(), runtime: {} }

        await ensureTriggers(registry, api, makeConfig(dir))

        expect(existsSync(join(dir, 'openclaw.json'))).toBe(false)
        expect(existsSync(join(dir, 'HEARTBEAT.md'))).toBe(false)
        expect(api.registerHook).not.toHaveBeenCalled()

        rmSync(dir, { recursive: true, force: true })
    })

    it('writes to sandbox files and registers cron reconciliation when bootstrap is enabled', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'aura-trigger-bootstrap-on-'))
        const api = { logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, registerHook: vi.fn(), runtime: {} }

        await ensureTriggers(registry, api, makeConfig(dir, { bootstrapEnabled: true }))

        const openClawConfig = JSON.parse(readFileSync(join(dir, 'openclaw.json'), 'utf8'))
        expect(openClawConfig.hooks.presets).toContain('gmail')
        expect(openClawConfig.hooks.gmail.account).toBe('studio-ops@gmail.com')

        const heartbeat = readFileSync(join(dir, 'HEARTBEAT.md'), 'utf8')
        expect(heartbeat).toContain('gog calendar list --account studio-ops@gmail.com')
        expect(api.registerHook).toHaveBeenCalledWith('gateway:startup', expect.any(Function))

        rmSync(dir, { recursive: true, force: true })
    })
})