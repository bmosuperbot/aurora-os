/**
 * @import { ContractTypeDefinition } from '../runtime/type-registry.js'
 * @import { BaseContract } from '../types/base-contract.js'
 * @import { GrantReportDraftContext } from './grant-report-draft.js'
 */

/** @type {ContractTypeDefinition} */
export const grantReportDraftType = {
    type: 'grant-report-draft',
    version: '1.0',
    description: 'Agent has compiled a grant report draft. Director reviews before submission.',

    /** @param {BaseContract} contract */
    validate(contract) {
        const errors = []
        const ctx = /** @type {Partial<GrantReportDraftContext>} */ (contract.intent.context)

        if (!ctx.funder_name)  errors.push('context.funder_name is required')
        if (!ctx.grant_id)     errors.push('context.grant_id is required')
        if (!ctx.report_period) errors.push('context.report_period is required')
        if (!ctx.deadline)     errors.push('context.deadline is required')
        if (!ctx.draft_path)   errors.push('context.draft_path is required')
        if (!Array.isArray(ctx.data_sources) || ctx.data_sources.length === 0) {
            errors.push('context.data_sources must contain at least one source')
        }

        return errors
    },
}
