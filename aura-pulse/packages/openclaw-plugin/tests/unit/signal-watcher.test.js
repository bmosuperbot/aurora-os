import { describe, it, expect, vi, afterEach } from 'vitest'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SignalWatcher } from '../../src/services/signal-watcher.js'

function makeSetup() {
    const dir        = mkdtempSync(join(tmpdir(), 'aura-signal-test-'))
    const signalPath = join(dir, '.signal')
    const cleanup    = () => rmSync(dir, { recursive: true, force: true })
    return { dir, signalPath, cleanup }
}

/**
 * Fake runtime that returns contracts in sequence.
 *
 * @param {object[][]} sequences
 */
function fakeRuntime(sequences) {
    let call = 0
    return {
        list: vi.fn().mockImplementation(async () => {
            const result = sequences[call] ?? sequences[sequences.length - 1] ?? []
            call++
            return result
        }),
    }
}

describe('SignalWatcher', () => {
    let cleanup = () => {}

    afterEach(() => {
        cleanup()
        vi.restoreAllMocks()
    })

    it('calls onChanged when signal file is touched', async () => {
        const { signalPath, cleanup: c } = makeSetup()
        cleanup = c

        const contracts = [{ id: 'c1', status: 'waiting_approval' }]
        const runtime   = fakeRuntime([contracts])
        const cb        = vi.fn()
        const logger    = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }

        writeFileSync(signalPath, '', 'utf8')

        const watcher = new SignalWatcher(signalPath, runtime, logger, 20, cb)
        watcher.start()

        // Touch the signal
        writeFileSync(signalPath, new Date().toISOString(), 'utf8')
        watcher.nudge()

        // Allow debounce + async to settle
        await new Promise(r => setTimeout(r, 100))

        watcher.stop()
        expect(cb).toHaveBeenCalledWith(contracts)
    })

    it('debounces rapid signal touches into a single callback', async () => {
        const { signalPath, cleanup: c } = makeSetup()
        cleanup = c

        const contracts = [{ id: 'c2' }]
        const runtime   = fakeRuntime([contracts])
        const cb        = vi.fn()
        const logger    = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }

        writeFileSync(signalPath, '', 'utf8')

        const watcher = new SignalWatcher(signalPath, runtime, logger, 80, cb)
        watcher.start()

        // Touch 5 times rapidly
        for (let i = 0; i < 5; i++) {
            writeFileSync(signalPath, String(i), 'utf8')
            await new Promise(r => setTimeout(r, 10))
        }

        await new Promise(r => setTimeout(r, 200))
        watcher.stop()

        // Should have collapsed to just one (or at most two) invocations
        expect(cb.mock.calls.length).toBeLessThanOrEqual(2)
    })

    it('does not call onChanged when contract list is empty', async () => {
        const { signalPath, cleanup: c } = makeSetup()
        cleanup = c

        const runtime = fakeRuntime([[]])
        const cb      = vi.fn()
        const logger  = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }

        writeFileSync(signalPath, '', 'utf8')

        const watcher = new SignalWatcher(signalPath, runtime, logger, 20, cb)
        watcher.start()

        writeFileSync(signalPath, 'tick', 'utf8')
        await new Promise(r => setTimeout(r, 100))

        watcher.stop()
        expect(cb).not.toHaveBeenCalled()
    })
})
