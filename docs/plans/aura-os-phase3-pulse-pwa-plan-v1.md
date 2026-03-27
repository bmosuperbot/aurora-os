# Aura OS — Phase 3 Plan
**Pulse PWA: Full Decision Surface**
version: 1.0 | status: implementation-ready
date: March 27, 2026

---

## 01 — What Phase 3 Delivers

Phase 3 builds the Pulse PWA — the human-facing surface that makes
the entire Aura stack visible and actionable.

By the end of this phase:

- A standalone React PWA connects to the Phase 2 WebSocket server
  and implements the full SurfaceProtocol.
- Every surface state from Silent through Completion is implemented
  and transitions correctly.
- The owner can engage a decision, ask a clarification question,
  edit an artifact inline, and commit a resolution — all within
  the Pulse surface without leaving it.
- Connector flows (browser redirect, secure input, manual guide)
  run inside Pulse.
- History is rendered as a navigable, human-readable view from
  contracts.db — not a file viewer.
- The morning brief renders on schedule.
- Voice speaks on Decision entry and Completion delivery.
- A2UI visual artifacts embedded in contracts render inside the
  card via the `@a2ui/react` renderer with a custom Aura catalog.

This phase does not connect to real email, real platforms, or real
connector services. That belongs to Phase 4 (artist reseller scenario).
Phase 3 targets the full lifecycle with generic contracts.

---

## 02 — Locked Inputs

### From Phase 1 (contract runtime)

- `BaseContract` schema and all status transitions
- `SurfaceProtocol` interface (runtime → surface and surface → runtime)
- `surface` field: `voice_line`, `summary`, `recommendation`,
  `actions[]`, `components[]`
- `clarifications[]` — append-only, attributed, immutable
- `resume` — populated by Resolver commit
- `completion_surface` — `voice_line` + `summary`
- `ConnectorCard` shape derived from connector state

### From Phase 2 (OpenClaw plugin)

WebSocket server on port 7700. All runtime-to-surface push messages:
- `decision` — contract enters or updates in `waiting_approval`
- `surface_update` — `surface` field changed while `resolver_active`
- `clarification_answer` — agent answered Resolver's question
- `clear` — contract resolved, failed, or timed out
- `completion` — contract `complete`, deliver `completion_surface`
- `connector_request` — connector card arrives
- `connector_complete` — connector auth flow finalized

All surface-to-runtime messages:
- `engage` — Resolver picks up contract
- `ask_clarification` — Resolver asks question
- `resolve` — Resolver commits action and artifacts
- `abandon` — Resolver drops contract
- `initiate_connector` — owner triggers auth flow
- `complete_connector` — plugin receives credentials
- `decline_connector` — owner declines, with optional `never` flag

On connect or reconnect, the server pushes all pending contracts
immediately via `getPending()`. The PWA does not depend on missed
signal events.

### From the foundation plan (Phase 3 description)

The foundation doc defines the surface states and done criteria.
This plan operationalizes them and corrects the framework choice
based on A2UI research completed after the foundation doc was written.

---

## 03 — Decisions Made Here

### Decision 1 — React, not Vue 3

The foundation plan said "Vue 3 PWA scaffold." That was written before
the A2UI research was complete.

A2UI is now confirmed as the rendering layer for visual artifacts
embedded in contracts. The official A2UI renderers are:
- `@a2ui/react` (React 18/19) — complete, maintained, visual-parity
  tested against the Lit reference implementation
- `@a2ui/lit` (Lit) — reference implementation, produces web components
- Angular — experimental
- Flutter — placeholder, defers to GenUI SDK

There is no Vue renderer and none is planned in the A2UI roadmap.
Integrating the Lit renderer as web components inside Vue is possible
but requires a framework bridge layer that adds complexity for no gain.

**The correct choice is React.** It maps exactly to the `@a2ui/react`
renderer, which is what the contract's `ComponentRef` artifacts
produce. Building a Vue adapter to use Lit web components would be
an unmaintained detour.

This is a deviation from the foundation doc. It is the correct call.

### Decision 2 — A2UI v0.9 spec, custom Aura catalog

A2UI v0.9 is the current stable, closed specification. v0.10 is
active development, no stability guarantee. Build against v0.9.

A2UI allows — and recommends for production — defining your own
catalog instead of using the basic catalog. The catalog restricts
agents to a pre-approved set of UI components. This is the A2UI
security model: agents cannot generate arbitrary UI, only components
in the trusted catalog.

Aura defines its own catalog: `aura-catalog.json`.
CatalogId: `https://aura-os.ai/a2ui/v1/aura-catalog.json`

The Aura catalog extends the basic catalog with Aura-specific rich
components for artifact editing while inheriting all standard layout,
text, and input primitives. See Section 09 for the catalog definition.

### Decision 3 — SurfaceProtocol over WebSocket is the delivery layer; A2UI renders inside artifact panels

A2UI is not the transport. Our custom SurfaceProtocol over WebSocket
is how decisions, clarifications, connectors, and completions are
delivered to the PWA. A2UI is the rendering engine for the
`surface.components[]` artifact panel within a decision card.

