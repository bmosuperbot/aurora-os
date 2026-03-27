import { Type } from '@sinclair/typebox'

/**
 * @import { SQLiteContractStorage } from '@aura/contract-runtime'
 * @import { WebSocketService } from '../services/websocket-service.js'
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
            wsService.pushConnectorRequest(state)

            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({ connector_id: p.connector_id, status: 'pending' }),
                }],
            }
        },
    }
}
