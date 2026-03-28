/**
 * @import { BaseContract } from '@aura/contract-runtime'
 * @import { AuraPluginConfig } from '../config/schema.js'
 * @import { PluginLogger } from '../types/plugin-types.js'
 */

/**
 * Context field names whose values are long-form prose — excluded from Engram tags.
 * Everything else that fits in 64 chars is promoted automatically.
 */
const PROSE_FIELDS = new Set([
    'message', 'description', 'summary', 'notes', 'body',
    'buyer_history', 'restock_suggestion', 'delay_reason',
])

/**
 * Implements CompletionNotifier by POSTing completed contracts to Engram's
 * stable HTTP memory write endpoint.
 *
 * Bridge failure (network error, Engram down, bad token) must never affect
 * the runtime state machine — all errors are logged and swallowed.
 *
 * When engramBridgeEnabled is false or AURA_ENGRAM_AUTH_TOKEN is absent,
 * the bridge is a no-op stub.
 */
export class EngramCompletionBridge {
    /**
     * @param {AuraPluginConfig} config
     * @param {PluginLogger} logger
     */
    constructor(config, logger) {
        /** @type {AuraPluginConfig} */ this._config = config
        /** @type {PluginLogger} */ this._logger = logger
        /** @type {string | null} */ this._token = process.env['AURA_ENGRAM_AUTH_TOKEN'] ?? null
    }

    /**
     * @param {BaseContract} contract
     * @returns {Promise<void>}
     */
    async onComplete(contract) {
        if (!this._config.engramBridgeEnabled) return
        if (!this._token) {
            this._logger.debug?.('engram bridge: AURA_ENGRAM_AUTH_TOKEN not set — skipping')
            return
        }

        const content = this._buildContent(contract)
        const body = JSON.stringify({
            schemaVersion:  '1.0',
            idempotencyKey: contract.id,
            dryRun:         false,
            content,
            category: 'decision',
            confidence: 0.9,
            tags: this._buildTags(contract),
        })

        try {
            const url = `${this._config.engramHttpUrl}/engram/v1/memories`
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this._token}`,
                },
                body,
            })
            if (!res.ok) {
                this._logger.warn(`engram bridge: POST ${url} returned ${res.status}`)
            } else {
                this._logger.debug?.(`engram bridge: recorded completion for contract ${contract.id}`)
            }
        } catch (err) {
            this._logger.warn(`engram bridge: network error posting contract ${contract.id}: ${String(err)}`)
        }
    }

    /**
     * Renders a structured, human-readable summary of any contract type.
     * No per-type branching — works generically for all current and future types.
     *
     * @param {BaseContract} contract
     * @returns {string}
     */
    _buildContent(contract) {
        const ctx   = /** @type {Record<string, unknown>} */ (contract.intent?.context ?? {})
        const resume = /** @type {Record<string, unknown>} */ (contract.resume          ?? {})
        const arts  = /** @type {Record<string, unknown>} */ (contract.resume?.artifacts ?? contract.result?.artifacts ?? {})

        const latencyMs = contract.status === 'complete' && contract.created_at
            ? new Date(contract.updated_at).getTime() - new Date(contract.created_at).getTime()
            : null

        /** @param {Record<string, unknown>} obj */
        const renderFields = (obj) =>
            Object.entries(obj)
                .filter(([, v]) => v != null && v !== '')
                .map(([k, v]) => `  ${k}: ${v}`)
                .join('\n')

        const parts = [
            `Contract: ${contract.type}  id: ${contract.id}`,
            `Goal: ${contract.intent?.goal ?? 'unknown'}`,
        ]

        const ctxLines = renderFields(ctx)
        if (ctxLines)  { parts.push('', 'Context:',    ctxLines) }

        const resolveLines = renderFields({ ...resume, ...arts })
        if (resolveLines) { parts.push('', 'Resolution:', resolveLines) }

        const meta = []
        if (latencyMs != null) meta.push(`latency: ${Math.round(latencyMs / 60_000)}m`)
        const clarisCount = Array.isArray(contract.clarifications) ? contract.clarifications.length : 0
        if (clarisCount)   meta.push(`clarifications: ${clarisCount}`)
        if (meta.length)   parts.push('', meta.join('  '))

        return parts.join('\n')
    }

    /**
     * Promotes short scalar context fields to Engram tags generically.
     * Any field whose serialized value fits in 64 chars becomes a tag.
     * Long-form prose fields (message, description, etc.) are blocklisted.
     *
     * @param {BaseContract} contract
     * @returns {string[]}
     */
    _buildTags(contract) {
        const ctx    = /** @type {Record<string, unknown>} */ (contract.intent?.context ?? {})
        const resume = /** @type {Record<string, unknown>} */ (contract.resume          ?? {})

        const tags = ['aura-contract', `type:${contract.type}`, `id:${contract.id}`]

        for (const [key, val] of Object.entries(ctx)) {
            if (PROSE_FIELDS.has(key)) continue
            const str = typeof val === 'string' || typeof val === 'number' ? String(val) : null
            if (str && str.length <= 64) tags.push(`${key}:${str}`)
        }

        const action = typeof resume['action'] === 'string' ? resume['action'] : null
        if (action) tags.push(`action:${action}`)

        return tags
    }
}