Two layers:
1. **SurfaceProtocol** (WebSocket) — delivers contract state changes
2. **A2UI** (within card) — renders rich artifact panels that the
   agent generates and the Resolver edits inline

For the majority of contracts, `surface.components[]` may be empty
(no visual artifact, just text). A2UI rendering is additive —
it activates when the contract includes `ComponentRef[]` items.

### Decision 4 — A2UI surfaces for artifact artifacts are pre-rendered by the plugin

When a contract has `surface.components[]`, the Phase 2 plugin
executes the referenced tool calls (which return A2UI message
streams) before pushing the `decision` message to the PWA.

The `decision` WebSocket message includes both the contract
and a pre-assembled array of A2UI messages for each component ref.
The PWA calls `processMessages()` on `@a2ui/react` to render them.

This avoids the PWA needing to make additional HTTP calls during
card presentation. The plugin assembles the full card payload
before pushing.

### Decision 5 — System TTS for prototype, ElevenLabs path for production

Voice speaks `voice_line` on Decision state entry.
Voice speaks `completion_surface.voice_line` on Completion.
Clarification answers from the agent are spoken in the card.

Prototype: Web Speech API (`window.speechSynthesis`) — zero setup,
available in all modern browsers, works offline.

Production path: ElevenLabs API via plugin HTTP proxy route. The PWA
calls the plugin's HTTP route, which proxies to ElevenLabs and returns
the audio blob. The API key lives in the plugin config, never in
the PWA. This proxy is registered in Phase 3.

### Decision 6 — PWA is served as static files, not embedded in OpenClaw Canvas

Foundation plan §15 is explicit: "Standalone — not OpenClaw Canvas."
The Pulse PWA is a browser PWA served at `http://localhost:<wsPort+1>`
by the plugin's HTTP route. The owner opens it in their browser.

This is simpler to build, simpler to debug, and does not require the
Canvas navigation APIs that remain unverified. It also makes Pulse
portable — any browser surface can be Pulse, including mobile.

---

## 04 — Surface States

Every surface state maps to a distinct visual mode. Transitions are
driven by incoming WebSocket messages, not by timers or polling.

```
Silent
  │  onDecision received
  ▼
Decision ────────────────┐
  │  Resolver engages    │ onClear (timeout or failed)
  ▼                      │
Resolver Active ◄────────┤
  │  Resolver asks       │ onClear
  ▼                      │
Clarifying               │
  │  Agent answers       │
  ▼                      │
Resolver Active ◄────────┘
  │  Resolver commits
  ▼
Confirming
  │  onClear received
  ▼
Completion (brief, then fades)
  │  fades to:
  ▼
Silent

         At any active state:
Connector ──► returns to previous state
History   ──► overlay, dismissible
```

### State definitions

**Silent** — connected to WebSocket, nothing rendered. Heartbeat
pulse confirms live connection. The interface has disappeared.

**Decision** — a contract in `waiting_approval` past its `surface_after`
time has arrived. The card renders with voice, summary, recommendation,
action buttons. Resolver has not yet engaged.

**Resolver Active** — the Resolver tapped Engage. The card locks
for up to the resolver timeout. Action buttons are now active.
An abandon button appears. The timeout countdown shows.

**Clarifying** — Resolver asked a question. The card expands with an
inline thread. The agent's pending answer indicator runs. When the
agent answers (`clarification_answer` push arrives), the answer
appears in the thread and is spoken. Surface may update.

**Artifact Review** — Resolver chose an action that includes a
`ComponentRef` artifact. The artifact panel opens inline or as an
overlay. Two-way A2UI binding lets the Resolver edit fields. The
edited artifact attaches to the resume payload when committed.

**Confirming** — Resolver committed. A resume token was sent to the
runtime. The card dims and shows "Working on it." Waits for `onClear`.

**Completion** — `completion` push arrived after `complete`. The
`completion_surface.voice_line` plays. A compact result card
briefly appears. After 8 seconds or user dismiss, fades to Silent.

**Connector** — a `connector_request` push arrived. Connector card
overlays the current state. Current state is preserved underneath.
The connector card handles browser redirect, secure input, or
manual guide. On complete or decline, overlay dismisses, state
restored.

---

## 05 — Package Layout

