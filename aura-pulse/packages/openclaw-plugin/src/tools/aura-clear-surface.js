import { Type } from '@sinclair/typebox'

/**
 * @typedef {{
 *   clearKernelSurface(surfaceId: string): void,
 * }} ClearSurfaceTransport
 */

/**
 * Clear a previously rendered generic Pulse surface.
 *
 * @param {ClearSurfaceTransport} wsService
 * @returns {import('../types/plugin-types.js').RegisteredTool}
 */
export function buildClearSurface(wsService) {
    return {
        name: 'aura_clear_surface',
        description: 'Clear a previously rendered general-purpose Aura Pulse surface created by aura_render_surface. Use the same surface_id that was rendered earlier.',
        parameters: Type.Object({
            surface_id: Type.String({ description: 'Surface id to clear' }),
        }),
        /**
         * @param {string} _id
         * @param {{ surface_id: string }} params
         */
        async execute(_id, params) {
            const p = /** @type {{ surface_id: string }} */ (params)
            wsService.clearKernelSurface(p.surface_id)

            return /** @type {import('../types/plugin-types.js').ToolResult} */ ({
                content: [{
                    type: 'text',
                    text: JSON.stringify({ surfaceId: p.surface_id, status: 'cleared' }),
                }],
            })
        },
    }
}
