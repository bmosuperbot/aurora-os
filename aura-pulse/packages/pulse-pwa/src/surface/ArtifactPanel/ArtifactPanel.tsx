import { useEffect } from "react";
import { A2UIProvider, A2UIRenderer, useA2UI } from "@a2ui/react";
import type { A2UIMessage } from "../../ws/protocol.js";
import type { A2UIActionEvent, A2UIClientEventMessage } from "@a2ui/react";
import { auraTheme } from "../../a2ui/aura-theme.js";
import { subscribeArtifactDraft } from "../../a2ui/aura-catalog.js";

// Re-export the action event type for parent usage
export type { A2UIActionEvent };

interface ArtifactPanelProps {
  a2uiMessages: A2UIMessage[];
  contractId: string;
  surfaceId: string;
  onAction: (event: A2UIActionEvent) => void;
  /** Called whenever the artifact data model changes (field edits). */
  onDataChange: (data: Record<string, unknown>) => void;
}

/** Inner component: lives inside A2UIProvider, feeds WS messages into the store. */
function A2UIMessageProcessor({ messages }: { messages: A2UIMessage[] }) {
  const { processMessages } = useA2UI();
  useEffect(() => {
    if (messages.length > 0) {
      processMessages(messages as unknown as Parameters<typeof processMessages>[0]);
    }
  }, [messages, processMessages]);
  return null;
}

function ArtifactDraftObserver({
  surfaceId,
  onDataChange,
}: {
  surfaceId: string;
  onDataChange: (data: Record<string, unknown>) => void;
}) {
  useEffect(() => subscribeArtifactDraft(surfaceId, onDataChange), [surfaceId, onDataChange]);
  return null;
}

export function ArtifactPanel({
  a2uiMessages,
  contractId: _contractId,
  surfaceId,
  onAction,
  onDataChange,
}: ArtifactPanelProps) {
  const handleProviderAction = (msg: A2UIClientEventMessage) => {
    if (msg.userAction) {
      onAction({
        actionName: msg.userAction.name,
        sourceComponentId: msg.userAction.sourceComponentId,
        timestamp: msg.userAction.timestamp,
        context: msg.userAction.context ?? {},
      });
    }
  };

  return (
    <div className="a2ui-artifact-panel" data-surface-id={surfaceId}>
      <A2UIProvider onAction={handleProviderAction} theme={auraTheme}>
        <A2UIMessageProcessor messages={a2uiMessages} />
        <ArtifactDraftObserver surfaceId={surfaceId} onDataChange={onDataChange} />
        <A2UIRenderer surfaceId={surfaceId} className="a2ui-artifact-viewer" />
      </A2UIProvider>
    </div>
  );
}
