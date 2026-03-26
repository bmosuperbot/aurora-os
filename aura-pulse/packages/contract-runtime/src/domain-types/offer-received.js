/**
 * @import { ContractTypeDefinition } from '../runtime/type-registry.js'
 * @import { BaseContract } from '../types/base-contract.js'
 * @import { OfferReceivedContext } from './offer-received.js'
 */

/** @type {ContractTypeDefinition} */
export const offerReceivedType = {
    type: 'offer-received',
    version: '1.0',
    description: 'A buyer has made an offer on a listing. Requires owner decision to accept, counter, or decline.',

    /** @param {BaseContract} contract */
    validate(contract) {
        const errors = []
        const ctx = /** @type {Partial<OfferReceivedContext>} */ (contract.intent.context)

        if (!ctx.platform)             errors.push('context.platform is required')
        if (!ctx.listing_id)           errors.push('context.listing_id is required')
        if (!ctx.listing_title)        errors.push('context.listing_title is required')
        if (!ctx.buyer_id)             errors.push('context.buyer_id is required')
        if (ctx.offer_amount == null)  errors.push('context.offer_amount is required')
        if (ctx.asking_price == null)  errors.push('context.asking_price is required')

        if (ctx.offer_amount != null && ctx.offer_amount <= 0) {
            errors.push('context.offer_amount must be greater than 0')
        }
        if (ctx.offer_amount != null && ctx.asking_price != null && ctx.offer_amount > ctx.asking_price) {
            errors.push('context.offer_amount cannot exceed asking_price')
        }

        return errors
    },
}
