import { Type } from '@sinclair/typebox'
import { randomUUID } from 'node:crypto'

/**
 * @import { ContractRuntime } from '@aura/contract-runtime'
 */

/**
 * aura_report_to_primary — orchestrator and workers only.
 * Creates an agent-resolved contract for the primary agent instead of surfacing to human.
 *
 * @param {ContractRuntime} runtime
 * @returns {import('../types/plugin-types.js').RegisteredTool}
 */
export function buildReportToPrimary(runtime) {
    return {
        name: 'aura_report_to_primary',
        description: 'Report a task result or decision back to the primary agent. Creates an agent-resolved contract visible in the primary agent context, not to the human. Use this for inter-agent coordination.',
        parameters: Type.Object({
            type:       Type.String({ description: 'Contract domain type' }),
            goal:       Type.String({ description: 'What was being accomplished' }),
            trigger:    Type.String({ description: 'What triggered this report' }),
            context:    Type.Record(Type.String(), Type.Unknown(), { description: 'Domain-specific context' }),
            summary:    Type.Optional(Type.String({ description: 'Summary of the result' })),
            writer_id:  Type.Optional(Type.String({ description: 'Reporting agent ID. Default: agent-orchestrator' })),
            primary_id: Type.Optional(Type.String({ description: 'Primary agent ID to receive the report. Default: agent-primary' })),
            parent_id:  Type.Optional(Type.String({ description: 'Parent contract ID if this is a subtask report' })),
        }),
        async execute(_id, params) {
            const p          = /** @type {any} */ (params)
            const writerId   = p.writer_id  ?? 'agent-orchestrator'
            const primaryId  = p.primary_id ?? 'agent-primary'
            const contractId = randomUUID()
            const now        = new Date().toISOString()

            /** @type {import('@aura/contract-runtime').BaseContract} */
            const contract = {
                id: contractId,
                version: '1.0',
                type: p.type,
                status: 'created',
                created_at: now,
                updated_at: now,
                participants: {
                    writer:   { id: writerId,  type: 'agent' },
                    resolver: { id: primaryId, type: 'agent' },
                },
                intent: { goal: p.goal, trigger: p.trigger, context: p.context ?? {} },
                ...(p.parent_id ? { parent_id: p.parent_id } : {}),
            }

            await runtime.create(contract)
            await runtime.transition(contractId, 'active', { id: writerId, type: 'agent' })
            await runtime.transition(contractId, 'waiting_approval', { id: writerId, type: 'agent' })

            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({ contractId, status: 'waiting_approval', resolver: primaryId }),
                }],
            }
        },
    }
}
