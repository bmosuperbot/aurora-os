import { useEffect, useMemo, useRef, useState } from "react";
import { A2UIProvider, A2UIRenderer, useA2UI } from "@a2ui/react";
import type { A2UIClientEventMessage } from "@a2ui/react";

import { auraTheme } from "../a2ui/aura-theme.js";
import type { KernelSurface, A2UIMessage } from "../ws/protocol.js";
import { useSurfaceStore } from "../ws/surface-store.js";
import { WsBadge } from "./WsBadge.js";

interface WorkspaceSurfaceProps {
  surfaces: KernelSurface[];
}

interface WorkspaceBounds {
  width: number;
  height: number;
}

interface WorkspacePanelLayout {
  x: number;
  y: number;
  width: number;
  z: number;
  collapsed: boolean;
  dismissed: boolean;
  maximized: boolean;
  hiddenAt?: number;
  restoreRect?: {
    x: number;
    y: number;
    width: number;
  };
}

interface WorkspaceLayoutState {
  panels: Record<string, WorkspacePanelLayout>;
  nextZ: number;
}

interface DragState {
  surfaceId: string;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  width: number;
}

type FallbackSurfaceItem =
  | {
      kind: "text";
      id: string;
      value: string;
    }
  | {
      kind: "action";
      id: string;
      label: string;
      actionId: string;
      style: string;
    };

const STORAGE_KEY = "aura.workspace.layout.v1";
const WORKSPACE_COMMAND_EVENT = "aura:queue-command";
const DEFAULT_BOUNDS: WorkspaceBounds = { width: 1120, height: 720 };

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function readWorkspaceLayout(): WorkspaceLayoutState {
  if (typeof window === "undefined") {
    return { panels: {}, nextZ: 1 };
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { panels: {}, nextZ: 1 };
    }

    const parsed = JSON.parse(raw) as WorkspaceLayoutState;
    return {
      panels: parsed?.panels ?? {},
      nextZ: typeof parsed?.nextZ === "number" ? parsed.nextZ : 1,
    };
  } catch {
    return { panels: {}, nextZ: 1 };
  }
}

function getSurfaceIcon(surface: KernelSurface): string {
  if (surface.icon && surface.icon.trim().length > 0) {
    return surface.icon.trim().slice(0, 2).toUpperCase();
  }

  const source = surface.title?.trim() || surface.surfaceId;
  const words = source.split(/\s+/).filter(Boolean);
  if (words.length === 1) {
    return words[0]?.slice(0, 2).toUpperCase() ?? "A";
  }
  return words.slice(0, 2).map((word) => word[0]?.toUpperCase() ?? "").join("") || "A";
}

function getSurfaceTypeLabel(surface: KernelSurface): string {
  switch (surface.surfaceType) {
    case "plan":
      return "Planning";
    case "attention":
      return "Attention";
    case "monitor":
      return "Monitor";
    case "brief":
      return "Brief";
    default:
      return surface.collaborative ? "Workspace" : "Update";
  }
}

function getDefaultPanelWidth(surface: KernelSurface, bounds: WorkspaceBounds): number {
  const target = surface.surfaceType === "plan"
    ? 520
    : surface.surfaceType === "attention"
      ? 380
      : 440;
  return clamp(target, 320, Math.max(320, bounds.width - 40));
}

function createDefaultLayout(surface: KernelSurface, index: number, bounds: WorkspaceBounds, z: number): WorkspacePanelLayout {
  const width = getDefaultPanelWidth(surface, bounds);
  const x = clamp(20 + (index % 2) * 56, 12, Math.max(12, bounds.width - width - 12));
  const y = 24 + index * 56;

  return {
    x,
    y,
    width,
    z,
    collapsed: false,
    dismissed: false,
    maximized: false,
  };
}

function normalizeComponentCollection(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  return Object.entries(value as Record<string, unknown>).map(([id, entry]) => {
    if (entry && typeof entry === "object") {
      const record = entry as Record<string, unknown>;

      if ("component" in record) {
        return "id" in record ? record : { id, ...record };
      }

      return {
        id,
        component: record,
      };
    }
    return { id, value: entry };
  });
}

