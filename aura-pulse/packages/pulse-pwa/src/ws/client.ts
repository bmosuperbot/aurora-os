import type {
  A2UIMessage,
  BaseContract,
  ClarificationEntry,
  CompletionSurface,
  ContractSurface,
  RuntimeMessage,
  SurfaceMessage,
} from "./protocol.js";

type MessageHandler = (msg: RuntimeMessage) => void;
type StatusHandler = (status: "connected" | "reconnecting" | "disconnected") => void;

export interface PulseWebSocketTransport {
  connect(url: string): void;
  disconnect(): void;
  send(message: SurfaceMessage): void;
  onMessage(handler: MessageHandler): () => void;
  onStatus(handler: StatusHandler): () => void;
}

export class PulseWebSocketClient implements PulseWebSocketTransport {
  private ws: WebSocket | null = null;
  private url = "";
  private reconnectDelay = 1000;
  private readonly maxDelay = 30_000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;

  private onMessageHandlers: MessageHandler[] = [];
  private onStatusHandlers: StatusHandler[] = [];

  connect(url: string): void {
    this.url = url;
    this.intentionalClose = false;
    this.open();
  }

  disconnect(): void {
    this.intentionalClose = true;
    this.clearReconnect();
    this.ws?.close();
    this.ws = null;
  }

