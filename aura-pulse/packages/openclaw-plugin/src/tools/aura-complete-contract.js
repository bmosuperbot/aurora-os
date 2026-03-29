import { Type } from '@sinclair/typebox'

/**
 * @import { ContractRuntime } from '@aura/contract-runtime'
 * @import { SQLiteContractStorage } from '@aura/contract-runtime'
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
 * @param {SQLiteContractStorage} storage
 * @returns {import('../types/plugin-types.js').RegisteredTool}
 */
export function buildCompleteContract(runtime, storage) {
    return {
        name: 'aura_complete_contract',
        description:
            'Mark a contract as complete after all required work is done. ' +
            'Call this as the final step of every execution goal. ' +
            'Provide a brief human-readable summary of what was accomplished. ' +
            'If the contract has complete_requires entries, this call will fail with missing_required_actions until those action names have been logged.',
        parameters: Type.Object({
            contract_id: Type.String({ description: 'The ID of the contract to complete' }),
            summary:     Type.String({ description: 'Required human-readable summary of what was accomplished' }),
        }),
        async execute(_id, params) {
            const p = /** @type {{ contract_id: string, summary: string }} */ (params)
            const contract = await runtime.get(p.contract_id)
            if (!contract) {
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({ ok: false, error: 'contract_not_found', contract_id: p.contract_id }),
                    }],
                    isError: true,
                }
            }

            const required = Array.isArray(contract.complete_requires) ? contract.complete_requires : []
            if (required.length > 0) {
                const log = await storage.queryAutonomousLog({ contract_id: p.contract_id })
                const seen = new Set(log.map((entry) => entry.action))
                const missing = required.filter((action) => !seen.has(action))
                if (missing.length > 0) {
                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({
                                ok: false,
                                error: 'missing_required_actions',
                                contract_id: p.contract_id,
                                missing,
                            }),
                        }],
                        isError: true,
                    }
                }
            }

            const artifacts = contract.result?.artifacts ?? contract.resume?.artifacts
            const result = artifacts
                ? { success: true, summary: p.summary, artifacts }
                : { success: true, summary: p.summary }

            await storage.write({
                ...contract,
                updated_at: new Date().toISOString(),
                completion_surface: {
                    voice_line: contract.completion_surface?.voice_line ?? '',
                    summary: p.summary,
                },
                result,
            })

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
