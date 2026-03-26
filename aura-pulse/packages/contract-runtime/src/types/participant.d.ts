export declare const ParticipantRole: {
    readonly WRITER:   'writer';
    readonly EXECUTOR: 'executor';
    readonly RESOLVER: 'resolver';
    readonly OBSERVER: 'observer';
};

export type ParticipantRoleValue = typeof ParticipantRole[keyof typeof ParticipantRole];

export interface ParticipantRef {
    id: string;
    type: 'agent' | 'human' | 'system';
    package?: string;
}
