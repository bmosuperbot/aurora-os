import { Type } from '@sinclair/typebox'
import { readFileSync } from 'node:fs'
import { jailPath } from '../fs/path-jail.js'

/**
 * @import { LockManager } from '../fs/locks.js'
 * @import { AuraPaths } from '../config/paths.js'
 */

/**
 * aura_fs_read — read the UTF-8 content of a file inside the PARA tree.
 *
 * @param {AuraPaths} auraPaths
 * @param {LockManager} locks
 * @returns {import('../types/plugin-types.js').RegisteredTool}
 */
export function buildFsRead(auraPaths, locks) {
    void locks // read is lock-free but we keep the param for API consistency

    return {
        name: 'aura_fs_read',
        description: 'Read a file from the Aura PARA filesystem. Paths are relative to the projects root.',
        parameters: Type.Object({
            path:     Type.String({ description: 'Relative path within the PARA tree' }),
            encoding: Type.Optional(Type.Enum({ utf8: 'utf8' }, { description: 'File encoding. Only utf8 supported.' })),
        }),
        async execute(_id, params) {
            const p         = /** @type {any} */ (params)
            const safeRoot  = auraPaths.projectsDir
            const safePath  = jailPath(safeRoot, p.path)

            const content = readFileSync(safePath, 'utf8')
            return { content: [{ type: 'text', text: content }] }
        },
    }
}
