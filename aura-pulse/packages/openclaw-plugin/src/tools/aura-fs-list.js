import { Type } from '@sinclair/typebox'
import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { jailPath } from '../fs/path-jail.js'

/**
 * @import { AuraPaths } from '../config/paths.js'
 */

/**
 * @typedef {object} DirEntry
 * @property {string} name
 * @property {'file'|'directory'} type
 * @property {number} size
 * @property {string} modified
 */

/**
 * aura_fs_list — list directory contents inside the PARA tree.
 *
 * @param {AuraPaths} auraPaths
 * @returns {import('../types/plugin-types.js').RegisteredTool}
 */
export function buildFsList(auraPaths) {
    return {
        name: 'aura_fs_list',
        description: 'List the contents of a directory in the Aura PARA filesystem.',
        parameters: Type.Object({
            path:      Type.Optional(Type.String({ description: 'Relative path within the PARA tree. Defaults to the projects root.' })),
            recursive: Type.Optional(Type.Boolean({ description: 'List recursively. Defaults to false.' })),
        }),
        async execute(_id, params) {
            const p        = /** @type {any} */ (params)
            const safeRoot = auraPaths.projectsDir
            const safePath = p.path ? jailPath(safeRoot, p.path) : safeRoot

            /**
             * @param {string} dir
             * @returns {DirEntry[]}
             */
            function listDir(dir) {
                const entries = readdirSync(dir, { withFileTypes: true })
                /** @type {DirEntry[]} */
                const result  = []
                for (const e of entries) {
                    const full    = join(dir, e.name)
                    const relName = relative(safeRoot, full)
                    if (e.isDirectory()) {
                        result.push({ name: relName, type: 'directory', size: 0, modified: statSync(full).mtime.toISOString() })
                        if (p.recursive) result.push(...listDir(full))
                    } else {
                        const s = statSync(full)
                        result.push({ name: relName, type: 'file', size: s.size, modified: s.mtime.toISOString() })
                    }
                }
                return result
            }

            const entries = listDir(safePath)
            return { content: [{ type: 'text', text: JSON.stringify(entries) }] }
        },
    }
}
