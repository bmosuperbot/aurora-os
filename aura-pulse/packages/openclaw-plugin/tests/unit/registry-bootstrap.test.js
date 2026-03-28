import { describe, it, expect, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { bootstrapRegistry, ensureOpenClawConfig, resolveOpenClawConfigPath } from '../../src/services/registry-bootstrap.js'

function makeConfig(overrides = {}) {
    return {
        auraRoot: '~/.aura',
        workspaceId: 'test',
        wsPort: 7700,
        pulseStaticDir: null,
        signalDebounceMs: 75,
        engramBridgeEnabled: false,
        engramHttpUrl: 'http://localhost:4318',
        projectRootOverride: null,
        workspaceDir: process.cwd(),
        bootstrapEnabled: false,
        openClawConfigPath: null,
        accountIds: {},
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
    plugins: {
        required: [{ id: 'engram', package: '@openclaw/engram', version: '1.0.0' }],
        optional: [],
    },
    openclawConfig: {
        plugins: {
            allow: ['aura-pulse', 'engram'],
            load: { paths: ['/tmp/plugin.js'] },
        },
    },
}

describe('registry bootstrap safety', () => {
    it('uses an override path for sandbox openclaw config', () => {
        expect(resolveOpenClawConfigPath(makeConfig({ openClawConfigPath: '/tmp/openclaw-sandbox.json' }))).toBe('/tmp/openclaw-sandbox.json')
    })

    it('does not install plugins or restart the gateway when bootstrap is disabled', async () => {
        const api = { logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }
        const execCmd = vi.fn()
        const spawnCmd = vi.fn()

        await bootstrapRegistry(api, registry, makeConfig(), execCmd, spawnCmd)

        expect(execCmd).not.toHaveBeenCalled()
        expect(spawnCmd).not.toHaveBeenCalled()
    })

    it('does not write openclaw.json when bootstrap is disabled', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'aura-registry-bootstrap-off-'))
        const configPath = join(dir, 'openclaw.json')
        const api = { logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }

        await ensureOpenClawConfig(api, registry, makeConfig({ openClawConfigPath: configPath }))

        expect(existsSync(configPath)).toBe(false)
        rmSync(dir, { recursive: true, force: true })
    })

    it('writes plugins.allow to the sandbox config when bootstrap is enabled', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'aura-registry-bootstrap-on-'))
        const configPath = join(dir, 'openclaw.json')
        const api = { logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }

        await ensureOpenClawConfig(api, registry, makeConfig({
            bootstrapEnabled: true,
            openClawConfigPath: configPath,
        }))

        const written = JSON.parse(readFileSync(configPath, 'utf8'))
        expect(written.plugins.allow).toEqual(['aura-pulse', 'engram'])
        expect(written.plugins.load).toEqual({ paths: ['/tmp/plugin.js'] })

        writeFileSync(configPath, JSON.stringify({ plugins: { allow: ['existing'] } }, null, 2))
        await ensureOpenClawConfig(api, registry, makeConfig({
            bootstrapEnabled: true,
            openClawConfigPath: configPath,
        }))
        const rewritten = JSON.parse(readFileSync(configPath, 'utf8'))
        expect(rewritten.plugins.allow).toEqual(['existing'])

        rmSync(dir, { recursive: true, force: true })
    })
})