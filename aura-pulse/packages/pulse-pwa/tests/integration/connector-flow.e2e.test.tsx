import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { App } from "../../src/App.js";
import { createPulseWebSocketClient, type PulseWebSocketTransport } from "../../src/ws/client.js";
import { useSurfaceStore } from "../../src/ws/surface-store.js";
import {
  installPulseTestGlobals,
  PulseTestHarness,
  resetSurfaceStore,
} from "./pulse-harness.js";

beforeAll(() => {
  installPulseTestGlobals();
});

describe("Pulse PWA connector flow", () => {
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

  it("handles a secure-input connector request over the live websocket transport", async () => {
    const user = userEvent.setup();
    render(<App wsClient={wsClient} />);

    await harness.waitForConnection();
    await waitFor(() => {
      expect(useSurfaceStore.getState().wsStatus).toBe("connected");
    });

    await act(async () => {
      harness.send({
        type: "connector_request",
        payload: {
          id: "gmail",
          connector_id: "gmail",
          connector_name: "Gmail",
          offer_text: "Connect Gmail so Aura can send follow-ups for you.",
          source: "aura-connector",
          status: "pending",
          capability_without: "Aura cannot send follow-ups automatically.",
          capability_with: "Aura can draft and send follow-ups.",
          flow_type: "secure_input",
          input_label: "Gmail API key",
        },
      });
    });

    expect(await screen.findByText("Connect Gmail")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Gmail API key"), "secret-123");
    await user.click(screen.getByRole("button", { name: "Save" }));

    const message = await harness.waitForMessage((entry) => entry.type === "complete_connector");
    expect(message.payload.connectorId).toBe("gmail");
    expect(message.payload.credentials).toEqual({ key: "secret-123" });

    await act(async () => {
      harness.send({ type: "connector_complete", payload: { connectorId: "gmail", status: "active" } });
    });

    await waitFor(() => {
      expect(screen.queryByText("Connect Gmail")).not.toBeInTheDocument();
    });
  });
});