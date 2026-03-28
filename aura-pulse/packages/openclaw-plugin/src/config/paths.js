import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * @import { AuraPluginConfig } from './schema.js'
 */

/**
 * Resolve the Aura root directory, expanding ~ if present.
 *
 * @param {string} auraRoot
 * @returns {string}
 */
export function resolveAuraRoot(auraRoot) {
    if (auraRoot.startsWith('~')) {
        return join(homedir(), auraRoot.slice(1))
    }
    return auraRoot
}

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * Resolve an installed `.aurora` package directory. In the monorepo, packages
 * live next to openclaw-plugin under `packages/`.
 *
 * @param {string} auraRoot
 * @param {string} packageId
 * @returns {string}
 */
export function resolveAuroraPackageDir(auraRoot, packageId) {
    const installed = resolve(resolveAuraRoot(auraRoot), 'packages', packageId)
    if (existsSync(installed)) {
        return installed
    }

    const bundled = resolve(__dirname, '../../vendor', packageId)
    if (existsSync(bundled)) {
        return bundled
    }

    return resolve(__dirname, '../../..', packageId)
}

/**
 * Resolve all runtime paths for a given config.
 *
 * @param {AuraPluginConfig} config
 * @returns {AuraPaths}
 */
export function resolvePaths(config) {
    const root = resolveAuraRoot(config.auraRoot)
    const sharedDir = join(root, 'shared', config.workspaceId)
    const projectsDir = join(root, 'projects', config.workspaceId)

    return {
        auraRoot: root,
        sharedDir,
        dbPath: join(sharedDir, 'contracts.db'),
        signalPath: join(sharedDir, '.signal'),
        artifactsDir: join(sharedDir, 'artifacts'),
        projectsDir,
        para: {
            projects:  join(projectsDir, 'projects'),
            areas:     join(projectsDir, 'areas'),
            resources: join(projectsDir, 'resources'),
            archive:   join(projectsDir, 'archive'),
            trash:     join(projectsDir, '.trash'),
        },
    }
}

/**
 * @typedef {object} ParaRoots
 * @property {string} projects
 * @property {string} areas
 * @property {string} resources
 * @property {string} archive
 * @property {string} trash
 */

/**
 * @typedef {object} AuraPaths
 * @property {string} auraRoot
 * @property {string} sharedDir
 * @property {string} dbPath
 * @property {string} signalPath
 * @property {string} artifactsDir
 * @property {string} projectsDir
 * @property {ParaRoots} para
 */
