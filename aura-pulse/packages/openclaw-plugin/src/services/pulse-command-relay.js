import { randomUUID } from 'node:crypto'

import { resolveMainSessionKey } from './contract-executor.js'

/**
 * @import { OpenClawPluginApi, PluginLogger } from '../types/plugin-types.js'
 */

/**
 * @typedef {'text' | 'voice'} PulseCommandModality
 */

/**
 * @typedef {object} PulseSurfaceActionParams
 * @property {string} surfaceId
 * @property {string} actionName
 * @property {string} [sourceComponentId]
 * @property {Record<string, unknown>} [context]
 */

/**
 * @typedef {object} PulseCommandDispatchParams
 * @property {string} commandId
 * @property {string} text
 * @property {PulseCommandModality} modality
 */

/**
 * @param {PulseCommandDispatchParams} params
 * @returns {string}
 */
function buildPulseCommandMessage(params) {
    return [
        'Aura Pulse owner command received.',
        '',
        `Command ID: ${params.commandId}`,
        `Modality: ${params.modality}`,
        '',
        'Treat the instruction below as a direct owner request originating from the Aura Pulse PWA.',
        'If you can act immediately, do so. If you need clarification or approval, surface the next step back into Pulse.',
        '',
        params.text,
    ].join('\n')
}

/**
 * @param {PulseSurfaceActionParams} params
 * @returns {string}
 */
function buildPulseSurfaceActionMessage(params) {
    return [
        'Aura Pulse surface action received.',
        '',
        `Surface ID: ${params.surfaceId}`,
        `Action: ${params.actionName}`,
        ...(params.sourceComponentId ? [`Source component: ${params.sourceComponentId}`] : []),
        '',
        'This action came from a rendered Aura Pulse interface. Treat it as a direct owner interaction with the currently visible UI.',
        'If the action changes the visible state, update or replace the surface in Pulse.',
        '',
        'Action context:',
        JSON.stringify(params.context ?? {}, null, 2),
    ].join('\n')
}

/**
 * @param {Record<string, unknown>} cfg
 * @returns {string}
 */
function resolvePulseSessionKey(cfg) {
    const mainSessionKey = resolveMainSessionKey(cfg)
    const session = typeof cfg['session'] === 'object' && cfg['session'] !== null
        ? /** @type {Record<string, unknown>} */ (cfg['session'])
        : {}
    const pulseKey = typeof session['pulseKey'] === 'string' && session['pulseKey'].length > 0
        ? session['pulseKey']
        : 'pulse'

    if (mainSessionKey === 'global') {
        return `global:${pulseKey}`
    }

    const separator = mainSessionKey.lastIndexOf(':')
    if (separator === -1) {
        return pulseKey
    }

    return `${mainSessionKey.slice(0, separator + 1)}${pulseKey}`
}

/**
 * @param {Record<string, unknown>} cfg
 * @returns {string}
 */
function resolvePrimaryAgentId(cfg) {
    const agentsConfig = typeof cfg['agents'] === 'object' && cfg['agents'] !== null
        ? /** @type {Record<string, unknown>} */ (cfg['agents'])
        : {}
    const agents = Array.isArray(agentsConfig['list']) ? agentsConfig['list'] : []
    const defaultAgent = agents.find((agent) => agent && typeof agent === 'object' && agent['default'] === true)

    return typeof defaultAgent?.['id'] === 'string'
        ? defaultAgent['id']
        : typeof agents[0]?.['id'] === 'string'
            ? agents[0]['id']
            : 'main'
}

/**
 * @param {Record<string, unknown>} cfg
 * @returns {unknown}
 */
function resolveSessionStoreConfig(cfg) {
    const session = typeof cfg['session'] === 'object' && cfg['session'] !== null
        ? /** @type {Record<string, unknown>} */ (cfg['session'])
        : {}

    return session['store']
}

/**
 * @param {string} value
 * @returns {string}
 */
function sanitizeRunIdSegment(value) {
    return value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'pulse'
}

/**
 * @param {Record<string, unknown>} cfg
 * @param {{ provider: string, model: string }} defaults
 * @returns {{ provider: string, model: string }}
 */
function resolvePulseModel(cfg, defaults) {
    const agentsConfig = typeof cfg['agents'] === 'object' && cfg['agents'] !== null
        ? /** @type {Record<string, unknown>} */ (cfg['agents'])
        : {}
    const defaultsConfig = typeof agentsConfig['defaults'] === 'object' && agentsConfig['defaults'] !== null
        ? /** @type {Record<string, unknown>} */ (agentsConfig['defaults'])
        : {}
    const configuredModel = typeof defaultsConfig['model'] === 'string'
        ? defaultsConfig['model']
        : defaultsConfig['model'] && typeof defaultsConfig['model'] === 'object'
            && typeof defaultsConfig['model']['primary'] === 'string'
            ? defaultsConfig['model']['primary']
            : null

    if (typeof configuredModel !== 'string' || configuredModel.trim().length === 0) {
        return defaults
    }

    const normalized = configuredModel.trim()
    const separator = normalized.indexOf('/')
    if (separator === -1) {
        return {
            provider: defaults.provider,
            model: normalized,
        }
    }

    return {
        provider: normalized.slice(0, separator),
        model: normalized.slice(separator + 1),
    }
}

export class PulseCommandRelay {
    /**
     * @param {OpenClawPluginApi} api
     * @param {PluginLogger} logger
     */
    constructor(api, logger) {
        this._api = api
        this._logger = logger
        /** @type {Map<string, Promise<void>>} */
        this._sessionRuns = new Map()
    }

