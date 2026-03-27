import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/ws/client.js", () => ({
  pulseWSClient: {
    send: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    onMessage: vi.fn(() => vi.fn()),
    onStatus: vi.fn(() => vi.fn()),
  },
}));

vi.mock("../../src/voice/voice-engine.js", () => ({
  voiceEngine: {
    speak: vi.fn(() => Promise.resolve()),
    cancel: vi.fn(),
    isSupported: vi.fn(() => true),
  },
}));

import { MorningBrief } from "../../src/morning-brief/MorningBrief.js";
import { useSurfaceStore } from "../../src/ws/surface-store.js";
import { pulseWSClient } from "../../src/ws/client.js";
import { voiceEngine } from "../../src/voice/voice-engine.js";
import type { BaseContract } from "../../src/ws/protocol.js";

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
  vi.mocked(voiceEngine.speak).mockClear();
  vi.mocked(voiceEngine.cancel).mockClear();
}

function makeMorningBriefContract(): BaseContract {
  const now = new Date().toISOString();
  return {
    id: "brief-1",
    type: "morning-brief",
    status: "waiting_approval",
    agent_id: "agent-brief",
    agent_name: "Sheryl",
    resume_token: "brief-token",
    participants: {
      writer: { id: "sheryl", type: "agent" },
      resolver: { id: "owner", type: "human" },
    },
    intent: { goal: "Review the morning brief" },
    surface: {
      voice_line: "Good morning. Two items need your attention.",
      summary: "I handled follow-ups overnight and one offer is waiting for your approval.",
      recommendation: {
        action: "dismiss",
        label: "Got it",
        reasoning: "You can review the queued decision next.",
        context: {
          pending_decisions: [
            {
              id: "offer-1",
              goal: "Approve the freelance design offer",
              agent_name: "Sheryl",
            },
          ],
          autonomous_actions: [
            {
              id: "log-1",
              agent_id: "sheryl",
              package: "aura-pulse",
              action: "message_sent",
              summary: "Followed up with two leads",
              connector_used: "none",
              timestamp: now,
            },
          ],
          patterns_observed: ["Warm leads reply faster before 10am."],
        },
      },
      actions: [{ id: "dismiss", label: "Got it", action: "dismiss", style: "primary" }],
    },
    created_at: now,
    updated_at: now,
  };
}

describe("MorningBrief", () => {
  beforeEach(resetStore);

  it("renders the brief summary sections from the shared morning-brief context schema", () => {
    render(<MorningBrief contract={makeMorningBriefContract()} />);

    expect(screen.getByText("Good morning")).toBeInTheDocument();
    expect(screen.getByText("While you were away")).toBeInTheDocument();
    expect(screen.getByText("Followed up with two leads")).toBeInTheDocument();
    expect(screen.getByText("aura-pulse")).toBeInTheDocument();
    expect(screen.getByText("Waiting for you")).toBeInTheDocument();
    expect(screen.getByText("Approve the freelance design offer")).toBeInTheDocument();
    expect(screen.getByText("I noticed")).toBeInTheDocument();
    expect(screen.getByText("Warm leads reply faster before 10am.")).toBeInTheDocument();

    const root = screen.getByText("Good morning").closest(".morning-brief-card");
    expect(root).toHaveClass("aura-card");
    expect(screen.getByRole("button", { name: "Got it" })).toHaveClass("aura-btn--primary");
  });

  it("sends a dismiss resolve when the primary button or pending decision is clicked", async () => {
    const user = userEvent.setup();
    render(<MorningBrief contract={makeMorningBriefContract()} />);

    await user.click(screen.getByRole("button", { name: "Got it" }));
    expect(pulseWSClient.send).toHaveBeenCalledWith({
      type: "resolve",
      contractId: "brief-1",
      token: "brief-token",
      action: "dismiss",
    });

    vi.mocked(pulseWSClient.send).mockClear();
    await user.click(screen.getByRole("button", { name: /Sheryl Approve the freelance design offer/ }));
    expect(pulseWSClient.send).toHaveBeenCalledWith({
      type: "resolve",
      contractId: "brief-1",
      token: "brief-token",
      action: "dismiss",
    });
  });

  it("speaks the morning brief voice line on mount", () => {
    render(<MorningBrief contract={makeMorningBriefContract()} />);

    expect(voiceEngine.speak).toHaveBeenCalledWith(
      "Good morning. Two items need your attention.",
      "high",
    );
  });
});