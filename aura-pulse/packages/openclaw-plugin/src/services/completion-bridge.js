/**
 * @import { BaseContract } from '@aura/contract-runtime'
 * @import { AuraPluginConfig } from '../config/schema.js'
 * @import { PluginLogger } from '../types/plugin-types.js'
 */

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
            tags: ['aura-contract', `type:${contract.type}`, `id:${contract.id}`],
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
     * @param {BaseContract} contract
     * @returns {string}
     */
    _buildContent(contract) {
        const goal    = contract.intent?.goal ?? 'unknown goal'
        const outcome = contract.result?.summary ?? 'completed'
        return `Aura contract completed. Type: ${contract.type}. ID: ${contract.id}. Goal: ${goal}. Outcome: ${outcome}.`
    }
}
