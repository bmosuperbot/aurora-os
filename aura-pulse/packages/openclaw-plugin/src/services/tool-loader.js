import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { resolveAuroraPackageDir } from '../config/paths.js'

/**
 * @param {Record<string, unknown>} mod
 * @returns {((storage: import('@aura/contract-runtime').SQLiteContractStorage, logger: import('../types/plugin-types.js').PluginLogger) => import('../types/plugin-types.js').RegisteredTool) | null}
 */
function findBuilder(mod) {
    for (const [name, value] of Object.entries(mod)) {
        if (/^build[A-Z]/.test(name) && typeof value === 'function') {
            return /** @type {(storage: import('@aura/contract-runtime').SQLiteContractStorage, logger: import('../types/plugin-types.js').PluginLogger) => import('../types/plugin-types.js').RegisteredTool} */ (value)
        }
    }
    return null
}

/**
 * @param {Record<string, unknown>} registry
 * @param {string} auraRoot
 * @param {import('@aura/contract-runtime').SQLiteContractStorage} storage
 * @param {import('../types/plugin-types.js').PluginLogger} logger
 * @param {(tool: import('../types/plugin-types.js').RegisteredTool) => void} registerFn
 * @returns {Promise<void>}
 */
export async function loadContributedTools(registry, auraRoot, storage, logger, registerFn) {
    const tools = Array.isArray(registry.tools) ? registry.tools : []

    for (const entry of tools) {
        if (!entry || typeof entry !== 'object') continue
        if (typeof entry.module !== 'string' || entry.module.length === 0) continue

        if (typeof entry.connector === 'string') {
            const connector = await storage.readConnector(entry.connector)
            if (connector?.status !== 'active') {
                logger.info(`[tool-loader] skipped ${String(entry.id)} because connector ${entry.connector} is not active`)
                continue
            }
        }

        try {
            const packageDir = resolveAuroraPackageDir(auraRoot, typeof entry.packageId === 'string' ? entry.packageId : 'artist-reseller')
            const moduleUrl = pathToFileURL(join(packageDir, entry.module)).href
            const mod = /** @type {Record<string, unknown>} */ (await import(moduleUrl))
            const buildTool = findBuilder(mod)
            if (!buildTool) {
                logger.warn(`[tool-loader] no build* export found in ${String(entry.module)}`)
                continue
            }

            const tool = buildTool(storage, logger)
            registerFn(tool)
            logger.info(`[tool-loader] registered contributed tool: ${tool.name} (from ${String(entry.id)})`)
        } catch (err) {
            logger.warn(`[tool-loader] failed to load ${String(entry.id)}: ${String(err)}`)
        }
    }
}