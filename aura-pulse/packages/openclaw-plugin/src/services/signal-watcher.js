import { watch } from 'node:fs'

/**
 * @import { ContractRuntime } from '@aura/contract-runtime'
 * @import { PluginLogger } from '../types/plugin-types.js'
 */

/**
 * Watches the .signal file and triggers a debounced query for changed contracts.
 *
 * Defensive implementation:
 * - Debounces signal events at signalDebounceMs (default 75ms)
 * - Keeps lastCheckedAt in memory to query only changed contracts
 * - On gateway restart, lastCheckedAt resets to epoch — first fire pushes all pending
 *
 * @callback OnChangedCallback
 * @param {import('@aura/contract-runtime').BaseContract[]} contracts
 * @returns {void}
 */

export class SignalWatcher {
    /**
     * @param {string} signalPath
     * @param {ContractRuntime} runtime
     * @param {PluginLogger} logger
     * @param {number} debounceMs
     * @param {OnChangedCallback} onChanged
     */
    constructor(signalPath, runtime, logger, debounceMs, onChanged) {
        /** @type {string} */ this._signalPath = signalPath
        /** @type {ContractRuntime} */ this._runtime = runtime
        /** @type {PluginLogger} */ this._logger = logger
        /** @type {number} */ this._debounceMs = debounceMs
        /** @type {OnChangedCallback} */ this._onChanged = onChanged
        /** @type {string} */ this._lastCheckedAt = new Date(0).toISOString()
        /** @type {ReturnType<typeof setTimeout> | null} */ this._timer = null
        /** @type {import('node:fs').FSWatcher | null} */ this._watcher = null
    }

    start() {
        if (this._watcher) return
        try {
            this._watcher = watch(this._signalPath, () => this._onSignal())
        } catch {
            // signal file may not exist yet — start watching parent dir for it
            this._logger.warn(`signal-watcher: cannot watch ${this._signalPath} — will retry after first write`)
        }
    }

    stop() {
        if (this._timer) {
            clearTimeout(this._timer)
            this._timer = null
        }
        this._watcher?.close()
        this._watcher = null
    }

    /**
     * Called externally (e.g. after file-bridge writes) to trigger a push
     * without waiting for the fs event.
     */
    nudge() {
        this._onSignal()
    }

    _onSignal() {
        if (this._timer) return
        this._timer = setTimeout(() => {
            this._timer = null
            this._flush().catch((err) => this._logger.warn(`signal-watcher flush error: ${String(err)}`))
        }, this._debounceMs)
    }

    async _flush() {
        const since = this._lastCheckedAt
        this._lastCheckedAt = new Date().toISOString()
        try {
            const changed = await this._runtime.list({ updated_after: since })
            if (changed.length > 0) {
                this._onChanged(changed)
            }
        } catch (err) {
            this._logger.warn(`signal-watcher query error: ${String(err)}`)
            // Roll back checkpoint so we don't lose events
            this._lastCheckedAt = since
        }
    }
}