```
aura-pulse/
  packages/
    contract-runtime/       ← Phase 1 (complete)
    openclaw-plugin/        ← Phase 2 (complete)
    pulse-pwa/              ← Phase 3 (this phase)
      package.json
      vite.config.ts
      tsconfig.json
      index.html
      public/
        manifest.json       ← PWA manifest
        icons/
      src/
        main.tsx            ← React entry, injectStyles, mounts App
        App.tsx             ← WebSocket provider, surface state machine
        ws/
          client.ts         ← WebSocket client, reconnect logic
          protocol.ts       ← SurfaceProtocol message types
          surface-store.ts  ← Zustand store: current state + contracts
        surface/
          SilentSurface.tsx
          DecisionCard/
            DecisionCard.tsx
            VoiceLine.tsx
            RecommendationPanel.tsx
            ActionBar.tsx
            AbandonButton.tsx
            TimeoutBar.tsx
          ClarificationThread/
            ClarificationThread.tsx
            QuestionInput.tsx
            AnswerEntry.tsx
          ArtifactPanel/
            ArtifactPanel.tsx        ← hosts A2UI renderer for artifacts
            ArtifactEditor.tsx       ← editable fields, captures to resume
          ConnectorCard/
            ConnectorCard.tsx
            BrowserRedirectFlow.tsx
            SecureInputFlow.tsx
            ManualGuideFlow.tsx
          CompletionCard.tsx
          ConfirmingCard.tsx
        history/
          HistoryOverlay.tsx
          HistoryList.tsx
          HistoryItem.tsx
          ContractTimeline.tsx
        morning-brief/
          MorningBrief.tsx
          AutonomousLogEntry.tsx
        voice/
          voice-engine.ts        ← Web Speech API + ElevenLabs proxy
        a2ui/
          a2ui-surface.tsx       ← A2UIProvider + A2UIRenderer wrapper
          aura-catalog.ts        ← Aura custom catalog registration
          artifact-actions.ts    ← action dispatch → ws resolve payload
        api/
          ws-http.ts             ← plugin HTTP calls (TTS proxy, history)
        theme/
          aura-theme.ts          ← Aura brand theme for A2UI
```

---

## 06 — Stack Decisions

### Package manager and bundler

- pnpm (workspace already uses pnpm)
- Vite for dev server and production build
- `@vitejs/plugin-react` — React refresh and JSX transform

### Dependencies

- `react` + `react-dom` 18.x
- `@a2ui/react` — A2UI renderer, `processMessages`, `A2UIProvider`
- `@a2ui/web_core` — underlying state/protocol engine (peer dep)
- `zustand` — surface state machine, simple and React-native
- `ws` is server-side only — PWA uses browser `WebSocket`
- No `ws` package needed in the PWA

### State management

Zustand with a single `useSurfaceStore`. State shape:

```typescript
interface SurfaceState {
  mode: SurfaceMode;               // the current surface state
  contract: BaseContract | null;   // active contract
  a2uiMessages: ServerToClientMessage[]; // staged A2UI messages
  pendingContracts: BaseContract[];      // queued behind current
  connectorCard: ConnectorCard | null;   // overlay if present
  historyOpen: boolean;
  briefOpen: boolean;
  wsStatus: "connected" | "reconnecting" | "disconnected";
}
```

Multi-contract queuing: if a second `decision` arrives while the
Resolver is active, it enters `pendingContracts`. After the active
card reaches Silent, the next pending contract auto-presents.

### PWA manifest

```json
{
  "name": "Aura Pulse",
  "short_name": "Pulse",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0a0a0a",
  "theme_color": "#6366f1",
  "icons": [{ "src": "/icons/pulse-192.png", "sizes": "192x192" }]
}
```

---

## 07 — WebSocket Client

### Connection and reconnect

`ws/client.ts` wraps the browser `WebSocket` and owns reconnect logic.

```typescript
class PulseWebSocketClient {
  private ws: WebSocket | null = null;
  private reconnectDelay = 1000;
  private maxDelay = 30000;

  connect(url: string): void;
  disconnect(): void;
  send(message: SurfaceToRuntimeMessage): void;

  // Internal: reconnect with exponential backoff + jitter
  private scheduleReconnect(): void;
  private onOpen(): void;   // resets backoff, triggers pending query
  private onMessage(data: MessageEvent): void;
  private onClose(): void;  // schedules reconnect
}
```

On every `onOpen`, the client does NOT request pending contracts.
The Phase 2 server pushes all pending contracts automatically on
every new connection. The client simply receives them.

Reconnect: exponential backoff from 1s → 30s with ±30% jitter.
Backoff resets to 1s on successful reconnect.

Status updates flow into `useSurfaceStore.wsStatus` so the
connection badge in the UI reflects live status.

### Message dispatch

```typescript
// Runtime → Surface (inbound)
type RuntimeMessage =
  | { type: "decision";              contract: BaseContract; a2uiMessages?: ServerToClientMessage[] }
  | { type: "surface_update";        contract: BaseContract; a2uiMessages?: ServerToClientMessage[] }
  | { type: "clarification_answer";  contractId: string; entry: ClarificationEntry }
  | { type: "clear";                 contractId: string; reason: "resolved" | "failed" | "timeout" }
  | { type: "completion";            contractId: string; surface: CompletionSurface }
  | { type: "connector_request";     card: ConnectorCard }
  | { type: "connector_complete";    connectorId: string };

// Surface → Runtime (outbound)
type SurfaceMessage =
  | { type: "engage";             contractId: string; resolverId: string }
  | { type: "ask_clarification";  contractId: string; question: string }
  | { type: "resolve";            contractId: string; action: string; artifacts?: Record<string, unknown> }
  | { type: "abandon";            contractId: string }
  | { type: "initiate_connector"; connectorId: string }
  | { type: "complete_connector"; connectorId: string; credentials?: unknown }
  | { type: "decline_connector";  connectorId: string; never?: boolean };
```

