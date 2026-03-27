import { resolve, relative, normalize, dirname, basename } from 'node:path'
import { realpathSync } from 'node:fs'

/**
 * Validates and resolves a relative path against a project root jail.
 * Rejects any path that escapes the jail through .., symlinks, or alternate mounts.
 *
 * @param {string} root  - The jail root (absolute, already normalized).
 * @param {string} input - User-provided relative path.
 * @returns {string}     - Resolved absolute path within the jail.
 * @throws {Error}       - If the path would escape the jail.
 */
export function jailPath(root, input) {
    if (!input || typeof input !== 'string') {
        throw new Error('Path must be a non-empty string')
    }

    // Prevent null bytes
    if (input.includes('\0')) {
        throw new Error('Path contains null bytes')
    }

    const normalized = normalize(input)
    const rootAbs    = resolve(root)
    const candidate  = resolve(rootAbs, normalized)

    // First check: lexical containment
    const rel = relative(rootAbs, candidate)
    if (rel.startsWith('..') || rel.startsWith('/')) {
        throw new Error(`Path escapes jail: ${input}`)
    }

    // Second check: resolve symlinks and re-check containment
    try {
        const rootReal = realpathSync(rootAbs)
        let real = candidate
        try {
            real = realpathSync(candidate)
        } catch (err) {
            // Candidate may not exist yet (write target). Resolve parent instead.
            if (/** @type {NodeJS.ErrnoException} */ (err).code !== 'ENOENT') {
                throw err
            }
            const realParent = realpathSync(dirname(candidate))
            real = resolve(realParent, basename(candidate))
        }
        const realRel = relative(rootReal, real)
        if (realRel.startsWith('..') || realRel.startsWith('/')) {
            throw new Error(`Symlink escapes jail: ${input}`)
        }
    } catch (err) {
        if (/** @type {Error} */ (err).message.includes('escapes')) {
            throw err
        }
    }

    return candidate
}

/**
 * Resolve a path within the jail, returning the absolute path without throwing.
 * Returns null if the path would escape.
 *
 * @param {string} root
 * @param {string} input
 * @returns {string | null}
 */
export function tryJailPath(root, input) {
    try {
        return jailPath(root, input)
    } catch {
        return null
    }
}
