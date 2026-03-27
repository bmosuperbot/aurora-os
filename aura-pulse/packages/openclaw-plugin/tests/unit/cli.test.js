import { describe, it, expect, vi, afterEach } from 'vitest'
import { buildCli } from '../../src/cli/aura-cli.js'

function makeLogger() {
    return { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

/**
 * Build a minimal mock runtime + storage for CLI tests.
 *
 * @param {object[]} contracts
 * @param {object[]} connectors
 */
function makeCliDeps(contracts = [], connectors = []) {
    const runtime = {
        list:       vi.fn().mockResolvedValue(contracts),
        get:        vi.fn().mockResolvedValue(contracts[0] ?? null),
        transition: vi.fn().mockResolvedValue({ status: 'complete' }),
        resume:     vi.fn().mockResolvedValue({ status: 'executing' }),
    }
    const storage = {
        readConnectors:    vi.fn().mockResolvedValue(connectors),
    }
    return { runtime, storage }
}

describe('aura CLI', () => {
    afterEach(() => vi.restoreAllMocks())

    describe('pending', () => {
        it('prints "No pending contracts." when none exist', async () => {
            const logger          = makeLogger()
            const { runtime, storage } = makeCliDeps([])
            const cli             = buildCli({ runtime, storage, logger, agentId: 'test-agent' })
            await cli.execute(['pending'])
            expect(logger.info).toHaveBeenCalledWith(expect.stringMatching(/no pending/i))
        })

        it('prints contract details when contracts exist', async () => {
            const logger = makeLogger()
            const { runtime, storage } = makeCliDeps([
                { id: 'c-1', status: 'waiting_approval', type: 'offer-received', created_at: '2026-01-01T00:00:00Z' },
            ])
            const cli = buildCli({ runtime, storage, logger, agentId: 'test-agent' })
            await cli.execute(['pending'])
            const combined = logger.info.mock.calls.flat().join(' ')
            expect(combined).toContain('c-1')
        })
    })

    describe('connectors', () => {
        it('prints "No connectors" when none exist', async () => {
            const logger = makeLogger()
            const { runtime, storage } = makeCliDeps()
            const cli = buildCli({ runtime, storage, logger, agentId: 'test-agent' })
            await cli.execute(['connectors'])
            expect(logger.info).toHaveBeenCalledWith(expect.stringMatching(/no connectors/i))
        })

        it('never prints encrypted_tokens field', async () => {
            const logger = makeLogger()
            const { runtime, storage } = makeCliDeps([], [
                { id: 'github', status: 'active', oauth_token_enc: 'super-secret', refresh_token_enc: 'also-secret' },
            ])
            const cli = buildCli({ runtime, storage, logger, agentId: 'test-agent' })
            await cli.execute(['connectors'])
            const combined = logger.info.mock.calls.flat().join(' ')
            expect(combined).not.toContain('super-secret')
            expect(combined).not.toContain('oauth_token_enc')
            expect(combined).not.toContain('refresh_token_enc')
        })
    })

    describe('resume', () => {
        it('prints not found when contract does not exist', async () => {
            const logger = makeLogger()
            const { runtime, storage } = makeCliDeps([])
            const cli = buildCli({ runtime, storage, logger, agentId: 'test-agent' })
            await cli.execute(['resume', '--contract', 'c-1', '--token', 'bad-token', '--action', 'resolve'])
            expect(logger.info).toHaveBeenCalledWith(expect.stringMatching(/not found/i))
        })

        it('transitions to resolver_active on engage', async () => {
            const logger = makeLogger()
            const resolver = { id: 'owner', type: 'human' }
            const { runtime, storage } = makeCliDeps([{ id: 'c-1', status: 'waiting_approval', participants: { resolver } }])
            const cli = buildCli({ runtime, storage, logger, agentId: 'test-agent' })
            await cli.execute(['resume', '--contract', 'c-1', '--action', 'engage'])
            expect(runtime.transition).toHaveBeenCalledWith('c-1', 'resolver_active', resolver)
        })

        it('uses runtime.resume on resolve with token', async () => {
            const logger = makeLogger()
            const resolver = { id: 'owner', type: 'human' }
            const { runtime, storage } = makeCliDeps([{ id: 'c-1', status: 'waiting_approval', participants: { resolver } }])
            const cli = buildCli({ runtime, storage, logger, agentId: 'test-agent' })
            await cli.execute(['resume', '--contract', 'c-1', '--token', 'good-token', '--action', 'resolve'])
            expect(runtime.resume).toHaveBeenCalledWith('c-1', 'good-token', resolver, 'resolve')
        })

        it('prints usage when resolve token is missing', async () => {
            const logger = makeLogger()
            const resolver = { id: 'owner', type: 'human' }
            const { runtime, storage } = makeCliDeps([{ id: 'c-1', status: 'waiting_approval', participants: { resolver } }])
            const cli = buildCli({ runtime, storage, logger, agentId: 'test-agent' })
            await cli.execute(['resume', '--contract', 'c-1', '--action', 'resolve'])
            expect(logger.info).toHaveBeenCalledWith(expect.stringMatching(/usage/i))
        })

        it('prints usage when required args are missing', async () => {
            const logger = makeLogger()
            const { runtime, storage } = makeCliDeps()
            const cli = buildCli({ runtime, storage, logger, agentId: 'test-agent' })
            await cli.execute(['resume'])
            expect(logger.info).toHaveBeenCalledWith(expect.stringMatching(/usage/i))
        })
    })

    describe('status', () => {
        it('prints total contract count', async () => {
            const logger = makeLogger()
            const { runtime, storage } = makeCliDeps([
                { id: 'c-1', status: 'waiting_approval' },
                { id: 'c-2', status: 'completed' },
            ])
            const cli = buildCli({ runtime, storage, logger, agentId: 'test-agent' })
            await cli.execute(['status'])
            const combined = logger.info.mock.calls.flat().join(' ')
            expect(combined).toContain('2')
        })
    })
})
