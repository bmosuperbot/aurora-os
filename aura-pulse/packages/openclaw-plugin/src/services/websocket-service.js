import { WebSocketServer } from 'ws'

/**
 * @import { AuraPluginConfig } from '../config/schema.js'
 * @import { ContractRuntime, BaseContract } from '@aura/contract-runtime'
 * @import { PluginLogger } from '../types/plugin-types.js'
 * @import { SQLiteContractStorage } from '@aura/contract-runtime'
 */

import { SignalWatcher } from './signal-watcher.js'
import {
    buildDecision,
    buildClear,
    buildCompletion,
    buildConnectorRequest,
    buildConnectorComplete,
    parseInbound,
} from '../transport/websocket-protocol.js'

const HEARTBEAT_INTERVAL_MS = 30_000

/**
 * Manages the WebSocket server, connection registry, and signal-driven pushes.
 * Owns the SignalWatcher. Bootstraps pending contracts on every new connection.
 */
export class WebSocketService {
    /**
     * @param {AuraPluginConfig} config
     * @param {ContractRuntime} runtime
     * @param {SQLiteContractStorage} storage
     * @param {string} signalPath
     * @param {PluginLogger} logger
     */
    constructor(config, runtime, storage, signalPath, logger) {
        /** @type {AuraPluginConfig} */ this._config = config
        /** @type {ContractRuntime} */ this._runtime = runtime
        /** @type {SQLiteContractStorage} */ this._storage = storage
        /** @type {string} */ this._signalPath = signalPath
        /** @type {PluginLogger} */ this._logger = logger
        /** @type {WebSocketServer | null} */ this._wss = null
        /** @type {SignalWatcher | null} */ this._watcher = null
        /** @type {ReturnType<typeof setInterval> | null} */ this._heartbeatTimer = null
        /** @type {Set<import('ws').WebSocket>} */ this._clients = new Set()
    }

    async start() {
        this._wss = new WebSocketServer({ port: this._config.wsPort })
        this._logger.info(`aura-pulse ws: listening on port ${this._config.wsPort}`)

        this._wss.on('connection', (ws) => this._onConnect(ws))
        this._wss.on('error', (err) => this._logger.error(`aura-pulse ws error: ${String(err)}`))

        this._watcher = new SignalWatcher(
            this._signalPath,
            this._runtime,
            this._logger,
            this._config.signalDebounceMs,
            (contracts) => this._onContractsChanged(contracts),
        )
        this._watcher.start()

        this._heartbeatTimer = setInterval(() => this._ping(), HEARTBEAT_INTERVAL_MS)
    }

    async stop() {
        if (this._heartbeatTimer) {
            clearInterval(this._heartbeatTimer)
            this._heartbeatTimer = null
        }
        this._watcher?.stop()
        this._watcher = null
        await new Promise((resolve) => {
            if (this._wss) {
                this._wss.close(() => resolve(undefined))
            } else {
                resolve(undefined)
            }
        })
        this._wss = null
        this._clients.clear()
    }

    /**
     * Nudge the signal watcher — call after any write that should be pushed immediately.
     */
    nudge() {
        this._watcher?.nudge()
    }

    /**
     * Push a connector request card to all connected clients.
     * @param {import('@aura/contract-runtime').ConnectorState} connector
     */
    pushConnectorRequest(connector) {
        this._broadcast(buildConnectorRequest(connector))
    }

    /**
     * Push a connector completion notice to all connected clients.
     * @param {string} connectorId
     * @param {string} status
     */
    pushConnectorComplete(connectorId, status) {
        this._broadcast(buildConnectorComplete(connectorId, status))
    }

    /** @param {import('ws').WebSocket} ws */
    _onConnect(ws) {
        this._clients.add(ws)
        this._logger.debug?.('aura-pulse ws: client connected')

        ws.on('close', () => {
            this._clients.delete(ws)
            this._logger.debug?.('aura-pulse ws: client disconnected')
        })
        ws.on('error', (err) => {
            this._logger.warn(`aura-pulse ws: client error: ${String(err)}`)
            this._clients.delete(ws)
        })
        ws.on('message', (data) => this._onMessage(ws, data))

        // Bootstrap: immediately push all surfaceable pending contracts
        this._bootstrapClient(ws)
    }

