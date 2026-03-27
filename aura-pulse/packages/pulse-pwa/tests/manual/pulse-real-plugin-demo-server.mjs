import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WebSocket, WebSocketServer } from "ws";

import { ContractRuntimeService } from "../../../openclaw-plugin/src/services/contract-runtime-service.js";
import { WebSocketService } from "../../../openclaw-plugin/src/services/websocket-service.js";
import { buildSurfaceDecision } from "../../../openclaw-plugin/src/tools/aura-surface-decision.js";
import { buildRequestConnection } from "../../../openclaw-plugin/src/tools/aura-request-connection.js";

const httpPort = Number(process.env.AURA_REAL_DEMO_PORT ?? 8712);
const wsPort = Number(process.env.AURA_REAL_DEMO_WS_PORT ?? 7720);
const auraRoot = mkdtempSync(join(tmpdir(), "aura-real-demo-"));

const logger = {
  debug: (msg) => console.log(`[debug] ${msg}`),
  info: (msg) => console.log(`[info] ${msg}`),
  warn: (msg) => console.warn(`[warn] ${msg}`),
  error: (msg) => console.error(`[error] ${msg}`),
};

const config = {
  auraRoot,
  workspaceId: "manual-browser-demo",
  wsPort,
  signalDebounceMs: 50,
  engramBridgeEnabled: false,
  engramHttpUrl: "http://localhost:4318",
  pulseStaticDir: null,
  projectRootOverride: null,
};

const completionNotifier = { onComplete: async () => {} };
const runtimeService = new ContractRuntimeService(config, completionNotifier);
await runtimeService.start();

const runtime = runtimeService.getRuntime();
const storage = runtimeService.getStorage();
const paths = runtimeService.getPaths();

const wsService = new WebSocketService(config, runtime, storage, paths.signalPath, logger);
await wsService.start();

const surfaceDecision = buildSurfaceDecision(runtime);
const requestConnection = buildRequestConnection(storage, wsService);

let currentContractId = null;
let completionQueued = false;
let connectorQueued = false;
let pendingConnectorCard = null;
let offerSequence = 0;

function buildConnectorRequestParams() {
  return {
    connector_id: "gmail",
    display_name: "Gmail",
    reason: "Connect Gmail so Aura can send the kickoff email for you.",
    flow_type: "secure_input",
    input_label: "Gmail API key",
  };
}

function buildPendingConnectorCard() {
  return {
    id: "gmail",
    connector_id: "gmail",
    connector_name: "Gmail",
    offer_text: "Connect Gmail so Aura can send the kickoff email for you.",
    source: "aura-connector",
    status: "pending",
    capability_without: "Aura cannot send the kickoff email automatically.",
    capability_with: "Aura can send the kickoff email automatically.",
    flow_type: "secure_input",
    input_label: "Gmail API key",
  };
}

async function seedOfferScenario() {
  offerSequence += 1;
  const offerId = `design-kickoff-${offerSequence}`;
  const seeded = JSON.parse(
    (
      await surfaceDecision.execute(`manual-real-offer-${offerSequence}`, {
        type: "offer-received",
        goal: "Approve the freelance design kickoff",
        trigger: "Designer accepted the budget range",
        context: {
          platform: "email",
          listing_id: offerId,
          listing_title: "Freelance design kickoff",
          buyer_id: `designer-${offerSequence}`,
          offer_amount: 1200,
          asking_price: 1200,
        },
        summary: "The designer can start Monday for $1,200. Approve to lock in the kickoff.",
        voice_line: "The designer accepted your budget.",
        actions: [
          { id: "approve_offer", label: "Approve offer", value: "approve_offer" },
          { id: "decline_offer", label: "Decline", value: "decline_offer" },
        ],
        writer_id: "sheryl",
      })
    ).content[0].text,
  );

  currentContractId = seeded.contractId;
  completionQueued = false;
  connectorQueued = false;
  pendingConnectorCard = null;
}

async function ensureScenario() {
  const contract = currentContractId ? await runtime.get(currentContractId) : null;
  const connector = await storage.readConnector("gmail");

  if (connector?.status === "pending") {
    pendingConnectorCard ??= buildPendingConnectorCard();
    return { replayConnector: true };
  }

  if (contract && ["waiting_approval", "resolver_active", "clarifying", "executing"].includes(contract.status)) {
    return { replayConnector: false };
  }

  if (!contract || contract.status === "complete" || contract.status === "failed") {
    await seedOfferScenario();
  }

  return { replayConnector: false };
}

