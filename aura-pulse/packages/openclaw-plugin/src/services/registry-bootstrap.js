import { mkdir } from 'node:fs/promises'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

/**
 * @param {import('../config/schema.js').AuraPluginConfig} config
 * @returns {string}
 */
export function resolveOpenClawConfigPath(config) {
    return config.openClawConfigPath ?? join(homedir(), '.openclaw', 'openclaw.json')
}

/**
 * @param {import('../types/plugin-types.js').OpenClawPluginApi} api
 * @param {{ plugins: { required: Array<{ id: string, package: string, version: string }> } }} registry
 * @param {import('../config/schema.js').AuraPluginConfig} config
 * @param {(cmd: string) => Promise<{ stdout: string, stderr: string, error: Error | null }>} execCmd
 * @param {(bin: string, args: string[]) => Promise<{ stdout: string, stderr: string, error: Error | null }>} spawnCmd
 * @returns {Promise<boolean>}
 */
export async function bootstrapRegistry(api, registry, config, execCmd, spawnCmd) {
    if (!config.bootstrapEnabled) {
        api.logger.info('[aura-registry] bootstrap disabled; skipping plugin installs and gateway restart')
        return false
    }

    const { stdout, error } = await execCmd('openclaw plugins list --json')
    if (error) {
        api.logger.warn('[aura-registry] could not list plugins — skipping bootstrap')
        return false
    }

    let loaded = /** @type {string[]} */ ([])
    try {
        loaded = JSON.parse(stdout).map((/** @type {{ id: string }} */ p) => p.id)
    } catch {
        api.logger.warn('[aura-registry] could not parse plugins list — skipping bootstrap')
        return false
    }

    let needsRestart = false
    for (const plugin of registry.plugins.required) {
        if (!loaded.includes(plugin.id)) {
            api.logger.info(`[aura-registry] installing ${plugin.package}@${plugin.version}`)
            const result = await spawnCmd('openclaw', ['plugins', 'install', `${plugin.package}@${plugin.version}`])
            if (result.error) {
                api.logger.warn(`[aura-registry] install failed for ${plugin.id}: ${result.stderr}`)
            } else {
                needsRestart = true
            }
        }
    }

    if (needsRestart) {
        api.logger.info('[aura-registry] restarting gateway after plugin installs')
        await execCmd('openclaw gateway restart')
    }

    return true
}

/**
 * @param {import('../types/plugin-types.js').OpenClawPluginApi} api
 * @param {{ openclawConfig: { plugins: { allow: string[], load?: unknown } } }} registry
 * @param {import('../config/schema.js').AuraPluginConfig} config
 * @returns {Promise<void>}
 */
export async function ensureOpenClawConfig(api, registry, config) {
    if (!config.bootstrapEnabled) {
        api.logger.info('[aura-registry] bootstrap disabled; skipping openclaw.json writes')
        return
    }

    const configPath = resolveOpenClawConfigPath(config)
    let current = /** @type {Record<string, unknown>} */ ({})
    try {
        current = JSON.parse(await readFile(configPath, 'utf8'))
    } catch {
        current = {}
    }

    const plugins = /** @type {Record<string, unknown>} */ (
        (typeof current['plugins'] === 'object' && current['plugins'] !== null)
            ? current['plugins']
            : {}
    )

    if (!plugins['allow']) {
        plugins['allow'] = registry.openclawConfig.plugins.allow
        if (!plugins['load']) plugins['load'] = registry.openclawConfig.plugins.load
        current['plugins'] = plugins
        try {
            await mkdir(dirname(configPath), { recursive: true })
            await writeFile(configPath, JSON.stringify(current, null, 2))
            api.logger.info(`[aura-registry] wrote plugins.allow to ${configPath}`)
        } catch (err) {
            api.logger.warn(`[aura-registry] could not write ${configPath}: ${String(err)}`)
        }
    }
}