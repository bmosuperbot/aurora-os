import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SQLiteContractStorage } from '../../src/storage/sqlite-storage.js'
import { ContractRuntime } from '../../src/runtime/contract-runtime.js'

/**
 * Create a temp directory with a fresh contracts.db and .signal file.
 * Returns the runtime, storage, signalPath, and a cleanup function.
 *
 * @param {object} [runtimeConfig]
 * @returns {{ runtime: ContractRuntime, storage: SQLiteContractStorage, signalPath: string, cleanup: () => void }}
 */
export function makeTempRuntime(runtimeConfig = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'aura-test-'))
    const dbPath = join(dir, 'contracts.db')
    const signalPath = join(dir, '.signal')

    const storage = new SQLiteContractStorage(dbPath, signalPath)
    const runtime = new ContractRuntime(storage, undefined, runtimeConfig)

    const cleanup = () => {
        try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
    }

    return { runtime, storage, signalPath, cleanup }
}