function normalizeA2UIMessage(message: A2UIMessage): A2UIMessage {
  const nextMessage = { ...message };

  if (message.surfaceUpdate && typeof message.surfaceUpdate === "object") {
    const surfaceUpdate = message.surfaceUpdate as Record<string, unknown>;
    nextMessage.surfaceUpdate = {
      ...surfaceUpdate,
      components: normalizeComponentCollection(surfaceUpdate.components),
    };
  }

  if (message.dataModelUpdate && typeof message.dataModelUpdate === "object") {
    const dataModelUpdate = message.dataModelUpdate as Record<string, unknown>;
    nextMessage.dataModelUpdate = {
      ...dataModelUpdate,
      contents: normalizeComponentCollection(dataModelUpdate.contents),
    };
  }

  return nextMessage;
}

function deriveFallbackActionId(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "surface_action";
}

function resolveFallbackTextValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.literalString === "string" && record.literalString.trim().length > 0) {
    return record.literalString;
  }

  if (typeof record.literal === "string" && record.literal.trim().length > 0) {
    return record.literal;
  }

  return null;
}

function extractFallbackSurfaceItems(messages: A2UIMessage[]): FallbackSurfaceItem[] {
  const items: FallbackSurfaceItem[] = [];

  for (const rawMessage of messages) {
    if (
      rawMessage
      && typeof rawMessage === "object"
      && !("surfaceUpdate" in rawMessage)
      && !("dataModelUpdate" in rawMessage)
      && !("beginRendering" in rawMessage)
    ) {
      const record = rawMessage as Record<string, unknown>;

      if (record.type === "message" && typeof record.value === "string" && record.value.trim().length > 0) {
        items.push({
          kind: "text",
          id: `message-${items.length}`,
          value: record.value,
        });
      }

      if (typeof record.actionLabel === "string" && record.actionLabel.trim().length > 0) {
        items.push({
          kind: "action",
          id: `action-${items.length}`,
          label: record.actionLabel,
          actionId: typeof record.actionId === "string" && record.actionId.trim().length > 0
            ? record.actionId
            : deriveFallbackActionId(record.actionLabel),
          style: typeof record.style === "string" ? record.style : "primary",
        });
      }

      continue;
    }

    const message = normalizeA2UIMessage(rawMessage);
    if (!message.surfaceUpdate || typeof message.surfaceUpdate !== "object") {
      continue;
    }

    const surfaceUpdate = message.surfaceUpdate as Record<string, unknown>;
    const components = normalizeComponentCollection(surfaceUpdate.components);

    for (const entry of components) {
      if (!entry || typeof entry !== "object") {
        continue;
      }

      const componentEntry = entry as Record<string, unknown>;
      const component = componentEntry.component;
      const id = typeof componentEntry.id === "string" ? componentEntry.id : `component-${items.length}`;
      if (!component || typeof component !== "object") {
        continue;
      }

      const [componentType, payload] = Object.entries(component as Record<string, unknown>)[0] ?? [];
      if (!componentType || !payload || typeof payload !== "object") {
        continue;
      }

      const props = payload as Record<string, unknown>;

      const textValue = componentType === "Text"
        ? resolveFallbackTextValue(props.text ?? props.value)
        : null;

      if (textValue) {
        items.push({
          kind: "text",
          id,
          value: textValue,
        });
        continue;
      }

      if (
        componentType === "ActionButton"
        && typeof props.label === "string"
        && typeof props.actionId === "string"
      ) {
        items.push({
          kind: "action",
          id,
          label: props.label,
          actionId: props.actionId,
          style: typeof props.style === "string" ? props.style : "primary",
        });
      }
    }
  }

  return items;
}

function A2UIMessageProcessor({ messages }: { messages: A2UIMessage[] }) {
  const { processMessages } = useA2UI();

  useEffect(() => {
    if (messages.length > 0) {
      for (const message of messages.map(normalizeA2UIMessage)) {
        try {
          processMessages([message] as unknown as Parameters<typeof processMessages>[0]);
        } catch (error) {
          console.warn("[AuraPulse] Skipping malformed workspace A2UI message.", error, message);
        }
      }
    }
  }, [messages, processMessages]);

  return null;
}

