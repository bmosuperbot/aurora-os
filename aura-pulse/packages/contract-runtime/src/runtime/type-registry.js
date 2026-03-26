/**
 * @import { BaseContract } from '../types/base-contract.js'
 * @import { ContractTypeDefinition } from './type-registry.js'
 */

import { UnknownContractTypeError, ContractValidationError } from '../types/errors.js'

export class TypeRegistry {
    constructor() {
        /** @type {Map<string, ContractTypeDefinition>} */
        this._types = new Map()
    }

    /**
     * Register a domain contract type.
     * @param {ContractTypeDefinition} definition
     * @returns {void}
     * @throws {Error} if the type is already registered
     */
    register(definition) {
        if (this._types.has(definition.type)) {
            throw new Error(`Contract type already registered: "${definition.type}"`)
        }
        this._types.set(definition.type, definition)
    }

    /**
     * Validate a contract against its registered type.
     * @param {BaseContract} contract
     * @returns {void}
     * @throws {UnknownContractTypeError}
     * @throws {ContractValidationError}
     */
    validate(contract) {
        const definition = this._types.get(contract.type)
        if (!definition) throw new UnknownContractTypeError(contract.type)
        const errors = definition.validate(contract)
        if (errors.length > 0) throw new ContractValidationError(contract.type, errors)
    }

    /**
     * @param {string} type
     * @returns {boolean}
     */
    has(type) {
        return this._types.has(type)
    }

    /** @returns {string[]} */
    list() {
        return Array.from(this._types.keys())
    }
}
