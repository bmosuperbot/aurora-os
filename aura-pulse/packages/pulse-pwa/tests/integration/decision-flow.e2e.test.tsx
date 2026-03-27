import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { App } from "../../src/App.js";
import { createPulseWebSocketClient, type PulseWebSocketTransport } from "../../src/ws/client.js";
import { useSurfaceStore } from "../../src/ws/surface-store.js";
import {
  installPulseTestGlobals,
  makeDecisionContract,
  makeMorningBriefContract,
  PulseTestHarness,
  resetSurfaceStore,
} from "./pulse-harness.js";

beforeAll(() => {
  installPulseTestGlobals();
});

describe("Pulse PWA decision flow", () => {
  let harness: PulseTestHarness;
  let wsClient: PulseWebSocketTransport;

  beforeEach(async () => {
    harness = new PulseTestHarness();
    wsClient = createPulseWebSocketClient();
    resetSurfaceStore();
    await harness.start();
  });

  afterEach(async () => {
    cleanup();
    resetSurfaceStore();
    await harness.stop();
  });

  it("runs the live morning-brief to decision to completion flow", async () => {
    const user = userEvent.setup();
    render(<App wsClient={wsClient} />);

    await harness.waitForConnection();
    await waitFor(() => {
      expect(useSurfaceStore.getState().wsStatus).toBe("connected");
    });

    await act(async () => {
      harness.send({
        type: "decision",
        payload: { contract: makeMorningBriefContract(), resumeToken: "brief-token" },
      });
    });

    expect(await screen.findByText("Good morning")).toBeInTheDocument();
    expect(screen.getByText("Approve the freelance design offer")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Got it" }));

    await harness.waitForMessage(
      (message) =>
        message.type === "resolve"
        && message.payload.contractId === "brief-1"
        && message.payload.token === "brief-token"
        && message.payload.action === "dismiss",
    );

    await act(async () => {
      harness.send({ type: "clear", payload: { contractId: "brief-1", reason: "resolved" } });
      harness.send({
        type: "decision",
        payload: { contract: makeDecisionContract(), resumeToken: "offer-token" },
      });
    });

    expect(await screen.findByRole("button", { name: "Engage" })).toBeInTheDocument();
    expect(screen.getByText("The freelancer can start Monday for $1,200. Approve if you want me to book the kickoff.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Engage" }));

    await harness.waitForMessage(
      (message) =>
        message.type === "engage"
        && message.payload.contractId === "offer-1",
    );

    await user.click(await screen.findByRole("button", { name: "Approve offer" }));

    await harness.waitForMessage(
      (message) =>
        message.type === "resolve"
        && message.payload.contractId === "offer-1"
        && message.payload.token === "offer-token"
        && message.payload.action === "approve_offer",
    );

    await act(async () => {
      harness.send({ type: "clear", payload: { contractId: "offer-1", reason: "resolved" } });
      harness.send({
        type: "completion",
        payload: {
          contractId: "offer-1",
          surface: {
            voice_line: "Offer approved.",
            summary: "Kickoff confirmed and calendar hold placed.",
          },
        },
      });
    });

    expect(await screen.findByText("Kickoff confirmed and calendar hold placed.")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
  });

  it("preserves the resume token after engage-triggered surface updates", async () => {
    const user = userEvent.setup();
    render(<App wsClient={wsClient} />);

    await harness.waitForConnection();
    await waitFor(() => {
      expect(useSurfaceStore.getState().wsStatus).toBe("connected");
    });

    const contract = makeDecisionContract();

    await act(async () => {
      harness.send({
        type: "decision",
        payload: { contract, resumeToken: "offer-token" },
      });
    });

    await user.click(await screen.findByRole("button", { name: "Engage" }));

    await harness.waitForMessage(
      (message) =>
        message.type === "engage"
        && message.payload.contractId === "offer-1",
    );

    await act(async () => {
      harness.send({
        type: "surface_update",
        payload: {
          contract: {
            ...contract,
            status: "resolver_active",
          },
        },
      });
    });

    await user.click(await screen.findByRole("button", { name: "Approve offer" }));

    await harness.waitForMessage(
      (message) =>
        message.type === "resolve"
        && message.payload.contractId === "offer-1"
        && message.payload.token === "offer-token"
        && message.payload.action === "approve_offer",
    );
  });
});