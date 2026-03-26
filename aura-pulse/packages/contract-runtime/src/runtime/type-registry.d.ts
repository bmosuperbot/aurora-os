import type { BaseContract } from '../types/base-contract.js';

export interface ContractTypeDefinition {
    type: string;
    version: string;
    description: string;
    validate(contract: BaseContract): string[];
}

export class TypeRegistry {
    register(definition: ContractTypeDefinition): void;
    validate(contract: BaseContract): void;
    has(type: string): boolean;
    list(): string[];
}
