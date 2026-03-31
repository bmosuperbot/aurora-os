import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { A2UIProvider, A2UIRenderer, useA2UI } from "@a2ui/react";
import type { A2UIClientEventMessage } from "@a2ui/react";

import { auraTheme } from "../a2ui/aura-theme.js";
import type { KernelSurface, A2UIMessage } from "../ws/protocol.js";
import { useSurfaceStore } from "../ws/surface-store.js";
import { WsBadge } from "./WsBadge.js";
import { Toast } from "./Toast.js";
import { AuroraBarsListen, AuroraBarsLoading } from "../assets/aurora-bars.js";

/* ═══════════════════════════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════════════════════════ */

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
  restoreRect?: { x: number; y: number; width: number };
}

interface SingleWorkspace {
  panels: Record<string, WorkspacePanelLayout>;
  nextZ: number;
}

interface WorkspaceLayoutState {
  activeWorkspaceId: string;
  workspaces: Record<string, SingleWorkspace>;
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
  | { kind: "text"; id: string; value: string }
  | { kind: "action"; id: string; label: string; actionId: string; style: string };

/* ═══════════════════════════════════════════════════════════════════════════
   Constants
   ═══════════════════════════════════════════════════════════════════════════ */

const STORAGE_KEY = "aura.workspace.layout.v2";
const DEFAULT_BOUNDS: WorkspaceBounds = { width: 1120, height: 720 };
const DEFAULT_WORKSPACE_ID = "default";
const PANEL_WIDTH = 380;
const PANEL_GAP = 12;
const BOARD_PAD = 12;
const ROW_HEIGHT_ESTIMATE = 320;

/* ═══════════════════════════════════════════════════════════════════════════
   Layout helpers
   ═══════════════════════════════════════════════════════════════════════════ */

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function getColumns(boardWidth: number): number {
  return Math.max(1, Math.floor((boardWidth - BOARD_PAD) / (PANEL_WIDTH + PANEL_GAP)));
}

function getMaxVisible(boardWidth: number): number {
  return getColumns(boardWidth) * 3;
}

function getPanelWidth(boardWidth: number): number {
  const cols = getColumns(boardWidth);
  return Math.min(PANEL_WIDTH, Math.floor((boardWidth - BOARD_PAD * 2 - PANEL_GAP * (cols - 1)) / cols));
}

function findOpenSlot(
  occupiedPanels: WorkspacePanelLayout[],
  boardWidth: number,
): { x: number; y: number } {
  const cols = getColumns(boardWidth);
  const pw = getPanelWidth(boardWidth);

  for (let row = 0; row < 20; row++) {
    for (let col = 0; col < cols; col++) {
      const x = BOARD_PAD + col * (pw + PANEL_GAP);
      const y = BOARD_PAD + row * (ROW_HEIGHT_ESTIMATE + PANEL_GAP);
      const overlaps = occupiedPanels.some(
        (p) =>
          !p.dismissed &&
          !p.collapsed &&
          Math.abs(p.x - x) < pw * 0.7 &&
          Math.abs(p.y - y) < ROW_HEIGHT_ESTIMATE * 0.6,
      );
      if (!overlaps) return { x, y };
    }
  }

  const lowestY = occupiedPanels.reduce(
    (max, p) => (!p.dismissed && !p.collapsed ? Math.max(max, p.y) : max),
    0,
  );
  return { x: BOARD_PAD, y: lowestY + ROW_HEIGHT_ESTIMATE + PANEL_GAP };
}

function arrangePanels(
  surfaces: KernelSurface[],
  panels: Record<string, WorkspacePanelLayout>,
  boardWidth: number,
): Record<string, WorkspacePanelLayout> {
  const cols = getColumns(boardWidth);
  const pw = getPanelWidth(boardWidth);
  const visible = surfaces.filter((s) => {
    const p = panels[s.surfaceId];
    return p && !p.dismissed && !p.collapsed;
  });

  const next = { ...panels };
  visible.forEach((surface, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const p = next[surface.surfaceId];
    if (!p) return;
    next[surface.surfaceId] = {
      ...p,
      x: BOARD_PAD + col * (pw + PANEL_GAP),
      y: BOARD_PAD + row * (ROW_HEIGHT_ESTIMATE + PANEL_GAP),
      width: pw,
    };
  });
  return next;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Persistence
   ═══════════════════════════════════════════════════════════════════════════ */

function emptyWorkspace(): SingleWorkspace {
  return { panels: {}, nextZ: 1 };
}

function readWorkspaceLayout(): WorkspaceLayoutState {
  if (typeof window === "undefined") {
    return { activeWorkspaceId: DEFAULT_WORKSPACE_ID, workspaces: { [DEFAULT_WORKSPACE_ID]: emptyWorkspace() } };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { activeWorkspaceId: DEFAULT_WORKSPACE_ID, workspaces: { [DEFAULT_WORKSPACE_ID]: emptyWorkspace() } };
    const parsed = JSON.parse(raw) as WorkspaceLayoutState;
    if (!parsed?.workspaces?.[parsed.activeWorkspaceId]) {
      return { activeWorkspaceId: DEFAULT_WORKSPACE_ID, workspaces: { [DEFAULT_WORKSPACE_ID]: emptyWorkspace() } };
    }
    return parsed;
  } catch {
    return { activeWorkspaceId: DEFAULT_WORKSPACE_ID, workspaces: { [DEFAULT_WORKSPACE_ID]: emptyWorkspace() } };
  }
}

function getActiveWs(state: WorkspaceLayoutState): SingleWorkspace {
  return state.workspaces[state.activeWorkspaceId] ?? emptyWorkspace();
}

function setActiveWs(state: WorkspaceLayoutState, ws: SingleWorkspace): WorkspaceLayoutState {
  return { ...state, workspaces: { ...state.workspaces, [state.activeWorkspaceId]: ws } };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Surface helpers
   ═══════════════════════════════════════════════════════════════════════════ */

function getSurfaceIcon(surface: KernelSurface): string {
  if (surface.icon?.trim()) return surface.icon.trim().slice(0, 2).toUpperCase();
  const source = surface.title?.trim() || surface.surfaceId;
  const words = source.split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0]?.slice(0, 2).toUpperCase() ?? "A";
  return words.slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "A";
}

function getSurfaceTypeLabel(surface: KernelSurface): string {
  switch (surface.surfaceType) {
    case "plan": return "Plan";
    case "attention": return "Alert";
    case "monitor": return "Monitor";
    case "brief": return "Brief";
    default: return surface.collaborative ? "Workspace" : "Update";
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   A2UI message normalization + fallback extraction (unchanged logic)
   ═══════════════════════════════════════════════════════════════════════════ */

function normalizeComponentCollection(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).map(([id, entry]) => {
    if (entry && typeof entry === "object") {
      const record = entry as Record<string, unknown>;
      if ("component" in record) return "id" in record ? record : { id, ...record };
      return { id, component: record };
    }
    return { id, value: entry };
  });
}

function normalizeA2UIMessage(message: A2UIMessage): A2UIMessage {
  const next = { ...message };
  if (message.surfaceUpdate && typeof message.surfaceUpdate === "object") {
    const su = message.surfaceUpdate as Record<string, unknown>;
    next.surfaceUpdate = { ...su, components: normalizeComponentCollection(su.components) };
  }
  if (message.dataModelUpdate && typeof message.dataModelUpdate === "object") {
    const dm = message.dataModelUpdate as Record<string, unknown>;
    next.dataModelUpdate = { ...dm, contents: normalizeComponentCollection(dm.contents) };
  }
  return next;
}

function deriveFallbackActionId(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "surface_action";
}

function resolveFallbackTextValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) return value;
  if (!value || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  if (typeof r.literalString === "string" && r.literalString.trim().length > 0) return r.literalString;
  if (typeof r.literal === "string" && r.literal.trim().length > 0) return r.literal;
  return null;
}

function extractFallbackSurfaceItems(messages: A2UIMessage[]): FallbackSurfaceItem[] {
  const items: FallbackSurfaceItem[] = [];
  for (const rawMessage of messages) {
    if (rawMessage && typeof rawMessage === "object" && !("surfaceUpdate" in rawMessage) && !("dataModelUpdate" in rawMessage) && !("beginRendering" in rawMessage)) {
      const record = rawMessage as Record<string, unknown>;
      if (record.type === "message" && typeof record.value === "string" && record.value.trim().length > 0) {
        items.push({ kind: "text", id: `message-${items.length}`, value: record.value });
      }
      if (typeof record.actionLabel === "string" && record.actionLabel.trim().length > 0) {
        items.push({
          kind: "action", id: `action-${items.length}`, label: record.actionLabel,
          actionId: typeof record.actionId === "string" && record.actionId.trim().length > 0 ? record.actionId : deriveFallbackActionId(record.actionLabel),
          style: typeof record.style === "string" ? record.style : "primary",
        });
      }
      continue;
    }
    const message = normalizeA2UIMessage(rawMessage);
    if (!message.surfaceUpdate || typeof message.surfaceUpdate !== "object") continue;
    const su = message.surfaceUpdate as Record<string, unknown>;
    const components = normalizeComponentCollection(su.components);
    for (const entry of components) {
      if (!entry || typeof entry !== "object") continue;
      const ce = entry as Record<string, unknown>;
      const component = ce.component;
      const id = typeof ce.id === "string" ? ce.id : `component-${items.length}`;
      if (!component || typeof component !== "object") continue;
      const [componentType, payload] = Object.entries(component as Record<string, unknown>)[0] ?? [];
      if (!componentType || !payload || typeof payload !== "object") continue;
      const props = payload as Record<string, unknown>;
      const textValue = componentType === "Text" ? resolveFallbackTextValue(props.text ?? props.value) : null;
      if (textValue) { items.push({ kind: "text", id, value: textValue }); continue; }
      if (componentType === "ActionButton" && typeof props.label === "string" && typeof props.actionId === "string") {
        items.push({ kind: "action", id, label: props.label, actionId: props.actionId, style: typeof props.style === "string" ? props.style : "primary" });
      }
    }
  }
  return items;
}

/* ═══════════════════════════════════════════════════════════════════════════
   SVG icons (inline, tiny)
   ═══════════════════════════════════════════════════════════════════════════ */

const IconMaximize = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/></svg>
);
const IconRestore = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="4" y="4" width="9" height="9" rx="1.5"/><path d="M4 8V3.5A1.5 1.5 0 015.5 2H12"/></svg>
);
const IconX = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>
);
const IconTrash = () => (
  <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M2 4h12M5.33 4V2.67a1.33 1.33 0 011.34-1.34h2.66a1.33 1.33 0 011.34 1.34V4M6.67 7.33v4M9.33 7.33v4"/><path d="M3.33 4l.82 9a1.33 1.33 0 001.33 1.23h5.04a1.33 1.33 0 001.33-1.23l.82-9"/></svg>
);
const IconGrid = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/></svg>
);
const IconUndo = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M3 7h7a3 3 0 010 6H8"/><path d="M6 4L3 7l3 3"/></svg>
);
const IconClear = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 2l12 12M8 2a6 6 0 016 6M2 8a6 6 0 006 6"/></svg>
);

