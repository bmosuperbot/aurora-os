/**
 * @import { ConnectorState } from '@aura/contract-runtime'
 * @import { SQLiteContractStorage } from '@aura/contract-runtime'
 * @import { PluginLogger } from '../types/plugin-types.js'
 */

import { encrypt, decrypt } from './crypto.js'

/**
 * Manages Aura-owned connector states stored in contracts.db.
 * Handles encrypted token fields. Master key comes from AURA_CONNECTOR_KEY env var.
 * Refuses to persist credentials when the key is unavailable.
 */
export class AuraConnectorStore {
    /**
     * @param {SQLiteContractStorage} storage
     * @param {PluginLogger} logger
     */
    constructor(storage, logger) {
        /** @type {SQLiteContractStorage} */ this._storage = storage
        /** @type {PluginLogger} */ this._logger = logger
        /** @type {string | null} */ this._masterKey = process.env['AURA_CONNECTOR_KEY'] ?? null
    }

    /**
     * Read all connector states (decrypting tokens if key is available).
     * @returns {Promise<ConnectorState[]>}
     */
    async readAll() {
        return this._storage.readConnectors()
    }

    /**
     * @param {string} id
     * @returns {Promise<ConnectorState | null>}
     */
    async read(id) {
        return this._storage.readConnector(id)
    }

    /**
     * Persist connector state, encrypting token fields.
     * Throws if tokens are present but the master key is absent.
     *
     * @param {ConnectorState} state
     * @returns {Promise<void>}
     */
    async write(state) {
        const toStore = { ...state }

        if (toStore.oauth_token_enc || toStore.refresh_token_enc) {
            if (!this._masterKey) {
                throw new Error('AURA_CONNECTOR_KEY is not set — refusing to persist credentials')
            }
            if (toStore.oauth_token_enc && !this._isEncrypted(toStore.oauth_token_enc)) {
                toStore.oauth_token_enc = encrypt(toStore.oauth_token_enc, this._masterKey)
            }
            if (toStore.refresh_token_enc && !this._isEncrypted(toStore.refresh_token_enc)) {
                toStore.refresh_token_enc = encrypt(toStore.refresh_token_enc, this._masterKey)
            }
        }

        await this._storage.writeConnector(toStore)
    }

    /**
     * Return a connector state with decrypted tokens. Returns null if not found.
     * Caller must handle the case when the master key is absent.
     *
     * @param {string} id
     * @returns {Promise<ConnectorState | null>}
     */
    async readDecrypted(id) {
        const state = await this._storage.readConnector(id)
        if (!state) return null

        if (!this._masterKey) {
            this._logger.warn(`aura-connector-store: AURA_CONNECTOR_KEY absent — returning state without decrypting tokens for ${id}`)
            return state
        }

        const decrypted = { ...state }
        try {
            if (decrypted.oauth_token_enc)   decrypted.oauth_token_enc   = decrypt(decrypted.oauth_token_enc, this._masterKey)
            if (decrypted.refresh_token_enc) decrypted.refresh_token_enc = decrypt(decrypted.refresh_token_enc, this._masterKey)
        } catch (err) {
            this._logger.warn(`aura-connector-store: token decryption failed for ${id}: ${String(err)}`)
        }
        return decrypted
    }

    /**
     * Update connector status fields without touching tokens.
     *
     * @param {string} id
     * @param {Partial<ConnectorState>} patch
     * @returns {Promise<void>}
     */
    async patch(id, patch) {
        const existing = await this._storage.readConnector(id)
        if (!existing) {
            throw new Error(`Connector ${id} not found`)
        }
        await this._storage.writeConnector({ ...existing, ...patch, id, updated_at: new Date().toISOString() })
    }

    /**
     * Heuristic: if the value looks like base64 and is long enough, treat it as already encrypted.
     * Prevents double-encrypting on repeated saves.
     *
     * @param {string} value
     * @returns {boolean}
     */
    _isEncrypted(value) {
        return value.length > 64 && /^[A-Za-z0-9+/=]+$/.test(value)
    }
}
