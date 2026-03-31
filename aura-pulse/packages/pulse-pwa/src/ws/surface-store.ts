import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  BaseContract,
  ConnectorCard,
  OnboardingStatusItem,
  A2UIMessage,
  KernelSurface,
  RuntimeMessage,
  SurfaceMessage,
  CompletionSurface,
} from "../ws/protocol.js";
import { pulseWSClient } from "../ws/client.js";

// ── Surface modes ─────────────────────────────────────────────────────────────

export type SurfaceMode =
  | "silent"
  | "decision"
  | "resolver_active"
  | "clarifying"
  | "artifact_review"
  | "confirming"
  | "completion"
  | "workspace"
  | "connector";

const defaultTransportSend = (msg: SurfaceMessage) => {
  pulseWSClient.send(msg);
};

function preserveResumeToken(current: BaseContract | null, incoming: BaseContract): BaseContract {
  return current?.id === incoming.id && current.resume_token && !incoming.resume_token
    ? { ...incoming, resume_token: current.resume_token }
    : incoming;
}

function upsertPendingContract(
  pendingContracts: Array<{ contract: BaseContract; a2uiMessages: A2UIMessage[] }>,
  entry: { contract: BaseContract; a2uiMessages: A2UIMessage[] },
) {
  const existingIndex = pendingContracts.findIndex(({ contract }) => contract.id === entry.contract.id);
  if (existingIndex === -1) {
    return [...pendingContracts, entry];
  }

  const withoutDuplicates = pendingContracts.filter(({ contract }) => contract.id !== entry.contract.id);
  withoutDuplicates.splice(existingIndex, 0, entry);
  return withoutDuplicates;
}

function takeNextPendingContract(
  pendingContracts: Array<{ contract: BaseContract; a2uiMessages: A2UIMessage[] }>,
  skippedContractId?: string,
) {
  const filtered = skippedContractId
    ? pendingContracts.filter(({ contract }) => contract.id !== skippedContractId)
    : pendingContracts;
  const [next, ...rest] = filtered;
  return { next, rest };
}

function upsertKernelSurface(kernelSurfaces: KernelSurface[], incoming: KernelSurface): KernelSurface[] {
  const nextSurface = {
    ...incoming,
    receivedAt: incoming.receivedAt ?? Date.now(),
  };
  const existingIndex = kernelSurfaces.findIndex((surface) => surface.surfaceId === nextSurface.surfaceId);

  if (existingIndex === -1) {
    return [...kernelSurfaces, nextSurface];
  }

  const next = [...kernelSurfaces];
  next.splice(existingIndex, 1, nextSurface);
  return next;
}

// ── Store shape ───────────────────────────────────────────────────────────────

export interface SurfaceState {
  mode: SurfaceMode;
  contract: BaseContract | null;
  a2uiMessages: A2UIMessage[];
  completionSurface: CompletionSurface | null;
  kernelSurfaces: KernelSurface[];
  pendingContracts: Array<{ contract: BaseContract; a2uiMessages: A2UIMessage[] }>;
  artifactUnderlyingMode: SurfaceMode;
  connectorCard: ConnectorCard | null;
  connectorUnderlyingMode: SurfaceMode;
  onboardingOpen: boolean;
  onboardingItems: OnboardingStatusItem[];
  historyOpen: boolean;
  briefOpen: boolean;
  wsStatus: "connected" | "reconnecting" | "disconnected";
  agentBusy: boolean;
  ttsEnabled: boolean;
  transportSend: (msg: SurfaceMessage) => void;

  // Actions
  handleMessage: (msg: RuntimeMessage) => void;
  setAgentBusy: (busy: boolean) => void;
  setTtsEnabled: (enabled: boolean) => void;
  sendMessage: (msg: SurfaceMessage) => void;
  configureTransport: (sender: (msg: SurfaceMessage) => void) => void;
  setWsStatus: (status: "connected" | "reconnecting" | "disconnected") => void;
  openHistory: () => void;
  closeHistory: () => void;
  openBrief: () => void;
  closeBrief: () => void;
  openArtifactReview: () => void;
  closeArtifactReview: () => void;
  dismissCompletion: () => void;
  dismissOnboarding: () => void;
  deleteKernelSurface: (surfaceId: string) => void;
}

// ── Store implementation ──────────────────────────────────────────────────────

