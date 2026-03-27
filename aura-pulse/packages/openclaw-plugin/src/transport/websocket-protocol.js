/**
 * WebSocket message protocol for the Aura Pulse surface transport.
 *
 * Runtime → Surface messages:
 *   decision           — a contract in waiting_approval ready to be surfaced
 *   surface_update     — contract surface fields changed
 *   clarification      — clarification entry added (question or answer)
 *   clear              — contract is no longer surfaceable (resolved/failed)
 *   completion         — contract reached complete status
 *   connector_request  — connector card to display
 *   connector_complete — connector flow finished
 *
 * Surface → Runtime messages:
 *   engage             — resolver has opened the decision card
 *   ask_clarification  — resolver is asking a question
 *   resolve            — resolver commits with token + action + value
 *   abandon            — resolver abandons the active card
 *   initiate_connector — operator wants to start a connector flow
 *   complete_connector — connector data received from the surface
 *   decline_connector  — operator declines a connector offer
 */

/**
 * @param {import('@aura/contract-runtime').BaseContract} contract
 * @returns {string}
 */
export function buildDecision(contract) {
    return JSON.stringify({ type: 'decision', payload: contract })
}

/**
 * @param {string} contractId
 * @param {import('@aura/contract-runtime').BaseContract['surface']} surface
 * @returns {string}
 */
export function buildSurfaceUpdate(contractId, surface) {
    return JSON.stringify({ type: 'surface_update', payload: { contractId, surface } })
}

/**
 * @param {string} contractId
 * @returns {string}
 */
export function buildClear(contractId) {
    return JSON.stringify({ type: 'clear', payload: { contractId } })
}

/**
 * @param {string} contractId
 * @param {string} summary
 * @returns {string}
 */
export function buildCompletion(contractId, summary) {
    return JSON.stringify({ type: 'completion', payload: { contractId, summary } })
}

/**
 * @param {import('@aura/contract-runtime').ConnectorState} connector
 * @returns {string}
 */
export function buildConnectorRequest(connector) {
    // Never send raw secrets — strip encrypted token blobs
    const safe = {
        id:                connector.id,
        source:            connector.source,
        status:            connector.status,
        capability_without: connector.capability_without,
        capability_with:   connector.capability_with,
        offered_at:        connector.offered_at,
        never_resurface:   connector.never_resurface,
    }
    return JSON.stringify({ type: 'connector_request', payload: safe })
}

/**
 * @param {string} connectorId
 * @param {string} status
 * @returns {string}
 */
export function buildConnectorComplete(connectorId, status) {
    return JSON.stringify({ type: 'connector_complete', payload: { connectorId, status } })
}

/**
 * Parse an inbound surface message. Returns null if malformed.
 *
 * @param {string | Buffer} raw
 * @returns {{ type: string, payload: Record<string, unknown> } | null}
 */
export function parseInbound(raw) {
    try {
        const msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString())
        if (typeof msg.type !== 'string') return null
        return { type: msg.type, payload: msg.payload ?? {} }
    } catch {
        return null
    }
}
