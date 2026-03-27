import http from "node:http";
import { WebSocketServer } from "ws";

const port = Number(process.env.AURA_DEMO_PORT ?? 8711);

const now = () => new Date().toISOString();

function makeMorningBriefContract() {
  const timestamp = now();
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
              timestamp,
              agent_id: "sheryl",
              package: "aura-pulse",
              action: "message_sent",
              summary: "Followed up with two leads",
              connector_used: "none",
            },
          ],
          patterns_observed: ["Warm leads reply faster before 10am."],
        },
      },
      actions: [{ id: "dismiss", label: "Got it", action: "dismiss", style: "primary" }],
    },
    created_at: timestamp,
    updated_at: timestamp,
  };
}

function makeDecisionContract(clarifications = []) {
  const timestamp = now();
  return {
    id: "offer-1",
    type: "offer-received",
    status: clarifications.length > 0 ? "resolver_active" : "waiting_approval",
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
        { id: "review_draft", label: "Review email draft", action: "review_draft", style: "secondary", opens_artifact: "draft" },
        { id: "ask_question", label: "Ask a question", action: "ask", style: "secondary", opens_clarification: true },
        { id: "decline_offer", label: "Decline", action: "decline_offer", style: "secondary" },
      ],
    },
    ...(clarifications.length > 0 ? { clarifications } : {}),
    created_at: timestamp,
    updated_at: timestamp,
  };
}

/**
 * Build the A2UI messages for the "email draft" artifact surface.
 * surfaceId must match `artifact-${contractId}-${openArtifactId}` = artifact-offer-1-draft.
 * Custom Aura catalog components read properties directly (no BoundValue wrapping).
 */
function makeArtifactA2UIMessages(contractId) {
  const surfaceId = `artifact-${contractId}-draft`;
  return [
    {
      surfaceUpdate: {
        surfaceId,
        components: [
          {
            id: "root",
            component: {
              Column: {
                children: { explicitList: ["subject_field", "body_field"] },
              },
            },
          },
          {
            id: "subject_field",
            component: {
              ArtifactTextField: {
                fieldId: "email_subject",
                label: "Email subject",
                defaultValue: "Kickoff confirmed — Design project",
                multiline: false,
              },
            },
          },
          {
            id: "body_field",
            component: {
              ArtifactTextField: {
                fieldId: "email_body",
                label: "Email draft",
                defaultValue:
                  "Hi,\n\nConfirming the kickoff for Monday at 9am for $1,200. Looking forward to working together.\n\nBest,\nSheryl (on behalf of Aura)",
                multiline: true,
              },
            },
          },
        ],
      },
    },
    {
      dataModelUpdate: {
        surfaceId,
        contents: [],
      },
    },
    {
      beginRendering: {
        surfaceId,
        root: "root",
        catalogId: "https://aura-os.ai/a2ui/v1/aura-catalog.json",
      },
    },
  ];
}

function makeConnectorCard() {
  return {
    id: "gmail",
    connector_id: "gmail",
    connector_name: "Gmail",
    offer_text: "Connect Gmail so Aura can send the kickoff and follow-up email for you.",
    source: "aura-connector",
    status: "pending",
    capability_without: "Aura will stop after approval and leave the email draft for later.",
    capability_with: "Aura can send the kickoff email and log the thread automatically.",
    flow_type: "secure_input",
    input_label: "Gmail API key",
  };
}

function sendOfferCompletion(send) {
  send({ type: "clear", payload: { contractId: "offer-1", reason: "resolved" } });
  setTimeout(() => {
    send({
      type: "completion",
      payload: {
        contractId: "offer-1",
        surface: {
          voice_line: "Offer approved.",
          summary: "Kickoff confirmed, Gmail connected, and the first outreach draft is queued.",
        },
      },
    });
  }, 150);
}

const historyPayload = {
  contracts: [
    {
      id: "history-1",
      type: "offer-received",
      status: "complete",
      intent: { goal: "Approve last week's supplier offer" },
      clarifications: [
        {
          id: "hist-clar-1",
          role: "answer",
          content: "Supplier can deliver by Wednesday.",
          timestamp: now(),
        },
      ],
      resume: {
        action: "approve_offer",
        resolver_id: "owner",
        timestamp: now(),
      },
      completion_surface: {
        voice_line: "Supplier approved.",
        summary: "Delivery window confirmed and order queued.",
      },
      created_at: now(),
      updated_at: now(),
    },
  ],
  hasMore: false,
  total: 1,
};

