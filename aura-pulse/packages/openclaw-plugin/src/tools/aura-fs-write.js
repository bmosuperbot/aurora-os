import { Type } from '@sinclair/typebox'
import { writeFileSync, mkdirSync } from 'node:fs'
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
 * aura_fs_write — atomically write UTF-8 content to a PARA-jailed path.
 *
 * @param {AuraPaths} auraPaths
 * @param {LockManager} locks
 * @param {ContractRuntime} runtime
 * @param {string} agentId
 * @returns {import('../types/plugin-types.js').RegisteredTool}
 */
export function buildFsWrite(auraPaths, locks, runtime, agentId) {
    return {
        name: 'aura_fs_write',
        description: 'Write content to a file in the Aura PARA filesystem. Creates parent directories automatically. Acquires a file lock.',
        parameters: Type.Object({
            path:    Type.String({ description: 'Relative path within the PARA tree' }),
            content: Type.String({ description: 'UTF-8 content to write' }),
        }),
        async execute(_id, params) {
            const p        = /** @type {any} */ (params)
            const safeRoot = auraPaths.projectsDir
            const safePath = jailPath(safeRoot, p.path)

            await locks.acquire(safePath, agentId, 'write')
            try {
                mkdirSync(dirname(safePath), { recursive: true })
                writeFileSync(safePath, p.content, 'utf8')
                await runtime.logAutonomousAction({
                    id:             randomUUID(),
                    timestamp:      new Date().toISOString(),
                    agent_id:       agentId,
                    package:        'aura-pulse',
                    action:         'fs_write',
                    connector_used: '',
                    summary:        `Wrote ${safePath}`,
                    detail:         { path: safePath, bytes: Buffer.byteLength(p.content) },
                })
                touchSignal(auraPaths.signalPath)
            } finally {
                await locks.release(safePath)
            }

            return { content: [{ type: 'text', text: JSON.stringify({ ok: true, path: p.path }) }] }
        },
    }
}
