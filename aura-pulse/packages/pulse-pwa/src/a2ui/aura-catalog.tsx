// Aura custom catalog for A2UI.
// Extends the default basic catalog with Aura-specific rich components.
//
// CatalogId: https://aura-os.ai/a2ui/v1/aura-catalog.json

import { ComponentRegistry, initializeDefaultCatalog, useA2UIComponent } from "@a2ui/react";
import type { A2UIComponentProps, AnyComponentNode } from "@a2ui/react";
import React from "react";

const artifactDrafts = new Map<string, Record<string, unknown>>();
const artifactDraftListeners = new Map<string, Set<(data: Record<string, unknown>) => void>>();

function emitArtifactDraft(surfaceId: string): void {
  const data = artifactDrafts.get(surfaceId) ?? {};
  for (const listener of artifactDraftListeners.get(surfaceId) ?? []) {
    listener(data);
  }
}

export function setArtifactDraftValue(surfaceId: string, key: string, value: unknown): void {
  const next = { ...(artifactDrafts.get(surfaceId) ?? {}), [key]: value };
  artifactDrafts.set(surfaceId, next);
  emitArtifactDraft(surfaceId);
}

export function getArtifactDraft(surfaceId: string): Record<string, unknown> {
  return artifactDrafts.get(surfaceId) ?? {};
}

export function clearArtifactDraft(surfaceId: string): void {
  artifactDrafts.delete(surfaceId);
  emitArtifactDraft(surfaceId);
}

export function subscribeArtifactDraft(
  surfaceId: string,
  listener: (data: Record<string, unknown>) => void,
): () => void {
  const listeners = artifactDraftListeners.get(surfaceId) ?? new Set<(data: Record<string, unknown>) => void>();
  listeners.add(listener);
  artifactDraftListeners.set(surfaceId, listeners);
  listener(getArtifactDraft(surfaceId));
  return () => {
    const current = artifactDraftListeners.get(surfaceId);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) {
      artifactDraftListeners.delete(surfaceId);
    }
  };
}

// Helper: extract resolved CustomNode properties bag at runtime.
// catalog components always receive a CustomNode, which has `properties`.
type RawNodeProps = { properties: Record<string, unknown>; id: string };
const nodeProps = (node: AnyComponentNode) =>
  (node as unknown as RawNodeProps).properties;
const nodeId = (node: AnyComponentNode) =>
  (node as unknown as RawNodeProps).id;

// ── Aura-specific components ──────────────────────────────────────────────

function AuraActionButton({ node, surfaceId }: A2UIComponentProps<AnyComponentNode>) {
  const { sendAction } = useA2UIComponent(node, surfaceId);
  const p = nodeProps(node);
  const actionId = String(p.actionId ?? "");
  const label = String(p.label ?? "Action");
  const style = String(p.style ?? "primary");
  return (
    <button
      className={`aura-btn aura-btn--${style}`}
      onClick={() => sendAction({ name: actionId })}
    >
      {label}
    </button>
  );
}

function ContractMetaRow({ node }: A2UIComponentProps<AnyComponentNode>) {
  const p = nodeProps(node);
  const label = String(p.label ?? "");
  const value = String(p.value ?? "");
  return (
    <div className="aura-meta-row">
      <span className="aura-meta-row__label">{label}</span>
      <span className="aura-meta-row__value">{value}</span>
    </div>
  );
}

function AuraArtifactTextField({ node, surfaceId }: A2UIComponentProps<AnyComponentNode>) {
  const { setValue } = useA2UIComponent(node, surfaceId);
  const p = nodeProps(node);
  const fieldId = String(p.fieldId ?? nodeId(node));
  const label = String(p.label ?? "");
  const defaultValue = String(p.defaultValue ?? "");
  const multiline = Boolean(p.multiline);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setValue("value", e.target.value);
    setArtifactDraftValue(surfaceId, fieldId, e.target.value);
  };

  return (
    <div className="aura-artifact-field">
      <label className="aura-artifact-field__label" htmlFor={fieldId}>{label}</label>
      {multiline ? (
        <textarea
          id={fieldId}
          className="aura-artifact-field__textarea"
          defaultValue={defaultValue}
          onChange={handleChange}
          rows={4}
        />
      ) : (
        <input
          id={fieldId}
          type="text"
          className="aura-artifact-field__input"
          defaultValue={defaultValue}
          onChange={handleChange}
        />
      )}
    </div>
  );
}

function DecisionChips({ node, surfaceId }: A2UIComponentProps<AnyComponentNode>) {
  const { sendAction } = useA2UIComponent(node, surfaceId);
  const chips = (nodeProps(node).chips as Array<{ id: string; label: string; actionId: string }>) ?? [];
  return (
    <div className="aura-decision-chips">
      {chips.map((chip) => (
        <button
          key={chip.id}
          className="aura-chip"
          onClick={() => sendAction({ name: chip.actionId })}
        >
          {chip.label}
        </button>
      ))}
    </div>
  );
}

// ── Registration ─────────────────────────────────────────────────────────────

/** Must be called once at app startup, before any A2UIProvider mounts. */
export function registerAuraCatalog(): void {
  initializeDefaultCatalog();
  const registry = ComponentRegistry.getInstance();

  registry.register<AnyComponentNode>("ActionButton", { component: AuraActionButton });
  registry.register<AnyComponentNode>("ContractMetaRow", { component: ContractMetaRow });
  registry.register<AnyComponentNode>("ArtifactTextField", { component: AuraArtifactTextField });
  registry.register<AnyComponentNode>("DecisionChips", { component: DecisionChips });
}
