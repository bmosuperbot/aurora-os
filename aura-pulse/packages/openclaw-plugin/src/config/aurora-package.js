import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { resolveAuroraPackageDir } from './paths.js'

/**
 * Load a JSON file from an Aura package, falling back to a provided value when
 * the package is unavailable. This keeps the plugin bootable in standalone
 * bundle mode as well as the monorepo.
 *
 * @template T
 * @param {string} auraRoot
 * @param {string} packageId
 * @param {string} relativePath
 * @param {T} fallbackValue
 * @param {{ warn?: (message: string) => void } | null} [logger]
 * @returns {T}
 */
export function loadAuroraPackageJsonSync(auraRoot, packageId, relativePath, fallbackValue, logger = null) {
    try {
        const packageDir = resolveAuroraPackageDir(auraRoot, packageId)
        return /** @type {T} */ (JSON.parse(readFileSync(join(packageDir, relativePath), 'utf8')))
    } catch (err) {
        logger?.warn?.(`[aurora-package] failed to load ${packageId}/${relativePath}: ${String(err)}`)
        return structuredClone(fallbackValue)
    }
}