---

## 08 — Surface State Machine

The state machine lives in `App.tsx`, driven by the Zustand store and
incoming WebSocket messages.

```typescript
// State transitions on inbound messages

onDecision(contract):
  if (mode === "silent" || mode === "completion") → mode = "decision"
  else → pendingContracts.push(contract)

onSurfaceUpdate(contract):
  if (mode === "resolver_active" || mode === "clarifying")
    → update contract in store, re-render card

onClarificationAnswer(contractId, entry):
  → mode = "clarifying"
  → append entry to clarifications
  → speak answer via voice engine

onClear(contractId, reason):
  if (pendingContracts.length > 0)
    → pop next, mode = "decision"
  else
    → mode = "silent"

onCompletion(contractId, surface):
  → mode = "completion"
  → speak completion voice line
  → schedule fade to silent after 8s or user dismiss

onConnectorRequest(card):
  → set connectorCard (overlay activates)
  → current mode preserved in connectorUnderlyingMode

onConnectorComplete(connectorId):
  → clear connectorCard
  → restore connectorUnderlyingMode
```

User actions transition state:

```typescript
engage():   send { type: "engage", ... }; mode = "resolver_active"
clarify():  send { type: "ask_clarification", ... }; mode = "clarifying"
resolve():  send { type: "resolve", ... }; mode = "confirming"
abandon():  send { type: "abandon", ... }; mode = "silent"
```

---

## 09 — A2UI Integration and the Aura Catalog

### Why a custom catalog

A2UI's trust model: the client controls which components can be
rendered. Agents can only request components from the client's
registered catalog. An agent cannot generate arbitrary HTML or
execute arbitrary code — it can only compose from approved
primitives.

This matches Aura's security requirements exactly. The Aura catalog
restricts agents to components appropriate for the decision surface:
display components, safe input fields, and structured layout.

The Aura catalog does not include: `Video`, `AudioPlayer`, `openUrl`
function (which could be abused to navigate users to arbitrary URLs).

### `aura-catalog.ts` — registration

```typescript
import { ComponentRegistry, initializeDefaultCatalog } from "@a2ui/react";

export function registerAuraCatalog() {
  // Start from the default basic catalog (Text, Button, Column, etc.)
  initializeDefaultCatalog();

  const registry = ComponentRegistry.getInstance();

  // Override Button to use Aura action dispatch instead of default
  registry.register("ActionButton", { component: AuraActionButton });

  // Aura-specific component: compact key-value pair for contract metadata
  registry.register("ContractMetaRow", { component: ContractMetaRow });

  // Aura-specific component: rich text artifact for email/report editing
  registry.register("ArtifactTextField", { component: AuraArtifactTextField });

  // Aura-specific component: approval chip row
  registry.register("DecisionChips", { component: DecisionChips });
}
```

The `catalogId` used when the plugin generates A2UI surfaces for Aura:
`https://aura-os.ai/a2ui/v1/aura-catalog.json`

### How A2UI renders inside a decision card

When a `decision` message arrives with `a2uiMessages[]`:

```typescript
// ArtifactPanel.tsx
import { A2UIProvider, A2UIRenderer, useA2UI, injectStyles } from "@a2ui/react";

injectStyles(); // once at app startup

function ArtifactPanel({ a2uiMessages, onAction }) {
  const { processMessages } = useA2UI();

  useEffect(() => {
    processMessages(a2uiMessages);
  }, [a2uiMessages]);

  return (
    <A2UIProvider onAction={onAction} theme={auraTheme}>
      <A2UIRenderer surfaceId="artifact" />
    </A2UIProvider>
  );
}
```

The `onAction` callback intercepts button clicks inside the artifact.
For `ActionButton` components the agent embeds in the artifact (e.g.,
"Approve This Draft"), the action dispatches back through the
SurfaceProtocol WebSocket as a `resolve` message — not as an A2UI
client-to-server event. The artifact buttons control the contract
lifecycle, not the A2UI surface lifecycle.

For artifact edits (inline TextField changes), the data model
accumulates in A2UI's local state. On Resolver commit, the PWA
reads the current A2UI data model and attaches it to the `resolve`
message as `artifacts`.

### A2UI theme for Aura

```typescript
// src/a2ui/aura-theme.ts
export const auraTheme = {
  ...litTheme,
  components: {
    ...litTheme.components,
    Button: {
      all: { "aura-btn": true },
      primary: { "aura-btn--primary": true },
      borderless: { "aura-btn--ghost": true },
    },
    Text: {
      all: { "aura-text": true },
    },
    Card: {
      all: { "aura-card": true },
    },
  },
};
```

Colors are provided via CSS custom properties set globally:

```css
:root {
  --n-0: #ffffff;
  --n-900: #0a0a0a;
  --p-500: #6366f1;  /* Aura indigo */
  /* ... full palette */
}
```

---

## 10 — DecisionCard

The `DecisionCard` renders the `surface` field of a `BaseContract`.

