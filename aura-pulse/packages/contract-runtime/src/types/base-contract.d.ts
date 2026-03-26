import type { ContractStatusValue } from './contract-status.js';
import type { ParticipantRef } from './participant.js';
import type { SurfaceAction } from './surface-action.js';
import type { ClarificationEntry } from './clarification.js';

export interface ComponentRef {
    tool: string;
    data: Record<string, unknown>;
    returns: 'a2ui';
}

export interface SurfaceRecommendation {
    action: string;
    value?: unknown;
    reasoning: string;
}

export interface ContractSurface {
    voice_line: string;
    summary: string;
    recommendation: SurfaceRecommendation;
    actions: SurfaceAction[];
    components?: ComponentRef[];
    version: number;
}

export interface ContractResume {
    action: string;
    value?: unknown;
    timestamp: string;
    resolver_id: string;
    artifacts?: Record<string, unknown>;
}

export interface ContractCompletionSurface {
    voice_line: string;
    summary: string;
}

export interface ContractResult {
    success: boolean;
    summary: string;
    artifacts?: Record<string, unknown>;
}

export interface ContractIntent {
    goal: string;
    trigger: string;
    context: Record<string, unknown>;
}

export interface ContractParticipants {
    writer: ParticipantRef;
    executor?: ParticipantRef;
    resolver: ParticipantRef;
}

export interface BaseContract {
    id: string;
    version: string;
    type: string;
    status: ContractStatusValue;
    created_at: string;
    updated_at: string;
    expires_at?: string;
    surface_after?: string;
    participants: ContractParticipants;
    intent: ContractIntent;
    surface?: ContractSurface;
    clarifications?: ClarificationEntry[];
    resume?: ContractResume;
    completion_surface?: ContractCompletionSurface;
    result?: ContractResult;
    parent_id?: string;
    child_ids?: string[];
    recovery_of?: string;
}
