import { useEffect, useCallback, useRef, type ReactNode } from "react";
import { registerAuraCatalog } from "./a2ui/aura-catalog.js";
import { useSurfaceStore } from "./ws/surface-store.js";
import { pulseWSClient, type PulseWebSocketTransport } from "./ws/client.js";
import { voiceEngine } from "./voice/voice-engine.js";
import { SilentSurface } from "./surface/SilentSurface.js";
import { DecisionCard } from "./surface/DecisionCard/DecisionCard.js";
import { ConfirmingCard } from "./surface/ConfirmingCard.js";
import { CompletionCard } from "./surface/CompletionCard.js";
import { WorkspaceSurface } from "./surface/WorkspaceSurface.js";
import { CommandDock } from "./surface/CommandDock.js";
import { ConnectorCardOverlay } from "./surface/ConnectorCard/ConnectorCard.js";
import { OnboardingView } from "./surface/OnboardingView.js";
import { HistoryOverlay } from "./history/HistoryOverlay.js";
import { MorningBrief } from "./morning-brief/MorningBrief.js";
import { getPluginWsUrl } from "./api/plugin-config.js";
import type { RuntimeMessage } from "./ws/protocol.js";

registerAuraCatalog();

interface AppProps {
  wsClient?: PulseWebSocketTransport;
}

export function App({ wsClient = pulseWSClient }: AppProps) {
  const {
    mode,
    contract,
    a2uiMessages,
    completionSurface,
    kernelSurfaces,
    connectorCard,
    onboardingOpen,
    onboardingItems,
    historyOpen,
    handleMessage,
    setWsStatus,
    configureTransport,
    closeHistory,
    dismissCompletion,
    dismissOnboarding,
  } = useSurfaceStore();

  // Wire WebSocket client once on mount
  useEffect(() => {
    configureTransport((message) => {
      wsClient.send(message);
    });

    const offMessage = wsClient.onMessage((raw: RuntimeMessage) => {
      handleMessage(raw);
    });

    const offStatus = wsClient.onStatus((status) => {
      setWsStatus(status);
    });

    wsClient.connect(getPluginWsUrl());

    return () => {
      offMessage();
      offStatus();
      configureTransport((message) => {
        pulseWSClient.send(message);
      });
      wsClient.disconnect();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Speak voice lines on decision entry
  const latestKernelSurface = kernelSurfaces[kernelSurfaces.length - 1] ?? null;
  const prevModeRef = useRef(mode);
  useEffect(() => {
    if (
      mode === "decision" &&
      prevModeRef.current !== "decision" &&
      contract?.surface?.voice_line
    ) {
      voiceEngine.speak(contract.surface.voice_line, "high");
    }
    if (
      mode === "completion" &&
      prevModeRef.current !== "completion" &&
      completionSurface?.voice_line
    ) {
      voiceEngine.speak(completionSurface.voice_line, "high");
    }
    if (
      mode === "workspace" &&
      prevModeRef.current !== "workspace" &&
      latestKernelSurface?.voiceLine
    ) {
      voiceEngine.speak(latestKernelSurface.voiceLine, "high");
    }
    prevModeRef.current = mode;
  }, [mode, contract?.id, completionSurface?.summary, latestKernelSurface?.surfaceId, latestKernelSurface?.receivedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  // Route to the correct surface component
  const renderSurface = useCallback((): ReactNode => {
    if (mode === "completion") {
      return completionSurface ? (
        <CompletionCard surface={completionSurface} onDismiss={dismissCompletion} />
      ) : (
        <SilentSurface />
      );
    }

    if (mode === "workspace") {
      return kernelSurfaces.length > 0 ? <WorkspaceSurface surfaces={kernelSurfaces} /> : <SilentSurface />;
    }

    if (!contract) return <SilentSurface />;

    // Morning brief is a special contract type routed to its own surface
    if (
      (mode === "decision" ||
        mode === "resolver_active" ||
        mode === "clarifying") &&
      contract.type === "morning-brief"
    ) {
      return <MorningBrief contract={contract} />;
    }

    switch (mode) {
      case "silent":
        return <SilentSurface />;

      case "decision":
      case "resolver_active":
      case "clarifying":
      case "artifact_review":
        return (
          <DecisionCard
            contract={contract}
            a2uiMessages={a2uiMessages}
            mode={mode}
          />
        );

      case "confirming":
        return <ConfirmingCard />;
      default:
        return <SilentSurface />;
    }
  }, [mode, contract, a2uiMessages, completionSurface, dismissCompletion, kernelSurfaces]);

  return (
    <div className="app-root">
      {/* Primary surface */}
      {renderSurface()}

      {/* Persistent owner command channel */}
      <CommandDock wsClient={wsClient} />

      {/* Onboarding overlay — shown when registry is incomplete */}
      {onboardingOpen && <OnboardingView items={onboardingItems} onDismiss={dismissOnboarding} />}

      {/* Connector card — full-screen overlay, always on top */}
      {connectorCard && <ConnectorCardOverlay card={connectorCard} />}

      {/* History overlay */}
      {historyOpen && <HistoryOverlay onClose={closeHistory} />}
    </div>
  );
}