```typescript
interface DecisionCardProps {
  contract: BaseContract;
  a2uiMessages?: ServerToClientMessage[];
  mode: "decision" | "resolver_active" | "clarifying" | "artifact_review" | "confirming";
}
```

### Layout

```
┌─────────────────────────────────────────┐
│  [Agent avatar]  Studio Ops             │
│  "voice_line rendered as subtitle"      │
├─────────────────────────────────────────┤
│  Summary paragraph                      │
│                                         │
│  Recommendation:                        │
│  [action label] — [reasoning]           │
│                                         │
│  [Artifact panel if components[] set]   │
│                                         │
│  [Clarification thread if clarifying]   │
├─────────────────────────────────────────┤
│  [Action buttons from surface.actions]  │
│  [Engage] (decision mode only)          │
│  [Abandon] (resolver_active mode)       │
│  [Timeout bar]  (resolver_active mode)  │
└─────────────────────────────────────────┘
```

### ActionBar

`surface.actions[]` drives the action buttons:

```typescript
interface SurfaceAction {
  id: string;
  label: string;
  action: string;
  value?: unknown;
  style?: "primary" | "secondary" | "destructive";
  opens_clarification?: boolean;
  opens_artifact?: string;
}
```

- `opens_clarification: true` → clicking expands `ClarificationThread`
- `opens_artifact: "componentId"` → clicking opens `ArtifactPanel`
  for that specific `ComponentRef`
- Otherwise → resolve immediately with `{ action, value }`

### Timeout bar

The `resolver_active` state has a countdown. The timeout duration
comes from the contract's `expires_at`. The bar depletes in real time.
On expiry, the plugin server sends `clear` with `reason: "timeout"`.
The PWA transitions to Silent on receiving that message, not on
local timer — the server is authoritative on expiry.

---

## 11 — ClarificationThread

Expands inline within the `DecisionCard` when mode is `clarifying`
or when a `opens_clarification` action is taken.

```typescript
interface ClarificationThreadProps {
  clarifications: ClarificationEntry[];
  onSubmitQuestion: (text: string) => void;
  isWaitingForAnswer: boolean;
}
```

- Each entry in `clarifications[]` is rendered as an attributed
  message bubble (Resolver question, agent answer)
- When the Resolver adds a question and sends it, mode stays
  `clarifying`, `isWaitingForAnswer` = true, input locks
- On `onClarificationAnswer` push: answer appends, input unlocks,
  answer is spoken via voice engine
- Multiple clarification rounds supported — the thread accumulates
- The thread does not clear on surface update. `surface_update`
  replaces the card's recommendation panel but the thread persists.

---

## 12 — ArtifactPanel

Hosts the A2UI renderer for artifacts embedded in a contract.

An artifact opens when the Resolver clicks an action with
`opens_artifact` set, or when the contract was already in
`resolver_active` with an artifact pre-selected.

```typescript
interface ArtifactPanelProps {
  a2uiMessages: ServerToClientMessage[];
  onAction: (msg: A2UIClientEventMessage) => void;
  onArtifactChange: (data: Record<string, unknown>) => void;
}
```

The A2UI surface uses `sendDataModel: true` so that when the Resolver
edits fields (typing in a `TextField`, toggling a `CheckBox`), the data
model accumulates locally in A2UI's signal store.

On Resolver commit (`resolve` action), the PWA reads the current
A2UI data model via `getSurface("artifact")` and includes it in the
`resolve` WebSocket message as `artifacts`.

The plugin runtime attaches this to `contract.resume.artifacts` and
the agent receives it when the contract resumes.

---

## 13 — Connector Card

The connector card overlays whatever the current surface state is.
The underlying state is preserved and restored after the connector
flow completes or is declined.

Three connector flow types (from the foundation plan and Phase 2):

### Browser redirect flow

1. The plugin has already registered an HTTP callback route.
2. The `ConnectorCard` renders the connector's `offer_text` and
   a "Connect" button.
3. Owner clicks → PWA sends `initiate_connector` via WebSocket.
4. The plugin responds by calling `openUrl` — the browser navigates
   to the OAuth authorization URL in a new tab.
5. Owner completes OAuth consent in the new tab.
6. Provider redirects to plugin's callback route.
7. Plugin stores encrypted tokens and sends `connector_complete` push.
8. PWA receives `connector_complete`, dismisses overlay, plays
   a brief spoken confirmation.

For macOS, `openUrl` opens the system browser. The in-app experience
is slightly broken (leaves Pulse), but this is accepted for Phase 3.
In-app Canvas navigation is deferred to a future improvement.

### Secure input flow

1. `ConnectorCard` renders a masked `<input type="password">` field.
2. Owner types the API key.
3. Owner submits.
4. PWA sends `complete_connector` with `credentials: { key: value }`.
5. Plugin encrypts and stores the key, sends `connector_complete`.
6. PWA dismisses overlay.

**Security note:** The key travels over localhost WebSocket only.
The WebSocket server binds to localhost (127.0.0.1), not 0.0.0.0.
The connection is same-machine only. The credential is never echoed
back to the PWA in any push message.