    /**
     * @param {PulseCommandDispatchParams} params
     * @returns {Promise<{ sessionKey: string, message: string }>}
     */
    async dispatch(params) {
        const cfg = await this._loadOpenClawConfig()
        const sessionKey = resolvePulseSessionKey(cfg)
        const reason = `pulse-command:${params.commandId}`
        this._getRuntimeAgent()
        this._schedulePulseRun({
            cfg,
            sessionKey,
            reason,
            prompt: buildPulseCommandMessage(params),
        })

        this._logger.info?.(`[aura-pulse] scheduled ${params.modality} command ${params.commandId} in ${sessionKey}`)

        return {
            sessionKey,
            message: `Queued in ${sessionKey}.`,
        }
    }

    /**
     * @param {PulseSurfaceActionParams} params
     * @returns {Promise<{ sessionKey: string, message: string }>}
     */
    async dispatchSurfaceAction(params) {
        const cfg = await this._loadOpenClawConfig()
        const sessionKey = resolvePulseSessionKey(cfg)
        const reason = `pulse-surface-action:${params.surfaceId}:${params.actionName}`
        this._getRuntimeAgent()
        this._schedulePulseRun({
            cfg,
            sessionKey,
            reason,
            prompt: buildPulseSurfaceActionMessage(params),
        })

        this._logger.info?.(`[aura-pulse] scheduled surface action ${params.surfaceId}:${params.actionName} in ${sessionKey}`)

        return {
            sessionKey,
            message: `Queued action ${params.actionName} in ${sessionKey}.`,
        }
    }

    _getRuntimeAgent() {
        const agent = this._api.runtime?.agent
        if (!agent?.runEmbeddedPiAgent || !agent?.resolveAgentDir || !agent?.resolveAgentWorkspaceDir
            || !agent?.resolveAgentTimeoutMs || !agent?.ensureAgentWorkspace || !agent?.session?.resolveStorePath
            || !agent?.session?.loadSessionStore || !agent?.session?.saveSessionStore
            || !agent?.session?.resolveSessionFilePath) {
            throw new Error('OpenClaw runtime.agent direct relay APIs are unavailable')
        }
        return agent
    }

    /**
     * @param {{ cfg: Record<string, unknown>, sessionKey: string, reason: string, prompt: string }} params
     */
    _schedulePulseRun(params) {
        const priorRun = this._sessionRuns.get(params.sessionKey) ?? Promise.resolve()
        const nextRun = priorRun
            .catch(() => undefined)
            .then(async () => {
                await this._runInPulseSession(params)
            })

        this._sessionRuns.set(params.sessionKey, nextRun)

        void nextRun
            .catch((err) => {
                this._logger.warn(`[aura-pulse] direct pulse run failed for ${params.sessionKey}: ${String(err)}`)
            })
            .finally(() => {
                if (this._sessionRuns.get(params.sessionKey) === nextRun) {
                    this._sessionRuns.delete(params.sessionKey)
                }
            })
    }

    /**
     * @param {{ cfg: Record<string, unknown>, sessionKey: string, reason: string, prompt: string }} params
     * @returns {Promise<void>}
     */
    async _runInPulseSession(params) {
        const agent = this._getRuntimeAgent()
        const agentId = resolvePrimaryAgentId(params.cfg)
        const { provider, model } = resolvePulseModel(params.cfg, agent.defaults)
        const storePath = agent.session.resolveStorePath(resolveSessionStoreConfig(params.cfg), { agentId })
        const agentDir = agent.resolveAgentDir(params.cfg, agentId)
        const workspaceDir = agent.resolveAgentWorkspaceDir(params.cfg, agentId)

        await agent.ensureAgentWorkspace({ dir: workspaceDir })

        const sessionStore = agent.session.loadSessionStore(storePath)
        const existingEntry = sessionStore[params.sessionKey]
        const sessionEntry = existingEntry && typeof existingEntry === 'object' && typeof existingEntry['sessionId'] === 'string'
            ? {
                ...existingEntry,
                updatedAt: Date.now(),
            }
            : {
                sessionId: randomUUID(),
                updatedAt: Date.now(),
            }

        sessionStore[params.sessionKey] = sessionEntry
        await agent.session.saveSessionStore(storePath, sessionStore)

        const sessionId = sessionEntry.sessionId
        const sessionFile = agent.session.resolveSessionFilePath(sessionId, sessionEntry, { agentId })
        const timeoutMs = agent.resolveAgentTimeoutMs({ cfg: params.cfg })
        const thinkLevel = agent.resolveThinkingDefault({
            cfg: params.cfg,
            provider,
            model,
        })

        this._logger.info?.(`[aura-pulse] starting direct pulse run ${params.reason} in ${params.sessionKey}`)

        await agent.runEmbeddedPiAgent({
            sessionId,
            sessionKey: params.sessionKey,
            agentId,
            messageProvider: 'aura-pulse',
            trigger: 'manual',
            senderIsOwner: true,
            sessionFile,
            workspaceDir,
            agentDir,
            config: params.cfg,
            prompt: params.prompt,
            provider,
            model,
            thinkLevel,
            timeoutMs,
            runId: `pulse-${sanitizeRunIdSegment(params.reason)}-${Date.now()}`,
        })

        this._logger.info?.(`[aura-pulse] completed direct pulse run ${params.reason} in ${params.sessionKey}`)
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