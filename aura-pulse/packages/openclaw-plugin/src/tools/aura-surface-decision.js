import { Type } from '@sinclair/typebox'
import { randomUUID } from 'node:crypto'

/**
 * @import { ContractRuntime } from '@aura/contract-runtime'
 * @typedef {Object} SurfaceDecisionParams
 * @property {string} type
 * @property {string} goal
 * @property {string} trigger
 * @property {Record<string, unknown>} context
 * @property {Array<{id: string, label: string, action?: string, value?: unknown, style?: 'primary' | 'secondary' | 'destructive'}>} [actions]
 * @property {string} [summary]
 * @property {string} [voice_line]
 * @property {string} [expires_at]
 * @property {string} [surface_after]
 * @property {string} [writer_id]
 */

/**
 * aura_surface_decision — primary agent only.
 * Creates or updates a human-resolved contract and surfaces it for approval.
 *
 * @param {ContractRuntime} runtime
 * @returns {import('../types/plugin-types.js').RegisteredTool}
 */
export function buildSurfaceDecision(runtime) {
    return {
        name: 'aura_surface_decision',
        description: 'Surface a decision card to the owner for approval. Creates a waiting_approval contract and makes it visible in the Pulse UI. Use this when the agent reaches a decision point that requires human judgment.',
        parameters: Type.Object({
            type:       Type.String({ description: 'Registered contract domain type, e.g. offer-received' }),
            goal:       Type.String({ description: 'What the agent is trying to accomplish' }),
            trigger:    Type.String({ description: 'What caused this decision to be surfaced' }),
            context:    Type.Record(Type.String(), Type.Unknown(), { description: 'Domain-specific context data' }),
            actions:    Type.Optional(Type.Array(Type.Object({
                id:    Type.String(),
                label: Type.String(),
                action: Type.Optional(Type.String()),
                value: Type.Optional(Type.Unknown()),
                style: Type.Optional(Type.Union([
                    Type.Literal('primary'),
                    Type.Literal('secondary'),
                    Type.Literal('destructive'),
                ])),
            }), { description: 'Selectable actions for the resolver' })),
            summary:     Type.Optional(Type.String({ description: 'Human-readable summary for the decision card' })),
            voice_line:  Type.Optional(Type.String({ description: 'Short voice line for the decision card' })),
            expires_at:  Type.Optional(Type.String({ description: 'ISO-8601 TTL for the decision' })),
            surface_after: Type.Optional(Type.String({ description: 'ISO-8601 timestamp — defer display until this time' })),
            writer_id:   Type.Optional(Type.String({ description: 'Agent ID creating this contract. Default: agent-primary' })),
        }),
        async execute(_id, params) {
            const p          = /** @type {SurfaceDecisionParams} */ (params)
            const writerId   = p.writer_id ?? 'agent-primary'
            const contractId = randomUUID()
            const now        = new Date().toISOString()
            const normalizedActions = Array.isArray(p.actions)
                ? p.actions.map((action, index) => ({
                    id: action.id,
                    label: action.label,
                    action: typeof action.action === 'string'
                        ? action.action
                        : typeof action.value === 'string'
                            ? action.value
                            : action.id,
                    ...(action.value !== undefined ? { value: action.value } : {}),
                    style: action.style ?? (index === 0 ? 'primary' : 'secondary'),
                }))
                : []

            /** @type {import('@aura/contract-runtime').BaseContract} */
            const contract = {
                id: contractId,
                version: '1.0',
                type: p.type,
                status: 'created',
                created_at: now,
                updated_at: now,
                participants: {
                    writer:   { id: writerId, type: 'agent' },
                    resolver: { id: 'owner', type: 'human' },
                },
                intent: { goal: p.goal, trigger: p.trigger, context: p.context ?? {} },
                ...(p.expires_at    ? { expires_at: p.expires_at }       : {}),
                ...(p.surface_after ? { surface_after: p.surface_after } : {}),
                ...(p.summary       ? { surface: {
                    voice_line: p.voice_line ?? '',
                    summary: p.summary,
                    recommendation: { action: 'review', reasoning: p.goal },
                    actions: normalizedActions,
                    version: 1,
                } } : {}),
            }

            await runtime.create(contract)
            await runtime.transition(contractId, 'active', { id: writerId, type: 'agent' })
            await runtime.transition(contractId, 'waiting_approval', { id: writerId, type: 'agent' })

            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({ contractId, status: 'waiting_approval', type: p.type }),
                }],
            }
        },
    }
}
