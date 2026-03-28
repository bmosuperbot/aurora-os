import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'

import { substituteTokens } from './contract-executor.js'
import { resolveOpenClawConfigPath } from './registry-bootstrap.js'

/**
 * @param {string} configPath
 * @returns {Promise<Record<string, unknown>>}
 */
async function readOpenClawConfig(configPath) {
    try {
        return /** @type {Record<string, unknown>} */ (JSON.parse(await readFile(configPath, 'utf8')))
    } catch {
        return {}
    }
}

/**
 * @param {string} configPath
 * @param {Record<string, unknown>} cfg
 * @returns {Promise<void>}
 */
async function writeOpenClawConfig(configPath, cfg) {
    await mkdir(dirname(configPath), { recursive: true })
    await writeFile(configPath, JSON.stringify(cfg, null, 2))
}

/**
 * @param {Record<string, unknown>} registry
 * @param {import('../types/plugin-types.js').OpenClawPluginApi} api
 * @param {import('../config/schema.js').AuraPluginConfig} config
 * @returns {Promise<void>}
 */
export async function ensureTriggers(registry, api, config) {
    if (!config.bootstrapEnabled) {
        api.logger.info('[triggers] bootstrap disabled; skipping trigger bootstrap')
        return
    }

    const triggers = Array.isArray(registry.triggers) ? registry.triggers : []
    const gmailAccount = typeof config.accountIds['gmail'] === 'string' ? config.accountIds['gmail'] : ''
    const configPath = resolveOpenClawConfigPath(config)

    for (const trigger of triggers) {
        if (!trigger || typeof trigger !== 'object') continue

        if (trigger.kind === 'gmail-preset') {
            const cfg = await readOpenClawConfig(configPath)
            const hooks = typeof cfg['hooks'] === 'object' && cfg['hooks'] !== null
                ? /** @type {Record<string, unknown>} */ (cfg['hooks'])
                : {}
            const presets = Array.isArray(hooks['presets']) ? hooks['presets'] : []
            if (!presets.includes('gmail')) {
                hooks['presets'] = [...presets, 'gmail']
            }
            if (gmailAccount) {
                const gmail = typeof hooks['gmail'] === 'object' && hooks['gmail'] !== null
                    ? /** @type {Record<string, unknown>} */ (hooks['gmail'])
                    : {}
                if (typeof gmail['account'] !== 'string' || gmail['account'].length === 0) {
                    gmail['account'] = gmailAccount
                }
                hooks['gmail'] = gmail
            }
            cfg['hooks'] = hooks
            await writeOpenClawConfig(configPath, cfg)
            api.logger.info(`[triggers] ensured gmail preset in ${configPath}`)
            continue
        }

        if (trigger.kind === 'heartbeat' && typeof trigger.directive === 'string') {
            const heartbeatPath = join(config.workspaceDir, 'HEARTBEAT.md')
            const directive = substituteTokens(trigger.directive, { gmail_account: gmailAccount })
            let existing = ''
            try {
                existing = await readFile(heartbeatPath, 'utf8')
            } catch {
                existing = ''
            }
            if (!existing.includes(directive.slice(0, 40))) {
                const next = existing.length > 0 && !existing.endsWith('\n')
                    ? `${existing}\n\n${directive}\n`
                    : `${existing}${existing.length > 0 ? '\n' : ''}${directive}\n`
                await mkdir(config.workspaceDir, { recursive: true })
                await writeFile(heartbeatPath, next)
                api.logger.info('[triggers] updated HEARTBEAT.md')
            }
        }
    }

    const cronTriggers = triggers.filter((trigger) => trigger && typeof trigger === 'object' && trigger.kind === 'cron')
    if (cronTriggers.length === 0) return

    api.registerHook('gateway:startup', async () => {
        const subagent = api.runtime?.subagent?.run
        if (typeof subagent !== 'function') {
            api.logger.warn('[triggers] subagent runtime unavailable; skipping cron reconciliation')
            return
        }

        const declared = cronTriggers.map((trigger) => [
            `- id: ${String(trigger.id)}`,
            `  schedule: ${String(trigger.schedule ?? '')}`,
            `  message: ${String(trigger.message ?? '')}`,
            `  instruction: ${String(trigger.instruction ?? '')}`,
        ].join('\n')).join('\n')

        await subagent({
            sessionKey: 'aura:cron-reconcile',
            prompt: [
                'Reconcile the declared Aura cron jobs with the current OpenClaw cron registry.',
                'First call cron.list.',
                'If any declared job is missing, call cron.add with the declared id, schedule, and message.',
                'Do not duplicate existing jobs.',
                '',
                'Declared jobs:',
                declared,
            ].join('\n'),
            deliver: false,
        })
    })
}