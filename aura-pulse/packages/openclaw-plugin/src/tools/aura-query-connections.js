import { Type } from '@sinclair/typebox'

/**
 * @import { SQLiteContractStorage } from '@aura/contract-runtime'
 */

/**
 * aura_query_connections — lists connector states.
 * NEVER returns encrypted token fields.
 *
 * @param {SQLiteContractStorage} storage
 * @returns {import('../types/plugin-types.js').RegisteredTool}
 */
export function buildQueryConnections(storage) {
    return {
        name: 'aura_query_connections',
        description: 'List known connector states. Token or credential fields are never returned. This tool only supports an optional status filter; it does not support filtering by connector id, name, or source. If you need one connector, call this tool and filter the returned rows client-side.',
        parameters: Type.Object({
            status: Type.Optional(Type.String({ description: 'Optional status filter. Supported values are pending, active, declined, revoked, error, and not-offered.' })),
        }),
        async execute(_id, params) {
            const p       = /** @type {any} */ (params)
            const rows    = await storage.readConnectors()
            const visible = rows
                .filter(c => !p.status || c.status === p.status)
                .map(c => {
                    // Omit encrypted token fields — never leakable
                    const { oauth_token_enc: _ot, refresh_token_enc: _rt, ...safe } = c
                    return safe
                })

            return { content: [{ type: 'text', text: JSON.stringify(visible) }] }
        },
    }
}