function WorkspacePanelRenderer({
  surface,
  onAction,
  onFallbackAction,
}: {
  surface: KernelSurface;
  onAction: (message: A2UIClientEventMessage) => void;
  onFallbackAction: (actionName: string, sourceComponentId?: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const fallbackItems = useMemo(() => extractFallbackSurfaceItems(surface.a2uiMessages), [surface.a2uiMessages]);
  const [showFallback, setShowFallback] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || fallbackItems.length === 0) {
      setShowFallback(false);
      return undefined;
    }

    let frameA = 0;
    let frameB = 0;

    const updateFallbackVisibility = () => {
      const hasRenderedContent = host.querySelector("*") !== null && (host.textContent?.trim().length ?? 0) > 0;
      setShowFallback(!hasRenderedContent);
    };

    const observer = new MutationObserver(updateFallbackVisibility);
    observer.observe(host, {
      subtree: true,
      childList: true,
      characterData: true,
    });

    frameA = window.requestAnimationFrame(() => {
      frameB = window.requestAnimationFrame(updateFallbackVisibility);
    });

    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frameA);
      window.cancelAnimationFrame(frameB);
    };
  }, [fallbackItems, surface.surfaceId]);

  return (
    <A2UIProvider onAction={onAction} theme={auraTheme}>
      <A2UIMessageProcessor messages={surface.a2uiMessages} />
      <div ref={hostRef} className="workspace-panel__renderer-host">
        <A2UIRenderer surfaceId={surface.surfaceId} className="workspace-panel__renderer" />
      </div>
      {showFallback ? (
        <div className="workspace-panel__fallback" aria-label={`${surface.title ?? surface.surfaceId} fallback surface`}>
          {fallbackItems.map((item) => (
            item.kind === "text" ? (
              <p key={item.id} className="workspace-panel__fallback-text">{item.value}</p>
            ) : (
              <button
                key={item.id}
                type="button"
                className={`aura-btn aura-btn--${item.style}`}
                onClick={() => onFallbackAction(item.actionId, item.id)}
              >
                {item.label}
              </button>
            )
          ))}
        </div>
      ) : null}
    </A2UIProvider>
  );
}