/* ═══════════════════════════════════════════════════════════════════════════
   GripDots — subtle drag affordance
   ═══════════════════════════════════════════════════════════════════════════ */

function GripDots() {
  return (
    <div className="workspace-panel__grip" aria-hidden="true">
      <span className="workspace-panel__grip-dot" />
      <span className="workspace-panel__grip-dot" />
      <span className="workspace-panel__grip-dot" />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   A2UI message processor (unchanged logic)
   ═══════════════════════════════════════════════════════════════════════════ */

function A2UIMessageProcessor({ messages }: { messages: A2UIMessage[] }) {
  const { processMessages } = useA2UI();
  useEffect(() => {
    if (messages.length > 0) {
      for (const message of messages.map(normalizeA2UIMessage)) {
        try { processMessages([message] as unknown as Parameters<typeof processMessages>[0]); }
        catch (error) { console.warn("[AuraPulse] Skipping malformed workspace A2UI message.", error, message); }
      }
    }
  }, [messages, processMessages]);
  return null;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Panel renderer (unchanged logic, lighter wrapper)
   ═══════════════════════════════════════════════════════════════════════════ */

function WorkspacePanelRenderer({
  surface, onAction, onFallbackAction,
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
    if (!host || fallbackItems.length === 0) { setShowFallback(false); return undefined; }
    let frameA = 0;
    let frameB = 0;
    const update = () => {
      const hasContent = host.querySelector("*") !== null && (host.textContent?.trim().length ?? 0) > 0;
      setShowFallback(!hasContent);
    };
    const observer = new MutationObserver(update);
    observer.observe(host, { subtree: true, childList: true, characterData: true });
    frameA = window.requestAnimationFrame(() => { frameB = window.requestAnimationFrame(update); });
    return () => { observer.disconnect(); window.cancelAnimationFrame(frameA); window.cancelAnimationFrame(frameB); };
  }, [fallbackItems, surface.surfaceId]);

  return (
    <A2UIProvider onAction={onAction} theme={auraTheme}>
      <A2UIMessageProcessor messages={surface.a2uiMessages} />
      <div ref={hostRef} className="workspace-panel__renderer-host">
        <A2UIRenderer surfaceId={surface.surfaceId} className="workspace-panel__renderer" />
      </div>
      {showFallback ? (
        <div className="workspace-panel__fallback" aria-label={`${surface.title ?? surface.surfaceId} fallback surface`}>
          {fallbackItems.map((item) =>
            item.kind === "text" ? (
              <p key={item.id} className="workspace-panel__fallback-text">{item.value}</p>
            ) : (
              <button key={item.id} type="button" className={`aura-btn aura-btn--${item.style}`} onClick={() => onFallbackAction(item.actionId, item.id)}>
                {item.label}
              </button>
            ),
          )}
        </div>
      ) : null}
    </A2UIProvider>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Main component
   ═══════════════════════════════════════════════════════════════════════════ */

export function WorkspaceSurface({ surfaces }: WorkspaceSurfaceProps) {
  const sendMessage = useSurfaceStore((s) => s.sendMessage);
  const deleteKernelSurface = useSurfaceStore((s) => s.deleteKernelSurface);
  const agentBusy = useSurfaceStore((s) => s.agentBusy);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const trayRef = useRef<HTMLDivElement | null>(null);
  const trayDragRef = useRef<{ startX: number; scrollLeft: number } | null>(null);
  const [bounds, setBounds] = useState<WorkspaceBounds>(DEFAULT_BOUNDS);
  const [layout, setLayout] = useState<WorkspaceLayoutState>(() => readWorkspaceLayout());
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [exitingSurfaces, setExitingSurfaces] = useState<Set<string>>(new Set());
  const [arranging, setArranging] = useState(false);

  const compactMode = bounds.width < 760;
  const ws = getActiveWs(layout);

  // Measure board
  useEffect(() => {
    const measure = () => {
      const rect = boardRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) { setBounds(DEFAULT_BOUNDS); return; }
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

  // Persist layout
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  }, [layout]);

  // Reconcile surfaces with layout panels — auto-tile new arrivals, auto-dock overflow
  useEffect(() => {
    setLayout((current) => {
      const currentWs = getActiveWs(current);
      let changed = false;
      let nextZ = currentWs.nextZ;
      const nextPanels = { ...currentWs.panels };
      const liveSurfaceIds = new Set(surfaces.map((s) => s.surfaceId));

      const visibleCount = () =>
        Object.values(nextPanels).filter((p) => !p.dismissed && !p.collapsed).length;

      const targetWidth = getPanelWidth(bounds.width);

      surfaces.forEach((surface) => {
        const existing = nextPanels[surface.surfaceId];
        if (!existing) {
          // Auto-dock oldest if at capacity
          const maxVis = getMaxVisible(bounds.width);
          if (visibleCount() >= maxVis) {
            const oldest = surfaces
              .filter((s) => { const p = nextPanels[s.surfaceId]; return p && !p.dismissed && !p.collapsed; })
              .sort((a, b) => (a.receivedAt ?? 0) - (b.receivedAt ?? 0))[0];
            if (oldest && nextPanels[oldest.surfaceId]) {
              nextPanels[oldest.surfaceId] = { ...nextPanels[oldest.surfaceId], collapsed: true };
            }
          }
          const slot = findOpenSlot(Object.values(nextPanels), bounds.width);
          nextPanels[surface.surfaceId] = {
            x: slot.x, y: slot.y, width: targetWidth,
            z: nextZ, collapsed: false, dismissed: false, maximized: false,
          };
          nextZ += 1;
          changed = true;
          return;
        }
        // Normalize width of existing panels whenever bounds changes so all
        // panels stay consistent (fixes panels placed before ResizeObserver fires).
        if (!existing.maximized && !existing.dismissed && !existing.collapsed && existing.width !== targetWidth) {
          nextPanels[surface.surfaceId] = { ...existing, width: targetWidth };
          changed = true;
        }
        if (existing.dismissed && surface.receivedAt && surface.receivedAt > (existing.hiddenAt ?? 0)) {
          nextPanels[surface.surfaceId] = { ...existing, dismissed: false, collapsed: false, hiddenAt: undefined };
          changed = true;
        }
      });

      Object.keys(nextPanels).forEach((sid) => {
        if (!liveSurfaceIds.has(sid)) { delete nextPanels[sid]; changed = true; }
      });

      if (!changed) return current;
      return setActiveWs(current, { panels: nextPanels, nextZ });
    });
  }, [bounds, surfaces]);

  // Drag system
  useEffect(() => {
    if (compactMode) { dragRef.current = null; return undefined; }
    const handlePointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;

      // Clamp X: panel must stay within board width
      const nextX = clamp(
        drag.originX + event.clientX - drag.startX,
        BOARD_PAD,
        Math.max(BOARD_PAD, bounds.width - drag.width - BOARD_PAD),
      );

      // Clamp Y: panel bottom must not exit the visible viewport.
      // The board sits 44px below the viewport top (topbar). Command pill + clearance = 88px from bottom.
      // We read the panel element's live height so the body can never escape the viewport floor.
      const panelEl = boardRef.current?.querySelector<HTMLElement>(`[data-surface-panel="${drag.surfaceId}"]`);
      const panelH = panelEl ? panelEl.getBoundingClientRect().height : 200;
      const TOPBAR_H = 44;
      const BOTTOM_CLEARANCE = 88; // command pill + breathing room
      const maxY = Math.max(BOARD_PAD, window.innerHeight - TOPBAR_H - BOTTOM_CLEARANCE - panelH);
      const nextY = clamp(drag.originY + event.clientY - drag.startY, BOARD_PAD, maxY);

      setLayout((current) => {
        const currentWs = getActiveWs(current);
        const panel = currentWs.panels[drag.surfaceId];
        if (!panel || panel.maximized || panel.collapsed || panel.dismissed) return current;
        if (nextX === panel.x && nextY === panel.y) return current;
        return setActiveWs(current, {
          ...currentWs,
          panels: { ...currentWs.panels, [drag.surfaceId]: { ...panel, x: nextX, y: nextY } },
        });
      });
    };
    const handlePointerUp = () => { dragRef.current = null; };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => { window.removeEventListener("pointermove", handlePointerMove); window.removeEventListener("pointerup", handlePointerUp); };
  }, [bounds.width, compactMode]);

  const beginDrag = (surfaceId: string, event: React.PointerEvent<HTMLElement>) => {
    if (compactMode) return;
    if (event.target instanceof HTMLElement && event.target.closest("button")) return;
    const panel = ws.panels[surfaceId];
    if (!panel || panel.maximized || panel.collapsed || panel.dismissed) return;
    dragRef.current = { surfaceId, startX: event.clientX, startY: event.clientY, originX: panel.x, originY: panel.y, width: panel.width };
    setLayout((current) => {
      const cws = getActiveWs(current);
      return setActiveWs(current, { ...cws, panels: { ...cws.panels, [surfaceId]: { ...panel, z: cws.nextZ } }, nextZ: cws.nextZ + 1 });
    });
  };

  // Actions
  const handleProviderAction = (surface: KernelSurface, message: A2UIClientEventMessage) => {
    if (!message.userAction) return;
    sendMessage({ type: "surface_action", surfaceId: surface.surfaceId, actionName: message.userAction.name, sourceComponentId: message.userAction.sourceComponentId, context: message.userAction.context ?? {} });
  };

  const handleFallbackAction = (surface: KernelSurface, actionName: string, sourceComponentId?: string) => {
    sendMessage({ type: "surface_action", surfaceId: surface.surfaceId, actionName, sourceComponentId, context: {} });
  };

  const updatePanel = useCallback((surfaceId: string, updater: (p: WorkspacePanelLayout) => WorkspacePanelLayout) => {
    setLayout((current) => {
      const cws = getActiveWs(current);
      const panel = cws.panels[surfaceId];
      if (!panel) return current;
      return setActiveWs(current, { ...cws, panels: { ...cws.panels, [surfaceId]: updater(panel) } });
    });
  }, []);

  const collapsePanel = (surfaceId: string) => {
    updatePanel(surfaceId, (p) => ({ ...p, collapsed: true, dismissed: false, maximized: false }));
  };

  const toggleMaximize = (surfaceId: string) => {
    setLayout((current) => {
      const cws = getActiveWs(current);
      const panel = cws.panels[surfaceId];
      if (!panel) return current;
      if (panel.maximized && panel.restoreRect) {
        return setActiveWs(current, { ...cws, panels: { ...cws.panels, [surfaceId]: { ...panel, ...panel.restoreRect, maximized: false, restoreRect: undefined } } });
      }
      return setActiveWs(current, {
        panels: { ...cws.panels, [surfaceId]: { ...panel, x: 8, y: 8, width: Math.max(320, bounds.width - 16), z: cws.nextZ, maximized: true, restoreRect: { x: panel.x, y: panel.y, width: panel.width } } },
        nextZ: cws.nextZ + 1,
      });
    });
  };


  const restorePanel = (surfaceId: string) => {
    setLayout((current) => {
      const cws = getActiveWs(current);
      const panel = cws.panels[surfaceId];
      if (!panel) return current;
      return setActiveWs(current, {
        panels: { ...cws.panels, [surfaceId]: { ...panel, collapsed: false, dismissed: false, hiddenAt: undefined, z: cws.nextZ } },
        nextZ: cws.nextZ + 1,
      });
    });
  };

  const deleteSurface = (surfaceId: string) => {
    setLayout((current) => {
      const cws = getActiveWs(current);
      const nextPanels = { ...cws.panels };
      delete nextPanels[surfaceId];
      return setActiveWs(current, { ...cws, panels: nextPanels });
    });
    deleteKernelSurface?.(surfaceId);
  };

  const clearWorkspace = () => {
    const visCount = surfaces.filter((s) => { const p = ws.panels[s.surfaceId]; return p && !p.dismissed && !p.collapsed; }).length;
    if (visCount === 0) return;

    setExitingSurfaces(new Set(surfaces.filter((s) => { const p = ws.panels[s.surfaceId]; return p && !p.dismissed && !p.collapsed; }).map((s) => s.surfaceId)));

    setTimeout(() => {
      setLayout((current) => {
        const cws = getActiveWs(current);
        const nextPanels = { ...cws.panels };
        const hiddenAt = Date.now();
        for (const surface of surfaces) {
          const panel = nextPanels[surface.surfaceId];
          if (!panel) continue;
          nextPanels[surface.surfaceId] = { ...panel, collapsed: false, dismissed: true, maximized: false, hiddenAt };
        }
        return setActiveWs(current, { ...cws, panels: nextPanels });
      });
      setExitingSurfaces(new Set());
      setToastMessage(`Workspace cleared — ${visCount} surface${visCount === 1 ? "" : "s"} parked`);
    }, 200);
  };

  const restoreAll = () => {
    setLayout((current) => {
      const cws = getActiveWs(current);
      const nextPanels = { ...cws.panels };
      for (const [sid, panel] of Object.entries(nextPanels)) {
        nextPanels[sid] = { ...panel, collapsed: false, dismissed: false, hiddenAt: undefined };
      }
      return setActiveWs(current, { ...cws, panels: nextPanels });
    });
  };

  const deleteAllHidden = () => {
    const docked = surfaces.filter((s) => { const p = ws.panels[s.surfaceId]; return p?.collapsed || p?.dismissed; });
    for (const s of docked) deleteSurface(s.surfaceId);
    if (docked.length > 0) setToastMessage(`Deleted ${docked.length} surface${docked.length === 1 ? "" : "s"}`);
  };

  const arrangeAll = () => {
    setArranging(true);
    setLayout((current) => {
      const cws = getActiveWs(current);
      return setActiveWs(current, { ...cws, panels: arrangePanels(surfaces, cws.panels, bounds.width) });
    });
    setTimeout(() => setArranging(false), 300);
  };

  // Derived lists
  const visibleSurfaces = useMemo(() =>
    surfaces
      .filter((s) => { const p = ws.panels[s.surfaceId]; return p && !p.dismissed && !p.collapsed; })
      .sort((a, b) => (ws.panels[a.surfaceId]?.z ?? 0) - (ws.panels[b.surfaceId]?.z ?? 0)),
    [ws.panels, surfaces],
  );

  const handleTrayPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!trayRef.current) return;
    trayDragRef.current = { startX: e.clientX, scrollLeft: trayRef.current.scrollLeft };
    trayRef.current.setPointerCapture(e.pointerId);
  };
  const handleTrayPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!trayDragRef.current || !trayRef.current) return;
    trayRef.current.scrollLeft = trayDragRef.current.scrollLeft - (e.clientX - trayDragRef.current.startX);
  };
  const handleTrayPointerUp = () => { trayDragRef.current = null; };

  const collapsedSurfaces = useMemo(() =>
    surfaces.filter((s) => { const p = ws.panels[s.surfaceId]; return Boolean(p?.collapsed && !p.dismissed); }),
    [ws.panels, surfaces],
  );

  const dismissedSurfaces = useMemo(() =>
    surfaces.filter((s) => ws.panels[s.surfaceId]?.dismissed),
    [ws.panels, surfaces],
  );

  const hiddenCount = collapsedSurfaces.length + dismissedSurfaces.length;

  return (
    <div className="workspace-surface">
      {/* ── Top bar ────────────────────────────────────────────────────── */}
      <header className="topbar">
        <div className="topbar__brand">
          {agentBusy ? <AuroraBarsLoading width={32} /> : <AuroraBarsListen width={32} />}
        </div>

        <div
          ref={trayRef}
          className="topbar__tray"
          onPointerDown={handleTrayPointerDown}
          onPointerMove={handleTrayPointerMove}
          onPointerUp={handleTrayPointerUp}
          onPointerCancel={handleTrayPointerUp}
        >
          {collapsedSurfaces.map((surface) => (
            <span key={surface.surfaceId} className="tray-pill" role="button" tabIndex={0}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => restorePanel(surface.surfaceId)}
              aria-label={`Restore ${surface.title ?? surface.surfaceId}`}
            >
              <span className="tray-pill__icon">{getSurfaceIcon(surface)}</span>
              <span className="tray-pill__label">{surface.title ?? surface.surfaceId}</span>
              <button className="tray-pill__delete" onClick={(e) => { e.stopPropagation(); deleteSurface(surface.surfaceId); }} aria-label="Delete"><IconTrash /></button>
            </span>
          ))}
          {dismissedSurfaces.map((surface) => (
            <span key={surface.surfaceId} className="tray-pill tray-pill--dismissed" role="button" tabIndex={0}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => restorePanel(surface.surfaceId)}
              aria-label={`Restore ${surface.title ?? surface.surfaceId}`}
            >
              <span className="tray-pill__icon">{getSurfaceIcon(surface)}</span>
              <span className="tray-pill__label">{surface.title ?? surface.surfaceId}</span>
              <button className="tray-pill__delete" onClick={(e) => { e.stopPropagation(); deleteSurface(surface.surfaceId); }} aria-label="Delete"><IconTrash /></button>
            </span>
          ))}
        </div>

        <div className="topbar__actions">
          {hiddenCount > 1 && (
            <button type="button" className="aura-icon-btn aura-icon-btn--danger" onClick={deleteAllHidden} aria-label="Delete all docked" title="Delete all docked">
              <IconTrash />
            </button>
          )}
          {!compactMode && (
            <button type="button" className="aura-icon-btn" onClick={arrangeAll} aria-label="Arrange panels" title="Arrange" disabled={visibleSurfaces.length < 2}><IconGrid /></button>
          )}
          {hiddenCount > 0 && (
            <button type="button" className="aura-icon-btn" onClick={restoreAll} aria-label="Restore all" title="Restore all"><IconUndo /></button>
          )}
          {visibleSurfaces.length > 0 && (
            <button type="button" className="aura-icon-btn" onClick={clearWorkspace} aria-label="Clear workspace" title="Clear workspace"><IconClear /></button>
          )}
          <WsBadge />
        </div>
      </header>

      {/* ── Board ──────────────────────────────────────────────────────── */}
      <div ref={boardRef} className={`workspace-board${compactMode ? " workspace-board--compact" : ""}`}>
        {visibleSurfaces.length === 0 && surfaces.length === 0 ? (
          <div className="workspace-board__empty">
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.75rem" }}>
              <AuroraBarsListen width={140} />
              <span style={{ fontFamily: "'Michroma', var(--font-sans)", fontSize: "1.4rem", letterSpacing: "0.25em", color: "var(--a-400)", fontWeight: 400, textTransform: "lowercase", opacity: 0.7 }}>aurora</span>
            </div>
          </div>
        ) : null}

        {visibleSurfaces.map((surface) => {
          const panel = ws.panels[surface.surfaceId];
          if (!panel) return null;
          const isExiting = exitingSurfaces.has(surface.surfaceId);

          // When maximized, let the CSS class `workspace-panel--maximized` own all position/size
          // via `inset`. Only inject zIndex so inline styles don't override `inset`.
          const panelStyle = compactMode
            ? undefined
            : panel.maximized
              ? { zIndex: panel.z }
              : {
                  left: `${panel.x}px`,
                  top: `${panel.y}px`,
                  width: `${panel.width}px`,
                  zIndex: panel.z,
                };

          const panelClass = [
            "workspace-panel",
            panel.maximized && "workspace-panel--maximized",
            isExiting && "workspace-panel--exiting",
            arranging && "workspace-panel--arranging",
          ].filter(Boolean).join(" ");

          return (
            <section key={surface.surfaceId} className={panelClass} style={panelStyle} data-surface-panel={surface.surfaceId}>
              <header className="workspace-panel__header" onPointerDown={(e) => beginDrag(surface.surfaceId, e)}>
                <GripDots />
                <div className="workspace-panel__badge" aria-hidden="true">{getSurfaceIcon(surface)}</div>
                <h2 className="workspace-panel__title">{surface.title ?? surface.surfaceId}</h2>
                <span className="workspace-panel__type-tag">{getSurfaceTypeLabel(surface)}</span>
                <div className="workspace-panel__controls">
                  <button type="button" className="aura-icon-btn" onPointerDown={(e) => e.stopPropagation()} onClick={() => toggleMaximize(surface.surfaceId)} aria-label={panel.maximized ? "Restore size" : "Maximize"}>
                    {panel.maximized ? <IconRestore /> : <IconMaximize />}
                  </button>
                  <button type="button" className="aura-icon-btn" onPointerDown={(e) => e.stopPropagation()} onClick={() => collapsePanel(surface.surfaceId)} aria-label="Dock to tray"><IconX /></button>
                </div>
              </header>

              {(surface.summary || surface.voiceLine) && (
                <p className="workspace-panel__subtitle">{surface.voiceLine || surface.summary}</p>
              )}

              <div className="workspace-panel__body">
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

      {/* ── Toast ──────────────────────────────────────────────────────── */}
      {toastMessage && <Toast message={toastMessage} onDone={() => setToastMessage(null)} />}
    </div>
  );
}
