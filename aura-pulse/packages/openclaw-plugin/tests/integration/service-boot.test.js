/**
 * integration/service-boot.test.js
 *
 * Verifies that ContractRuntimeService starts cleanly, creates the expected
 * directory structure, and provides a live runtime + storage.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ContractRuntimeService } from '../../src/services/contract-runtime-service.js'

function makeCfg(dir) {
    return {
        auraRoot:             dir,
        workspaceId:          'test-boot',
        wsPort:               7701,
        signalDebounceMs:     50,
        engramBridgeEnabled:  false,
        engramHttpUrl:        'http://localhost:4318',
        pulseStaticDir:       null,
        projectRootOverride:  null,
    }
}

const fakeNotifier = { onComplete: async () => {} }

describe('ContractRuntimeService boot', () => {
    let dir    = ''
    let svc    = /** @type {ContractRuntimeService|null} */ (null)

    afterEach(async () => {
        if (svc) { await svc.stop().catch(() => {}); svc = null }
        if (dir)  rmSync(dir, { recursive: true, force: true })
    })

    it('starts without throwing', async () => {
        dir = mkdtempSync(join(tmpdir(), 'aura-svc-test-'))
        svc = new ContractRuntimeService(makeCfg(dir), fakeNotifier)
        await expect(svc.start()).resolves.toBeUndefined()
    })

    it('creates the shared directory and contracts.db', async () => {
        dir        = mkdtempSync(join(tmpdir(), 'aura-svc-test-'))
        svc        = new ContractRuntimeService(makeCfg(dir), fakeNotifier)
        await svc.start()
        const paths = svc.getPaths()
        expect(existsSync(paths.sharedDir)).toBe(true)
        expect(existsSync(paths.dbPath)).toBe(true)
    })

    it('exposes a live runtime after start', async () => {
        dir = mkdtempSync(join(tmpdir(), 'aura-svc-test-'))
        svc = new ContractRuntimeService(makeCfg(dir), fakeNotifier)
        await svc.start()
        expect(svc.getRuntime()).toBeTruthy()
    })

    it('throws when getRuntime() is called before start()', () => {
        dir = mkdtempSync(join(tmpdir(), 'aura-svc-test-'))
        svc = new ContractRuntimeService(makeCfg(dir), fakeNotifier)
        expect(() => svc.getRuntime()).toThrow()
    })

    it('creates PARA directories on start', async () => {
        dir        = mkdtempSync(join(tmpdir(), 'aura-svc-test-'))
        svc         = new ContractRuntimeService(makeCfg(dir), fakeNotifier)
        await svc.start()
        const paths = svc.getPaths()
        expect(existsSync(paths.para.projects)).toBe(true)
        expect(existsSync(paths.para.areas)).toBe(true)
        expect(existsSync(paths.para.resources)).toBe(true)
        expect(existsSync(paths.para.archive)).toBe(true)
    })

    it('can be started twice without error (idempotent)', async () => {
        dir = mkdtempSync(join(tmpdir(), 'aura-svc-test-'))
        svc = new ContractRuntimeService(makeCfg(dir), fakeNotifier)
        await svc.start()
        await expect(svc.start()).resolves.toBeUndefined()
    })
})