const server = http.createServer((req, res) => {
  if (req.url?.startsWith("/aura/history")) {
    res.writeHead(200, {
      "content-type": "application/json",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    });
    res.end(JSON.stringify(historyPayload));
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not_found" }));
});

const wss = new WebSocketServer({ noServer: true });

wss.on("connection", (ws) => {
  const send = (message) => ws.send(JSON.stringify(message));

  // Replay protection: track whether offer-1 has already been resolved this session.
  let offer1Resolved = false;
  // Accumulated clarification entries for the current offer session.
  const clarificationEntries = [];

  send({
    type: "decision",
    payload: { contract: makeMorningBriefContract(), resumeToken: "brief-token" },
  });

  ws.on("message", (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }

    const payload = message?.payload ?? {};

    if (message?.type === "resolve" && payload.contractId === "brief-1") {
      send({ type: "clear", payload: { contractId: "brief-1", reason: "resolved" } });
      offer1Resolved = false;
      clarificationEntries.length = 0;
      setTimeout(() => {
        send({
          type: "decision",
          payload: {
            contract: makeDecisionContract(),
            resumeToken: "offer-token",
            a2uiMessages: makeArtifactA2UIMessages("offer-1"),
          },
        });
      }, 150);
      return;
    }

    if (message?.type === "engage" && payload.contractId === "offer-1") {
      return;
    }

    // ── Clarification round-trip (Test #3) ──────────────────────────────────
    if (message?.type === "ask_clarification" && payload.contractId === "offer-1") {
      const questionEntry = {
        id: `clar-q-${Date.now()}`,
        role: "question",
        text: String(payload.question ?? ""),
        timestamp: now(),
      };
      clarificationEntries.push(questionEntry);

      // Echo the question back so the thread shows it immediately.
      send({
        type: "clarification_answer",
        payload: {
          contractId: "offer-1",
          entry: questionEntry,
          contract: makeDecisionContract([...clarificationEntries]),
        },
      });

      // After 1.5s, agent answers and the contract returns to resolver_active.
      setTimeout(() => {
        const answerEntry = {
          id: `clar-a-${Date.now()}`,
          role: "answer",
          text: "The designer confirmed Monday at 9am. Rate is fixed at $1,200 with 50% upfront.",
          attributed_to: "Sheryl",
          timestamp: now(),
        };
        clarificationEntries.push(answerEntry);
        send({
          type: "clarification_answer",
          payload: {
            contractId: "offer-1",
            entry: answerEntry,
            contract: makeDecisionContract([...clarificationEntries]),
          },
        });
      }, 1500);
      return;
    }

    if (message?.type === "resolve" && payload.contractId === "offer-1") {
      // ── Replay protection (Test #4) ────────────────────────────────────────
      if (offer1Resolved) {
        console.log("[demo] Replay attempt detected for offer-1 — ignored (token already consumed).");
        return;
      }
      offer1Resolved = true;
      setTimeout(() => {
        send({
          type: "connector_request",
          payload: makeConnectorCard(),
        });
      }, 150);
      return;
    }

    if (message?.type === "complete_connector" && payload.connectorId === "gmail") {
      send({ type: "connector_complete", payload: { connectorId: "gmail", status: "active" } });
      setTimeout(() => {
        sendOfferCompletion(send);
      }, 150);
      return;
    }

    if (message?.type === "decline_connector" && payload.connectorId === "gmail") {
      send({ type: "connector_complete", payload: { connectorId: "gmail", status: "declined" } });
      setTimeout(() => {
        send({ type: "clear", payload: { contractId: "offer-1", reason: "resolved" } });
        setTimeout(() => {
          send({
            type: "completion",
            payload: {
              contractId: "offer-1",
              surface: {
                voice_line: "Offer approved.",
                summary: "Kickoff confirmed. Gmail stayed disconnected, so the outreach draft is waiting for review.",
              },
            },
          });
        }, 150);
      }, 150);
    }
  });
});

server.on("upgrade", (req, socket, head) => {
  if (req.url !== "/aura/surface") {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Aura Pulse browser demo backend listening on http://127.0.0.1:${port}`);
});