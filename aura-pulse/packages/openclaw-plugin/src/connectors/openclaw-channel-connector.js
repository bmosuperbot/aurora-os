/**
 * @import { SQLiteContractStorage } from '@aura/contract-runtime'
 * @import { PluginLogger } from '../types/plugin-types.js'
 */

/**
 * Adapter for OpenClaw-channel-backed connectors.
 * Reports availability based on connector state in contracts.db.
 *
 * Note: OpenClaw's auth-profiles.json is scoped to model providers only.
 * We cannot reuse its OAuth tokens for service connectors (Gmail, Calendar).
 * This adapter detects whether the channel is active in the agent config —
 * it does not copy credentials.
 */
export class OpenClawChannelConnector {
    /**
     * @param {SQLiteContractStorage} storage
     * @param {PluginLogger} logger
     */
    constructor(storage, logger) {
        /** @type {SQLiteContractStorage} */ this._storage = storage
        /** @type {PluginLogger} */ this._logger = logger
    }

    /**
     * Check if a named OpenClaw channel is currently active.
     * Inspects the connector record in contracts.db — the Aura plugin
     * updates this record when it detects channel availability at startup.
     *
     * @param {string} connectorId
     * @returns {Promise<boolean>}
     */
    async isActive(connectorId) {
        const state = await this._storage.readConnector(connectorId)
        return state?.status === 'active' && state.source === 'openclaw-channel'
    }

    /**
     * Seed a connector record for a known OpenClaw channel if none exists.
     * Called at startup to ensure channel connectors are represented in state.
     *
     * @param {string} id
     * @param {string} capabilityWithout
     * @param {string} capabilityWith
     * @returns {Promise<void>}
     */
    async seedIfAbsent(id, capabilityWithout, capabilityWith) {
        const existing = await this._storage.readConnector(id)
        if (existing) return

        const now = new Date().toISOString()
        await this._storage.writeConnector({
            id,
            source: 'openclaw-channel',
            status: 'not-offered',
            capability_without: capabilityWithout,
            capability_with: capabilityWith,
            updated_at: now,
        })
        this._logger.debug?.(`openclaw-channel-connector: seeded ${id}`)
    }
}
