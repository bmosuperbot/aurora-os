import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { HistoryOverlay } from "../../src/history/HistoryOverlay.js";
import { installPulseTestGlobals, PulseTestHarness, setPulseRuntimeUrls } from "./pulse-harness.js";

beforeAll(() => {
  installPulseTestGlobals();
});

describe("History overlay", () => {
  let harness: PulseTestHarness;

  beforeEach(async () => {
    harness = new PulseTestHarness({
      historyResponse: {
        contracts: [
          {
            id: "offer-1",
            type: "offer-received",
            status: "complete",
            intent: { goal: "Approve the freelance design offer" },
            clarifications: [
              {
                id: "clar-1",
                role: "answer",
                content: "Monday works for the kickoff.",
                timestamp: new Date().toISOString(),
              },
            ],
            resume: {
              action: "approve_offer",
              resolver_id: "owner",
              timestamp: new Date().toISOString(),
            },
            completion_surface: {
              voice_line: "Offer approved.",
              summary: "Kickoff confirmed and calendar hold placed.",
            },
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
        hasMore: false,
        total: 1,
      },
    });
    await harness.start();
  });

  afterEach(async () => {
    cleanup();
    setPulseRuntimeUrls(undefined, undefined);
    await harness.stop();
  });

  it("loads and renders history from the live HTTP endpoint", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(<HistoryOverlay onClose={onClose} />);

    expect(await screen.findByText("Approve the freelance design offer")).toBeInTheDocument();
    expect(screen.getByText("approve_offer")).toBeInTheDocument();
    expect(screen.getByText("Kickoff confirmed and calendar hold placed.")).toBeInTheDocument();
    expect(screen.getByText("Monday works for the kickoff.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});