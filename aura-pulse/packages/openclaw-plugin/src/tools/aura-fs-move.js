import { Type } from '@sinclair/typebox'
import { renameSync, mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import { jailPath } from '../fs/path-jail.js'
import { touchSignal } from '../fs/signal.js'

/**
 * @import { ContractRuntime } from '@aura/contract-runtime'
 * @import { LockManager } from '../fs/locks.js'
 * @import { AuraPaths } from '../config/paths.js'
 */

/**
 * aura_fs_move — move/rename a file inside the PARA tree.
 *
 * @param {AuraPaths} auraPaths
 * @param {LockManager} locks
 * @param {ContractRuntime} runtime
 * @param {string} agentId
 * @returns {import('../types/plugin-types.js').RegisteredTool}
 */
export function buildFsMove(auraPaths, locks, runtime, agentId) {
    return {
        name: 'aura_fs_move',
        description: 'Move or rename a file within the Aura PARA filesystem. Creates destination parent directories automatically.',
        parameters: Type.Object({
            source:      Type.String({ description: 'Source relative path within the PARA tree' }),
            destination: Type.String({ description: 'Destination relative path within the PARA tree' }),
        }),
        async execute(_id, params) {
            const p        = /** @type {any} */ (params)
            const safeRoot = auraPaths.projectsDir
            const srcPath  = jailPath(safeRoot, p.source)
            const dstPath  = jailPath(safeRoot, p.destination)

            await locks.acquire(srcPath, agentId, 'move')
            try {
                mkdirSync(dirname(dstPath), { recursive: true })
                renameSync(srcPath, dstPath)
                await runtime.logAutonomousAction({
                    id:             randomUUID(),
                    timestamp:      new Date().toISOString(),
                    agent_id:       agentId,
                    package:        'aura-pulse',
                    action:         'fs_move',
                    connector_used: '',
                    summary:        `Moved ${srcPath} → ${dstPath}`,
                    detail:         { source: p.source, destination: p.destination },
                })
                touchSignal(auraPaths.signalPath)
            } finally {
                await locks.release(srcPath)
            }

            return { content: [{ type: 'text', text: JSON.stringify({ ok: true, source: p.source, destination: p.destination }) }] }
        },
    }
}
