import { WebSocketServer } from 'ws'

/**
 * @import { AuraPluginConfig } from '../config/schema.js'
 * @import { ContractRuntime, BaseContract } from '@aura/contract-runtime'
 * @import { PluginLogger } from '../types/plugin-types.js'
 * @import { SQLiteContractStorage } from '@aura/contract-runtime'
 * @import { ExecutionNotifier } from '@aura/contract-runtime'
 */

import { AuraConnectorStore } from '../connectors/aura-connector-store.js'
import { SignalWatcher } from './signal-watcher.js'


/**
 * @typedef {object} OnboardingStatusItem
 * @property {string} id
 * @property {string} label
 * @property {'installed' | 'missing' | 'not-installed' | 'pending'} status
 * @property {'required' | 'optional'} tier
 */

/**
 * @typedef {object} OnboardingStatus
 * @property {OnboardingStatusItem[]} items
 * @property {boolean} incomplete
 */
import {
    buildDecision,
    buildClarificationAnswer,
    buildSurfaceUpdate,
    buildClear,
    buildCompletion,
    buildConnectorRequest,
    buildConnectorComplete,
    parseInbound,
} from '../transport/websocket-protocol.js'

const HEARTBEAT_INTERVAL_MS = 30_000

/**
 * @typedef {object} ConnectorCardPayload
 * @property {string} id
 * @property {'openclaw-channel' | 'aura-connector' | 'aura-skill' | 'aura-app'} source
 * @property {'active' | 'pending' | 'declined' | 'error' | 'not-offered'} status
 * @property {string} [offered_at]
 * @property {boolean} [never_resurface]
 * @property {string} capability_without
 * @property {string} capability_with
 * @property {string} connector_id
 * @property {string} connector_name
 * @property {string} offer_text
 * @property {'browser_redirect' | 'secure_input' | 'manual_guide'} [flow_type]
 * @property {string} [auth_url]
 * @property {string} [input_label]
 * @property {string[]} [guide_steps]
 */

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
     * @param {OnboardingStatus | null} [onboardingStatus]
    * @param {ExecutionNotifier | null} [executor]
     */
    constructor(config, runtime, storage, signalPath, logger, onboardingStatus = null, executor = null) {
        /** @type {AuraPluginConfig} */ this._config = config
        /** @type {ContractRuntime} */ this._runtime = runtime
        /** @type {SQLiteContractStorage} */ this._storage = storage
        /** @type {string} */ this._signalPath = signalPath
        /** @type {PluginLogger} */ this._logger = logger
        /** @type {OnboardingStatus | null} */ this._onboardingStatus = onboardingStatus
        /** @type {ExecutionNotifier | null} */ this._executor = executor
        /** @type {WebSocketServer | null} */ this._wss = null
        /** @type {SignalWatcher | null} */ this._watcher = null
        /** @type {ReturnType<typeof setInterval> | null} */ this._heartbeatTimer = null
        /** @type {Set<import('ws').WebSocket>} */ this._clients = new Set()
        /** @type {Promise<void> | null} */ this._startPromise = null
        /** @type {Promise<void> | null} */ this._stopPromise = null
    }

    async start() {
        if (this._wss) {
            return
        }
        if (this._startPromise) {
            await this._startPromise
            return
        }

        this._startPromise = (async () => {
            const wss = await new Promise((resolve, reject) => {
                const server = new WebSocketServer({ port: this._config.wsPort })

                const onListening = () => {
                    cleanup()
                    resolve(server)
                }
                const onError = (err) => {
                    cleanup()
                    server.close()
                    reject(err)
                }
                const cleanup = () => {
                    server.off('listening', onListening)
                    server.off('error', onError)
                }

                server.once('listening', onListening)
                server.once('error', onError)
            })

            this._wss = /** @type {WebSocketServer} */ (wss)
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
        if (!this._wss && !this._watcher && !this._heartbeatTimer) {
            return
        }

        this._stopPromise = (async () => {
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
        })()

        try {
            await this._stopPromise
        } finally {
            this._stopPromise = null
        }
    }

    /**
     * Nudge the signal watcher — call after any write that should be pushed immediately.
     */
    nudge() {
        this._watcher?.nudge()
    }

    /**
     * Push a connector request card to all connected clients.
     * @param {ConnectorCardPayload} connector
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
            // Push onboarding status if registry is incomplete
            if (this._onboardingStatus) {
                this._send(ws, JSON.stringify({
                    type: 'onboarding_status',
                    items: this._onboardingStatus.items,
                    incomplete: this._onboardingStatus.incomplete,
                }))
            }

            const pending = await this._runtime.getPending()
            for (const contract of pending) {
                await this._sendDecision(ws, contract)
            }
        } catch (err) {
            this._logger.warn(`aura-pulse ws bootstrap error: ${String(err)}`)
        }
    }

    /**
     * @param {import('ws').WebSocket} ws
     * @param {BaseContract} contract
     */
    async _sendDecision(ws, contract) {
        const resumeToken = await this._storage.readResumeToken(contract.id)
        this._send(ws, buildDecision(contract, { resumeToken }))
    }

    /**
     * @param {BaseContract} contract
     */
    async _broadcastDecision(contract) {
        const resumeToken = await this._storage.readResumeToken(contract.id)
        this._broadcast(buildDecision(contract, { resumeToken }))
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
                const resolver = await this._getResolverActor(payload['contractId'])
                await this._runtime.transition(payload['contractId'], 'resolver_active', resolver)
            }
            break

        case 'resolve':
            // Resolver commits — consume token and move to executing
            if (typeof payload['contractId'] === 'string' && typeof payload['token'] === 'string' && typeof payload['action'] === 'string') {
                const resolver = await this._getResolverActor(payload['contractId'])
                const artifacts = typeof payload['artifacts'] === 'object' && payload['artifacts'] !== null
                    ? /** @type {Record<string, unknown>} */ (payload['artifacts'])
                    : undefined

                await this._runtime.resume(
                    payload['contractId'],
                    payload['token'],
                    resolver,
                    payload['action'],
                    payload['value'],
                    artifacts,
                )
                this._broadcast(buildClear(payload['contractId'], 'resolved'))
                if (this._executor) {
                    const contract = await this._runtime.get(payload['contractId'])
                    if (contract) {
                        this._executor.onExecuting(contract).catch((err) => {
                            this._logger.warn(`executor error: ${String(err)}`)
                        })
                    }
                }
            }
            break

        case 'abandon':
            // Resolver abandons — move back to waiting_approval
            if (typeof payload['contractId'] === 'string') {
                const resolver = await this._getResolverActor(payload['contractId'])
                await this._runtime.transition(payload['contractId'], 'waiting_approval', resolver)
            }
            break

        case 'ask_clarification':
            if (typeof payload['contractId'] === 'string' && typeof payload['question'] === 'string') {
                const resolver = await this._getResolverActor(payload['contractId'])
                await this._runtime.askClarification(payload['contractId'], payload['question'], resolver.id)
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
                    this.pushConnectorComplete(connId, 'declined')
                }
            }
            break
        }

        case 'complete_connector': {
            const connId     = payload['connectorId']
            const credential = payload['credential']  // optional — Etsy API key etc.
            if (typeof connId === 'string') {
                const existing = await this._storage.readConnector(connId)
                if (existing) {
                    const now = new Date().toISOString()
                    const {
                        declined_at: _declinedAt,
                        declined_reason: _declinedReason,
                        ...rest
                    } = existing
                    const update = {
                        ...rest,
                        status: /** @type {'active'} */ ('active'),
                        connected_at: existing.connected_at ?? now,
                        updated_at: now,
                    }
                    if (typeof credential === 'string' && credential.length > 0) {
                        // Store via AuraConnectorStore to get AES-256 encryption
                        const store = new AuraConnectorStore(this._storage, this._logger)
                        await store.write({ ...update, oauth_token_enc: credential })
                    } else {
                        await this._storage.writeConnector(update)
                    }
                    this.pushConnectorComplete(connId, 'active')
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
                void this._broadcastDecision(contract)
                break
            case 'clarifying':
                this._broadcast(buildSurfaceUpdate(contract))
                break
            case 'resolver_active': {
                const latest = contract.clarifications?.[contract.clarifications.length - 1]
                if (latest?.role === 'answer') {
                    this._broadcast(buildClarificationAnswer(contract, latest))
                } else {
                    this._broadcast(buildSurfaceUpdate(contract))
                }
                break
            }
            case 'complete':
                this._broadcast(buildCompletion(contract.id, contract.completion_surface ?? { summary: contract.result?.summary ?? 'completed' }))
                break
            case 'failed':
                this._broadcast(buildClear(contract.id, 'failed'))
                break
            default:
                break
            }
        }
    }

    /**
     * @param {string} contractId
     * @returns {Promise<import('@aura/contract-runtime').ParticipantRef>}
     */
    async _getResolverActor(contractId) {
        const contract = await this._runtime.get(contractId)
        if (!contract?.participants?.resolver) {
            throw new Error(`Resolver not found for contract ${contractId}`)
        }
        return /** @type {import('@aura/contract-runtime').ParticipantRef} */ (contract.participants.resolver)
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
