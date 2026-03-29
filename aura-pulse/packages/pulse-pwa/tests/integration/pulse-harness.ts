import { createServer, type Server } from "node:http";
import { WebSocketServer, WebSocket as NodeWebSocket, type RawData } from "ws";
import { act } from "@testing-library/react";
import { vi } from "vitest";

import { useSurfaceStore } from "../../src/ws/surface-store.js";

export interface WireMessage {
  type: string;
  payload: Record<string, unknown>;
}

export interface HistoryResponseFixture {
  contracts: Array<Record<string, unknown>>;
  hasMore: boolean;
  total: number;
}

interface PulseTestHarnessOptions {
  historyResponse?: HistoryResponseFixture;
}

class BrowserWebSocket {
  static readonly CONNECTING = NodeWebSocket.CONNECTING;
  static readonly OPEN = NodeWebSocket.OPEN;
  static readonly CLOSING = NodeWebSocket.CLOSING;
  static readonly CLOSED = NodeWebSocket.CLOSED;

  private readonly socket: NodeWebSocket;

  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.socket = new NodeWebSocket(url);
    this.socket.on("open", () => {
      act(() => {
        this.onopen?.();
      });
    });
    this.socket.on("message", (data: RawData) => {
      act(() => {
        this.onmessage?.({ data: data.toString() });
      });
    });
    this.socket.on("close", () => {
      act(() => {
        this.onclose?.();
      });
    });
    this.socket.on("error", () => {
      act(() => {
        this.onerror?.();
      });
    });
  }

  get readyState() {
    return this.socket.readyState;
  }

  send(data: string) {
    this.socket.send(data);
  }

  close() {
    this.socket.close();
  }
}

export class PulseTestHarness {
  private httpServer: Server | null = null;
  private wsServer: WebSocketServer | null = null;
  private client: NodeWebSocket | null = null;
  private readonly historyResponse: HistoryResponseFixture;
  httpUrl = "";
  wsUrl = "";
  readonly received: WireMessage[] = [];

  constructor(options: PulseTestHarnessOptions = {}) {
    this.historyResponse = options.historyResponse ?? {
      contracts: [],
      hasMore: false,
      total: 0,
    };
  }

  async start(): Promise<void> {
    this.httpServer = createServer((req, res) => {
      if (req.url?.startsWith("/aura/history")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(this.historyResponse));
        return;
      }
      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve, reject) => {
      this.httpServer?.once("error", reject);
      this.httpServer?.listen(0, "127.0.0.1", () => resolve());
    });
    const httpAddress = this.httpServer.address();
    if (!httpAddress || typeof httpAddress === "string") {
      throw new Error("Failed to determine Pulse test harness HTTP port.");
    }
    this.httpUrl = `http://127.0.0.1:${httpAddress.port}`;

    this.wsServer = new WebSocketServer({ port: 0, host: "127.0.0.1", path: "/aura/surface" });
    this.wsServer.on("connection", (socket: NodeWebSocket) => {
      this.client = socket;
      socket.on("message", (data: RawData) => {
        this.received.push(JSON.parse(data.toString()) as WireMessage);
      });
      socket.on("close", () => {
        if (this.client === socket) {
          this.client = null;
        }
      });
    });

    await new Promise<void>((resolve) => {
      this.wsServer?.once("listening", () => resolve());
    });
    const wsAddress = this.wsServer.address();
    if (!wsAddress || typeof wsAddress === "string") {
      throw new Error("Failed to determine Pulse test harness WebSocket port.");
    }
    this.wsUrl = `ws://127.0.0.1:${wsAddress.port}/aura/surface`;
    setPulseRuntimeUrls(this.httpUrl, this.wsUrl);
  }

  async stop(): Promise<void> {
    this.client?.close();
    this.client = null;

    if (this.wsServer) {
      await new Promise<void>((resolve, reject) => {
        this.wsServer?.close((error?: Error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      this.wsServer = null;
    }

    if (this.httpServer) {
      await new Promise<void>((resolve, reject) => {
        this.httpServer?.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      this.httpServer = null;
    }

    this.received.length = 0;
    setPulseRuntimeUrls(undefined, undefined);
  }

  async waitForConnection(): Promise<void> {
    await this.waitFor(() => this.client !== null);
  }

  send(message: Record<string, unknown>): void {
    if (!this.client) {
      throw new Error("Pulse test harness has no connected client.");
    }
    this.client.send(JSON.stringify(message));
  }

  async waitForMessage(predicate: (message: WireMessage) => boolean): Promise<WireMessage> {
    try {
      await this.waitFor(() => this.received.some(predicate));
    } catch (error) {
      throw new Error(`${(error as Error).message} Received messages: ${JSON.stringify(this.received)}`);
    }
    return this.received.find(predicate) as WireMessage;
  }

  private async waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
    const started = Date.now();
    while (!predicate()) {
      if (Date.now() - started > timeoutMs) {
        throw new Error("Timed out waiting for test harness condition.");
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}

export function installPulseTestGlobals() {
  vi.stubGlobal("WebSocket", BrowserWebSocket as unknown as typeof globalThis.WebSocket);
  Object.defineProperty(window, "WebSocket", {
    configurable: true,
    value: BrowserWebSocket,
  });
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
      takeRecords() {
        return [];
      }
    },
  );
  Object.defineProperty(window, "IntersectionObserver", {
    configurable: true,
    value: globalThis.IntersectionObserver,
  });
  vi.stubGlobal(
    "SpeechSynthesisUtterance",
    class {
      text: string;
      rate = 1;
      pitch = 1;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;

      constructor(text: string) {
        this.text = text;
      }
    },
  );
  Object.defineProperty(window, "speechSynthesis", {
    configurable: true,
    value: {
      speak: (utterance: { onend?: (() => void) | null }) => {
        setTimeout(() => utterance.onend?.(), 0);
      },
      cancel: vi.fn(),
    },
  });
}

export function setPulseRuntimeUrls(httpUrl?: string, wsUrl?: string) {
  const runtime = globalThis as typeof globalThis & {
    __AURA_PLUGIN_URL__?: string;
    __AURA_WS_URL__?: string;
  };
  runtime.__AURA_PLUGIN_URL__ = httpUrl;
  runtime.__AURA_WS_URL__ = wsUrl;
}

export function resetSurfaceStore() {
  useSurfaceStore.setState({
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
  });
}

export function makeMorningBriefContract() {
  const now = new Date().toISOString();
  return {
    id: "brief-1",
    type: "morning-brief",
    status: "waiting_approval",
    agent_id: "agent-brief",
    agent_name: "Sheryl",
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

export function makeDecisionContract() {
  const now = new Date().toISOString();
  return {
    id: "offer-1",
    type: "offer-received",
    status: "waiting_approval",
    agent_id: "agent-offer",
    agent_name: "Sheryl",
    participants: {
      writer: { id: "sheryl", type: "agent" },
      resolver: { id: "owner", type: "human" },
    },
    intent: { goal: "Approve the freelance design offer" },
    surface: {
      voice_line: "A designer accepted the budget range.",
      summary: "The freelancer can start Monday for $1,200. Approve if you want me to book the kickoff.",
      recommendation: {
        action: "approve_offer",
        label: "Approve offer",
        reasoning: "The scope, timing, and rate match your constraints.",
      },
      actions: [
        { id: "approve_offer", label: "Approve offer", action: "approve_offer", style: "primary" },
        { id: "decline_offer", label: "Decline", action: "decline_offer", style: "secondary" },
      ],
    },
    created_at: now,
    updated_at: now,
  };
}