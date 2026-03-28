import { Type } from '@sinclair/typebox'

/**
 * @import { SQLiteContractStorage } from '@aura/contract-runtime'
 * @import { WebSocketService } from '../services/websocket-service.js'
 */

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
 * aura_request_connection — surface a connector-card request to the human.
 *
 * @param {SQLiteContractStorage} storage
 * @param {WebSocketService} wsService
 * @returns {import('../types/plugin-types.js').RegisteredTool}
 */
export function buildRequestConnection(storage, wsService) {
    return {
        name: 'aura_request_connection',
        description:
            'Request a human to authorise a new service connection (OAuth, API key, etc.). ' +
            'Pushes a connector card to the Pulse surface and records the connection as pending.',
        parameters: Type.Object({
            connector_id: Type.String({ description: 'Unique identifier for this connector type (e.g. "github", "notion")' }),
            display_name: Type.String({ description: 'Human-readable name shown on the connector card' }),
            scopes:       Type.Optional(Type.Array(Type.String(), { description: 'OAuth scopes or permission names being requested' })),
            reason:       Type.String({ description: 'Why this connection is needed' }),
            flow_type:    Type.Optional(Type.Union([
                Type.Literal('browser_redirect'),
                Type.Literal('secure_input'),
                Type.Literal('manual_guide'),
            ], { description: 'How the Pulse UI should complete this connector flow' })),
            auth_url:     Type.Optional(Type.String({ description: 'Authorization URL for browser redirect flows' })),
            input_label:  Type.Optional(Type.String({ description: 'Label for secure-input flows' })),
            guide_steps:  Type.Optional(Type.Array(Type.String(), { description: 'Step-by-step instructions for manual guide flows' })),
        }),
        async execute(_id, params) {
            const p = /** @type {any} */ (params)

            // Write connector state as pending — ConnectorState is the canonical shape
            /** @type {import('@aura/contract-runtime').ConnectorState} */
            const state = {
                id:                  p.connector_id,
                source:              'aura-connector',
                status:              'pending',
                offered_at:          new Date().toISOString(),
                capability_without:  p.reason,
                capability_with:     p.reason,
                updated_at:          new Date().toISOString(),
            }
            await storage.writeConnector(state)

            // Push the connector card to connected surfaces
            const flowType = /** @type {'browser_redirect' | 'secure_input' | 'manual_guide' | undefined} */ (
                p.flow_type ?? (p.auth_url ? 'browser_redirect' : p.input_label ? 'secure_input' : p.guide_steps ? 'manual_guide' : undefined)
            )
            /** @type {ConnectorCardPayload} */
            const card = {
                id:                 state.id,
                source:             /** @type {'aura-connector'} */ (state.source),
                status:             state.status,
                capability_without: state.capability_without,
                capability_with:    state.capability_with,
                connector_id:       p.connector_id,
                connector_name:     p.display_name,
                offer_text:         p.reason,
                ...(state.offered_at ? { offered_at: state.offered_at } : {}),
                ...(flowType        ? { flow_type:   flowType }          : {}),
                ...(p.auth_url      ? { auth_url:    p.auth_url }        : {}),
                ...(p.input_label   ? { input_label: p.input_label }     : {}),
                ...(p.guide_steps   ? { guide_steps: p.guide_steps }     : {}),
            }
            wsService.pushConnectorRequest(card)

            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({ connector_id: p.connector_id, status: 'pending' }),
                }],
            }
        },
    }
}
