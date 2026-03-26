// Status
export type { ContractStatusValue } from './types/contract-status.js';
export { ContractStatus, VALID_TRANSITIONS, TERMINAL_STATUSES } from './types/contract-status.js';

// Participant
export type { ParticipantRef, ParticipantRoleValue } from './types/participant.js';
export { ParticipantRole } from './types/participant.js';

// Contract shape
export type {
    BaseContract,
    ContractSurface,
    ContractIntent,
    ContractParticipants,
    ContractResume,
    ContractResult,
    ContractCompletionSurface,
    ComponentRef,
    SurfaceRecommendation,
} from './types/base-contract.js';

export type { SurfaceAction } from './types/surface-action.js';
export type { ClarificationEntry } from './types/clarification.js';
export type { AutonomousLogEntry } from './types/autonomous-log.js';
export type { ConnectorState } from './types/connector-state.js';

// Storage
export type { ContractFilter, LogFilter, ContractLogEntry } from './storage/interface.js';
export { ContractStorage } from './storage/interface.js';
export { SQLiteContractStorage } from './storage/sqlite-storage.js';

// Runtime
export type { ContractRuntimeConfig } from './runtime/contract-runtime.js';
export type { ContractTypeDefinition } from './runtime/type-registry.js';
export type { CompletionNotifier } from './runtime/completion-notifier.js';
export { ContractRuntime } from './runtime/contract-runtime.js';
export { TypeRegistry } from './runtime/type-registry.js';
export { NoOpCompletionNotifier } from './runtime/completion-notifier.js';

// Errors
export {
    AuraRuntimeError,
    InvalidTransitionError,
    TerminalStateError,
    UnauthorizedRoleError,
    InvalidResumeTokenError,
    UnknownContractTypeError,
    ContractValidationError,
    ContractNotFoundError,
} from './types/errors.js';

// Domain types
export type { OfferReceivedContext } from './domain-types/offer-received.js';
export type { GrantReportDraftContext } from './domain-types/grant-report-draft.js';
export { offerReceivedType } from './domain-types/offer-received.js';
export { grantReportDraftType } from './domain-types/grant-report-draft.js';