await seedOfferScenario();

async function maybeAdvanceDemo() {
  const contract = currentContractId ? await runtime.get(currentContractId) : null;
  if (!contract) {
    return;
  }

  const connector = await storage.readConnector("gmail");
  if (connector?.status !== "pending" && pendingConnectorCard) {
    pendingConnectorCard = null;
  }

  if (contract.status === "executing" && !completionQueued) {
    completionQueued = true;
    setTimeout(async () => {
      const latest = currentContractId ? await runtime.get(currentContractId) : null;
      if (!latest || latest.status !== "executing") {
        return;
      }

      const summary = latest.resume?.action === "approve_offer"
        ? "Kickoff confirmed and the designer is cleared to start Monday."
        : "The offer was declined and the calendar hold was released.";

      await storage.write({
        ...latest,
        completion_surface: {
          voice_line: latest.resume?.action === "approve_offer" ? "Offer approved." : "Offer declined.",
          summary,
        },
        result: {
          success: latest.resume?.action === "approve_offer",
          summary,
        },
        updated_at: new Date().toISOString(),
      });
      await runtime.transition(latest.id, "complete", latest.participants.writer);
    }, 500);
    return;
  }

  if (contract.status === "complete" && !connectorQueued) {
    connectorQueued = true;
    setTimeout(async () => {
      pendingConnectorCard = buildPendingConnectorCard();
      await requestConnection.execute("manual-real-connector", buildConnectorRequestParams());
    }, 1200);
  }
}

const progressTimer = setInterval(() => {
  void maybeAdvanceDemo();
}, 200);

const wsProxy = new WebSocketServer({ noServer: true });

wsProxy.on("connection", async (frontendSocket) => {
  const { replayConnector } = await ensureScenario();
  const upstream = new WebSocket(`ws://127.0.0.1:${wsPort}/aura/surface`);

  upstream.on("open", () => {
    if (replayConnector && pendingConnectorCard) {
      setTimeout(() => {
        wsService.pushConnectorRequest(pendingConnectorCard);
      }, 120);
    }
  });

  upstream.on("message", (data) => {
    if (frontendSocket.readyState === WebSocket.OPEN) {
      frontendSocket.send(data.toString());
    }
  });

  frontendSocket.on("message", (data) => {
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.send(data.toString());
    }
  });

  const closeBoth = () => {
    if (frontendSocket.readyState === WebSocket.OPEN) {
      frontendSocket.close();
    }
    if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) {
      upstream.close();
    }
  };

  frontendSocket.on("close", closeBoth);
  frontendSocket.on("error", closeBoth);
  upstream.on("close", closeBoth);
  upstream.on("error", closeBoth);
});

const server = http.createServer(async (req, res) => {
  if (req.url?.startsWith("/aura/history")) {
    const url = new URL(req.url, "http://127.0.0.1");
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? "50"), 1), 200);
    const offset = Math.max(Number(url.searchParams.get("offset") ?? "0"), 0);
    const type = url.searchParams.get("type") ?? undefined;

    const all = await storage.query({
      status: ["complete", "failed"],
      ...(type ? { type } : {}),
    });
    const page = all.slice(offset, offset + limit);
    const hasMore = offset + page.length < all.length;

    res.writeHead(200, {
      "content-type": "application/json",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    });
    res.end(JSON.stringify({ contracts: page, hasMore, total: all.length }));
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not_found" }));
});

server.on("upgrade", (req, socket, head) => {
  if (req.url !== "/aura/surface") {
    socket.destroy();
    return;
  }

  wsProxy.handleUpgrade(req, socket, head, (ws) => {
    wsProxy.emit("connection", ws, req);
  });
});

server.listen(httpPort, "127.0.0.1", () => {
  console.log(`Aura Pulse real-plugin demo listening on http://127.0.0.1:${httpPort}`);
  console.log(`Aura Pulse real-plugin websocket upstream on ws://127.0.0.1:${wsPort}`);
});

async function shutdown() {
  clearInterval(progressTimer);
  await new Promise((resolve) => server.close(() => resolve()));
  wsProxy.close();
  await wsService.stop().catch(() => {});
  await runtimeService.stop().catch(() => {});
  rmSync(auraRoot, { recursive: true, force: true });
}

process.on("SIGINT", async () => {
  await shutdown();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await shutdown();
  process.exit(0);
});