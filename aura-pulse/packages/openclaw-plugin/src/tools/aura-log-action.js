import { Type } from '@sinclair/typebox'
import { randomUUID } from 'node:crypto'

/**
 * @import { ContractRuntime } from '@aura/contract-runtime'
 */

/**
 * aura_log_action — log a pre-authorized autonomous action.
 *
 * @param {ContractRuntime} runtime
 * @returns {import('../types/plugin-types.js').RegisteredTool}
 */
export function buildLogAction(runtime) {
    return {
        name: 'aura_log_action',
        description: 'Record a pre-authorized autonomous action in the audit log. Every autonomous action must be logged for owner transparency.',
        parameters: Type.Object({
            action:        Type.String({ description: 'Short action name, e.g. sent-counter-offer' }),
            summary:       Type.String({ description: 'Human-readable description of what was done' }),
            agent_id:      Type.Optional(Type.String({ description: 'Agent ID performing the action. Default: agent-primary' })),
            package:       Type.Optional(Type.String({ description: 'Package or module that triggered the action. Default: aura-pulse' })),
            detail:        Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: 'Extra structured detail' })),
            contract_id:   Type.Optional(Type.String({ description: 'Associated contract ID if applicable' })),
            connector_used: Type.Optional(Type.String({ description: 'Connector used for this action, e.g. gmail-agent' })),
        }),
        async execute(_id, params) {
            const p = /** @type {any} */ (params)
            await runtime.logAutonomousAction({
                id:             randomUUID(),
                timestamp:      new Date().toISOString(),
                agent_id:       p.agent_id      ?? 'agent-primary',
                package:        p.package       ?? 'aura-pulse',
                action:         p.action,
                summary:        p.summary,
                detail:         p.detail        ?? null,
                contract_id:    p.contract_id   ?? null,
                connector_used: p.connector_used ?? '',
            })
            return { content: [{ type: 'text', text: 'logged' }] }
        },
    }
}
