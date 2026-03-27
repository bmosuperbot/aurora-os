import { watch } from 'chokidar'
import { randomUUID } from 'node:crypto'

/**
 * @import { PluginLogger } from '../types/plugin-types.js'
 * @import { SQLiteContractStorage } from '@aura/contract-runtime'
 */

/**
 * Watches the File Bridge project root for external CLI writes.
 * When a change is detected, checks for file-lock conflicts, logs the event,
 * and nudges the signal watcher.
 */
export class FileBridgeWatcher {
    /**
     * @param {string} projectRoot
     * @param {SQLiteContractStorage} storage
     * @param {PluginLogger} logger
     * @param {() => void} nudgeSignal
     */
    constructor(projectRoot, storage, logger, nudgeSignal) {
        /** @type {string} */ this._projectRoot = projectRoot
        /** @type {SQLiteContractStorage} */ this._storage = storage
        /** @type {PluginLogger} */ this._logger = logger
        /** @type {() => void} */ this._nudgeSignal = nudgeSignal
        /** @type {import('chokidar').FSWatcher | null} */ this._watcher = null
    }

    start() {
        if (this._watcher) return
        this._watcher = watch(this._projectRoot, {
            ignoreInitial: true,
            persistent: false,
            ignored: /(^|[/\\])\../, // ignore dotfiles
        })
        this._watcher.on('change', (path) => this._onChange(path, 'change'))
        this._watcher.on('add',    (path) => this._onChange(path, 'add'))
        this._watcher.on('error',  (err)  => this._logger.warn(`file-bridge-watcher error: ${String(err)}`))
        this._logger.info(`file-bridge-watcher: watching ${this._projectRoot}`)
    }

    async stop() {
        if (this._watcher) {
            await this._watcher.close()
            this._watcher = null
        }
    }

    /**
     * @param {string} path
     * @param {string} eventType
     */
    async _onChange(path, eventType) {
        this._logger.debug?.(`file-bridge-watcher: external ${eventType} detected: ${path}`)
        const now = new Date().toISOString()

        // Check for active lock conflict
        try {
            const db = /** @type {any} */ (this._storage)._db?.()
            if (db) {
                const lockRow = db.prepare('SELECT * FROM file_locks WHERE path = ? AND lock_expires_at > ?')
                    .get(path, new Date().toISOString())
                if (lockRow) {
                    await this._storage.writeAutonomousLog({
                        id:             randomUUID(),
                        timestamp:      now,
                        agent_id:       'external-cli',
                        package:        'aura-pulse',
                        action:         'external_file_conflict',
                        connector_used: '',
                        summary:        `External ${eventType} conflicted with lock on ${path}`,
                        detail:         {
                            source:          'external-cli',
                            path,
                            event_type:      eventType,
                            locked_by_agent: lockRow.locked_by_agent,
                            lock_operation:  lockRow.operation,
                        },
                    })
                    this._logger.warn(
                        `file-bridge-watcher: conflict — external write to ${path} while locked by ${lockRow.locked_by_agent} (${lockRow.operation}). Routing to orchestration review.`,
                    )
                    // Fail open: log and let orchestration handle it
                    return
                }
            }
        } catch {
            // Storage access may not be available — proceed
        }

        await this._storage.writeAutonomousLog({
            id:             randomUUID(),
            timestamp:      now,
            agent_id:       'external-cli',
            package:        'aura-pulse',
            action:         'external_file_change',
            connector_used: '',
            summary:        `External ${eventType} detected at ${path}`,
            detail:         { source: 'external-cli', path, event_type: eventType },
        })

        this._nudgeSignal()
    }
}
