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
 * aura_fs_archive — moves a file from projects/ into archive/.
 *
 * @param {AuraPaths} auraPaths
 * @param {LockManager} locks
 * @param {ContractRuntime} runtime
 * @param {string} agentId
 * @returns {import('../types/plugin-types.js').RegisteredTool}
 */
export function buildFsArchive(auraPaths, locks, runtime, agentId) {
    return {
        name: 'aura_fs_archive',
        description: 'Move a file from the active PARA projects tree into the archive directory.',
        parameters: Type.Object({
            path: Type.String({ description: 'Relative path within the projects tree to archive' }),
        }),
        async execute(_id, params) {
            const p        = /** @type {any} */ (params)
            const safeRoot = auraPaths.projectsDir
            const safePath = jailPath(safeRoot, p.path)

            await locks.acquire(safePath, agentId, 'archive')
            try {
                const archiveDir  = auraPaths.para.archive
                mkdirSync(archiveDir, { recursive: true })
                const stamp       = new Date().toISOString().replace(/[:.]/g, '-')
                const archivePath = join(archiveDir, `${stamp}_${basename(safePath)}`)
                renameSync(safePath, archivePath)
                await runtime.logAutonomousAction({
                    id:             randomUUID(),
                    timestamp:      new Date().toISOString(),
                    agent_id:       agentId,
                    package:        'aura-pulse',
                    action:         'fs_archive',
                    connector_used: '',
                    summary:        `Archived ${safePath}`,
                    detail:         { path: p.path, archive_path: archivePath },
                })
                touchSignal(auraPaths.signalPath)
            } finally {
                await locks.release(safePath)
            }

            return { content: [{ type: 'text', text: JSON.stringify({ ok: true, path: p.path }) }] }
        },
    }
}
