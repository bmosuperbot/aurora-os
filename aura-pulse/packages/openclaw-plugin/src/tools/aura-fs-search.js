import { Type } from '@sinclair/typebox'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { jailPath } from '../fs/path-jail.js'

/**
 * @import { AuraPaths } from '../config/paths.js'
 */

/**
 * aura_fs_search — grep-style content search across the PARA tree.
 *
 * @param {AuraPaths} auraPaths
 * @returns {import('../types/plugin-types.js').RegisteredTool}
 */
export function buildFsSearch(auraPaths) {
    return {
        name: 'aura_fs_search',
        description: 'Search for a text pattern across files in the Aura PARA filesystem. Returns matching lines with context.',
        parameters: Type.Object({
            query:        Type.String({ description: 'Text or regex pattern to search for' }),
            path:         Type.Optional(Type.String({ description: 'Limit search to this relative path (directory or file). Defaults to projects root.' })),
            use_regex:    Type.Optional(Type.Boolean({ description: 'Treat query as a regular expression. Defaults to false.' })),
            max_results:  Type.Optional(Type.Number({ description: 'Max matching lines to return. Defaults to 50.', minimum: 1, maximum: 500 })),
            glob:         Type.Optional(Type.String({ description: 'Glob-style extension filter, e.g. "*.md". Defaults to all files.' })),
        }),
        async execute(_id, params) {
            const p        = /** @type {any} */ (params)
            const safeRoot = auraPaths.projectsDir
            const rootPath = p.path ? jailPath(safeRoot, p.path) : safeRoot
            const maxRes   = p.max_results ?? 50
            const pattern  = p.use_regex ? new RegExp(p.query) : p.query

            /** @type {{file: string, line: number, text: string}[]} */
            const matches = []

            /**
             * @param {string} dir
             */
            function walk(dir) {
                if (matches.length >= maxRes) return
                const entries = readdirSync(dir, { withFileTypes: true })
                for (const e of entries) {
                    if (matches.length >= maxRes) break
                    const full = join(dir, e.name)
                    if (e.isDirectory()) {
                        walk(full)
                    } else if (e.isFile()) {
                        if (p.glob) {
                            const ext = p.glob.replace('*', '')
                            if (!e.name.endsWith(ext)) continue
                        }
                        // Skip large binary-looking files (> 2 MB)
                        if (statSync(full).size > 2 * 1024 * 1024) continue
                        try {
                            const text  = readFileSync(full, 'utf8')
                            const lines = text.split('\n')
                            for (let i = 0; i < lines.length && matches.length < maxRes; i++) {
                                const line = lines[i] ?? ''
                                const hit  = typeof pattern === 'string'
                                    ? line.includes(pattern)
                                    : pattern.test(line)
                                if (hit) {
                                    matches.push({
                                        file: relative(safeRoot, full),
                                        line: i + 1,
                                        text: line,
                                    })
                                }
                            }
                        } catch {
                            // Binary or unreadable — skip
                        }
                    }
                }
            }

            const stat = statSync(rootPath, { throwIfNoEntry: false })
            if (stat?.isDirectory()) {
                walk(rootPath)
            } else if (stat?.isFile()) {
                // Single file mode
                const text  = readFileSync(rootPath, 'utf8')
                const lines = text.split('\n')
                for (let i = 0; i < lines.length && matches.length < maxRes; i++) {
                    const line = lines[i] ?? ''
                    const hit  = typeof pattern === 'string' ? line.includes(pattern) : pattern.test(line)
                    if (hit) matches.push({ file: relative(safeRoot, rootPath), line: i + 1, text: line })
                }
            }

            return { content: [{ type: 'text', text: JSON.stringify(matches) }] }
        },
    }
}
