// Mock pulseWSClient before importing surface-store
import { vi } from "vitest";

vi.mock("../../src/ws/client.js", () => ({
  pulseWSClient: {
    send: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    onMessage: vi.fn(() => vi.fn()),
    onStatus: vi.fn(() => vi.fn()),
  },
}));

import { describe, it, expect, beforeEach } from "vitest";
import { useSurfaceStore } from "../../src/ws/surface-store.js";
import type { BaseContract, RuntimeMessage } from "../../src/ws/protocol.js";
import { pulseWSClient } from "../../src/ws/client.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeContract(overrides: Partial<BaseContract> = {}): BaseContract {
  return {
    id: "c-1",
    type: "default",
    status: "waiting_approval",
    resume_token: "resume-token-1",
    agent_id: "agent-1",
    agent_name: "Sheryl",
    intent: { goal: "Send the weekly report" },
    clarifications: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    surface: {
      voice_line: "I need your approval.",
      summary: "Ready to send the weekly report.",
      recommendation: { action_id: "approve", label: "Approve", reasoning: "Looks good." },
      actions: [{ id: "approve", label: "Approve", action: "approve" }],
    },
    ...overrides,
  };
}

function msg(payload: RuntimeMessage): RuntimeMessage {
  return payload;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function resetStore() {
  useSurfaceStore.setState({
    mode: "silent",
    contract: null,
    a2uiMessages: [],
    completionSurface: null,
    pendingContracts: [],
    artifactUnderlyingMode: "silent",
    connectorCard: null,
    connectorUnderlyingMode: "silent",
    historyOpen: false,
    briefOpen: false,
    wsStatus: "disconnected",
  });
  vi.mocked(pulseWSClient.send).mockClear();
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("surface-store state machine", () => {
  beforeEach(resetStore);

  // ── Decision ──────────────────────────────────────────────────────────────

  it("transitions silent → decision on 'decision' message", () => {
    const contract = makeContract();
    useSurfaceStore.getState().handleMessage(msg({ type: "decision", contract }));
    const { mode, contract: c } = useSurfaceStore.getState();
    expect(mode).toBe("decision");
    expect(c?.id).toBe("c-1");
  });

  it("queues new 'decision' when already in decision mode", () => {
    const c1 = makeContract({ id: "c-1" });
    const c2 = makeContract({ id: "c-2" });
    useSurfaceStore.getState().handleMessage(msg({ type: "decision", contract: c1 }));
    useSurfaceStore.getState().handleMessage(msg({ type: "decision", contract: c2 }));
    const { mode, contract, pendingContracts } = useSurfaceStore.getState();
    expect(mode).toBe("decision");
    expect(contract?.id).toBe("c-1");
    expect(pendingContracts).toHaveLength(1);
    expect(pendingContracts[0].contract.id).toBe("c-2");
  });

  it("does not queue a duplicate decision for the active contract", () => {
    const c1 = makeContract({ id: "c-1", surface: { ...makeContract().surface!, summary: "First summary" } });
    const duplicate = makeContract({ id: "c-1", surface: { ...makeContract().surface!, summary: "Updated summary" } });

    useSurfaceStore.getState().handleMessage(msg({ type: "decision", contract: c1 }));
    useSurfaceStore.getState().sendMessage({ type: "engage", contractId: "c-1", resolverId: "r-1" });
    useSurfaceStore.getState().handleMessage(msg({ type: "decision", contract: duplicate }));

    expect(useSurfaceStore.getState().pendingContracts).toHaveLength(0);
    expect(useSurfaceStore.getState().contract?.surface?.summary).toBe("Updated summary");
  });

  it("queues multiple contracts while in resolver_active", () => {
    const c1 = makeContract({ id: "c-1" });
    useSurfaceStore.getState().handleMessage(msg({ type: "decision", contract: c1 }));
    // Engage → resolver_active
    useSurfaceStore.getState().sendMessage({ type: "engage", contractId: "c-1", resolverId: "r-1" });
    expect(useSurfaceStore.getState().mode).toBe("resolver_active");

    const c2 = makeContract({ id: "c-2" });
    const c3 = makeContract({ id: "c-3" });
    useSurfaceStore.getState().handleMessage(msg({ type: "decision", contract: c2 }));
    useSurfaceStore.getState().handleMessage(msg({ type: "decision", contract: c3 }));
    expect(useSurfaceStore.getState().pendingContracts).toHaveLength(2);
  });

  // ── Engage ────────────────────────────────────────────────────────────────

  it("transitions decision → resolver_active on 'engage' sendMessage", () => {
    const contract = makeContract();
    useSurfaceStore.getState().handleMessage(msg({ type: "decision", contract }));
    useSurfaceStore.getState().sendMessage({ type: "engage", contractId: "c-1", resolverId: "r-1" });
    expect(useSurfaceStore.getState().mode).toBe("resolver_active");
    expect(pulseWSClient.send).toHaveBeenCalledWith({
      type: "engage",
      contractId: "c-1",
      resolverId: "r-1",
    });
  });

  // ── Clarification ─────────────────────────────────────────────────────────

  it("transitions resolver_active → clarifying on 'ask_clarification'", () => {
    const contract = makeContract();
    useSurfaceStore.getState().handleMessage(msg({ type: "decision", contract }));
    useSurfaceStore.getState().sendMessage({ type: "engage", contractId: "c-1", resolverId: "r-1" });
    useSurfaceStore.getState().sendMessage({ type: "ask_clarification", contractId: "c-1", question: "What format?" });
    expect(useSurfaceStore.getState().mode).toBe("clarifying");
  });

  it("appends clarification_answer entry to contract.clarifications", () => {
    const contract = makeContract();
    useSurfaceStore.getState().handleMessage(msg({ type: "decision", contract }));
    useSurfaceStore.getState().sendMessage({ type: "engage", contractId: "c-1", resolverId: "r-1" });
    useSurfaceStore.getState().handleMessage(msg({
      type: "clarification_answer",
      contractId: "c-1",
      entry: { id: "e-1", role: "answer", text: "PDF format.", timestamp: new Date().toISOString() },
    }));
    const clarifications = useSurfaceStore.getState().contract?.clarifications ?? [];
    expect(clarifications).toHaveLength(1);
    expect(clarifications[0].text).toBe("PDF format.");
    expect(useSurfaceStore.getState().mode).toBe("resolver_active");
  });

  it("uses contract payload from clarification_answer when provided", () => {
    const contract = makeContract({ status: "clarifying" });
    const updated = makeContract({
      status: "resolver_active",
      clarifications: [{ id: "e-1", role: "answer", text: "Done.", timestamp: new Date().toISOString() }],
    });
    useSurfaceStore.getState().handleMessage(msg({ type: "decision", contract }));
    useSurfaceStore.getState().handleMessage(msg({
      type: "clarification_answer",
      contractId: "c-1",
      entry: { id: "e-1", role: "answer", text: "Done.", timestamp: updated.updated_at },
      contract: updated,
    }));
    expect(useSurfaceStore.getState().mode).toBe("resolver_active");
    expect(useSurfaceStore.getState().contract?.status).toBe("resolver_active");
    expect(useSurfaceStore.getState().contract?.clarifications).toHaveLength(1);
  });

  // ── Resolve → confirming ──────────────────────────────────────────────────

  it("transitions to confirming on 'resolve' sendMessage", () => {
    const contract = makeContract();
    useSurfaceStore.getState().handleMessage(msg({ type: "decision", contract }));
    useSurfaceStore.getState().sendMessage({ type: "engage", contractId: "c-1", resolverId: "r-1" });
    useSurfaceStore.getState().sendMessage({ type: "resolve", contractId: "c-1", token: "resume-token-1", action: "approve" });
    expect(useSurfaceStore.getState().mode).toBe("confirming");
  });

  it("enters and exits artifact review mode while preserving the underlying mode", () => {
    const contract = makeContract();
    useSurfaceStore.getState().handleMessage(msg({ type: "decision", contract }));
    useSurfaceStore.getState().sendMessage({ type: "engage", contractId: "c-1", resolverId: "r-1" });
    useSurfaceStore.getState().openArtifactReview();
    expect(useSurfaceStore.getState().mode).toBe("artifact_review");
    expect(useSurfaceStore.getState().artifactUnderlyingMode).toBe("resolver_active");
    useSurfaceStore.getState().closeArtifactReview();
    expect(useSurfaceStore.getState().mode).toBe("resolver_active");
  });

  // ── Abandon → silent ──────────────────────────────────────────────────────

  it("transitions to silent on 'abandon'", () => {
    const contract = makeContract();
    useSurfaceStore.getState().handleMessage(msg({ type: "decision", contract }));
    useSurfaceStore.getState().sendMessage({ type: "engage", contractId: "c-1", resolverId: "r-1" });
    useSurfaceStore.getState().sendMessage({ type: "abandon", contractId: "c-1" });
    const { mode, contract: c } = useSurfaceStore.getState();
    expect(mode).toBe("silent");
    expect(c).toBeNull();
  });

  // ── Clear → advance queue ─────────────────────────────────────────────────

  it("advances the pending queue on 'clear'", () => {
    const c1 = makeContract({ id: "c-1" });
    const c2 = makeContract({ id: "c-2" });
    useSurfaceStore.getState().handleMessage(msg({ type: "decision", contract: c1 }));
    useSurfaceStore.getState().handleMessage(msg({ type: "decision", contract: c2 }));
    useSurfaceStore.getState().handleMessage(msg({ type: "clear", contractId: "c-1", reason: "resolved" }));
    const { mode, contract, pendingContracts } = useSurfaceStore.getState();
    expect(mode).toBe("decision");
    expect(contract?.id).toBe("c-2");
    expect(pendingContracts).toHaveLength(0);
  });

  it("does not resurface a duplicate pending copy of the cleared contract", () => {
    const c1 = makeContract({ id: "c-1" });

    useSurfaceStore.getState().handleMessage(msg({ type: "decision", contract: c1 }));
    useSurfaceStore.getState().sendMessage({ type: "engage", contractId: "c-1", resolverId: "r-1" });
    useSurfaceStore.getState().handleMessage(msg({ type: "decision", contract: makeContract({ id: "c-1" }) }));
    useSurfaceStore.getState().handleMessage(msg({ type: "clear", contractId: "c-1", reason: "resolved" }));

    expect(useSurfaceStore.getState().mode).toBe("silent");
    expect(useSurfaceStore.getState().contract).toBeNull();
    expect(useSurfaceStore.getState().pendingContracts).toHaveLength(0);
  });

  it("goes silent on 'clear' with empty pending queue", () => {
    const contract = makeContract();
    useSurfaceStore.getState().handleMessage(msg({ type: "decision", contract }));
    useSurfaceStore.getState().handleMessage(msg({ type: "clear", contractId: "c-1", reason: "resolved" }));
    expect(useSurfaceStore.getState().mode).toBe("silent");
    expect(useSurfaceStore.getState().contract).toBeNull();
  });

  // ── Completion ────────────────────────────────────────────────────────────

  it("transitions to completion on 'completion' message", () => {
    const contract = makeContract();
    useSurfaceStore.getState().handleMessage(msg({ type: "decision", contract }));
    useSurfaceStore.getState().sendMessage({ type: "resolve", contractId: "c-1", token: "resume-token-1", action: "approve" });
    useSurfaceStore.getState().handleMessage(msg({
      type: "completion",
      contractId: "c-1",
      surface: { voice_line: "Done!", summary: "Report sent." },
    }));
    const { mode, completionSurface } = useSurfaceStore.getState();
    expect(mode).toBe("completion");
    expect(completionSurface?.summary).toBe("Report sent.");
  });

  // ── Connector ─────────────────────────────────────────────────────────────

  it("sets connectorCard on 'connector_request' without changing main mode", () => {
    const contract = makeContract();
    useSurfaceStore.getState().handleMessage(msg({ type: "decision", contract }));
    useSurfaceStore.getState().handleMessage(msg({
      type: "connector_request",
      card: {
        connector_id: "gmail",
        connector_name: "Gmail",
        offer_text: "Connect Gmail?",
        flow_type: "browser_redirect",
        auth_url: "https://oauth.example.com",
      },
    }));
    const { mode, connectorCard, connectorUnderlyingMode } = useSurfaceStore.getState();
    expect(mode).toBe("decision"); // unchanged
    expect(connectorCard?.connector_id).toBe("gmail");
    expect(connectorUnderlyingMode).toBe("decision");
  });

  it("clears connectorCard on 'connector_complete'", () => {
    const contract = makeContract();
    useSurfaceStore.getState().handleMessage(msg({ type: "decision", contract }));
    useSurfaceStore.getState().handleMessage(msg({
      type: "connector_request",
      card: { connector_id: "gmail", connector_name: "Gmail", offer_text: "Connect?", flow_type: "secure_input" },
    }));
    useSurfaceStore.getState().handleMessage(msg({ type: "connector_complete", connectorId: "gmail" }));
    expect(useSurfaceStore.getState().connectorCard).toBeNull();
  });

  it("clears connector overlay and restores mode on 'complete_connector' sendMessage", () => {
    const contract = makeContract();
    useSurfaceStore.getState().handleMessage(msg({ type: "decision", contract }));
    useSurfaceStore.getState().sendMessage({ type: "engage", contractId: "c-1", resolverId: "r-1" });
    useSurfaceStore.getState().handleMessage(msg({
      type: "connector_request",
      card: { connector_id: "gmail", connector_name: "Gmail", offer_text: "Connect?", flow_type: "secure_input" },
    }));
    useSurfaceStore.getState().sendMessage({
      type: "complete_connector",
      connectorId: "gmail",
      credentials: { key: "abc" },
    });
    expect(useSurfaceStore.getState().connectorCard).toBeNull();
    expect(useSurfaceStore.getState().mode).toBe("resolver_active");
  });

  // ── History / Brief toggles ───────────────────────────────────────────────

  it("toggles historyOpen", () => {
    useSurfaceStore.getState().openHistory();
    expect(useSurfaceStore.getState().historyOpen).toBe(true);
    useSurfaceStore.getState().closeHistory();
    expect(useSurfaceStore.getState().historyOpen).toBe(false);
  });

  // ── Surface update ────────────────────────────────────────────────────────

  it("updates contract on 'surface_update' during resolver_active", () => {
    const contract = makeContract();
    useSurfaceStore.getState().handleMessage(msg({ type: "decision", contract }));
    useSurfaceStore.getState().sendMessage({ type: "engage", contractId: "c-1", resolverId: "r-1" });
    const updated = makeContract({ intent: { goal: "Updated goal" } });
    useSurfaceStore.getState().handleMessage(msg({ type: "surface_update", contract: updated }));
    expect(useSurfaceStore.getState().contract?.intent.goal).toBe("Updated goal");
  });
});