    /** @param {import('ws').WebSocket} ws */
    async _bootstrapClient(ws) {
        try {
            const pending = await this._runtime.getPending()
            for (const contract of pending) {
                this._send(ws, buildDecision(contract))
            }
        } catch (err) {
            this._logger.warn(`aura-pulse ws bootstrap error: ${String(err)}`)
        }
    }

    /**
     * @param {import('ws').WebSocket} ws
     * @param {import('ws').RawData} data
     */
    async _onMessage(ws, data) {
        const msg = parseInbound(/** @type {string} */ (/** @type {unknown} */ (data)))
        if (!msg) {
            this._logger.warn('aura-pulse ws: received malformed message')
            return
        }

        try {
            await this._handleInbound(ws, msg.type, msg.payload)
        } catch (err) {
            this._logger.warn(`aura-pulse ws: error handling message ${msg.type}: ${String(err)}`)
        }
    }

    /**
     * @param {import('ws').WebSocket} _ws
     * @param {string} type
     * @param {Record<string, unknown>} payload
     */
    async _handleInbound(_ws, type, payload) {
        switch (type) {
        case 'engage':
            // Resolver engaged — transition to resolver_active
            if (typeof payload['contractId'] === 'string') {
                await this._runtime.transition(payload['contractId'], 'resolver_active', {
                    id: 'pulse-surface',
                    type: 'human',
                })
            }
            break

        case 'resolve':
            // Resolver commits — consume token and move to executing
            if (typeof payload['contractId'] === 'string' && typeof payload['token'] === 'string' && typeof payload['action'] === 'string') {
                await this._runtime.resume(
                    payload['contractId'],
                    payload['token'],
                    { id: 'pulse-surface', type: 'human' },
                    payload['action'],
                    payload['value'],
                )
                this._broadcast(buildClear(payload['contractId']))
            }
            break

        case 'abandon':
            // Resolver abandons — move back to waiting_approval
            if (typeof payload['contractId'] === 'string') {
                await this._runtime.transition(payload['contractId'], 'waiting_approval', {
                    id: 'pulse-surface',
                    type: 'human',
                })
            }
            break

        case 'ask_clarification':
            if (typeof payload['contractId'] === 'string' && typeof payload['question'] === 'string') {
                await this._runtime.askClarification(payload['contractId'], payload['question'], 'pulse-surface')
            }
            break

        case 'decline_connector': {
            const connId = payload['connectorId']
            const never  = payload['never'] === true
            if (typeof connId === 'string') {
                const existing = await this._storage.readConnector(connId)
                if (existing) {
                    const now = new Date().toISOString()
                    await this._storage.writeConnector({
                        ...existing,
                        status: 'declined',
                        declined_at: now,
                        never_resurface: never,
                        updated_at: now,
                    })
                }
            }
            break
        }

        default:
            this._logger.debug?.(`aura-pulse ws: unhandled message type: ${type}`)
        }
    }

    /** @param {BaseContract[]} contracts */
    _onContractsChanged(contracts) {
        for (const contract of contracts) {
            switch (contract.status) {
            case 'waiting_approval':
                this._broadcast(buildDecision(contract))
                break
            case 'complete':
                this._broadcast(buildCompletion(contract.id, contract.result?.summary ?? 'completed'))
                break
            case 'failed':
                this._broadcast(buildClear(contract.id))
                break
            default:
                break
            }
        }
    }

    /** @param {string} message */
    _broadcast(message) {
        for (const ws of this._clients) {
            this._send(ws, message)
        }
    }

    /**
     * Broadcast a raw message object to all connected clients (public surface for tests and plugins).
     * @param {object} message
     */
    broadcast(message) {
        this._broadcast(JSON.stringify(message))
    }

    /**
     * @param {import('ws').WebSocket} ws
     * @param {string} message
     */
    _send(ws, message) {
        if (ws.readyState === ws.OPEN) {
            ws.send(message, (err) => {
                if (err) this._logger.warn(`aura-pulse ws send error: ${String(err)}`)
            })
        }
    }

    _ping() {
        for (const ws of this._clients) {
            if (ws.readyState === ws.OPEN) {
                ws.ping()
            }
        }
    }
}
