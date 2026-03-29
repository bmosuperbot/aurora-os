/**
 * WebSocket message protocol for the Aura Pulse surface transport.
 *
 * Runtime → Surface messages:
 *   decision           — a contract in waiting_approval ready to be surfaced
 *   surface_update     — contract surface fields changed
 *   clarification_answer — agent answered an active clarification
 *   clear              — contract is no longer surfaceable (resolved/failed)
 *   completion         — contract reached complete status
 *   kernel_surface     — general-purpose OpenClaw kernel interface rendered in Pulse
 *   clear_kernel_surface — clear the general-purpose kernel interface
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
 *   submit_command     — owner-originated Aura Pulse command for the primary agent
 */

/**
 * Connector card payload sent to Pulse. This is separate from ConnectorState:
 * storage keeps the durable connector record, while the websocket layer carries
 * the UI metadata needed to render the connector flow.
 *
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
 * @param {import('@aura/contract-runtime').BaseContract} contract
 * @param {{ resumeToken?: string | null, a2uiMessages?: unknown[] }} [extras]
 * @returns {string}
 */
export function buildDecision(contract, extras = {}) {
    return JSON.stringify({
        type: 'decision',
        payload: {
            contract,
            ...(extras.resumeToken ? { resumeToken: extras.resumeToken } : {}),
            ...(extras.a2uiMessages ? { a2uiMessages: extras.a2uiMessages } : {}),
        },
    })
}

/**
 * @param {import('@aura/contract-runtime').BaseContract} contract
 * @returns {string}
 */
export function buildSurfaceUpdate(contract) {
    return JSON.stringify({
        type: 'surface_update',
        payload: {
            contractId: contract.id,
            surface: contract.surface,
            contract,
        },
    })
}

/**
 * @param {import('@aura/contract-runtime').BaseContract} contract
 * @param {import('@aura/contract-runtime').ClarificationEntry} entry
 * @returns {string}
 */
export function buildClarificationAnswer(contract, entry) {
    return JSON.stringify({
        type: 'clarification_answer',
        payload: {
            contractId: contract.id,
            entry,
            contract,
        },
    })
}

/**
 * @param {string} contractId
 * @param {'resolved' | 'failed' | 'timeout'} [reason]
 * @returns {string}
 */
export function buildClear(contractId, reason = 'resolved') {
    return JSON.stringify({ type: 'clear', payload: { contractId, reason } })
}

/**
 * @param {string} contractId
 * @param {{ voice_line?: string, summary?: string } | null | undefined} surface
 * @returns {string}
 */
export function buildCompletion(contractId, surface) {
    return JSON.stringify({
        type: 'completion',
        payload: {
            contractId,
            surface: {
                voice_line: surface?.voice_line ?? '',
                summary: surface?.summary ?? 'completed',
            },
        },
    })
}

/**
 * @param {{ surfaceId: string, title?: string, summary?: string, voiceLine?: string, surfaceType?: 'workspace' | 'plan' | 'attention' | 'monitor' | 'brief', priority?: 'low' | 'normal' | 'high', collaborative?: boolean, icon?: string, a2uiMessages?: unknown[] }} surface
 * @returns {string}
 */
export function buildKernelSurface(surface) {
    return JSON.stringify({
        type: 'kernel_surface',
        payload: {
            surfaceId: surface.surfaceId,
            ...(surface.title ? { title: surface.title } : {}),
            ...(surface.summary ? { summary: surface.summary } : {}),
            ...(surface.voiceLine ? { voiceLine: surface.voiceLine } : {}),
            ...(surface.surfaceType ? { surfaceType: surface.surfaceType } : {}),
            ...(surface.priority ? { priority: surface.priority } : {}),
            ...(typeof surface.collaborative === 'boolean' ? { collaborative: surface.collaborative } : {}),
            ...(surface.icon ? { icon: surface.icon } : {}),
            ...(surface.a2uiMessages ? { a2uiMessages: surface.a2uiMessages } : {}),
        },
    })
}

/**
 * @param {string} surfaceId
 * @returns {string}
 */
export function buildClearKernelSurface(surfaceId) {
    return JSON.stringify({ type: 'clear_kernel_surface', payload: { surfaceId } })
}

/**
 * @param {ConnectorCardPayload} connector
 * @returns {string}
 */
export function buildConnectorRequest(connector) {
    // Never send raw secrets — strip encrypted token blobs
    const safe = {
        id:                 connector.id,
        connector_id:       connector.id,
        connector_name:     connector.connector_name,
        offer_text:         connector.offer_text,
        flow_type:          connector.flow_type,
        auth_url:           connector.auth_url,
        input_label:        connector.input_label,
        guide_steps:        connector.guide_steps,
        source:             connector.source,
        status:             connector.status,
        capability_without: connector.capability_without,
        capability_with:    connector.capability_with,
        offered_at:         connector.offered_at,
        never_resurface:    connector.never_resurface,
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
 * @param {string} commandId
 * @param {'accepted' | 'rejected'} status
 * @param {string} message
 * @returns {string}
 */
export function buildCommandStatus(commandId, status, message) {
    return JSON.stringify({ type: 'command_status', payload: { commandId, status, message } })
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