### Manual guide flow

1. `ConnectorCard` renders step-by-step instructions the agent wrote.
2. Owner follows them manually (e.g., Poshmark, Mercari — no API).
3. A "Done" button sends `decline_connector` with `never: false`
   to mark it as manually configured.

### Decline behavior

- Decline → sends `decline_connector`, overlay dismisses
- "Never ask again" checkbox → `never: true` sets `never_resurface`
  in contracts.db; the agent never offers this connector again

---

## 14 — History Surface

The history surface is a full-screen overlay over the current state.
It shows completed contracts as rendered UI — ordered by `updated_at`
descending, rendered from the Phase 2 plugin's history HTTP route.

```
GET /aura/history?limit=50&offset=0&type=<optional>
→ JSON array of BaseContract (completed + failed)
```

The plugin registers this HTTP route in Phase 2. Phase 3 consumes it.

History item layout for each contract:

```
┌────────────────────────────────────────┐
│  Type badge    Status badge    Date    │
│  Goal: intent.goal text                │
├────────────────────────────────────────┤
│  Decision made: resume.action          │
│  By: resolver_id  at: resume.timestamp │
│  [Clarification thread if present]     │
│  [Artifact snapshot if resolved with]  │
│  Result: result.summary                │
└────────────────────────────────────────┘
```

The owner sees rendered decisions, not raw JSON. The agent name,
the recommendation, the clarification dialogue, the artifact they
edited, the outcome — all visible in a scannable timeline.

Pagination: load 50 at a time, infinite scroll.

Filter bar: by status (completed, failed), by type, by date range.

---

## 15 — Morning Brief

The morning brief is a scheduled surface. It delivers a structured
summary at the time the agent determines appropriate (typically after
the heartbeat cycle, morning hours).

The Phase 2 plugin sends a `decision` message with a special contract
type `morning-brief`. The PWA detects this type and routes it to
the `MorningBrief` component instead of the standard `DecisionCard`.

```typescript
// morning-brief/MorningBrief.tsx
interface MorningBriefProps {
  contract: BaseContract;  // type: "morning-brief"
}
```

Morning brief contract `surface`:
- `voice_line` — spoken greeting and high-level summary
- `summary` — markdown summary of overnight actions
- `recommendation.context` — structured: `{ autonomous_actions, pending_decisions, patterns_observed }`
- `actions` — typically just `[{ id: "dismiss", label: "Got it", action: "dismiss" }]`

The brief renders:

1. A spoken greeting (voice speaks `voice_line`)
2. "While you were away" section: `autonomous_actions` from the
   `autonomous_log` — formatted, attributed, scannable
3. "Waiting for you" section: count and previews of
   `pending_decisions` (contracts in `waiting_approval`)
4. "I noticed" section: `patterns_observed` — optional agent
   observations that don't require action
5. A single "Got it" button that resolves the brief contract

The "Waiting for you" items link to the full decision cards. Clicking
one dismisses the brief and brings the first pending decision into
the active Decision state.

---

## 16 — Voice Layer

`voice/voice-engine.ts` abstracts the TTS backend.

```typescript
interface VoiceEngine {
  speak(text: string, priority?: "high" | "normal"): Promise<void>;
  cancel(): void;
  isSupported(): boolean;
}
```

### Phase 3 prototype — Web Speech API

```typescript
class WebSpeechEngine implements VoiceEngine {
  speak(text: string): Promise<void> {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.92;
    utterance.pitch = 0.95;
    window.speechSynthesis.speak(utterance);
    return new Promise(resolve => utterance.onend = resolve);
  }

  cancel(): void {
    window.speechSynthesis.cancel();
  }
}
```

Voice is optional — if `isSupported()` returns false, voice is
silently skipped. Never blocks rendering.

`priority: "high"` cancels any in-progress speech before speaking.
Used for Decision entry. `priority: "normal"` queues.

### Production path — ElevenLabs proxy

The Phase 2 plugin registers:
```
POST /aura/tts
Body: { text: string, voiceId?: string }
Returns: audio/mpeg blob
```

The plugin proxies to ElevenLabs using the API key from environment.
The PWA plays the blob directly via `<audio>`.

Phase 3 implements the Web Speech API engine only. The ElevenLabs
engine is wired in a later phase when production voice quality matters.

---

## 17 — On Reconnect Recovery

On every `WebSocket` `onOpen`:

1. The `wsStatus` transitions to `"connected"`.
2. No explicit query needed — the Phase 2 server automatically pushes
   all pending contracts from `getPending()` on every new connection.
3. If the Resolver was mid-engagement when the connection dropped:
   - The contract may have timed out server-side. If so, the server
     sends a `clear` on reconnect.
   - If not timed out, the server re-pushes the contract via `decision`.
   - The PWA handles this as a fresh `decision`, resetting to the
     `decision` (not `resolver_active`) state — the Resolver must
     re-engage.

This is the correct safe behavior. Do not attempt to restore
mid-engagement state on reconnect. The runtime is authoritative.

---

## 18 — Testing Strategy

