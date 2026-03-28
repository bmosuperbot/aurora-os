import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * @import { AuraPluginConfig } from '../config/schema.js'
 * @import { AuraPaths } from '../config/paths.js'
 * @import { CompletionNotifier, ExecutionNotifier } from '@aura/contract-runtime'
 */

import { SQLiteContractStorage } from '@aura/contract-runtime'
import { ContractRuntime } from '@aura/contract-runtime'
import { offerReceivedType } from '@aura/contract-runtime'
import { grantReportDraftType } from '@aura/contract-runtime'
import { resolvePaths } from '../config/paths.js'
import { bootstrapPara } from '../fs/para.js'

/**
 * Manages the lifecycle of the ContractRuntime for the plugin.
 * This is the only place allowed to construct the runtime.
 */
export class ContractRuntimeService {
    /**
     * @param {AuraPluginConfig} config
     * @param {CompletionNotifier} notifier
     */
    constructor(config, notifier) {
        /** @type {AuraPluginConfig} */ this._config = config
        /** @type {CompletionNotifier} */ this._notifier = notifier
        /** @type {ExecutionNotifier | null} */ this._executionNotifier = null
        /** @type {AuraPaths} */ this._paths = resolvePaths(config)
        /** @type {SQLiteContractStorage | null} */ this._storage = null
        /** @type {ContractRuntime | null} */ this._runtime = null
        /** @type {Promise<void> | null} */ this._startPromise = null
        /** @type {Promise<void> | null} */ this._stopPromise = null
    }

    async start() {
        if (this._runtime && this._storage) {
            return
        }
        if (this._startPromise) {
            await this._startPromise
            return
        }

        this._startPromise = (async () => {
            const paths = this._paths
            mkdirSync(paths.sharedDir, { recursive: true })
            mkdirSync(paths.artifactsDir, { recursive: true })
            bootstrapPara(paths)

            this._storage = new SQLiteContractStorage(paths.dbPath, paths.signalPath)
            this._runtime = new ContractRuntime(this._storage, this._notifier, { ttl: this._config.ttl }, this._executionNotifier ?? undefined)

            this._runtime.registerType(offerReceivedType)
            this._runtime.registerType(grantReportDraftType)

            await this._runtime.initialize()
            this._runtime._ttlManager.start()

            // Artist-reseller subdirs — idempotent, safe on every workspace
            mkdirSync(join(paths.para.areas, 'inventory'), { recursive: true })
            mkdirSync(join(paths.para.areas, 'buyer-patterns'), { recursive: true })
            mkdirSync(join(paths.para.resources, 'platform-policies'), { recursive: true })
            mkdirSync(join(paths.projectsDir, 'apps'), { recursive: true })
        })()

        try {
            await this._startPromise
        } finally {
            this._startPromise = null
        }
    }

    async stop() {
        if (this._stopPromise) {
            await this._stopPromise
            return
        }
        if (this._startPromise) {
            await this._startPromise.catch(() => undefined)
        }
        if (!this._runtime) {
            return
        }

        this._stopPromise = (async () => {
            try {
                await this._runtime?.shutdown()
            } finally {
                this._runtime = null
                this._storage = null
            }
        })()

        try {
            await this._stopPromise
        } finally {
            this._stopPromise = null
        }
    }

    /**
     * @returns {ContractRuntime}
     * @throws {Error} if not started
     */
    getRuntime() {
        if (!this._runtime) {
            throw new Error('ContractRuntimeService is not started')
        }
        return this._runtime
    }

    /**
     * @returns {SQLiteContractStorage}
     * @throws {Error} if not started
     */
    getStorage() {
        if (!this._storage) {
            throw new Error('ContractRuntimeService is not started')
        }
        return this._storage
    }

    /**
     * @returns {AuraPaths}
     */
    getPaths() {
        return this._paths
    }

    /**
     * @param {ExecutionNotifier | null} notifier
     */
    setExecutionNotifier(notifier) {
        this._executionNotifier = notifier
        if (this._runtime) {
            this._runtime._executionNotifier = notifier ?? this._runtime._executionNotifier
        }
    }
}
