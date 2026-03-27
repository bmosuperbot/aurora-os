/**
 * @import { ConnectorState } from '@aura/contract-runtime'
 * @import { SQLiteContractStorage } from '@aura/contract-runtime'
 * @import { PluginLogger } from '../types/plugin-types.js'
 */

/**
 * Facade over SQLiteContractStorage connector methods.
 * Provides the surface that plugin tools use to query and update connectors.
 */
export class ConnectorManager {
    /**
     * @param {SQLiteContractStorage} storage
     * @param {PluginLogger} logger
     */
    constructor(storage, logger) {
        /** @type {SQLiteContractStorage} */ this._storage = storage
        /** @type {PluginLogger} */ this._logger = logger
    }

    /**
     * Return all connector states. Never includes raw token data.
     * @returns {Promise<ConnectorState[]>}
     */
    async listConnectors() {
        return this._storage.readConnectors()
    }

    /**
     * @param {string} id
     * @returns {Promise<ConnectorState | null>}
     */
    async getConnector(id) {
        return this._storage.readConnector(id)
    }

    /**
     * Write or update a connector state.
     * @param {ConnectorState} state
     * @returns {Promise<void>}
     */
    async writeConnector(state) {
        await this._storage.writeConnector(state)
    }

    /**
     * Patch a connector state by merging partial fields.
     * @param {string} id
     * @param {Partial<ConnectorState>} patch
     * @returns {Promise<void>}
     */
    async patchConnector(id, patch) {
        const existing = await this._storage.readConnector(id)
        if (!existing) {
            this._logger.warn(`ConnectorManager.patchConnector: connector not found: ${id}`)
            return
        }
        await this._storage.writeConnector({ ...existing, ...patch, updated_at: new Date().toISOString() })
    }

    /**
     * Mark a connector as offered.
     * @param {string} id
     * @returns {Promise<void>}
     */
    async offerConnector(id) {
        await this.patchConnector(id, { status: 'pending', offered_at: new Date().toISOString() })
    }

    /**
     * Mark a connector as declined.
     * @param {string} id
     * @param {boolean} [never]
     * @returns {Promise<void>}
     */
    async declineConnector(id, never = false) {
        await this.patchConnector(id, {
            status:          'declined',
            declined_at:     new Date().toISOString(),
            never_resurface: never,
        })
    }

    /**
     * Mark a connector as fully connected.
     * @param {string} id
     * @returns {Promise<void>}
     */
    async completeConnector(id) {
        await this.patchConnector(id, { status: 'active', connected_at: new Date().toISOString() })
    }
}