### Unit tests (Vitest + React Testing Library)

- Surface state machine transitions — every valid transition
- `onDecision` with pending queue — multi-card queue behavior
- `onClear` — advances pending queue
- `DecisionCard` renders from `surface` field correctly
- `ActionBar` dispatches correct WS messages per action type
- `ClarificationThread` appends entries, locks/unlocks on answer
- Connector overlay — all three flow types reach the right state
- History list — renders from mock contract array
- Morning brief — routes to `MorningBrief` on type match
- WebSocket client reconnect — backoff increments correctly
- Voice engine — `speak()` called on Decision entry
- A2UI artifact panel — `processMessages()` called with messages
- Zustand store — state shape does not mutate unexpectedly

### Integration tests (Vitest + msw + ws mock)

- Full Decision → Resolver Active → Clarifying → Resolver Active
  → Confirming → Completion → Silent cycle
- Connector overlay inserted mid-Decision, restored after completion
- Reconnect: server pushes two pending contracts, both queue correctly
- Artifact edit: data model change captured in `resolve` payload
- History load: HTTP route returns, items render

### Manual smoke run

Required manual proof:

1. PWA loads and connects to Phase 2 WebSocket server
2. Primary agent calls `aura_surface_decision`
3. Decision card appears in PWA, voice speaks
4. Resolver engages (click Engage), timeout bar starts
5. Resolver asks clarification, agent answers, answer appears and speaks
6. Resolver commits — `confirming` mode shows
7. Operator resumes via CLI — `clear` arrives — PWA goes Silent
8. `completion` arrives — brief card appears, voice speaks, fades
9. History overlay shows the completed contract
10. Morning brief contract renders the brief surface, dismiss works
11. Connector card overlays, decline closes it, `never` is respected
12. Reconnect: disconnect WebSocket server, restart it, pending contracts
    re-appear without manual refresh

---

## 19 — Build Order

### Step 1 — Scaffold and connect

- Create `packages/pulse-pwa` with Vite + React + TypeScript
- Add pnpm workspace entry
- Implement `ws/client.ts` with reconnect
- Implement `useSurfaceStore` (Zustand) with all state fields
- Wire `App.tsx` to `client.ts`
- Prove: connect to Phase 2 server, receive a pushed contract via CLI

### Step 2 — Silent and Decision states

- Implement `SilentSurface` — connection badge, pulse indicator
- Implement `DecisionCard` — static rendering from `surface` field
- Implement `ActionBar` — buttons fire WS messages
- Wire voice engine — Web Speech API, speaks on Decision entry
- Prove: agent calls tool, card appears, voice speaks, action button
  sends WS message

### Step 3 — Resolver Active and Clarifying

- Implement Engage button → WS `engage` → state transition
- Implement timeout bar (display only; runtime is authoritative)
- Implement `ClarificationThread`
- Implement question input → WS `ask_clarification`
- Handle `clarification_answer` push → answer appends, speaks
- Handle `surface_update` → re-render recommendation without clearing
  clarification thread
- Prove: full clarification round-trip end to end

### Step 4 — Artifact panel (A2UI)

- Install `@a2ui/react` and `@a2ui/web_core`
- Implement `registerAuraCatalog()` — extended basic catalog
- Implement `ArtifactPanel` — `A2UIProvider` + `A2UIRenderer`
- Implement `onAction` → WS `resolve` dispatch for `ActionButton`
- Implement data model capture → attach to `resolve.artifacts`
- Prove: agent sends a contract with `components[]`, artifact renders,
  Resolver edits a field, commit captures the edit in `resolve` payload

### Step 5 — Confirming and Completion states

- Implement `ConfirmingCard` — dimmed card, "Working on it"
- Handle `clear` → advance pending queue or go Silent
- Implement `CompletionCard` — voice speaks, auto-fade after 8s
- Prove: full cycle including Completion and auto-fade to Silent

### Step 6 — Connector card

- Implement `ConnectorCard` overlay
- Implement `BrowserRedirectFlow` — `openUrl` in browser, wait for
  `connector_complete` push
- Implement `SecureInputFlow` — masked input, `complete_connector`
- Implement `ManualGuideFlow` — instruction steps, "Done" dismisses
- Implement decline with `never` flag
- Prove: connector card overlays, all three flows reach terminal state

### Step 7 — History surface

- Register `GET /aura/history` HTTP route in Phase 2 plugin
  (this route returns contracts from `contracts.db`)
- Implement `HistoryOverlay` — full-screen, dismissible
- Implement `HistoryList` — paginated, infinite scroll
- Implement `HistoryItem` — full contract rendered as human-readable
  timeline entry
- Prove: history overlay opens, items load, completed contract from
  the smoke run is visible and rendered

### Step 8 — Morning brief

- Implement `MorningBrief` — routes on `type === "morning-brief"`
- Implement `AutonomousLogEntry` — per-action rows
- Wire "Waiting for you" → pending contract cards linkage
- Prove: plugin sends a morning-brief contract, brief surface renders,
  dismiss resolves the contract, pending contract items are clickable

### Step 9 — PWA hardening

