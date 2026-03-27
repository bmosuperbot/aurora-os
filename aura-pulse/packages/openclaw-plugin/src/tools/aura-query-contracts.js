import { Type } from '@sinclair/typebox'

/**
 * @import { ContractRuntime } from '@aura/contract-runtime'
 */

/**
 * aura_query_contracts — read-only contract query surface.
 *
 * @param {ContractRuntime} runtime
 * @returns {import('../types/plugin-types.js').RegisteredTool}
 */
export function buildQueryContracts(runtime) {
    return {
        name: 'aura_query_contracts',
        description: 'Query contracts by status, type, parent, or recency. Read-only.',
        parameters: Type.Object({
            id:            Type.Optional(Type.String({ description: 'Fetch a single contract by ID' })),
            status:        Type.Optional(Type.Union([
                Type.String(),
                Type.Array(Type.String()),
            ], { description: 'Filter by status or array of statuses' })),
            type:          Type.Optional(Type.String({ description: 'Filter by contract domain type' })),
            parent_id:     Type.Optional(Type.String({ description: 'Filter by parent contract ID' })),
            resolver_type: Type.Optional(Type.Enum({ human: 'human', agent: 'agent' }, { description: 'Filter by resolver type' })),
            updated_after: Type.Optional(Type.String({ description: 'ISO-8601 — return contracts updated after this timestamp' })),
            limit:         Type.Optional(Type.Number({ description: 'Max results to return. Default: 20', minimum: 1, maximum: 200 })),
        }),
        async execute(_id, params) {
            const p = /** @type {any} */ (params)
            let result

            if (p.id) {
                const contract = await runtime.get(p.id)
                result = contract ? [contract] : []
            } else {
                const filter = /** @type {import('@aura/contract-runtime').ContractFilter} */ ({})
                if (p.status)        filter.status        = p.status
                if (p.type)          filter.type          = p.type
                if (p.parent_id)     filter.parent_id     = p.parent_id
                if (p.resolver_type) filter.resolver_type = p.resolver_type
                if (p.updated_after) filter.updated_after = p.updated_after

                const all    = await runtime.list(filter)
                const limit  = p.limit ?? 20
                result       = all.slice(0, limit)
            }

            return { content: [{ type: 'text', text: JSON.stringify(result) }] }
        },
    }
}
