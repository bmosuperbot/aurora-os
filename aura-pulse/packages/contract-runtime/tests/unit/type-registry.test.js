import { describe, it, expect, beforeEach } from 'vitest'
import { TypeRegistry } from '../../src/runtime/type-registry.js'
import { UnknownContractTypeError, ContractValidationError } from '../../src/types/errors.js'
import { offerReceivedType } from '../../src/domain-types/offer-received.js'
import { grantReportDraftType } from '../../src/domain-types/grant-report-draft.js'
import { makeContract, makeGrantContract, makeOfferContext } from '../helpers/fixtures.js'

describe('TypeRegistry', () => {
    let registry
    beforeEach(() => { registry = new TypeRegistry() })

    it('registers a type definition', () => {
        registry.register(offerReceivedType)
        expect(registry.has('offer-received')).toBe(true)
    })

    it('throws on duplicate registration', () => {
        registry.register(offerReceivedType)
        expect(() => registry.register(offerReceivedType)).toThrow()
    })

    it('lists registered types', () => {
        registry.register(offerReceivedType)
        registry.register(grantReportDraftType)
        expect(registry.list()).toContain('offer-received')
        expect(registry.list()).toContain('grant-report-draft')
    })

    it('throws UnknownContractTypeError for unregistered type', () => {
        expect(() => registry.validate(makeContract({ type: 'unknown-type' }))).toThrow(UnknownContractTypeError)
    })

    it('passes validation for a valid offer-received contract', () => {
        registry.register(offerReceivedType)
        expect(() => registry.validate(makeContract())).not.toThrow()
    })

    it('throws ContractValidationError for offer-received with missing offer_amount', () => {
        registry.register(offerReceivedType)
        const contract = makeContract({
            intent: { goal: '', trigger: '', context: makeOfferContext({ offer_amount: undefined }) },
        })
        expect(() => registry.validate(contract)).toThrow(ContractValidationError)
    })

    it('throws ContractValidationError for offer-received with offer_amount = 0', () => {
        registry.register(offerReceivedType)
        const contract = makeContract({
            intent: { goal: '', trigger: '', context: makeOfferContext({ offer_amount: 0 }) },
        })
        const err = /** @type {ContractValidationError} */ (
            (() => { try { registry.validate(contract) } catch (e) { return e } })()
        )
        expect(err).toBeInstanceOf(ContractValidationError)
        expect(err.details.some(d => d.includes('offer_amount'))).toBe(true)
    })

    it('passes validation for a valid grant-report-draft contract', () => {
        registry.register(grantReportDraftType)
        expect(() => registry.validate(makeGrantContract())).not.toThrow()
    })

    it('throws ContractValidationError for grant-report-draft with missing deadline', () => {
        registry.register(grantReportDraftType)
        const contract = makeGrantContract()
        delete contract.intent.context.deadline
        expect(() => registry.validate(contract)).toThrow(ContractValidationError)
    })
})
