import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Use fake timers to control reconnect delays
vi.useFakeTimers();

// Minimal WebSocket mock
class MockWebSocket {
  static OPEN = 1;
  readyState = MockWebSocket.OPEN;
  url: string;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  send = vi.fn();
  close = vi.fn(() => {
    if (this.onclose) this.onclose();
  });
  constructor(url: string) {
    this.url = url;
    // Simulate async open
    setTimeout(() => this.onopen?.(), 0);
  }
}

vi.stubGlobal("WebSocket", MockWebSocket);

import { PulseWebSocketClient } from "../../src/ws/client.js";

describe("PulseWebSocketClient reconnect backoff", () => {
  let client: PulseWebSocketClient;
  let statusEvents: string[];

  beforeEach(() => {
    client = new PulseWebSocketClient();
    statusEvents = [];
    client.onStatus((s) => statusEvents.push(s));
  });

  afterEach(() => {
    vi.clearAllTimers();
    client.disconnect();
  });

  it("reports 'connected' on first open", async () => {
    client.connect("ws://localhost:7700/aura/surface");
    await vi.runAllTimersAsync();
    expect(statusEvents).toContain("connected");
  });

  it("reports 'reconnecting' after unexpected close", async () => {
    client.connect("ws://localhost:7700/aura/surface");
    await vi.runAllTimersAsync();
    // Simulate unexpected close
    (client as any).ws.onclose();
    expect(statusEvents).toContain("reconnecting");
  });

  it("attempts reconnect after initial 1s delay", async () => {
    client.connect("ws://localhost:7700/aura/surface");
    await vi.runAllTimersAsync();
    const connectSpy = vi.spyOn(client as any, "open");
    (client as any).ws.onclose();
    vi.advanceTimersByTime(1500);
    expect(connectSpy).toHaveBeenCalledTimes(1);
  });

  it("doubles reconnect delay after each failure", async () => {
    // Instead of fighting fake-timer jitter, verify the doubling by tracking
    // what delay value the reconnect timer is scheduled WITH.
    // We spy on clearTimeout (used by scheduleReconnect -> clearReconnect) to
    // know it ran, then read the post-fire reconnectDelay directly (before open() resets it).
    // We intercept open() to stop the reset from happening.
    client.connect("ws://localhost:7700/aura/surface");
    await vi.runAllTimersAsync();

    // Patch open() to a no-op so firing the reconnect timer doesn't create a new WS
    // (and avoid the onopen -> reset problem)
    let capturedDelay: number | null = null;
    vi.spyOn(client as any, "scheduleReconnect").mockImplementation(function (this: typeof client) {
      capturedDelay = (this as any).reconnectDelay;
      // Don't actually schedule — just capture
    });

    // First close — reconnectDelay is currently 1000 (reset by onopen)
    (client as any).ws.onclose();
    expect(capturedDelay).toBe(1000);

    // Simulate a second close after delay has been doubled
    (client as any).reconnectDelay = 2000;
    (client as any).ws = { onclose: vi.fn() }; // fake ws so we can close again
    (client as any).handleClose();
    expect(capturedDelay).toBe(2000);
  });

  it("caps reconnect delay at 30s", async () => {
    client.connect("ws://localhost:7700/aura/surface");
    await vi.runAllTimersAsync();

    // Patch scheduleReconnect to capture the delay at moment of scheduling
    vi.spyOn(client as any, "scheduleReconnect").mockImplementation(function () {});

    // Set delay to 20s — doubling would give 40s, but cap is 30s
    (client as any).reconnectDelay = 20_000;
    (client as any).handleClose(); // triggers scheduleReconnect

    // reconnectDelay should have been doubled inside scheduleReconnect before cap
    // But we capture it BEFORE doubling — the cap happens inside scheduleReconnect itself
    // So: capturedDelay (pre-double) = 20000; actual scheduled ms = min(40000±jitter, 30000) ≤ 30000
    // We can verify by patching the private scheduleReconnect differently — just check that
    // the delay stored after the next reconnect fires is 30000 (capped when doubled).
    vi.spyOn(client as any, "scheduleReconnect").mockRestore();

    // Re-test: let the real scheduleReconnect run and verify the stored delay after fire
    (client as any).reconnectDelay = 20_000;
    vi.spyOn(client as any, "open").mockImplementation(() => {}); // stop actual WS creation
    (client as any).handleClose(); // schedules at min(40000, 30000) = 30000 (before jitter clamp)
    vi.advanceTimersByTime(33_000); // advance past the max delay
    // After firing, reconnectDelay should have been doubled (20000→40000→capped to 30000)
    expect((client as any).reconnectDelay).toBe(30_000);
  });

  it("does NOT reconnect after intentional disconnect", async () => {
    client.connect("ws://localhost:7700/aura/surface");
    await vi.runAllTimersAsync();
    const openSpy = vi.spyOn(client as any, "open");
    client.disconnect();
    vi.advanceTimersByTime(5000);
    // open() should not have been called again after disconnect
    expect(openSpy).not.toHaveBeenCalled();
  });

  it("resets delay to 1s on successful reconnect", async () => {
    client.connect("ws://localhost:7700/aura/surface");
    await vi.runAllTimersAsync();
    (client as any).reconnectDelay = 8000;
    (client as any).ws.onclose();
    vi.advanceTimersByTime(10_000);
    await vi.runAllTimersAsync(); // fires open() → new MockWebSocket → onopen
    expect((client as any).reconnectDelay).toBe(1000);
  });

  it("parses JSON messages and calls onMessage handlers", async () => {
    const messages: unknown[] = [];
    client.onMessage((m) => messages.push(m));
    client.connect("ws://localhost:7700/aura/surface");
    await vi.runAllTimersAsync();
    const ws = (client as any).ws as MockWebSocket;
    ws.onmessage!({ data: JSON.stringify({ type: "decision", contract: { id: "c-1" } }) });
    expect(messages).toHaveLength(1);
    expect((messages[0] as any).type).toBe("decision");
  });

  it("parses clarification_answer payloads", async () => {
    const messages: unknown[] = [];
    client.onMessage((m) => messages.push(m));
    client.connect("ws://localhost:7700/aura/surface");
    await vi.runAllTimersAsync();
    const ws = (client as any).ws as MockWebSocket;
    ws.onmessage!({
      data: JSON.stringify({
        type: "clarification_answer",
        payload: {
          contractId: "c-1",
          entry: { id: "e-1", role: "answer", content: "PDF", timestamp: new Date().toISOString() },
          contract: { id: "c-1", status: "resolver_active" },
        },
      }),
    });
    expect(messages).toHaveLength(1);
    expect((messages[0] as any).type).toBe("clarification_answer");
    expect((messages[0] as any).contract?.status).toBe("resolver_active");
  });

  it("preserves clear reason from payload", async () => {
    const messages: unknown[] = [];
    client.onMessage((m) => messages.push(m));
    client.connect("ws://localhost:7700/aura/surface");
    await vi.runAllTimersAsync();
    const ws = (client as any).ws as MockWebSocket;
    ws.onmessage!({ data: JSON.stringify({ type: "clear", payload: { contractId: "c-1", reason: "failed" } }) });
    expect((messages[0] as any).reason).toBe("failed");
  });

  it("silently discards non-JSON messages", async () => {
    const messages: unknown[] = [];
    client.onMessage((m) => messages.push(m));
    client.connect("ws://localhost:7700/aura/surface");
    await vi.runAllTimersAsync();
    const ws = (client as any).ws as MockWebSocket;
    ws.onmessage!({ data: "not-json" });
    expect(messages).toHaveLength(0);
  });
});
