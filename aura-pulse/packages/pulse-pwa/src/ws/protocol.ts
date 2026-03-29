// SurfaceProtocol message types for the Pulse PWA WebSocket client.
// Mirror the types in Phase 2 (openclaw-plugin) SurfaceProtocol.

// ── Shared contract types ────────────────────────────────────────────────────

export type ContractStatus =
  | "created"
  | "active"
  | "waiting_approval"
  | "resolver_active"
  | "clarifying"
  | "executing"
  | "complete"
  | "failed";

export interface SurfaceAction {
  id: string;
  label: string;
  action: string;
  value?: unknown;
  style?: "primary" | "secondary" | "destructive";
  opens_clarification?: boolean;
  opens_artifact?: string;
}

export interface ComponentRef {
  id?: string;
  tool?: string;
  tool_call?: string;
  data?: Record<string, unknown>;
  args?: Record<string, unknown>;
  returns?: "a2ui";
}

export interface ContractSurface {
  voice_line: string;
  summary: string;
  recommendation: {
    action?: string;
    action_id?: string;
    label?: string;
    value?: unknown;
    reasoning: string;
    context?: Record<string, unknown>;
  };
  actions: SurfaceAction[];
  components?: ComponentRef[];
  version?: number;
}

export interface ClarificationEntry {
  id: string;
  role: "resolver" | "agent" | "question" | "answer" | "surface_update";
  text?: string;
  content?: string;
  timestamp: string;
  attributed_to?: string;
  participant?: string;
  surface_version?: number;
}

export interface ResumePayload {
  action: string;
  artifacts?: Record<string, unknown>;
  resolver_id: string;
  timestamp: string;
}

export interface CompletionSurface {
  voice_line: string;
  summary: string;
}

export interface CommandStatus {
  commandId: string;
  status: "accepted" | "rejected";
  message: string;
}

export type KernelSurfaceType = "workspace" | "plan" | "attention" | "monitor" | "brief";
export type KernelSurfacePriority = "low" | "normal" | "high";

export interface KernelSurface {
  surfaceId: string;
  title?: string;
  summary?: string;
  voiceLine?: string;
  surfaceType?: KernelSurfaceType;
  priority?: KernelSurfacePriority;
  collaborative?: boolean;
  icon?: string;
  a2uiMessages: A2UIMessage[];
  receivedAt?: number;
}

export interface ConnectorCard {
  id?: string;
  source?: "openclaw-channel" | "aura-connector";
  status?: "active" | "pending" | "declined" | "error" | "not-offered";
  capability_without?: string;
  capability_with?: string;
  never_resurface?: boolean;
  offered_at?: string;
  connector_id: string;
  connector_name: string;
  offer_text: string;
  flow_type?: "browser_redirect" | "secure_input" | "manual_guide";
  auth_url?: string;       // browser_redirect only
  input_label?: string;    // secure_input only
  guide_steps?: string[];  // manual_guide only
}

export interface OnboardingStatusItem {
  id: string;
  label: string;
  status: "installed" | "missing" | "not-installed" | "pending";
  tier: "required" | "optional";
}

export interface BaseContract {
  id: string;
  version?: string;
  type: string;
  status: ContractStatus;
  agent_id: string;
  agent_name?: string;
  participants?: {
    writer?: { id: string; type: string };
    resolver?: { id: string; type: string };
  };
  intent: {
    goal: string;
    trigger?: string;
    context?: string;
  } | {
    goal: string;
    trigger: string;
    context: Record<string, unknown>;
  };
  surface?: ContractSurface;
  clarifications?: ClarificationEntry[];
  resume?: ResumePayload;
  resume_token?: string;
  completion_surface?: CompletionSurface;
  surface_after?: string;
  expires_at?: string;
  created_at: string;
  updated_at: string;
  never_resurface_connectors?: string[];
}

// ── A2UI types (Phase 3 — real @a2ui/react not yet on npm) ──────────────────

/**
 * Matches @a2ui/react ServerToClientMessage.
 * The plugin pre-assembles these before pushing the `decision` message.
 * When @a2ui/react is published, import ServerToClientMessage from it directly.
 */
export interface A2UIMessage {
  type?: string;
  surfaceId?: string;
  [key: string]: unknown;
}

// ── Runtime → Surface messages ───────────────────────────────────────────────

export type RuntimeMessage =
  | {
      type: "decision";
      contract: BaseContract;
      a2uiMessages?: A2UIMessage[];
    }
  | {
      type: "surface_update";
      contract?: BaseContract;
      contractId?: string;
      surface?: ContractSurface;
      a2uiMessages?: A2UIMessage[];
    }
  | {
      type: "clarification_answer";
      contractId: string;
      entry: ClarificationEntry;
      contract?: BaseContract;
    }
  | {
      type: "clear";
      contractId: string;
      reason: "resolved" | "failed" | "timeout";
    }
  | {
      type: "completion";
      contractId: string;
      surface: CompletionSurface;
    }
  | {
      type: "kernel_surface";
      surface: KernelSurface;
    }
  | {
      type: "clear_kernel_surface";
      surfaceId: string;
    }
  | { type: "connector_request"; card: ConnectorCard }
  | { type: "connector_complete"; connectorId: string }
  | { type: "command_status"; commandId: string; status: "accepted" | "rejected"; message: string }
  | {
      type: "onboarding_status";
      items: OnboardingStatusItem[];
      incomplete: boolean;
    };

// ── Surface → Runtime messages ───────────────────────────────────────────────

export type SurfaceMessage =
  | { type: "engage"; contractId: string; resolverId?: string }
  | { type: "ask_clarification"; contractId: string; question: string }
  | {
      type: "resolve";
      contractId: string;
      token?: string;
      action: string;
      value?: unknown;
      artifacts?: Record<string, unknown>;
    }
  | { type: "abandon"; contractId: string }
  | { type: "initiate_connector"; connectorId: string }
  | {
      type: "complete_connector";
      connectorId: string;
      credentials?: Record<string, unknown>;
    }
  | { type: "decline_connector"; connectorId: string; never?: boolean }
  | {
      type: "surface_action";
      surfaceId: string;
      actionName: string;
      sourceComponentId?: string;
      context?: Record<string, unknown>;
    }
  | { type: "submit_command"; commandId: string; text: string; modality?: "text" | "voice" };