  send(message: SurfaceMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(this.toWireMessage(message)));
    }
  }

  onMessage(handler: MessageHandler): () => void {
    this.onMessageHandlers.push(handler);
    return () => {
      this.onMessageHandlers = this.onMessageHandlers.filter(h => h !== handler);
    };
  }

  onStatus(handler: StatusHandler): () => void {
    this.onStatusHandlers.push(handler);
    return () => {
      this.onStatusHandlers = this.onStatusHandlers.filter(h => h !== handler);
    };
  }

  private open(): void {
    this.ws = new WebSocket(this.url);
    this.ws.onopen = () => this.handleOpen();
    this.ws.onmessage = (event) => this.handleMessage(event);
    this.ws.onclose = () => this.handleClose();
    this.ws.onerror = () => {
      // onerror is always followed by onclose; handle reconnect there
    };
  }

  private handleOpen(): void {
    this.reconnectDelay = 1000;
    this.emitStatus("connected");
    // Phase 2 server automatically pushes all pending contracts on connect.
  }

  private handleMessage(event: MessageEvent): void {
    let raw: unknown;
    try {
      raw = JSON.parse(event.data as string);
    } catch {
      console.warn("[PulseWS] Received non-JSON message, ignoring.");
      return;
    }
    const msg = this.normalizeRuntimeMessage(raw);
    if (!msg) return;
    for (const h of this.onMessageHandlers) h(msg);
  }

  private normalizeRuntimeMessage(raw: unknown): RuntimeMessage | null {
    if (!raw || typeof raw !== "object") return null;

    const msg = raw as { type?: unknown; payload?: unknown; [key: string]: unknown };
    if (typeof msg.type !== "string") return null;

    const payload = (msg.payload ?? raw) as Record<string, unknown>;

    switch (msg.type) {
      case "decision": {
        const envelope = "contract" in payload && payload.contract && typeof payload.contract === "object"
          ? payload
          : { contract: payload };
        if (!envelope.contract || typeof envelope.contract !== "object") return null;
        return {
          type: "decision",
          contract: {
            ...(envelope.contract as object),
            ...(typeof envelope.resumeToken === "string" ? { resume_token: envelope.resumeToken } : {}),
          } as BaseContract,
          a2uiMessages: Array.isArray(envelope.a2uiMessages) ? envelope.a2uiMessages as A2UIMessage[] : undefined,
        };
      }

      case "surface_update":
        return {
          type: "surface_update",
          contractId: typeof payload.contractId === "string" ? payload.contractId : undefined,
          surface: typeof payload.surface === "object" && payload.surface !== null ? payload.surface as ContractSurface : undefined,
          contract: typeof payload.contract === "object" && payload.contract !== null ? payload.contract as BaseContract : undefined,
          a2uiMessages: Array.isArray(payload.a2uiMessages) ? payload.a2uiMessages as A2UIMessage[] : undefined,
        };

      case "clarification_answer":
        if (typeof payload.contractId !== "string" || typeof payload.entry !== "object" || payload.entry === null) {
          return null;
        }
        return {
          type: "clarification_answer",
          contractId: payload.contractId,
          entry: payload.entry as ClarificationEntry,
          contract: typeof payload.contract === "object" && payload.contract !== null ? payload.contract as BaseContract : undefined,
        };

      case "clear":
        if (typeof payload.contractId !== "string") return null;
        return {
          type: "clear",
          contractId: payload.contractId,
          reason: payload.reason === "failed" || payload.reason === "timeout" ? payload.reason : "resolved",
        };

      case "completion":
        if (typeof payload.contractId !== "string") return null;
        return {
          type: "completion",
          contractId: payload.contractId,
          surface: typeof payload.surface === "object" && payload.surface !== null
            ? payload.surface as CompletionSurface
            : {
                voice_line: typeof payload.voice_line === "string" ? payload.voice_line : "",
                summary: typeof payload.summary === "string" ? payload.summary : "completed",
              },
        };

      case "connector_request": {
        const connectorId = typeof payload.connector_id === "string"
          ? payload.connector_id
          : typeof payload.id === "string"
            ? payload.id
            : "connector";
        return {
          type: "connector_request",
          card: {
            ...(payload as object),
            connector_id: connectorId,
            connector_name:
              typeof payload.connector_name === "string"
                ? payload.connector_name
                : typeof payload.source === "string"
                  ? payload.source
                  : connectorId,
            offer_text:
              typeof payload.offer_text === "string"
                ? payload.offer_text
                : typeof payload.capability_without === "string"
                  ? payload.capability_without
                  : "This connector can unlock additional capabilities.",
          },
        };
      }

      case "connector_complete":
        if (typeof payload.connectorId !== "string") return null;
        return { type: "connector_complete", connectorId: payload.connectorId };

      default:
        return null;
    }
  }

  private toWireMessage(message: SurfaceMessage): { type: string; payload: Record<string, unknown> } {
    switch (message.type) {
      case "engage":
        return { type: message.type, payload: { contractId: message.contractId } };
      case "ask_clarification":
        return { type: message.type, payload: { contractId: message.contractId, question: message.question } };
      case "resolve":
        return {
          type: message.type,
          payload: {
            contractId: message.contractId,
            ...(message.token ? { token: message.token } : {}),
            action: message.action,
            ...(message.value !== undefined ? { value: message.value } : {}),
            ...(message.artifacts ? { artifacts: message.artifacts } : {}),
          },
        };
      case "abandon":
        return { type: message.type, payload: { contractId: message.contractId } };
      case "initiate_connector":
        return { type: message.type, payload: { connectorId: message.connectorId } };
      case "complete_connector":
        return { type: message.type, payload: { connectorId: message.connectorId, credentials: message.credentials } };
      case "decline_connector":
        return { type: message.type, payload: { connectorId: message.connectorId, never: message.never } };
    }
  }

  private handleClose(): void {
    this.ws = null;
    if (this.intentionalClose) return;
    this.emitStatus("reconnecting");
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    this.clearReconnect();
    const jitter = this.reconnectDelay * 0.3 * (Math.random() * 2 - 1);
    const delay = Math.min(this.reconnectDelay + jitter, this.maxDelay);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxDelay);
      this.open();
    }, delay);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private emitStatus(status: "connected" | "reconnecting" | "disconnected"): void {
    for (const h of this.onStatusHandlers) h(status);
  }
}

export function createPulseWebSocketClient(): PulseWebSocketClient {
  return new PulseWebSocketClient();
}

export const pulseWSClient = createPulseWebSocketClient();
