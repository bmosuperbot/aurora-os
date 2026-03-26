export class AuraRuntimeError extends Error {
    /** @param {string} message */
    constructor(message) {
        super(message)
        this.name = 'AuraRuntimeError'
    }
}

export class InvalidTransitionError extends AuraRuntimeError {
    /**
     * @param {string} contractId
     * @param {string} from
     * @param {string} to
     */
    constructor(contractId, from, to) {
        super(`Invalid transition: ${from} → ${to} on contract ${contractId}`)
        this.name = 'InvalidTransitionError'
        /** @type {string} */ this.contractId = contractId
        /** @type {string} */ this.from = from
        /** @type {string} */ this.to = to
    }
}

export class TerminalStateError extends AuraRuntimeError {
    /**
     * @param {string} contractId
     * @param {string} status
     */
    constructor(contractId, status) {
        super(`Contract ${contractId} is terminal (${status}) — no further transitions`)
        this.name = 'TerminalStateError'
        /** @type {string} */ this.contractId = contractId
        /** @type {string} */ this.status = status
    }
}

export class UnauthorizedRoleError extends AuraRuntimeError {
    /**
     * @param {string} participantId
     * @param {string} role
     * @param {string} operation
     */
    constructor(participantId, role, operation) {
        super(`${participantId} (role: ${role}) is not authorized to: ${operation}`)
        this.name = 'UnauthorizedRoleError'
        /** @type {string} */ this.participantId = participantId
        /** @type {string} */ this.role = role
        /** @type {string} */ this.operation = operation
    }
}

export class InvalidResumeTokenError extends AuraRuntimeError {
    /** @param {string} contractId */
    constructor(contractId) {
        super(`Invalid or already-used resume token for contract ${contractId}`)
        this.name = 'InvalidResumeTokenError'
        /** @type {string} */ this.contractId = contractId
    }
}

export class ResumeRequiredError extends AuraRuntimeError {
    /** @param {string} contractId */
    constructor(contractId) {
        super(`Contract ${contractId} must use resume() to enter executing`)
        this.name = 'ResumeRequiredError'
        /** @type {string} */ this.contractId = contractId
    }
}

export class UnknownContractTypeError extends AuraRuntimeError {
    /** @param {string} type */
    constructor(type) {
        super(`Unknown contract type: "${type}". Register it with TypeRegistry first.`)
        this.name = 'UnknownContractTypeError'
        /** @type {string} */ this.type = type
    }
}

export class ContractValidationError extends AuraRuntimeError {
    /**
     * @param {string} type
     * @param {string[]} details
     */
    constructor(type, details) {
        super(`Validation failed for type "${type}": ${details.join('; ')}`)
        this.name = 'ContractValidationError'
        /** @type {string} */ this.type = type
        /** @type {string[]} */ this.details = details
    }
}

export class ContractNotFoundError extends AuraRuntimeError {
    /** @param {string} contractId */
    constructor(contractId) {
        super(`Contract not found: ${contractId}`)
        this.name = 'ContractNotFoundError'
        /** @type {string} */ this.contractId = contractId
    }
}