- Add `manifest.json` — PWA installable
- Add `injectStyles()` once at app startup
- Add reconnect visual indicator in `SilentSurface`
- CSS polish — Aura design tokens, dark-first
- Verify voice on/off toggle (some users will not want voice)
- Verify multi-card queue behavior under load
- Final full smoke run against Phase 2 server

---

## 20 — Done Criteria

Phase 3 is done only when all of the following are true:

- PWA connects to Phase 2 WebSocket server and maintains reconnect
- All eight surface states are implemented and transition correctly
- Decision card renders the full `surface` field including voice line,
  recommendation, and action buttons
- Voice speaks on Decision entry and Completion delivery
- Engage, abandon, and timeout transitions work correctly
- Clarification round-trip end to end: question sent, answer received,
  answer spoken, thread updated
- Artifact panel renders A2UI messages via `@a2ui/react` with Aura
  catalog; Resolver edits are captured in resume payload
- All three connector flows reach their terminal state (complete or decline)
- `never_resurface` is respected — declined connector never reappears
- History overlay renders completed contracts as human-readable timeline
- Morning brief surface routes correctly and resolves on dismiss
- Reconnect restores all pending contracts without manual refresh
- Multi-card queue: second decision waits, advances after first resolves
- Voice engine is optional — no voice = no crash, rendering unaffected
- Full manual smoke run passes (see Section 18)

---

## 21 — Open Questions for Early Prototype

These may affect implementation choices. Resolve before Step 4.

**Q1 — A2UI surface IDs per contract**
Each contract may have multiple `ComponentRef` items. Each needs its
own `surfaceId` in the A2UI `createSurface` message. Use
`"artifact-<contractId>-<componentIndex>"` as the `surfaceId` pattern.
Verify `A2UIRenderer` handles multiple surfaces in one `A2UIProvider`.

**Q2 — `processMessages()` with pre-assembled A2UI messages**
The Phase 2 plugin assembles A2UI messages before the `decision` push.
These arrive as a batch. Verify `processMessages()` handles batched
JSONL (array input) correctly — the `@a2ui/react` docs show array
input is supported.

**Q3 — Web Speech API voice quality**
Test with actual `voice_line` strings (longer sentences, proper nouns).
If quality is unacceptable even for prototype, move up the ElevenLabs
proxy to Phase 3. Do not let poor voice quality block the smoke run.

**Q4 — Plugin history HTTP route scope**
The `GET /aura/history` route is technically a Phase 2 addition,
but Phase 2 is already complete. Add this route as a targeted Phase 2
amendment before starting Step 7. It is a read-only query over the
existing `contracts.db` — no schema changes needed.

**Q5 — A2UI v0.10 timeline**
v0.10 is active development. If it stabilizes and ships before
Phase 3 is complete, evaluate migration. Do not migrate speculatively;
wait for a final stable release and a clear upgrade guide.

---

## 22 — A2UI Technical Constraints (Verified)

The following are confirmed from the A2UI documentation and must
be respected in implementation.

- A2UI v0.9 is closed and stable. Build against it.
  Target npm package `@a2ui/react` pinned to v0.9-compatible release.

- `@a2ui/react` requires React 18.x or 19.x. Use 18.x for stability.

- The `@a2ui/web_core` package is a peer dependency of `@a2ui/react`.
  Pin both versions together — the README warns about version drift.

- `injectStyles()` must be called **once** at app startup, before
  any A2UI components render. Place in `src/main.tsx`.

- `initializeDefaultCatalog()` must also be called once at startup,
  before any `A2UIProvider` mounts.

- The `ComponentRegistry` is a singleton — overriding a component
  (e.g., `Button`) affects all surfaces in the app. Use distinct
  component names for Aura-specific variants to avoid collisions.

- Do not register `openUrl` as a function in the Aura catalog.
  This function allows agents to navigate the user's browser. It is
  a security boundary. If link-opening is needed for an artifact,
  route it through an Aura-controlled `ActionButton` action.

- A2UI `sendDataModel: true` sends the full data model with every
  client action. This is the mechanism for capturing artifact edits.
  The plugin must be the `createSurface` originator so it receives
  the data model back. Wire accordingly.

- The `agentDisplayName` field in the A2UI theme identifies the
  agent in the rendered surface. Set to the agent's `identity.name`
  from the `.aurora` manifest. The plugin includes this in the
  A2UI messages it pre-assembles before pushing to the PWA.

---

## 23 — Engram Integration Notes for Phase 3

Phase 3 is the surface layer. Engram integration belongs in Phase 4.
No Engram calls from the PWA.

However: the Phase 3 morning brief surface will reference Engram-
sourced observations in the `patterns_observed` field of the brief
contract. This data is assembled by the agent using Engram's
`memory_search` tool (already exposed by the Engram plugin). The
morning brief contract arrives at the PWA pre-assembled. The PWA
renders it. No Engram API calls from the PWA are needed.

---

*Phase 3 plan complete. Builds on Phase 1 and Phase 2 as locked inputs.*
*Date: March 27, 2026*
