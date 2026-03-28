/**
 * Generic domain-type loader.
 *
 * Reads a declarative `domain-types.json` spec from an `.aurora` package and
 * converts each entry into a `ContractTypeDefinition` that the ContractRuntime
 * can register. No per-type code is required — adding a new domain type to an
 * `.aurora` package is purely a data change in `domain-types.json`.
 *
 * Field spec schema:
 * ```json
 * {
 *   "name": "platform",
 *   "type": "string" | "number" | "boolean",
 *   "required": true | false,
 *   "enum": ["a", "b"],   // optional — only for 'string' fields
 *   "min": 0,             // optional — only for 'number' fields
 *   "max": 100            // optional — only for 'number' fields
 * }
 * ```
 */

/**
 * @import { ContractTypeDefinition } from '@aura/contract-runtime'
 * @import { BaseContract } from '@aura/contract-runtime'
 */

/**
 * @typedef {object} FieldSpec
 * @property {string}  name
 * @property {'string' | 'number' | 'boolean'} type
 * @property {boolean} [required]
 * @property {string[]} [enum]
 * @property {number}  [min]
 * @property {number}  [max]
 */

/**
 * @typedef {object} DomainTypeSpec
 * @property {string}      type
 * @property {string}      [version]
 * @property {string}      [description]
 * @property {FieldSpec[]} fields
 */

/**
 * @typedef {object} DomainTypesManifest
 * @property {string}          version
 * @property {DomainTypeSpec[]} types
 */

/**
 * Build a `ContractTypeDefinition` from a declarative field spec.
 * The generated `validate()` checks required fields, types, enums, and numeric bounds.
 *
 * @param {DomainTypeSpec} spec
 * @returns {ContractTypeDefinition}
 */
function buildDefinition(spec) {
    return {
        type:        spec.type,
        version:     spec.version ?? '1.0',
        description: spec.description ?? '',

        /** @param {BaseContract} contract */
        validate(contract) {
            const errors = []
            const ctx = /** @type {Record<string, unknown>} */ (contract.intent?.context ?? {})

            for (const field of spec.fields) {
                const value = ctx[field.name]

                if (field.required) {
                    if (value == null || value === '') {
                        errors.push(`context.${field.name} is required`)
                        continue
                    }
                }

                if (value == null) continue  // optional, absent — skip further checks

                // Type check
                if (typeof value !== field.type) {
                    errors.push(`context.${field.name} must be a ${field.type}`)
                    continue
                }

                // Enum constraint (strings only)
                if (field.type === 'string' && field.enum && !field.enum.includes(/** @type {string} */ (value))) {
                    errors.push(`context.${field.name} must be one of: ${field.enum.join(', ')}`)
                }

                // Numeric bounds
                if (field.type === 'number') {
                    const n = /** @type {number} */ (value)
                    if (field.min != null && n < field.min) {
                        errors.push(`context.${field.name} must be >= ${field.min}`)
                    }
                    if (field.max != null && n > field.max) {
                        errors.push(`context.${field.name} must be <= ${field.max}`)
                    }
                }
            }

            return errors
        },
    }
}

/**
 * Convert a parsed `domain-types.json` manifest into an array of
 * `ContractTypeDefinition` objects ready for `runtime.registerType()`.
 *
 * Usage:
 * ```js
 * import manifest from '../../../artist-reseller/domain-types.json' assert { type: 'json' }
 * import { buildDomainTypeDefinitions } from './src/domain-types/loader.js'
 *
 * for (const def of buildDomainTypeDefinitions(manifest)) {
 *     runtime.registerType(def)
 * }
 * ```
 *
 * @param {DomainTypesManifest} manifest
 * @returns {ContractTypeDefinition[]}
 */
export function buildDomainTypeDefinitions(manifest) {
    if (!Array.isArray(manifest.types)) {
        throw new Error('[domain-type-loader] manifest.types must be an array')
    }
    return manifest.types.map(buildDefinition)
}
