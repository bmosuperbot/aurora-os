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

  it("submits an Aura command from the dock and renders the ack", async () => {
    const user = userEvent.setup();
    render(<App wsClient={wsClient} />);

    await harness.waitForConnection();
    await waitFor(() => {
      expect(useSurfaceStore.getState().wsStatus).toBe("connected");
    });

    await user.type(screen.getByLabelText("Command"), "Review open Etsy offers and summarize the top two.");
    await user.click(screen.getByRole("button", { name: "Send to Aura" }));

    const outbound = await harness.waitForMessage(
      (message) =>
        message.type === "submit_command"
        && message.payload.text === "Review open Etsy offers and summarize the top two."
        && message.payload.modality === "text",
    );

    await act(async () => {
      harness.send({
        type: "command_status",
        payload: {
          commandId: outbound.payload.commandId,
          status: "accepted",
          message: "Queued in agent:main:main.",
        },
      });
    });

    expect(await screen.findByText("Queued in agent:main:main.")).toBeInTheDocument();
    expect(screen.getByText("Review open Etsy offers and summarize the top two.")).toBeInTheDocument();
  });

  it("renders and clears a generic kernel workspace surface", async () => {
    render(<App wsClient={wsClient} />);

    await harness.waitForConnection();
    await waitFor(() => {
      expect(useSurfaceStore.getState().wsStatus).toBe("connected");
    });

    await act(async () => {
      harness.send({
        type: "kernel_surface",
        payload: {
          surfaceId: "sales-last-week",
          title: "Last week's sales",
          summary: "Three orders closed for $482 total revenue.",
          voiceLine: "Here is last week's sales summary.",
          a2uiMessages: [],
        },
      });
    });

    expect(await screen.findByText("Last week's sales")).toBeInTheDocument();
    expect(screen.getByText("Three orders closed for $482 total revenue.")).toBeInTheDocument();

    await act(async () => {
      harness.send({
        type: "clear_kernel_surface",
        payload: { surfaceId: "sales-last-week" },
      });
    });

    await waitFor(() => {
      expect(screen.queryByText("Last week's sales")).not.toBeInTheDocument();
    });
  });

  it("supports workspace panel controls, clear, and prompt-driven commands", async () => {
    const user = userEvent.setup();
    render(<App wsClient={wsClient} />);

    await harness.waitForConnection();
    await waitFor(() => {
      expect(useSurfaceStore.getState().wsStatus).toBe("connected");
    });

    await act(async () => {
      harness.send({
        type: "kernel_surface",
        payload: {
          surfaceId: "grant-plan",
          title: "Grant plan",
          summary: "Three funding paths need a shortlisting pass.",
          surfaceType: "plan",
          collaborative: true,
          a2uiMessages: [],
        },
      });
      harness.send({
        type: "kernel_surface",
        payload: {
          surfaceId: "inbox-summary",
          title: "Inbox summary",
          summary: "One decision email needs review.",
          surfaceType: "attention",
          priority: "high",
          a2uiMessages: [],
        },
      });
    });

    expect(await screen.findByText("Grant plan")).toBeInTheDocument();
    expect(screen.getByText("Inbox summary")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Collapse Grant plan" }));
    expect(document.querySelector('[data-surface-panel="grant-plan"]')).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore Grant plan" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear workspace" }));
    expect(await screen.findByText("The board is clear.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "What is my inventory looking like today?" }));

    await harness.waitForMessage(
      (message) =>
        message.type === "submit_command"
        && message.payload.text === "What is my inventory looking like today?"
        && message.payload.modality === "text",
    );

    await user.click(screen.getByRole("button", { name: "Restore workspace" }));
    expect(await screen.findByText("Grant plan")).toBeInTheDocument();
    expect(screen.getByText("Inbox summary")).toBeInTheDocument();
  });

  it("renders Aura business components and sends workspace surface actions", async () => {
    const user = userEvent.setup();
    render(<App wsClient={wsClient} />);

    await harness.waitForConnection();
    await waitFor(() => {
      expect(useSurfaceStore.getState().wsStatus).toBe("connected");
    });

    await act(async () => {
      harness.send({
        type: "kernel_surface",
        payload: {
          surfaceId: "sales-last-week",
          title: "Last week's sales",
          summary: "Three orders closed for $482 total revenue.",
          a2uiMessages: [
            {
              surfaceUpdate: {
                surfaceId: "sales-last-week",
                components: [
                  {
                    id: "root",
                    component: {
                      Column: {
                        children: { explicitList: ["headline", "metrics", "orders", "inspect"] },
                      },
                    },
                  },
                  {
                    id: "headline",
                    component: {
                      Text: {
                        text: {
                          literalString: "Sales performance for last week",
                        },
                      },
                    },
                  },
                  {
                    id: "metrics",
                    component: {
                      MetricGrid: {
                        title: "Overview",
                        metrics: [
                          {
                            id: "revenue",
                            label: "Revenue",
                            value: "$482",
                            detail: "+12% vs prior week",
                            tone: "positive",
                          },
                          {
                            id: "orders",
                            label: "Orders",
                            value: 3,
                            detail: "2 Etsy, 1 direct",
                          },
                        ],
                      },
                    },
                  },
                  {
                    id: "orders",
                    component: {
                      DataTable: {
                        title: "Closed orders",
                        columns: [
                          { id: "order", label: "Order" },
                          { id: "buyer", label: "Buyer" },
                          { id: "gross", label: "Gross", align: "right" },
                        ],
                        rows: [
                          { id: "row-1", order: "A-104", buyer: "Alex", gross: "$182" },
                          { id: "row-2", order: "A-103", buyer: "Mina", gross: "$160" },
                        ],
                      },
                    },
                  },
                  {
                    id: "inspect",
                    component: {
                      ActionButton: {
                        label: "Inspect A-104",
                        actionId: "inspect_order",
                        style: "secondary",
                        actionContext: {
                          orderId: "A-104",
                          gross: 182,
                          priority: true,
                        },
                      },
                    },
                  },
                ],
              },
            },
            {
              dataModelUpdate: {
                surfaceId: "sales-last-week",
                contents: [],
              },
            },
            {
              beginRendering: {
                surfaceId: "sales-last-week",
                root: "root",
                catalogId: "https://aura-os.ai/a2ui/v1/aura-catalog.json",
              },
            },
          ],
        },
      });
    });

    expect(await screen.findByText("Overview")).toBeInTheDocument();
    expect(screen.getByText("Sales performance for last week")).toBeInTheDocument();
    expect(screen.getByText("$482")).toBeInTheDocument();
    expect(screen.getByText("Closed orders")).toBeInTheDocument();
    expect(screen.getByText("Alex")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Inspect A-104" }));

    await harness.waitForMessage(
      (message) => {
        const context = message.payload.context as Record<string, unknown> | undefined;
        return message.type === "surface_action"
          && message.payload.surfaceId === "sales-last-week"
          && message.payload.actionName === "inspect_order"
          && context?.orderId === "A-104"
          && context?.gross === 182;
      },
    );
  });

  it("falls back to simple text and action rendering when agent A2UI payloads are malformed", async () => {
    const user = userEvent.setup();
    render(<App wsClient={wsClient} />);

    await harness.waitForConnection();
    await waitFor(() => {
      expect(useSurfaceStore.getState().wsStatus).toBe("connected");
    });

    await act(async () => {
      harness.send({
        type: "kernel_surface",
        payload: {
          surfaceId: "attention-inbox-decisions",
          title: "Inbox decisions",
          summary: "A new decision needs attention.",
          surfaceType: "attention",
                                children: { explicitList: ["headline", "metrics", "orders", "inspect"] },
          a2uiMessages: [
            {
              surfaceUpdate: {
                surfaceId: "attention-inbox-decisions",
                components: {
                  root: {
                    Column: {
                      children: { explicitList: ["title", "cta"] },
                    },
                  },
                  title: {
                    Text: {
                      value: "Reply to the venue by 3pm.",
                    },
                  },
                  cta: {
                    ActionButton: {
                      label: "Review now",
                      actionId: "review_now",
                      style: "primary",
                    },
                  },
                },
              },
            },
            {
              dataModelUpdate: {
                surfaceId: "attention-inbox-decisions",
                contents: {},
              },
            },
            {
              beginRendering: {
                surfaceId: "attention-inbox-decisions",
                root: "root",
                catalogId: "https://aura-os.ai/a2ui/v1/aura-catalog.json",
              },
            },
          ],
        },
      });
    });

    expect(await screen.findByText("Inbox decisions")).toBeInTheDocument();
    expect(screen.getByText("A new decision needs attention.")).toBeInTheDocument();
    expect(await screen.findByText("Reply to the venue by 3pm.")).toBeInTheDocument();

    await user.click(await screen.findByRole("button", { name: "Review now" }));

    await harness.waitForMessage(
      (message) => message.type === "surface_action"
        && message.payload.surfaceId === "attention-inbox-decisions"
        && message.payload.actionName === "review_now",
    );
  });

  it("renders fallback text and buttons from ad hoc agent message payloads", async () => {
    const user = userEvent.setup();
    render(<App wsClient={wsClient} />);

    await harness.waitForConnection();
    await waitFor(() => {
      expect(useSurfaceStore.getState().wsStatus).toBe("connected");
    });

    await act(async () => {
      harness.send({
        type: "kernel_surface",
        payload: {
          surfaceId: "pulse-visible-button-live",
          title: "Visible Button Live",
          summary: "Button should appear now",
          surfaceType: "workspace",
          icon: "VB",
          a2uiMessages: [
            {
              type: "message",
              value: "Visible button check",
              actionLabel: "Visible Ack",
            },
          ],
        },
      });
    });

    expect(await screen.findByText("Visible button check")).toBeInTheDocument();

    await user.click(await screen.findByRole("button", { name: "Visible Ack" }));

    await harness.waitForMessage(
      (message) => message.type === "surface_action"
        && message.payload.surfaceId === "pulse-visible-button-live"
        && message.payload.actionName === "visible_ack",
    );
  });
});