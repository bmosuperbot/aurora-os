export declare const ContractStatus: {
    readonly CREATED:          'created';
    readonly ACTIVE:           'active';
    readonly WAITING_APPROVAL: 'waiting_approval';
    readonly RESOLVER_ACTIVE:  'resolver_active';
    readonly CLARIFYING:       'clarifying';
    readonly EXECUTING:        'executing';
    readonly COMPLETE:         'complete';
    readonly FAILED:           'failed';
};

export type ContractStatusValue = typeof ContractStatus[keyof typeof ContractStatus];

export declare const VALID_TRANSITIONS: Record<ContractStatusValue, ContractStatusValue[]>;
export declare const TERMINAL_STATUSES: ContractStatusValue[];
