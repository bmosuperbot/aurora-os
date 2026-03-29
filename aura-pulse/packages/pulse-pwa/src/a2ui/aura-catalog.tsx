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

type PrimitiveActionValue = string | number | boolean;

type ActionContextEntry =
  | { key: string; value: { literalString: string } }
  | { key: string; value: { literalNumber: number } }
  | { key: string; value: { literalBoolean: boolean } };

function toActionContextEntries(context: Record<string, unknown>) {
  const entries: ActionContextEntry[] = [];

  for (const [key, value] of Object.entries(context)) {
    if (typeof value === "string") {
      entries.push({ key, value: { literalString: value } });
      continue;
    }
    if (typeof value === "number") {
      entries.push({ key, value: { literalNumber: value } });
      continue;
    }
    if (typeof value === "boolean") {
      entries.push({ key, value: { literalBoolean: value } });
      continue;
    }
    if (value === null || value === undefined) {
      continue;
    }
    entries.push({ key, value: { literalString: JSON.stringify(value) } });
  }

  return entries;
}

type CommandTimelineEntry = {
  id: string;
  role?: "user" | "system";
  text?: string;
  status?: "pending" | "accepted" | "rejected";
  modality?: "text" | "voice";
  timestamp?: string;
};

interface BrowserSpeechRecognitionResult {
  transcript: string;
}

interface BrowserSpeechRecognitionResultList {
  length: number;
  [index: number]: {
    length: number;
    [innerIndex: number]: BrowserSpeechRecognitionResult;
  };
}

interface BrowserSpeechRecognitionEvent {
  results: BrowserSpeechRecognitionResultList;
}

interface BrowserSpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
}

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

function getSpeechRecognitionCtor(): BrowserSpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const speechWindow = window as Window & {
    SpeechRecognition?: BrowserSpeechRecognitionConstructor;
    webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
  };
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

// ── Aura-specific components ──────────────────────────────────────────────

function AuraActionButton({ node, surfaceId }: A2UIComponentProps<AnyComponentNode>) {
  const { sendAction } = useA2UIComponent(node, surfaceId);
  const p = nodeProps(node);
  const actionId = String(p.actionId ?? "");
  const label = String(p.label ?? "Action");
  const style = String(p.style ?? "primary");
  const actionContext = typeof p.actionContext === "object" && p.actionContext !== null
    ? p.actionContext as Record<string, PrimitiveActionValue>
    : null;
  return (
    <button
      className={`aura-btn aura-btn--${style}`}
      onClick={() => sendAction({
        name: actionId,
        ...(actionContext ? { context: toActionContextEntries(actionContext) } : {}),
      } as Parameters<typeof sendAction>[0])}
    >
      {label}
    </button>
  );
}

type MetricTone = "default" | "positive" | "warning" | "critical";

interface MetricGridItem {
  id: string;
  label: string;
  value: string | number;
  detail?: string;
  tone?: MetricTone;
}

function MetricGrid({ node }: A2UIComponentProps<AnyComponentNode>) {
  const p = nodeProps(node);
  const title = typeof p.title === "string" ? p.title : "";
  const metrics = Array.isArray(p.metrics) ? p.metrics as MetricGridItem[] : [];

  return (
    <section className="aura-metric-grid" aria-label={title || "Summary metrics"}>
      {title ? <h2 className="aura-metric-grid__title">{title}</h2> : null}
      <div className="aura-metric-grid__items">
        {metrics.map((metric) => (
          <article
            key={metric.id}
            className={`aura-metric-card aura-metric-card--${metric.tone ?? "default"}`}
          >
            <p className="aura-metric-card__label">{metric.label}</p>
            <p className="aura-metric-card__value">{metric.value}</p>
            {metric.detail ? <p className="aura-metric-card__detail">{metric.detail}</p> : null}
          </article>
        ))}
      </div>
    </section>
  );
}

interface DataTableColumn {
  id: string;
  label: string;
  align?: "left" | "center" | "right";
}

interface DataTableRow {
  id?: string;
  [key: string]: unknown;
}