export const useSurfaceStore = create<SurfaceState>()(persist((set, get) => ({
  mode: "silent",
  contract: null,
  a2uiMessages: [],
  completionSurface: null,
  kernelSurfaces: [],
  pendingContracts: [],
  artifactUnderlyingMode: "silent",
  connectorCard: null,
  connectorUnderlyingMode: "silent",
  onboardingOpen: false,
  onboardingItems: [],
  historyOpen: false,
  briefOpen: false,
  wsStatus: "disconnected",
  agentBusy: false,
  ttsEnabled: false,
  transportSend: defaultTransportSend,

  handleMessage(msg) {
    const state = get();

    switch (msg.type) {
      case "decision": {
        const entry = {
          contract: preserveResumeToken(state.contract, msg.contract),
          a2uiMessages: msg.a2uiMessages ?? [],
        };

        if (state.contract?.id === entry.contract.id) {
          set({ contract: entry.contract, a2uiMessages: entry.a2uiMessages });
          break;
        }

        if (state.mode === "silent" || state.mode === "completion" || state.mode === "workspace") {
          set({ mode: "decision", contract: entry.contract, a2uiMessages: entry.a2uiMessages });
        } else {
          set((s) => ({ pendingContracts: upsertPendingContract(s.pendingContracts, entry) }));
        }
        break;
      }

      case "kernel_surface": {
        const shouldPromote = !state.contract && (state.mode === "silent" || state.mode === "completion" || state.mode === "workspace");
        set({
          kernelSurfaces: upsertKernelSurface(state.kernelSurfaces, {
            ...msg.surface,
            receivedAt: Date.now(),
          }),
          agentBusy: false,
          ...(shouldPromote ? { mode: "workspace" as const, completionSurface: null } : {}),
        });
        break;
      }

      case "clear_kernel_surface": {
        if (!state.kernelSurfaces.some((surface) => surface.surfaceId === msg.surfaceId)) {
          break;
        }
        const remainingSurfaces = state.kernelSurfaces.filter((surface) => surface.surfaceId !== msg.surfaceId);
        set({
          kernelSurfaces: remainingSurfaces,
          ...(state.mode === "workspace" && remainingSurfaces.length === 0 ? { mode: "silent" as const } : {}),
        });
        break;
      }

      case "surface_update": {
        if (state.mode === "resolver_active" || state.mode === "clarifying" || state.mode === "artifact_review") {
          if (msg.contract) {
            const nextContract = preserveResumeToken(state.contract, msg.contract);
            set({
              contract: nextContract,
              mode: state.mode === "artifact_review"
                ? "artifact_review"
                : nextContract.status === "clarifying"
                  ? "clarifying"
                  : "resolver_active",
              a2uiMessages: msg.a2uiMessages ?? state.a2uiMessages,
            });
          } else if (msg.contractId && msg.surface && state.contract?.id === msg.contractId) {
            set((s) => ({
              contract: s.contract ? { ...s.contract, surface: msg.surface } : null,
              a2uiMessages: msg.a2uiMessages ?? s.a2uiMessages,
            }));
          }
        }
        break;
      }

      case "clarification_answer": {
        if (state.contract && state.contract.id === msg.contractId) {
          set((s) => {
            const existing = s.contract?.clarifications ?? [];
            const hasEntry = existing.some((entry) => entry.id === msg.entry.id);
            const nextContract = msg.contract
              ? preserveResumeToken(s.contract, msg.contract)
              : s.contract
                ? {
                    ...s.contract,
                    clarifications: hasEntry ? existing : [...existing, msg.entry],
                  }
                : null;

            return {
              mode: s.mode === "artifact_review"
                ? "artifact_review"
                : nextContract?.status === "clarifying"
                  ? "clarifying"
                  : "resolver_active",
              contract: nextContract,
            };
          });
        }
        break;
      }

      case "clear": {
        if (state.contract && state.contract.id !== msg.contractId) {
          set((s) => ({
            pendingContracts: s.pendingContracts.filter(({ contract }) => contract.id !== msg.contractId),
          }));
          break;
        }
        const { next, rest } = takeNextPendingContract(get().pendingContracts, msg.contractId);
        if (next) {
          set({
            mode: "decision",
            contract: next.contract,
            a2uiMessages: next.a2uiMessages,
            completionSurface: null,
            pendingContracts: rest,
          });
        } else {
          set({
            mode: get().kernelSurfaces.length > 0 ? "workspace" : "silent",
            contract: null,
            a2uiMessages: [],
            completionSurface: null,
          });
        }
        break;
      }

      case "completion": {
        if (!state.contract || state.contract.id === msg.contractId) {
          set({
            mode: "completion",
            completionSurface: msg.surface,
          });
        }
        break;
      }

      case "connector_request": {
        set({
          connectorCard: msg.card,
          connectorUnderlyingMode: state.mode,
        });
        break;
      }

      case "connector_complete": {
        set({
          connectorCard: null,
        });
        break;
      }

      case "onboarding_status": {
        if (msg.incomplete) {
          set({ onboardingOpen: true, onboardingItems: msg.items });
        }
        break;
      }
    }
  },

  sendMessage(msg) {
    const { mode } = get();

    if (msg.type === "resolve" && !msg.token) {
      console.warn("[PulseWS] Missing resume token for resolve; aborting commit.");
      return;
    }

    // Apply state transitions for outbound user actions
    switch (msg.type) {
      case "engage":
        set({ mode: "resolver_active" });
        break;
      case "ask_clarification":
        set({ mode: "clarifying" });
        break;
      case "resolve":
        set({ mode: "confirming" });
        break;
      case "abandon":
        set({ mode: get().kernelSurfaces.length > 0 ? "workspace" : "silent", contract: null, a2uiMessages: [] });
        break;
      case "decline_connector":
      case "complete_connector":
        // Clear connector overlay; restore underlying mode
        set((s) => ({ connectorCard: null, mode: s.connectorUnderlyingMode }));
        break;
    }

    // Suppress TS complaint about unused variable
    void mode;
    get().transportSend(msg);
  },

  configureTransport(sender) {
    set({ transportSend: sender });
  },

  setWsStatus(status) {
    set({ wsStatus: status });
  },

  openHistory: () => set({ historyOpen: true }),
  closeHistory: () => set({ historyOpen: false }),
  openBrief: () => set({ briefOpen: true }),
  closeBrief: () => set({ briefOpen: false }),
  openArtifactReview: () => set((s) => ({ artifactUnderlyingMode: s.mode, mode: "artifact_review" })),
  closeArtifactReview: () => set((s) => ({
    mode: s.artifactUnderlyingMode === "artifact_review" ? "resolver_active" : s.artifactUnderlyingMode,
    artifactUnderlyingMode: "silent",
  })),
  dismissCompletion: () => {
    const currentId = get().contract?.id;
    const { next, rest } = takeNextPendingContract(get().pendingContracts, currentId);
    if (next) {
      set({
        mode: "decision",
        contract: next.contract,
        a2uiMessages: next.a2uiMessages,
        completionSurface: null,
        pendingContracts: rest,
      });
      return;
    }
    set((state) => ({
      mode: state.kernelSurfaces.length > 0 ? "workspace" : "silent",
      contract: null,
      a2uiMessages: [],
      completionSurface: null,
    }));
  },

  dismissOnboarding: () => set({ onboardingOpen: false }),

  setAgentBusy: (busy: boolean) => set({ agentBusy: busy }),
  setTtsEnabled: (enabled: boolean) => set({ ttsEnabled: enabled }),

  deleteKernelSurface: (surfaceId: string) => {
    set((state) => {
      const remaining = state.kernelSurfaces.filter((s) => s.surfaceId !== surfaceId);
      return {
        kernelSurfaces: remaining,
        ...(state.mode === "workspace" && remaining.length === 0 ? { mode: "silent" as const } : {}),
      };
    });
  },
}), {
  name: "aura.surface-store.v1",
  storage: {
    getItem: (name) => {
      const raw = sessionStorage.getItem(name);
      return raw ? JSON.parse(raw) : null;
    },
    setItem: (name, value) => {
      sessionStorage.setItem(name, JSON.stringify(value));
    },
    removeItem: (name) => {
      sessionStorage.removeItem(name);
    },
  },
  partialize: (state) => ({
    mode: state.mode,
    contract: state.contract,
    a2uiMessages: state.a2uiMessages,
    completionSurface: state.completionSurface,
    kernelSurfaces: state.kernelSurfaces,
  } as unknown as SurfaceState),
}));
