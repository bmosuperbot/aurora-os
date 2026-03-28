import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { resolveAuroraPackageDir } from '../config/paths.js'

const DEFAULT_PACKAGE_ID = 'artist-reseller'

/**
 * @param {string} template
 * @param {Record<string, unknown>} [context]
 * @returns {string}
 */
export function substituteTokens(template, context = {}) {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => (
        key in context ? String(context[key]) : `{{${key}}}`
    ))
}

/**
 * @param {Record<string, unknown> | undefined} artifacts
 * @returns {string}
 */
function summarizeArtifacts(artifacts) {
    if (!artifacts || Object.keys(artifacts).length === 0) {
        return 'none'
    }
    return JSON.stringify(artifacts, null, 2)
}

/**
 * @param {Record<string, unknown>} cfg
 * @returns {string}
 */
export function resolveMainSessionKey(cfg) {
    const agentsConfig = typeof cfg['agents'] === 'object' && cfg['agents'] !== null
        ? /** @type {Record<string, unknown>} */ (cfg['agents'])
        : {}
    const agents = Array.isArray(agentsConfig['list']) ? agentsConfig['list'] : []
    const defaultAgent = agents.find((agent) => agent && typeof agent === 'object' && agent['default'] === true)
    const agentId = typeof defaultAgent?.['id'] === 'string'
        ? defaultAgent['id']
        : typeof agents[0]?.['id'] === 'string'
            ? agents[0]['id']
            : 'main'

    const session = typeof cfg['session'] === 'object' && cfg['session'] !== null
        ? /** @type {Record<string, unknown>} */ (cfg['session'])
        : {}

    if (session['scope'] === 'global') {
        return 'global'
    }

    const mainKey = typeof session['mainKey'] === 'string' && session['mainKey'].length > 0
        ? session['mainKey']
        : 'main'

    return `agent:${agentId}:${mainKey}`
}

/**
 * @param {import('@aura/contract-runtime').BaseContract} contract
 * @param {string} goal
 * @returns {string}
 */
function buildWakeMessage(contract, goal) {
    const action = contract.resume?.action ?? 'unknown'
    const required = Array.isArray(contract.complete_requires) && contract.complete_requires.length > 0
        ? contract.complete_requires.join(', ')
        : 'none'

    return [
        'Contract execution required.',
        '',
        `Execution goal:\n${goal}`,
        '',
        `Contract ID: ${contract.id}`,
        `Resume action: ${action}`,
        `Required logged actions before completion: ${required}`,
        `Resolver artifacts: ${summarizeArtifacts(contract.resume?.artifacts)}`,
        '',
        `When the work is complete, call aura_complete_contract with contract_id="${contract.id}" and a short summary.`,
    ].join('\n')
}

/**
 * @typedef {{
 *   api: import('../types/plugin-types.js').OpenClawPluginApi,
 *   auraRoot: string,
 *   storage: import('@aura/contract-runtime').SQLiteContractStorage,
 *   logger: import('../types/plugin-types.js').PluginLogger,
 *   packageId?: string,
 * }} ContractExecutorOptions
 */

export class ContractExecutor {
    /** @param {ContractExecutorOptions} options */
    constructor(options) {
        this._api = options.api
        this._auraRoot = options.auraRoot
        this._storage = options.storage
        this._logger = options.logger
        this._packageId = options.packageId ?? DEFAULT_PACKAGE_ID
        this._manifestPromise = null
    }

    /** @param {import('@aura/contract-runtime').BaseContract} contract */
    async onExecuting(contract) {
        try {
            await this._wake(contract)
        } catch (err) {
            this._logger.warn(`[executor] failed to wake ${contract.id}: ${String(err)}`)
        }
    }

    /**
     * @param {import('@aura/contract-runtime').BaseContract} contract
     * @returns {Promise<string>}
     */
    async _resolveGoal(contract) {
        const manifest = await this._loadManifest()
        const typeSpec = Array.isArray(manifest?.types)
            ? manifest.types.find((entry) => entry?.type === contract.type)
            : null

        const action = contract.resume?.action
        const executionGoal = typeof action === 'string' && typeof typeSpec?.execution_goal?.[action] === 'string'
            ? typeSpec.execution_goal[action]
            : typeof typeSpec?.execution_goal?.default === 'string'
                ? typeSpec.execution_goal.default
                : contract.intent.goal

        return substituteTokens(executionGoal, contract.intent.context ?? {})
    }

    /**
     * @param {import('@aura/contract-runtime').BaseContract} contract
     * @returns {Promise<void>}
     */
    async _wake(contract) {
        const system = this._api.runtime?.system
        if (!system?.enqueueSystemEvent || !system?.requestHeartbeatNow) {
            throw new Error('OpenClaw runtime.system executor APIs are unavailable')
        }

        const goal = await this._resolveGoal(contract)
        const cfg = await this._loadOpenClawConfig()
        const sessionKey = resolveMainSessionKey(cfg)
        const message = buildWakeMessage(contract, goal)

        await system.enqueueSystemEvent(message, { sessionKey })
        system.requestHeartbeatNow({
            sessionKey,
            reason: `executor:${contract.id}`,
        })

        await this._storage.writeAutonomousLog({
            id: randomUUID(),
            timestamp: new Date().toISOString(),
            agent_id: 'aura-executor',
            package: 'aura-pulse',
            action: 'executor_wake',
            summary: `Queued ${contract.type} for execution`,
            detail: {
                sessionKey,
                contract_type: contract.type,
                resume_action: contract.resume?.action ?? null,
            },
            contract_id: contract.id,
            connector_used: 'none',
        })
    }

    /** @returns {Promise<Record<string, unknown>>} */
    async _loadManifest() {
        if (!this._manifestPromise) {
            this._manifestPromise = (async () => {
                const packageDir = resolveAuroraPackageDir(this._auraRoot, this._packageId)
                const raw = await readFile(join(packageDir, 'domain-types.json'), 'utf8')
                return /** @type {Record<string, unknown>} */ (JSON.parse(raw))
            })()
        }

        return this._manifestPromise
    }

    /** @returns {Promise<Record<string, unknown>>} */
    async _loadOpenClawConfig() {
        const loader = this._api.runtime?.config?.loadConfig
        if (typeof loader === 'function') {
            const loaded = await loader()
            if (loaded && typeof loaded === 'object') {
                return /** @type {Record<string, unknown>} */ (loaded)
            }
        }
        return typeof this._api.config === 'object' && this._api.config !== null
            ? /** @type {Record<string, unknown>} */ (this._api.config)
            : {}
    }
}