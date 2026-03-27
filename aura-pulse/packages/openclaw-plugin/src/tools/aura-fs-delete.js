import { Type } from '@sinclair/typebox'
import { renameSync, mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { basename, join } from 'node:path'
import { jailPath } from '../fs/path-jail.js'
import { touchSignal } from '../fs/signal.js'

/**
 * @import { ContractRuntime } from '@aura/contract-runtime'
 * @import { LockManager } from '../fs/locks.js'
 * @import { AuraPaths } from '../config/paths.js'
 */

/**
 * aura_fs_delete — moves a file to the PARA .trash/ directory (tombstone, not hard-delete).
 *
 * @param {AuraPaths} auraPaths
 * @param {LockManager} locks
 * @param {ContractRuntime} runtime
 * @param {string} agentId
 * @returns {import('../types/plugin-types.js').RegisteredTool}
 */
export function buildFsDelete(auraPaths, locks, runtime, agentId) {
    return {
        name: 'aura_fs_delete',
        description: 'Soft-delete a file by moving it to the .trash/ folder with a timestamp prefix. Acquires a file lock.',
        parameters: Type.Object({
            path: Type.String({ description: 'Relative path within the PARA tree' }),
        }),
        async execute(_id, params) {
            const p        = /** @type {any} */ (params)
            const safeRoot = auraPaths.projectsDir
            const safePath = jailPath(safeRoot, p.path)

            await locks.acquire(safePath, agentId, 'delete')
            try {
                const trashDir  = auraPaths.para.trash
                mkdirSync(trashDir, { recursive: true })
                const stamp     = new Date().toISOString().replace(/[:.]/g, '-')
                const trashPath = join(trashDir, `${stamp}_${basename(safePath)}`)
                renameSync(safePath, trashPath)
                await runtime.logAutonomousAction({
                    id:             randomUUID(),
                    timestamp:      new Date().toISOString(),
                    agent_id:       agentId,
                    package:        'aura-pulse',
                    action:         'fs_delete',
                    connector_used: '',
                    summary:        `Trashed ${safePath}`,
                    detail:         { path: p.path, trash_path: trashPath },
                })
                touchSignal(auraPaths.signalPath)
            } finally {
                await locks.release(safePath)
            }

            return { content: [{ type: 'text', text: JSON.stringify({ ok: true, path: p.path }) }] }
        },
    }
}
