/**
 * @import { ContractStorage } from '../storage/interface.js'
 * @import { ContractRuntime } from './contract-runtime.js'
 * @import { ParticipantRef } from '../types/participant.js'
 * @import { TtlManagerConfig } from './ttl-manager.js'
 */

const SYSTEM_ACTOR = /** @type {import('../types/participant.js').ParticipantRef} */ ({
    id: 'system',
    type: 'system',
})

export class TtlManager {
    /**
     * @param {ContractStorage} storage
     * @param {ContractRuntime} runtime
     * @param {TtlManagerConfig} [config]
     */
    constructor(storage, runtime, config = {}) {
        this._storage = storage
        this._runtime = runtime
        this._checkIntervalMs = config.checkIntervalMs ?? 30_000
        this._resolverTimeoutMs = config.resolverTimeoutMs ?? 300_000
        /** @type {ReturnType<typeof setInterval> | null} */
        this._timer = null
    }

    start() {
        this._timer = setInterval(() => this.tick(), this._checkIntervalMs)
        this._timer.unref()
    }

    stop() {
        if (this._timer) {
            clearInterval(this._timer)
            this._timer = null
        }
    }

    async tick() {
        const now = new Date().toISOString()

        const expired = await this._storage.query({
            status: 'waiting_approval',
            expires_before: now,
        })
        for (const contract of expired) {
            await this._runtime.transition(contract.id, 'failed', SYSTEM_ACTOR)
        }

        const cutoff = new Date(Date.now() - this._resolverTimeoutMs).toISOString()
        const timedOut = await this._storage.query({
            status: 'resolver_active',
            updated_before: cutoff,
        })
        for (const contract of timedOut) {
            await this._runtime.transition(contract.id, 'waiting_approval', SYSTEM_ACTOR)
        }
    }
}