function DataTable({ node }: A2UIComponentProps<AnyComponentNode>) {
  const p = nodeProps(node);
  const title = typeof p.title === "string" ? p.title : "";
  const caption = typeof p.caption === "string" ? p.caption : "";
  const emptyText = typeof p.emptyText === "string" ? p.emptyText : "No rows available.";
  const columns = Array.isArray(p.columns) ? p.columns as DataTableColumn[] : [];
  const rows = Array.isArray(p.rows) ? p.rows as DataTableRow[] : [];

  return (
    <section className="aura-data-table" aria-label={title || "Data table"}>
      {title ? <h2 className="aura-data-table__title">{title}</h2> : null}
      {caption ? <p className="aura-data-table__caption">{caption}</p> : null}
      {rows.length === 0 ? (
        <div className="aura-data-table__empty">{emptyText}</div>
      ) : (
        <div className="aura-data-table__scroller">
          <table>
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column.id} className={`aura-data-table__cell aura-data-table__cell--${column.align ?? "left"}`}>
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={typeof row.id === "string" ? row.id : `row-${index}`}>
                  {columns.map((column) => (
                    <td key={column.id} className={`aura-data-table__cell aura-data-table__cell--${column.align ?? "left"}`}>
                      {String(row[column.id] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
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

function CommandTimeline({ node }: A2UIComponentProps<AnyComponentNode>) {
  const p = nodeProps(node);
  const entries = Array.isArray(p.entries) ? p.entries as CommandTimelineEntry[] : [];
  const emptyText = String(p.emptyText ?? "No commands yet.");
  const scrollerRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    const element = scrollerRef.current;
    if (!element) return;
    if (typeof element.scrollTo === "function") {
      element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
      return;
    }
    element.scrollTop = element.scrollHeight;
  }, [entries]);

  return (
    <div className="aura-command-timeline" ref={scrollerRef}>
      {entries.length === 0 ? (
        <p className="aura-command-timeline__empty">{emptyText}</p>
      ) : entries.map((entry) => (
        <article
          key={entry.id}
          className={`aura-command-entry aura-command-entry--${entry.role ?? "system"}`}
        >
          <div className="aura-command-entry__meta">
            <span>{entry.role === "user" ? "You" : "Aura"}</span>
            {entry.modality ? <span>{entry.modality === "voice" ? "voice" : "text"}</span> : null}
            {entry.status ? (
              <span className={`aura-command-entry__status aura-command-entry__status--${entry.status}`}>
                {entry.status}
              </span>
            ) : null}
          </div>
          <p className="aura-command-entry__text">{entry.text ?? ""}</p>
        </article>
      ))}
    </div>
  );
}

function CommandComposer({ node, surfaceId }: A2UIComponentProps<AnyComponentNode>) {
  const { sendAction } = useA2UIComponent(node, surfaceId);
  const p = nodeProps(node);
  const placeholder = String(p.placeholder ?? "Tell Aura what to do");
  const submitLabel = String(p.submitLabel ?? "Send");
  const voiceLabel = String(p.voiceLabel ?? "Voice");
  const voiceActiveLabel = String(p.voiceActiveLabel ?? "Listening…");
  const [text, setText] = React.useState("");
  const [listening, setListening] = React.useState(false);
  const [error, setError] = React.useState("");
  const recognitionRef = React.useRef<BrowserSpeechRecognition | null>(null);

  React.useEffect(() => () => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
  }, []);

  const submit = (rawText: string, modality: "text" | "voice") => {
    const command = rawText.trim();
    if (!command) return;

    sendAction({
      name: "submit_command",
      context: [
        { key: "text", value: { literalString: command } },
        { key: "modality", value: { literalString: modality } },
      ],
    } as Parameters<typeof sendAction>[0]);
    setText("");
    setError("");
  };

  const toggleVoice = () => {
    const SpeechRecognitionCtor = getSpeechRecognitionCtor();
    if (!SpeechRecognitionCtor) {
      setError("Voice capture is unavailable in this browser.");
      return;
    }

    if (listening) {
      recognitionRef.current?.stop();
      return;
    }

    setError("");
    const recognition = new SpeechRecognitionCtor();
    let transcript = "";

    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onresult = (event) => {
      transcript = Array.from({ length: event.results.length }, (_, index) => event.results[index]?.[0]?.transcript ?? "")
        .join(" ")
        .trim();
      setText(transcript);
    };
    recognition.onerror = () => {
      setListening(false);
      setError("Voice capture failed. You can still type a command.");
      recognitionRef.current = null;
    };
    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = null;
      if (transcript.trim()) {
        submit(transcript, "voice");
      }
    };

    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  };

  return (
    <div className="aura-command-composer">
      <label className="aura-command-composer__label" htmlFor="aura-command-input">Command</label>
      <textarea
        id="aura-command-input"
        className="aura-command-composer__textarea"
        placeholder={placeholder}
        value={text}
        rows={3}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            submit(text, "text");
          }
        }}
      />
      {error ? <p className="aura-command-composer__error">{error}</p> : null}
      <div className="aura-command-composer__actions">
        <button
          type="button"
          className="aura-btn aura-btn--secondary"
          onClick={toggleVoice}
        >
          {listening ? voiceActiveLabel : voiceLabel}
        </button>
        <button
          type="button"
          className="aura-btn aura-btn--primary"
          onClick={() => submit(text, "text")}
        >
          {submitLabel}
        </button>
      </div>
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
  registry.register<AnyComponentNode>("CommandTimeline", { component: CommandTimeline });
  registry.register<AnyComponentNode>("CommandComposer", { component: CommandComposer });
  registry.register<AnyComponentNode>("MetricGrid", { component: MetricGrid });
  registry.register<AnyComponentNode>("DataTable", { component: DataTable });
}
