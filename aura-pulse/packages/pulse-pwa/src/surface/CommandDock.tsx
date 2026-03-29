import { useEffect, useMemo, useState } from "react";
import { A2UIProvider, A2UIRenderer, useA2UI } from "@a2ui/react";
import type { A2UIClientEventMessage } from "@a2ui/react";

import { auraTheme } from "../a2ui/aura-theme.js";
import type { PulseWebSocketTransport } from "../ws/client.js";
import type { A2UIMessage, RuntimeMessage } from "../ws/protocol.js";
import { useSurfaceStore } from "../ws/surface-store.js";

interface CommandDockProps {
  wsClient: PulseWebSocketTransport;
}

interface CommandTimelineEntry {
  id: string;
  role: "user" | "system";
  text: string;
  status?: "pending" | "accepted" | "rejected";
  modality?: "text" | "voice";
  timestamp: string;
}

const SURFACE_ID = "aura-command-dock";
const MAX_TIMELINE_ENTRIES = 18;
const WORKSPACE_COMMAND_EVENT = "aura:queue-command";

function createCommandId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `cmd-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function trimEntries(entries: CommandTimelineEntry[]): CommandTimelineEntry[] {
  return entries.slice(-MAX_TIMELINE_ENTRIES);
}

function buildCommandDockMessages(entries: CommandTimelineEntry[]): A2UIMessage[] {
  return [
    {
      surfaceUpdate: {
        surfaceId: SURFACE_ID,
        components: [
          {
            id: "root",
            component: {
              Column: {
                children: { explicitList: ["timeline", "composer"] },
              },
            },
          },
          {
            id: "timeline",
            component: {
              CommandTimeline: {
                entries,
                emptyText: "Type or speak a command. Aura will queue it into the main agent session.",
              },
            },
          },
          {
            id: "composer",
            component: {
              CommandComposer: {
                placeholder: "Tell Aura what to do",
                submitLabel: "Send to Aura",
                voiceLabel: "Voice",
                voiceActiveLabel: "Listening…",
              },
            },
          },
        ],
      },
    },
    {
      dataModelUpdate: {
        surfaceId: SURFACE_ID,
        contents: [],
      },
    },
    {
      beginRendering: {
        surfaceId: SURFACE_ID,
        root: "root",
        catalogId: "https://aura-os.ai/a2ui/v1/aura-catalog.json",
      },
    },
  ];
}

function A2UIMessageProcessor({ messages }: { messages: A2UIMessage[] }) {
  const { processMessages } = useA2UI();

  useEffect(() => {
    processMessages(messages as unknown as Parameters<typeof processMessages>[0]);
  }, [messages, processMessages]);

  return null;
}

export function CommandDock({ wsClient }: CommandDockProps) {
  const wsStatus = useSurfaceStore((state) => state.wsStatus);
  const [entries, setEntries] = useState<CommandTimelineEntry[]>([]);

  const queueCommand = (text: string, modality: "text" | "voice" = "text") => {
    const commandText = text.trim();
    if (!commandText) return;

    const commandId = createCommandId();
    const timestamp = new Date().toISOString();

    if (wsStatus !== "connected") {
      setEntries((current) => trimEntries([
        ...current,
        { id: commandId, role: "user", text: commandText, modality, status: "rejected", timestamp },
        {
          id: `${commandId}:status`,
          role: "system",
          text: "Aura is offline. Reconnect the Pulse websocket before sending commands.",
          status: "rejected",
          timestamp,
        },
      ]));
      return;
    }

    setEntries((current) => trimEntries([
      ...current,
      { id: commandId, role: "user", text: commandText, modality, status: "pending", timestamp },
    ]));

    wsClient.send({
      type: "submit_command",
      commandId,
      text: commandText,
      modality,
    });
  };

  useEffect(() => wsClient.onMessage((message: RuntimeMessage) => {
    if (message.type !== "command_status") return;

    setEntries((current) => {
      const next = current.map((entry) => (
        entry.id === message.commandId && entry.role === "user"
          ? { ...entry, status: message.status }
          : entry
      ));
      const statusEntryId = `${message.commandId}:status`;
      const statusEntry: CommandTimelineEntry = {
        id: statusEntryId,
        role: "system",
        text: message.message,
        status: message.status,
        timestamp: new Date().toISOString(),
      };
      const existingIndex = next.findIndex((entry) => entry.id === statusEntryId);
      if (existingIndex === -1) {
        next.push(statusEntry);
      } else {
        next.splice(existingIndex, 1, statusEntry);
      }
      return trimEntries(next);
    });
  }), [wsClient]);

  useEffect(() => {
    const handleWorkspaceCommand = (event: Event) => {
      const detail = (event as CustomEvent<{ text?: string; modality?: "text" | "voice" }>).detail;
      if (!detail?.text) return;
      queueCommand(detail.text, detail.modality === "voice" ? "voice" : "text");
    };

    window.addEventListener(WORKSPACE_COMMAND_EVENT, handleWorkspaceCommand);
    return () => window.removeEventListener(WORKSPACE_COMMAND_EVENT, handleWorkspaceCommand);
  }, [wsStatus, wsClient]);

  const messages = useMemo(() => buildCommandDockMessages(entries), [entries]);

  const handleProviderAction = (message: A2UIClientEventMessage) => {
    const userAction = message.userAction;
    if (!userAction || userAction.name !== "submit_command") return;

    const text = typeof userAction.context?.text === "string"
      ? userAction.context.text.trim()
      : "";
    const modality = userAction.context?.modality === "voice" ? "voice" : "text";

    queueCommand(text, modality);
  };

  return (
    <div className="command-dock" aria-label="Aura command dock">
      <A2UIProvider onAction={handleProviderAction} theme={auraTheme}>
        <A2UIMessageProcessor messages={messages} />
        <A2UIRenderer surfaceId={SURFACE_ID} className="command-dock__renderer" />
      </A2UIProvider>
    </div>
  );
}
