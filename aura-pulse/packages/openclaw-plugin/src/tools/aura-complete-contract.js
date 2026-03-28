import { Type } from '@sinclair/typebox'

/**
 * @import { ContractRuntime } from '@aura/contract-runtime'
 */

/**
 * aura_complete_contract — mark a contract as complete after the agent has
 * finished all required work in the `executing` state.
 *
 * The agent should call this tool as the final step of every execution goal.
 * The runtime will transition the contract to `complete` and fire the
 * completion notifier (Engram bridge, etc.).
 *
 * @param {ContractRuntime} runtime
 * @returns {import('../types/plugin-types.js').RegisteredTool}
 */
export function buildCompleteContract(runtime) {
    return {
        name: 'aura_complete_contract',
        description:
            'Mark a contract as complete after all required work is done. ' +
            'Call this as the final step of every execution goal. ' +
            'Provide a brief human-readable summary of what was accomplished.',
        parameters: Type.Object({
            contract_id: Type.String({ description: 'The ID of the contract to complete' }),
            summary:     Type.String({ description: 'Human-readable summary of what was accomplished' }),
        }),
        async execute(_id, params) {
            const p = /** @type {{ contract_id: string, summary: string }} */ (params)
            await runtime.transition(p.contract_id, 'complete', {
                id:   'agent-primary',
                type: 'agent',
            })
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({ ok: true, contract_id: p.contract_id, summary: p.summary }),
                    },
                ],
            }
        },
    }
}