export function WorkspaceSurface({ surfaces }: WorkspaceSurfaceProps) {
  const sendMessage = useSurfaceStore((state) => state.sendMessage);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [bounds, setBounds] = useState<WorkspaceBounds>(DEFAULT_BOUNDS);
  const [layout, setLayout] = useState<WorkspaceLayoutState>(() => readWorkspaceLayout());

  const compactMode = bounds.width < 760;

  useEffect(() => {
    const measure = () => {
      const rect = boardRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) {
        setBounds(DEFAULT_BOUNDS);
        return;
      }
      setBounds({ width: rect.width, height: Math.max(rect.height, 520) });
    };

    measure();

    if (typeof ResizeObserver !== "undefined" && boardRef.current) {
      const observer = new ResizeObserver(() => measure());
      observer.observe(boardRef.current);
      return () => observer.disconnect();
    }

    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  }, [layout]);

  useEffect(() => {
    setLayout((current) => {
      let changed = false;
      let nextZ = current.nextZ;
      const nextPanels = { ...current.panels };
      const liveSurfaceIds = new Set(surfaces.map((surface) => surface.surfaceId));

      surfaces.forEach((surface, index) => {
        const existing = nextPanels[surface.surfaceId];
        if (!existing) {
          nextPanels[surface.surfaceId] = createDefaultLayout(surface, index, bounds, nextZ);
          nextZ += 1;
          changed = true;
          return;
        }

        if (
          existing.dismissed
          && surface.receivedAt
          && surface.receivedAt > (existing.hiddenAt ?? 0)
        ) {
          nextPanels[surface.surfaceId] = {
            ...existing,
            dismissed: false,
            collapsed: false,
            hiddenAt: undefined,
          };
          changed = true;
        }
      });

      Object.keys(nextPanels).forEach((surfaceId) => {
        if (!liveSurfaceIds.has(surfaceId)) {
          delete nextPanels[surfaceId];
          changed = true;
        }
      });

      if (!changed) {
        return current;
      }

      return {
        panels: nextPanels,
        nextZ,
      };
    });
  }, [bounds, surfaces]);

  useEffect(() => {
    if (compactMode) {
      dragRef.current = null;
      return undefined;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;

      setLayout((current) => {
        const panel = current.panels[drag.surfaceId];
        if (!panel || panel.maximized || panel.collapsed || panel.dismissed) {
          return current;
        }

        const nextX = clamp(
          drag.originX + event.clientX - drag.startX,
          12,
          Math.max(12, bounds.width - drag.width - 12),
        );
        const nextY = clamp(
          drag.originY + event.clientY - drag.startY,
          12,
          Math.max(12, bounds.height - 160),
        );

        if (nextX === panel.x && nextY === panel.y) {
          return current;
        }

        return {
          ...current,
          panels: {
            ...current.panels,
            [drag.surfaceId]: {
              ...panel,
              x: nextX,
              y: nextY,
            },
          },
        };
      });
    };

    const handlePointerUp = () => {
      dragRef.current = null;
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [bounds.height, bounds.width, compactMode]);

  const beginDrag = (surfaceId: string, event: React.PointerEvent<HTMLElement>) => {
    if (compactMode) return;

    const target = event.target;
    if (target instanceof HTMLElement && target.closest("button")) {
      return;
    }

    const panel = layout.panels[surfaceId];
    if (!panel || panel.maximized || panel.collapsed || panel.dismissed) {
      return;
    }

    dragRef.current = {
      surfaceId,
      startX: event.clientX,
      startY: event.clientY,
      originX: panel.x,
      originY: panel.y,
      width: panel.width,
    };

    setLayout((current) => ({
      panels: {
        ...current.panels,
        [surfaceId]: {
          ...panel,
          z: current.nextZ,
        },
      },
      nextZ: current.nextZ + 1,
    }));
  };

  const handleProviderAction = (surface: KernelSurface, message: A2UIClientEventMessage) => {
    if (!message.userAction) return;

    sendMessage({
      type: "surface_action",
      surfaceId: surface.surfaceId,
      actionName: message.userAction.name,
      sourceComponentId: message.userAction.sourceComponentId,
      context: message.userAction.context ?? {},
    });
  };

  const handleFallbackAction = (surface: KernelSurface, actionName: string, sourceComponentId?: string) => {
    sendMessage({
      type: "surface_action",
      surfaceId: surface.surfaceId,
      actionName,
      sourceComponentId,
      context: {},
    });
  };

  const updatePanel = (surfaceId: string, updater: (panel: WorkspacePanelLayout) => WorkspacePanelLayout) => {
    setLayout((current) => {
      const panel = current.panels[surfaceId];
      if (!panel) return current;
      return {
        ...current,
        panels: {
          ...current.panels,
          [surfaceId]: updater(panel),
        },
      };
    });
  };

  const toggleCollapse = (surfaceId: string) => {
    setLayout((current) => {
      const panel = current.panels[surfaceId];
      if (!panel) return current;
      const collapsed = !panel.collapsed;
      return {
        panels: {
          ...current.panels,
          [surfaceId]: {
            ...panel,
            collapsed,
            dismissed: false,
            maximized: collapsed ? false : panel.maximized,
          },
        },
        nextZ: collapsed ? current.nextZ : current.nextZ + 1,
      };
    });
  };

  const toggleMaximize = (surfaceId: string) => {
    setLayout((current) => {
      const panel = current.panels[surfaceId];
      if (!panel) return current;

      if (panel.maximized && panel.restoreRect) {
        return {
          ...current,
          panels: {
            ...current.panels,
            [surfaceId]: {
              ...panel,
              ...panel.restoreRect,
              maximized: false,
              restoreRect: undefined,
            },
          },
        };
      }

      return {
        panels: {
          ...current.panels,
          [surfaceId]: {
            ...panel,
            x: 8,
            y: 8,
            width: Math.max(320, bounds.width - 16),
            z: current.nextZ,
            maximized: true,
            restoreRect: {
              x: panel.x,
              y: panel.y,
              width: panel.width,
            },
          },
        },
        nextZ: current.nextZ + 1,
      };
    });
  };

  const dismissPanel = (surfaceId: string) => {
    updatePanel(surfaceId, (panel) => ({
      ...panel,
      collapsed: false,
      dismissed: true,
      maximized: false,
      hiddenAt: Date.now(),
    }));
  };

  const restorePanel = (surfaceId: string) => {
    setLayout((current) => {
      const panel = current.panels[surfaceId];
      if (!panel) return current;
      return {
        panels: {
          ...current.panels,
          [surfaceId]: {
            ...panel,
            collapsed: false,
            dismissed: false,
            hiddenAt: undefined,
            z: current.nextZ,
          },
        },
        nextZ: current.nextZ + 1,
      };
    });
  };

  const clearWorkspace = () => {
    setLayout((current) => {
      const nextPanels = { ...current.panels };
      const hiddenAt = Date.now();
      for (const surface of surfaces) {
        const panel = nextPanels[surface.surfaceId];
        if (!panel) continue;
        nextPanels[surface.surfaceId] = {
          ...panel,
          collapsed: false,
          dismissed: true,
          maximized: false,
          hiddenAt,
        };
      }
      return {
        ...current,
        panels: nextPanels,
      };
    });
  };

  const restoreAllPanels = () => {
    setLayout((current) => {
      const nextPanels = { ...current.panels };
      for (const [surfaceId, panel] of Object.entries(nextPanels)) {
        nextPanels[surfaceId] = {
          ...panel,
          collapsed: false,
          dismissed: false,
          hiddenAt: undefined,
        };
      }
      return {
        ...current,
        panels: nextPanels,
      };
    });
  };

  const queuePrompt = (text: string) => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent(WORKSPACE_COMMAND_EVENT, {
      detail: {
        text,
        modality: "text",
      },
    }));
  };

  const visibleSurfaces = useMemo(() => (
    surfaces
      .filter((surface) => {
        const panel = layout.panels[surface.surfaceId];
        return panel && !panel.dismissed && !panel.collapsed;
      })
      .sort((left, right) => {
        const leftPanel = layout.panels[left.surfaceId];
        const rightPanel = layout.panels[right.surfaceId];
        return (leftPanel?.z ?? 0) - (rightPanel?.z ?? 0);
      })
  ), [layout.panels, surfaces]);

  const collapsedSurfaces = useMemo(() => (
    surfaces.filter((surface) => {
      const panel = layout.panels[surface.surfaceId];
      return Boolean(panel?.collapsed && !panel.dismissed);
    })
  ), [layout.panels, surfaces]);

  const dismissedCount = useMemo(() => (
    surfaces.filter((surface) => layout.panels[surface.surfaceId]?.dismissed).length
  ), [layout.panels, surfaces]);

  return (
    <div className="workspace-surface">
      <div className="workspace-surface__shell aura-card">
        <header className="workspace-surface__topbar">
          <div className="workspace-surface__intro">
            <p className="workspace-surface__eyebrow">Aura Workspace</p>
            <h1 className="workspace-surface__heading">Move things around. Let Aura add to the board.</h1>
            <p className="workspace-surface__summary">
              Keep planning surfaces open, collapse brief updates to the tray, or clear the board when you want the interface to disappear.
            </p>
          </div>
          <div className="workspace-surface__toolbar">
            {(collapsedSurfaces.length > 0 || dismissedCount > 0) ? (
              <button type="button" className="aura-btn aura-btn--ghost" onClick={restoreAllPanels}>
                Restore workspace
              </button>
            ) : null}
            <button type="button" className="aura-btn aura-btn--ghost" onClick={clearWorkspace} disabled={surfaces.length === 0}>
              Clear workspace
            </button>
            <WsBadge />
          </div>
        </header>

        <div ref={boardRef} className={`workspace-board${compactMode ? " workspace-board--compact" : ""}`}>
          {visibleSurfaces.length === 0 ? (
            <section className="workspace-empty-state aura-card">
              <p className="workspace-empty-state__eyebrow">Quiet Mode</p>
              <h2 className="workspace-empty-state__title">The board is clear.</h2>
              <p className="workspace-empty-state__body">
                Use the command dock to direct Aura, or tap a prompt to kick off focused work without rebuilding the whole workspace yourself.
              </p>
              <div className="workspace-empty-state__prompts">
                <button type="button" className="workspace-empty-state__prompt" onClick={() => queuePrompt("Find grant opportunities every night at 11pm.")}>
                  Find grant opportunities every night at 11pm
                </button>
                <button type="button" className="workspace-empty-state__prompt" onClick={() => queuePrompt("What is my inventory looking like today?")}>
                  What is my inventory looking like today?
                </button>
                <button type="button" className="workspace-empty-state__prompt" onClick={() => queuePrompt("Summarize the new email decisions waiting on me.")}>
                  Summarize the new email decisions waiting on me
                </button>
              </div>
            </section>
          ) : null}

          {visibleSurfaces.map((surface) => {
            const panel = layout.panels[surface.surfaceId];
            if (!panel) return null;

            const panelStyle = compactMode
              ? undefined
              : {
                  left: `${panel.maximized ? 8 : panel.x}px`,
                  top: `${panel.maximized ? 8 : panel.y}px`,
                  width: `${panel.maximized ? Math.max(320, bounds.width - 16) : panel.width}px`,
                  zIndex: panel.z,
                };

            return (
              <section
                key={surface.surfaceId}
                className={`workspace-panel aura-card${panel.maximized ? " workspace-panel--maximized" : ""}`}
                style={panelStyle}
                data-surface-panel={surface.surfaceId}
              >
                <header
                  className="workspace-panel__header"
                  onPointerDown={(event) => beginDrag(surface.surfaceId, event)}
                >
                  <div className="workspace-panel__identity">
                    <div className="workspace-panel__icon" aria-hidden="true">{getSurfaceIcon(surface)}</div>
                    <div className="workspace-panel__copy">
                      <div className="workspace-panel__meta">
                        <span className="workspace-panel__type">{getSurfaceTypeLabel(surface)}</span>
                        {surface.collaborative ? <span className="workspace-panel__badge">Collaborative</span> : null}
                        {surface.priority === "high" ? <span className="workspace-panel__badge workspace-panel__badge--priority">Priority</span> : null}
                      </div>
                      <h2 className="workspace-panel__title">{surface.title ?? surface.surfaceId}</h2>
                      {surface.summary ? <p className="workspace-panel__summary">{surface.summary}</p> : null}
                    </div>
                  </div>

                  <div className="workspace-panel__controls">
                    <button type="button" className="workspace-panel__control" onClick={() => toggleCollapse(surface.surfaceId)} aria-label={`Collapse ${surface.title ?? surface.surfaceId}`}>
                      Min
                    </button>
                    <button type="button" className="workspace-panel__control" onClick={() => toggleMaximize(surface.surfaceId)} aria-label={`${panel.maximized ? "Restore" : "Expand"} ${surface.title ?? surface.surfaceId}`}>
                      {panel.maximized ? "Fit" : "Max"}
                    </button>
                    <button type="button" className="workspace-panel__control workspace-panel__control--danger" onClick={() => dismissPanel(surface.surfaceId)} aria-label={`Dismiss ${surface.title ?? surface.surfaceId}`}>
                      Hide
                    </button>
                  </div>
                </header>

                <div className="workspace-panel__body">
                  {surface.voiceLine ? <p className="workspace-panel__voice">{surface.voiceLine}</p> : null}
                  <WorkspacePanelRenderer
                    surface={surface}
                    onAction={(message) => handleProviderAction(surface, message)}
                    onFallbackAction={(actionName, sourceComponentId) => handleFallbackAction(surface, actionName, sourceComponentId)}
                  />
                </div>
              </section>
            );
          })}
        </div>

        {(collapsedSurfaces.length > 0 || dismissedCount > 0) ? (
          <footer className="workspace-tray">
            <div className="workspace-tray__group">
              {collapsedSurfaces.map((surface) => (
                <button
                  key={surface.surfaceId}
                  type="button"
                  className="workspace-tray__item"
                  onClick={() => restorePanel(surface.surfaceId)}
                  aria-label={`Restore ${surface.title ?? surface.surfaceId}`}
                  data-collapsed-surface={surface.surfaceId}
                >
                  <span className="workspace-tray__icon" aria-hidden="true">{getSurfaceIcon(surface)}</span>
                  <span className="workspace-tray__label">{surface.title ?? surface.surfaceId}</span>
                </button>
              ))}
            </div>
            {dismissedCount > 0 ? (
              <p className="workspace-tray__note">{dismissedCount} hidden panel{dismissedCount === 1 ? "" : "s"} parked off the board.</p>
            ) : null}
          </footer>
        ) : null}
      </div>
    </div>
  );
}
