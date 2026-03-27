import { Type } from '@sinclair/typebox'
import { readFileSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { jailPath } from '../fs/path-jail.js'
import { applyPatches } from '../fs/patcher.js'
import { touchSignal } from '../fs/signal.js'

/**
 * @import { ContractRuntime } from '@aura/contract-runtime'
 * @import { LockManager } from '../fs/locks.js'
 * @import { AuraPaths } from '../config/paths.js'
 */

/**
 * A single search/replace patch operation.
 *
 * @typedef {object} PatchOp
 * @property {string} search     - Text to find (fuzzy-matched via diff-match-patch)
 * @property {string} replace    - Replacement text
 */

/**
 * aura_fs_patch — apply Aider-style search/replace patches to a PARA-jailed file.
 *
 * @param {AuraPaths} auraPaths
 * @param {LockManager} locks
 * @param {ContractRuntime} runtime
 * @param {string} agentId
 * @returns {import('../types/plugin-types.js').RegisteredTool}
 */
export function buildFsPatch(auraPaths, locks, runtime, agentId) {
    return {
        name: 'aura_fs_patch',
        description: 'Apply one or more search/replace patches to a file using fuzzy diff-match-patch logic. Acquires a file lock.',
        parameters: Type.Object({
            path:    Type.String({ description: 'Relative path within the PARA tree' }),
            patches: Type.Array(
                Type.Object({
                    search:  Type.String({ description: 'Exact (or near-exact) text to find' }),
                    replace: Type.String({ description: 'Text to replace it with' }),
                }),
                { minItems: 1, description: 'Ordered list of search/replace operations' }
            ),
        }),
        async execute(_id, params) {
            const p        = /** @type {any} */ (params)
            const safeRoot = auraPaths.projectsDir
            const safePath = jailPath(safeRoot, p.path)

            await locks.acquire(safePath, agentId, 'patch')
            try {
                const original = readFileSync(safePath, 'utf8')
                const patched  = applyPatches(original, p.patches)
                writeFileSync(safePath, patched, 'utf8')
                await runtime.logAutonomousAction({
                    id:             randomUUID(),
                    timestamp:      new Date().toISOString(),
                    agent_id:       agentId,
                    package:        'aura-pulse',
                    action:         'fs_patch',
                    connector_used: '',
                    summary:        `Patched ${safePath} (${p.patches.length} op${p.patches.length !== 1 ? 's' : ''})`,
                    detail:         { path: safePath, patch_count: p.patches.length },
                })
                touchSignal(auraPaths.signalPath)
            } finally {
                await locks.release(safePath)
            }

            return { content: [{ type: 'text', text: JSON.stringify({ ok: true, path: p.path }) }] }
        },
    }
}
