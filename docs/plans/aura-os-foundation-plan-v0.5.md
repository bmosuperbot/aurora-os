# Aura OS — Foundation Plan
**The Contract Layer: Architecture & Implementation**
version: 0.5 — LOCKED FOR IMPLEMENTATION
status: approved

---

## 01 — What We Are Building

Aura OS is a runtime that sits between intent and execution.

The human expresses intent once. The system works continuously without
being asked. It surfaces only what genuinely requires a human call.
Everything else it handles or watches quietly.

The contract layer is the nervous system of that runtime. It is a
protocol — a typed, persistent, observable state object that every
participant in the system reads from and writes to through a defined
interface.

The closest analogy is AWS Step Functions — a deterministic state
machine executor with explicit transitions, full audit trail, and
resumable state — but designed for agents operating on behalf of
real people, not engineers operating Lambda functions. The structural
rigor is identical. The entry point is completely different.

LangGraph's persistence architecture validates the core design: a
checkpointer that stores full operational state at every transition,
separate from the memory layer that stores what's worth keeping
across sessions. We implement this same separation — contracts in
SQLite, memories in engram.

---

## 02 — Design Principles

**Protocol, not implementation.**
Behavior and interfaces defined here. Storage backend, transport,
rendering surface — all replaceable behind the interface.

**Generic and typed.**
Base schema domain-agnostic. Domain-specific types extend it.
Runtime validates both. Nothing stringly typed. Nothing assumed.

**Observable, not polled.**
State changes emit events via signal file. Participants subscribe.
SQLite commits before signal fires — nothing is lost.

**Roles, not positions.**
Writer, Executor, Resolver, Observer. Declared by each participant.
Enforced by the runtime. Role determines what you can read and write.

**Direction of dependency.**
Agents write contracts. Surfaces observe contracts. Memory observes
contracts. Tools execute against contracts. Lower layers never know
about layers above. Dependencies flow downward. Events flow upward.

**Human authority is structural.**
`waiting_approval` is a hard gate. No agent transitions past it
without a valid resume token from a declared Resolver. Enforced by
the runtime, not convention.

**Transparency by default.**
Every autonomous action is logged. The human always knows what the
system did without asking. Trust built through visibility.

**The agent is an employee, not a tool.**
Arrives with its own identity. Its own email. Its own presence.
Does not demand access — earns it. Honest about what it can and
cannot do with what it has been given.

**Access and trust are bidirectional.**
Demonstrates competence before asking for more. Owner extends access
as confidence grows. Neither side assumes. Both sides explicit.

**Connector-aware from day one.**
Every `.aurora` package declares what connectors it needs, which
are required vs optional, and what capability each unlocks.

**Contracts write to SQLite. Memory writes to engram.**
Operational state is the contract store. Worth-keeping signal is
the memory store. They are different concerns. They never overlap.

**Extensible by package.**
Base schema fixed. Domain types declared in `.aurora` packages.
Runtime validates and manages all of it.

---

## 03 — The Storage Architecture

Three databases. Three concerns. Clean separation. No overlap.

```
shared/                          ← symlinked into each agent workspace
  contracts/
    contracts.db                 ← SQLite — all contract operational state
    .signal                      ← touched on every write, triggers watcher
  memory/
    engram/                      ← engram's markdown memory store
      facts/
      entities/
      profile.md
    engram.db                    ← engram's QMD search index
  connectors/
    connectors.db                ← SQLite — connector credential store
```

### Why SQLite for contracts

- Concurrent agent access: SQLite serializes writes automatically
- Query capability: "all contracts in waiting_approval", "history
  for this vendor", "what did the listing-drafter do last week"
- Durability: WAL mode survives gateway restarts mid-execution
- Backup: one file copy. No duplication, no sync.
- LangGraph validated this pattern: same interface, swap to
  Postgres for multi-tenant/cloud without touching the runtime.

### The signal pattern

Every write to contracts.db touches `.signal` after committing.
The file watcher watches only `.signal`. When it fires, the plugin
service queries contracts.db for current state and pushes to the
Pulse PWA via WebSocket. SQLite has already committed before the
signal fires — no data loss on missed signals.

For reconnecting surfaces: on WebSocket connect, the plugin service
immediately pushes any contracts in `waiting_approval`. The signal
is for live updates. The query is for recovery.

### Signal watcher — defensive implementation (required)

Two known failure modes must be handled in the WebSocket server's
watcher implementation:

**The thundering herd problem.** Every signal touch triggers a
SQLite query. If five agents write simultaneously, five queries
fire. The watcher must debounce: implement a 50-100ms debounce
so that bursts of signal touches collapse into a single query.
Five simultaneous writes → one debounced query → one push to the
PWA containing all five updates.

**macOS APFS event batching.** The APFS filesystem can batch
file watcher events. Three agents touching `.signal` in the same
second may produce only one `fs.watch` callback. The debounce
above handles this naturally — but the query must be designed to
catch all changes, not just the most recent one.

**The defensive implementation:**

```typescript
class SignalWatcher {
  private lastCheckedAt: string = new Date(0).toISOString();
  private debounceTimer: NodeJS.Timeout | null = null;

  watch(signalPath: string, onChanges: (contracts: BaseContract[]) => void) {
    fs.watch(signalPath, () => {
      // Debounce — collapse burst into one query
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(async () => {
        // Query only what changed since last check
        const changed = await db.query(
          `SELECT * FROM contracts WHERE updated_at > ?`,
          [this.lastCheckedAt]
        );
        if (changed.length > 0) {
          this.lastCheckedAt = new Date().toISOString();
          onChanges(changed);
        }
      }, 75); // 75ms debounce — responsive but burst-safe
    });
  }
}
```

Key points: the watcher keeps `last_checked_at` in memory and
queries `updated_at > last_checked_at` rather than fetching the
entire contracts table. This prevents the query cost from growing
with contract history. On gateway restart, `last_checked_at`
resets to epoch — the watcher will push all pending contracts
on first fire, which is the correct recovery behavior.

### Why engram for memory

Engram is the memory layer — not operational state, but extracted
signal worth keeping across sessions. It observes completed contracts
and extracts: what was decided, why, what the owner edited, what
the pattern reveals.

Engram's architecture is already the right one:
- LLM-powered extraction runs async — doesn't block agent responses
- Markdown storage — human-readable, portable, ownable, grep-able
- QMD hybrid search (BM25 + vector + reranking) — reliable recall
- 10 memory categories with confidence tiers and TTL
- Entity profiles, contradiction detection, memory linking
- Conversation threading maps to our contract hierarchy

The relationship: engram watches for `contract.completed` events,
queries the full contract from contracts.db, extracts the signal
worth keeping, writes to its markdown store.

### Storage upgrade path

Prototype: SQLite local. Interface abstracted.
Production single-tenant: SQLite — sufficient for all local use.
Production multi-tenant/cloud: Postgres — add `tenant_id` column,
no runtime changes, storage interface swap only.

### LCM compatibility

The dual-state architecture from the LCM paper maps directly:

- Immutable Store → completed contract log in contracts.db
  (every state transition, append-only, never modified)
- Active Context → current contract state + active-context.md
  (what the agent needs right now, kept lean)
- Engram → compressed memory layer beyond Active Context

The structure is LCM-compatible by design. No additional work needed.

---

## 04 — The Agent Identity Model

Every `.aurora` package declares an agent identity. The agent arrives
with its own presence — not a window into the owner's systems but
a participant in them.

```yaml
identity:
  name: Studio Ops
  handle: studio-ops
  role: Sales & Operations Agent
  persona: >
    Calm, organized, detail-oriented.
    Keeps track of everything so the artist doesn't have to.
  voice: identity/voice.profile
  accounts:
    email:
      address: studio-ops@gmail.com
      provider: gmail
      auth: connectors/gmail-agent.yaml
    calendar:
      provider: local
```

### What the agent owns from day one
- Its own email address and inbox
- Its own calendar
- Its own workspace directory
- Its own engram memory store
- Its own credential store

### What the agent does not have from day one
- Access to the owner's email
- Access to any platform or service
- Any knowledge of the business beyond what it is told

---

## 05 — The Multi-Agent Topology

OpenClaw's depth-2 nested sub-agent architecture maps directly to
the `.aurora` agent topology.

```
Depth 0 — Primary Agent
          The owner talks to this agent. Holds active-context.md.
          The ONLY agent that surfaces contracts to the human via
          Pulse. Calls aura_surface_decision. The Resolver's
          counterpart. Receives announce from orchestrator.

Depth 1 — Orchestrator Agent
          Receives tasks from primary. Spawns and coordinates
          worker agents. Synthesizes their results. Announces back
          to primary. Never touches the human directly. Has access
          to sessions_spawn.

Depth 2 — Worker Agents (spawned on demand)
          Specialists. Each does one thing. Announces result to
          orchestrator. Never touches the human. Never calls
          aura_surface_decision. Calls aura_report_to_primary
          for escalation.
```

### Agent topology in the .aurora manifest

```yaml
agents:
  primary:
    id: studio-ops-primary
    depth: 0
    tools:
      - aura_surface_decision    # ONLY primary has this
      - aura_log_action
      - aura_query_contracts
      - aura_query_connections
      - aura_request_connection

  orchestrator:
    id: studio-ops-orchestrator
    depth: 1
    openclaw-config:
      maxSpawnDepth: 2
      maxChildrenPerAgent: 5
    tools:
      - aura_report_to_primary   # escalate without surfacing
      - sessions_spawn

  workers:
    - id: listing-drafter
      depth: 2
      trigger: on-demand
      specialization: draft-listing
    - id: offer-monitor
      depth: 2
      trigger: scheduled
      specialization: monitor-offers
    - id: shipping-tracker
      depth: 2
      trigger: on-demand
      specialization: track-shipments
    - id: platform-monitor
      depth: 2
      trigger: scheduled
      specialization: monitor-platforms
```

### Auth inheritance

OpenClaw merges the primary agent's auth profiles as a fallback for
all sub-agents. Agent profiles override on conflicts. This means:
connector credentials established at the primary level are inherited
by the orchestrator and workers. One OAuth flow, inherited by all.

### The shared workspace — no symlinks

The OpenClaw workspace docs explicitly warn that symlinks resolving
outside the agent workspace are ignored by sandbox seed copies and
may break silently if sandboxing is ever enabled. Symlinks outside
the workspace are brittle. We do not use them.

The correct pattern: Aura's shared data lives entirely outside
OpenClaw's workspace hierarchy, in its own directory. Agents never
touch the shared data directly via filesystem tools. They access
it exclusively through `aura_*` plugin tools, which make all
SQLite calls themselves. No symlinks needed because agents never
need raw file access to contracts.db.

```
~/.aura/                              ← Aura's own data directory
  shared/
    studio-ops/                       ← one per .aurora package instance
      contracts/
        contracts.db                  ← plugin service owns this
        .signal                       ← plugin service touches this
      memory/
        engram/                       ← engram markdown store
        engram.db                     ← engram QMD index
      connectors/
        connectors.db                 ← plugin service owns this

~/.openclaw/                          ← OpenClaw owns this entirely
  workspace/                          ← primary agent workspace
    AGENTS.md
    SOUL.md
    active-context.md                 ← fast working context, agent R/W
  workspace-orchestrator/             ← orchestrator workspace
    AGENTS.md
    active-context.md
  agents/
    studio-ops-primary/
      agent/
        auth-profiles.json            ← primary agent credentials
    studio-ops-orchestrator/
      agent/
        auth-profiles.json            ← inherits from primary as fallback
```

The plugin service is an OpenClaw plugin with full host filesystem
access. It reads and writes `~/.aura/shared/studio-ops/` directly.
Agents call `aura_surface_decision`, `aura_log_action`, etc. —
the plugin service translates those tool calls into SQLite
operations. The agents never need to know where the database lives.

This is also the correct production pattern: when we move to
multi-tenant Postgres, the connection string changes in the plugin
config. No agent AGENTS.md or workspace layout changes at all.

### Two contract types, one schema

**Human-facing contracts** (primary agent only):
- `participants.resolver.type = "human"`
- Surfaced via Pulse PWA
- Requires resume token from human Resolver
- `aura_surface_decision` creates these

**Agent-facing contracts** (workers and orchestrator):
- `participants.resolver.type = "agent"`
- `participants.resolver.id = "studio-ops-primary"`
- Surfaced to primary agent's reasoning context, not to human
- `aura_report_to_primary` creates these
- Primary decides whether to escalate to human

Same contract schema. Different resolver type. The runtime handles
both identically except surface delivery.

---

## 06 — The Connector System

### Two access layers

**Delegated access** — owner routes work to the agent. Forwards
emails, CCs agent on threads, sends direct instructions. Available
from day one. No OAuth. The foundation of the working relationship.

**Service connectors** — proactive integrations. Agent watches
without being asked. Requires OAuth or API keys. Earned through
demonstrated value with delegated access first.

### OpenClaw channel connectors (use existing)

For services OpenClaw already has channel support for — Gmail,
Google Calendar, Google Drive, Slack, GitHub — use OpenClaw's
existing OAuth infrastructure. The agent's own Gmail account is
set up as an OpenClaw channel. Auth inherits to sub-agents.

```yaml
connectors:
  - id: gmail-agent
    source: openclaw-channel    # use OpenClaw's Gmail channel
    notes: "agent's own account, not owner's"

  - id: google-calendar
    source: openclaw-channel

  - id: google-drive
    source: openclaw-channel
    unlocks-agent: grant-writer  # enables co-agent capability
```

### Aura-custom connectors (build our own)

For services OpenClaw doesn't support — Etsy, Poshmark, Mercari,
Shippo, Yelp — stored in connectors.db with encrypted token column.

```yaml
  - id: etsy
    source: aura-connector
    auth: oauth
    flow: browser-redirect
    scopes-plain:
      - "Read your Etsy listings"
      - "Read orders and transactions"
    offer-trigger: "Etsy or selling mentioned"

  - id: shippo
    source: aura-connector
    auth: api-key
    flow: secure-input
    offer-trigger: "shipping or labels mentioned"
```

### Connector state in contracts.db

Connector state lives in contracts.db — one database, one backup.

```typescript
interface ConnectorState {
  id: string;
  // openclaw-channel: OpenClaw manages OAuth (Gmail, Calendar, Drive, Slack)
  // aura-connector:   REST API; Aura holds the key (Etsy, eBay, Shippo)
  // aura-skill:       Official CLI tool manages its own auth (gog, stripe CLI)
  // aura-app:         No API; browser automation via pm2/docker process
  source: "openclaw-channel" | "aura-connector" | "aura-skill" | "aura-app";
  status: "active" | "pending" | "declined" | "error" | "not-offered";
  offered_at?: string;
  connected_at?: string;
  declined_at?: string;
  declined_reason?: string;
  never_resurface?: boolean;
  resurface_trigger?: string;
  capability_without: string;
  capability_with: string;
  // aura-connector fields
  oauth_token?: string;         // encrypted
  refresh_token?: string;       // encrypted
  expires_at?: string;
  // aura-app fields
  process_manager?: "pm2" | "docker"; // detected at deploy time
  app_path?: string;            // ~/.aura/projects/<workspace>/apps/<name>/
}
```

### Auth flows

**openclaw-channel** — use OpenClaw's existing OAuth. Plugin reads
credentials from `api.runtime.agent.resolveAgentDir()` auth store.

**browser-redirect** — register HTTP callback route via
`registerHttpRoute`. Construct OAuth authorization URL. Open via
system browser (`openUrl` from provider-auth SDK) or embedded
WebView in Pulse PWA. Receive callback. Exchange code. Store
encrypted tokens in connectors.db.

**secure-input** — Pulse PWA renders masked input card. Owner
types key. Returns via WebSocket. Plugin stores encrypted in
connectors.db.

**aura-skill** — CLI tool manages its own auth (e.g. gog, stripe CLI).
Plugin calls the CLI via exec tool (allowlisted). No token stored in
contracts.db — the CLI keychain owns the credential.

**manual-guide** — API key entered via secure-input card, or initial
setup guided verbally. Used for Etsy (Phase 4 initial), eBay (Phase 5
OAuth replaces this). Not used for Poshmark or Mercari — those are
`aura-app` (browser automation), not connector flows.

---

## 07 — The Onboarding Flow

### The agent arrives knowing it has nothing

The agent's first words establish its starting position honestly.
It is an employee on day one. It knows what it can and cannot do.
It has a plan for getting from zero access to genuinely useful.

### The capability picture

The agent holds two simultaneous models throughout onboarding and
all subsequent operation:

**Current capability** — what it can do right now with exactly
what it has been granted.

**Full capability plan** — what becomes possible as each additional
connector is granted, explained in business value terms.

### Onboarding movements

1. **Arrival** — arrive, state zero-access position honestly, invite
   conversation about the business. Not a feature tour. A meeting.

2. **Listening** — understand the business from conversation alone.
   Extract to active-context.md continuously. Generate visuals when
   judgment says a visual adds value (model decides, not keywords).
   Offer connectors only when directly relevant to what was just said.

3. **First connections** — if owner accepts a connector, complete
   the flow immediately. Demonstrate the new capability live.
   The demonstration is the value proof.

4. **Capability plan** — reflect current state and the path forward.
   What you can do now. What each pending connector unlocks. Specific,
   not a feature list.

5. **Permission setting** — establish autonomous vs approval-required
   per service, per action type. Not global. Specific.

6. **Handoff** — go to work with what's been granted. Interface fades.

### Connection flows in onboarding

Connection cards appear in the Pulse surface — same surface as
decision cards. One consistent experience. The owner never leaves
the Aura surface for connector flows.

"Don't Ask Again" — `never_resurface: true` written to connector
state in contracts.db. The agent never offers that connector again
unless the owner explicitly asks about it.

On completion — agent immediately demonstrates the new capability.
Live data. The agent narrates what it can now see and watch.

---

## 08 — The State Machine

Every contract is a state machine. Valid transitions enforced by
the runtime. Invalid transitions rejected and logged.

```
                    ┌─────────┐
                    │ CREATED │
                    └────┬────┘
                         │ writer submits
                    ┌────▼────┐
                    │  ACTIVE │◄──────────────────────┐
                    └────┬────┘                        │
                         │                             │
               ┌─────────▼──────────┐                  │
               │  WAITING_APPROVAL  │◄─────────────┐   │
               │  (may be deferred) │              │   │
               └─────────┬──────────┘              │   │
                         │ resolver engages         │   │
               ┌─────────▼──────────┐              │   │
               │  RESOLVER_ACTIVE   │              │   │
               │  ┌──────────────┐  │              │   │
               │  │  CLARIFYING  │  │──────────────┘   │
               │  └──────────────┘  │  surface updated  │
               └─────────┬──────────┘                   │
                         │ resolver commits              │
               ┌─────────▼──────────┐                   │
               │     EXECUTING      │───────────────────┘
               └─────────┬──────────┘  subtask spawned
                ┌────────▼────────┐
                │    COMPLETE     │
                └─────────────────┘

        At any state except COMPLETE:
                    ┌────────┐
                    │ FAILED │──► recovery contract
                    └────────┘
```

### State definitions

| State | Meaning | Who can write |
|---|---|---|
| `created` | Initialized, intent declared | Writer |
| `active` | Agent working | Writer, Executor |
| `waiting_approval` | Surface published, awaiting Resolver | Runtime only |
| `resolver_active` | Resolver engaged, deciding | Resolver, Writer (clarification) |
| `clarifying` | Dialogue in progress | Resolver, Writer |
| `executing` | Approved action in flight | Executor |
| `complete` | Terminal | Runtime only |
| `failed` | Terminal or recoverable | Runtime |

### Valid transitions

| From | To | Trigger |
|---|---|---|
| `created` | `active` | Writer submits |
| `active` | `waiting_approval` | Agent calls `surface_decision` |
| `active` | `complete` | Agent resolves autonomously |
| `active` | `failed` | Unrecoverable error |
| `waiting_approval` | `resolver_active` | Resolver engages |
| `waiting_approval` | `failed` | TTL expires |
| `resolver_active` | `clarifying` | Resolver asks a question |
| `resolver_active` | `executing` | Resolver commits |
| `resolver_active` | `waiting_approval` | Resolver abandons (timeout) |
| `clarifying` | `resolver_active` | Agent answers, surface may update |
| `executing` | `active` | Subtask spawned |
| `executing` | `complete` | Success |
| `executing` | `failed` | Error |
| `failed` | `active` | Human instructs retry |

### Deferred surfacing

`surface_after` timestamp defers presentation. TTL begins at
`waiting_approval` creation, not at presentation. The contract
is real and waiting — it is simply not yet shown to the Resolver.

Used for: "don't wake me before 8am" — contract enters
`waiting_approval` at 11pm, `surface_after` set to 8am.

---

## 09 — The Base Contract Schema

```typescript
interface BaseContract {
  // Identity
  id: string;                    // unique deterministic slug
  version: string;               // schema version "1.0"
  type: string;                  // domain type, registered by .aurora

  // Lifecycle
  status: ContractStatus;
  created_at: string;            // ISO-8601
  updated_at: string;
  expires_at?: string;           // TTL — begins at waiting_approval
  surface_after?: string;        // defer presentation

  // Participants
  participants: {
    writer: ParticipantRef;
    executor?: ParticipantRef;
    resolver: ParticipantRef;    // human OR agent
  };

  // Intent
  intent: {
    goal: string;
    trigger: string;
    context: Record<string, unknown>;
  };

  // Decision surface — mutable during resolver_active/clarifying
  surface?: {
    voice_line: string;          // spoken reasoning (human contracts only)
    summary: string;
    recommendation: {
      action: string;
      value?: unknown;
      reasoning: string;
    };
    actions: SurfaceAction[];
    components?: ComponentRef[]; // a2ui visual artifacts
    version: number;             // incremented on each update
  };

  // Clarification log — append-only, attributed, immutable
  clarifications?: ClarificationEntry[];

  // Resume — populated when Resolver commits
  resume?: {
    action: string;
    value?: unknown;
    timestamp: string;
    resolver_id: string;
    artifacts?: Record<string, unknown>; // edited by Resolver
  };

  // Completion surface — delivered after complete
  completion_surface?: {
    voice_line: string;
    summary: string;
  };

  // Result
  result?: {
    success: boolean;
    summary: string;
    artifacts?: Record<string, unknown>;
  };

  // Hierarchy
  parent_id?: string;
  child_ids?: string[];
  recovery_of?: string;

  // Audit — append-only rows in contract_log table
  // (not embedded in contract row — separate table in contracts.db)
}

interface ParticipantRef {
  id: string;
  type: "agent" | "human" | "system";
  package?: string;
}

interface SurfaceAction {
  id: string;
  label: string;
  action: string;
  value?: unknown;
  style?: "primary" | "secondary" | "destructive";
  opens_clarification?: boolean;
  opens_artifact?: string;
}

interface ClarificationEntry {
  id: string;
  timestamp: string;
  participant: string;
  role: "question" | "answer" | "surface_update";
  content: string;
  surface_version?: number;
}

interface ComponentRef {
  tool: string;
  data: Record<string, unknown>;
  returns: "a2ui";
}
```

### contracts.db schema (SQLite)

```sql
-- Core contract state
CREATE TABLE contracts (
  id TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  resolver_type TEXT NOT NULL,   -- 'human' or 'agent'
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT,
  surface_after TEXT,
  parent_id TEXT,
  recovery_of TEXT,
  payload JSON NOT NULL           -- full BaseContract as JSON
);

-- Append-only audit log (separate table for performance)
CREATE TABLE contract_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  participant TEXT NOT NULL,
  event TEXT NOT NULL,
  detail JSON,
  FOREIGN KEY (contract_id) REFERENCES contracts(id)
);

-- Autonomous action log
CREATE TABLE autonomous_log (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  package TEXT NOT NULL,
  action TEXT NOT NULL,
  summary TEXT NOT NULL,
  detail JSON,
  contract_id TEXT,
  connector_used TEXT
);

-- Connector state
CREATE TABLE connectors (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  status TEXT NOT NULL,
  offered_at TEXT,
  connected_at TEXT,
  declined_at TEXT,
  declined_reason TEXT,
  never_resurface INTEGER DEFAULT 0,
  resurface_trigger TEXT,
  capability_without TEXT,
  capability_with TEXT,
  oauth_token_enc TEXT,          -- encrypted
  refresh_token_enc TEXT,        -- encrypted
  expires_at TEXT,
  updated_at TEXT NOT NULL
);

-- Indexes for common queries
CREATE INDEX idx_contracts_status ON contracts(status);
CREATE INDEX idx_contracts_resolver_type ON contracts(resolver_type);
CREATE INDEX idx_contracts_parent_id ON contracts(parent_id);
CREATE INDEX idx_contracts_surface_after ON contracts(surface_after);
CREATE INDEX idx_contract_log_contract_id ON contract_log(contract_id);
CREATE INDEX idx_autonomous_log_agent ON autonomous_log(agent_id, timestamp);
```

---

## 10 — The Contract Runtime

The runtime enforces. It does not reason.

### Responsibilities

- Schema validation against base + registered domain type
- State transition enforcement — invalid transitions rejected
- Signal file touch on every write — after SQLite commit
- Deferred surface management — `surface_after` respected
- Clarification routing — questions from Resolver to Writer,
  answers and surface updates back
- Durable event emission via signal + WebSocket push
- Single-use resume token generation and validation
- Hierarchy management — parent/child linking
- TTL enforcement — `waiting_approval` beyond `expires_at` → `failed`
- Resolver timeout — `resolver_active` inactivity → `waiting_approval`
- Completion surface delivery after `complete`
- Engram notification on `complete` — for memory extraction

### Interface

```typescript
interface ContractRuntime {
  // Write — role-checked
  create(contract: BaseContract): Promise<void>;
  update(id: string, patch: ContractPatch, role: ParticipantRole): Promise<void>;
  transition(id: string, to: ContractStatus, role: ParticipantRole): Promise<void>;
  resume(id: string, token: ResumeToken): Promise<void>;

  // Clarification
  askClarification(id: string, question: string, resolverId: string): Promise<void>;
  answerClarification(id: string, answer: string, agentId: string): Promise<void>;
  updateSurface(id: string, surface: ContractSurface, agentId: string): Promise<void>;

  // Read
  get(id: string): Promise<BaseContract | null>;
  list(filter?: ContractFilter): Promise<BaseContract[]>;
  getPending(): Promise<BaseContract[]>; // waiting_approval, past surface_after

  // Autonomous log
  logAutonomousAction(entry: AutonomousLogEntry): Promise<void>;
  getAutonomousLog(filter?: LogFilter): Promise<AutonomousLogEntry[]>;

  // Observable — via signal file + WebSocket push
  // (not a direct subscribe — consumers watch the WebSocket)

  // Type registry
  registerType(type: ContractTypeDefinition): void;

  // Connector registry
  getConnectors(): Promise<ConnectorState[]>;
  updateConnector(id: string, patch: ConnectorPatch): Promise<void>;
}
```

### Storage interface (abstracted for future swap)

```typescript
interface ContractStorage {
  // contracts table
  write(contract: BaseContract): Promise<void>;
  read(id: string): Promise<BaseContract | null>;
  query(filter: ContractFilter): Promise<BaseContract[]>;

  // contract_log table
  appendLog(entry: ContractLogEntry): Promise<void>;
  queryLog(contractId: string): Promise<ContractLogEntry[]>;

  // autonomous_log table
  writeLog(entry: AutonomousLogEntry): Promise<void>;
  queryLog(filter?: LogFilter): Promise<AutonomousLogEntry[]>;

  // connectors table
  writeConnector(state: ConnectorState): Promise<void>;
  readConnectors(): Promise<ConnectorState[]>;

  // Signal
  touchSignal(): Promise<void>;         // after every write
}
```

Prototype: `SQLiteContractStorage` implementing this interface.
Production upgrade: `PostgresContractStorage` — same interface,
add `tenant_id` column everywhere.

---

## 11 — The Autonomous Action Log

Pre-authorized actions below approval threshold produce log entries.

```typescript
interface AutonomousLogEntry {
  id: string;
  timestamp: string;
  agent_id: string;
  package: string;
  action: string;
  summary: string;
  detail?: Record<string, unknown>;
  contract_id?: string;
  connector_used: string;
}
```

Surfaced in morning brief as a summary. Full detail via history
surface. Never silent. Always traceable. The foundation of trust.

---

## 12 — The Surface Protocol

Any surface implementing this interface is a valid Resolver.
Pulse PWA, WhatsApp, iMessage, voice call, email with approve links.

```typescript
interface SurfaceProtocol {
  // Runtime → Surface (via WebSocket push)
  onDecision(contract: BaseContract): void;
  onSurfaceUpdate(contract: BaseContract): void;
  onClarificationAnswer(contractId: string, entry: ClarificationEntry): void;
  onClear(contractId: string, reason: "resolved" | "failed" | "timeout"): void;
  onCompletion(contractId: string, surface: CompletionSurface): void;
  onConnectorRequest(card: ConnectorCard): void;
  onConnectorComplete(connectorId: string): void;

  // Surface → Runtime (via WebSocket message)
  engage(contractId: string, resolverId: string): Promise<void>;
  askClarification(contractId: string, question: string): Promise<void>;
  resolve(
    contractId: string,
    action: string,
    artifacts?: Record<string, unknown>
  ): Promise<void>;
  abandon(contractId: string): Promise<void>;
  initiateConnector(connectorId: string): Promise<void>;
  completeConnector(connectorId: string, credentials?: unknown): Promise<void>;
  declineConnector(connectorId: string, never?: boolean): Promise<void>;
}
```

### On reconnect

When the Pulse PWA connects or reconnects, the plugin service
immediately queries `getPending()` and pushes any contracts in
`waiting_approval` that are past their `surface_after` time.
Nothing is lost on disconnect.

---

## 13 — Memory Integration (Engram)

Engram is an Observer. It watches for `contract.completed` events.
The contract runtime notifies engram after writing `status: complete`
to contracts.db. Engram queries the full contract, extracts signal,
writes to its markdown store.

### What engram extracts from contracts

For the artist reseller:
- Buyer negotiation patterns per platform
- Which listing categories perform best
- Owner's counter-offer preferences and editing patterns
- Shipping carrier preferences
- Platform response time patterns

For the non-profit:
- Grant funder preferences and deadlines
- Volunteer reliability and skills
- Donor giving patterns
- Board member communication styles

### Engram advanced features relevant to Aura

**Contradiction detection** — if the owner approved a counter at
$45 last month but declines a similar counter this month, engram
surfaces the contradiction for the agent's awareness.

**Memory linking** — the relationship between a vendor negotiation
contract and a shipping delay contract from the same vendor is
captured as a typed link.

**Commitment lifecycle** — when the owner makes an explicit
commitment ("always get my approval for orders over $500") engram
tracks it with a 90-day decay unless reconfirmed.

**Entity profiles** — every vendor, buyer, volunteer, and donor
accumulates a profile in engram. The agent knows their history.

### Direction of dependency (enforced)

The contract runtime does NOT call engram directly. The runtime
emits a completion notification. Engram listens. Engram reads
contracts.db. Engram writes to its own store. These are the only
data flows permitted.

---

## 14 — The OpenClaw Plugin Architecture

```
OpenClaw (existing multi-agent setup)
└── aura-pulse plugin
    ├── setup-entry.ts           ← lightweight, loads first
    │   └── registerHttpRoute    ← Pulse PWA static files
    └── index.ts                 ← full entry, loads after gateway
        ├── ContractRuntime      (background service via registerService)
        │   ├── SQLiteStorage    (injected ContractStorage impl)
        │   ├── SignalWriter     (touches .signal after writes)
        │   └── EngramNotifier   (notifies engram on completion)
        ├── WebSocketServer      (background service, port 7700)
        │   ├── SignalWatcher    (watches .signal, triggers push)
        │   └── SurfaceProtocol (implements push and receive)
        ├── ConnectorManager
        │   ├── OpenClawChannelConnector  (reads existing auth)
        │   └── AuraConnectorStore       (manages connectors.db)
        └── Tools
            ├── aura_surface_decision    (primary agent only)
            ├── aura_report_to_primary   (orchestrator + workers)
            ├── aura_log_action
            ├── aura_query_contracts
            ├── aura_request_connection
            └── aura_query_connections
```

### Plugin split: setup-entry vs full entry

**setup-entry.ts** — registers HTTP route for Pulse PWA static files.
Loads during pre-listen gateway startup. No heavy dependencies.

**index.ts** — registers all services and tools. Loads after gateway
is listening. ContractRuntime, WebSocketServer, ConnectorManager
all start here.

### SDK imports (2026.3.22+ compatible)

```typescript
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { defineSetupPluginEntry } from "openclaw/plugin-sdk/core";
import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";
import { upsertAuthProfile } from "openclaw/plugin-sdk/provider-auth";
```

Never import from `openclaw/extension-api` (removed) or
`openclaw/plugin-sdk/compat` (deprecated). These will break.

### Workspace paths

Never hardcode paths. Always use:
```typescript
api.runtime.agent.resolveAgentWorkspaceDir(agentId)
// Returns: ~/.openclaw/agents/<agentId>/workspace/
// shared/ symlink inside this directory points to shared storage
```

---

## 15 — The Pulse PWA

React PWA. WebSocket client implementing full SurfaceProtocol.
Standalone — not OpenClaw Canvas. Connects to WebSocket on port 7700.
Served as static files by the plugin's HTTP route.

### Surface states

| State | Description |
|---|---|
| Silent | Connected, listening, nothing rendered |
| Decision | Contract in presentation window — card, voice, actions |
| Resolver Active | Resolver engaged, timeout running, card locked |
| Clarifying | Inline dialogue within the card, scoped to this contract |
| Artifact Review | Resolver editing an artifact (draft email, report) |
| Confirming | Resume token sent, awaiting runtime confirmation |
| Completion | Voice confirms action and next watch, card fades |
| Connector | Connection card — browser redirect, secure input, or guide |

### Voice layer

System TTS for prototype. ElevenLabs for production.
Voice speaks `voice_line` on Decision state entry.
Voice speaks `completion_surface.voice_line` on Completion.
Clarification answers from agent are spoken in the card.

### History surface

Separate view (not a state). Shows completed contracts as rendered
UI — timeline, decision details, clarification dialogue, what was
sent, outcome. Not a file viewer. Rendered from contracts.db query.

The owner never sees raw JSON or markdown. They see rendered history.

---

## 16 — The Real Use Cases

### Use Case A — The Artist Reseller

Sole proprietor selling art and vintage clothing on Poshmark, Etsy,
and Mercari.

**Primary contract types:**
- `offer-received` — buyer made an offer, agent recommends
  accept/counter/decline with reasoning and draft response
- `listing-draft` — agent drafted a listing, owner reviews before
  publishing
- `shipping-delay` — package flagged late, agent drafts customer
  message
- `inventory-alert` — item category outperforming, restock suggestion

**OpenShell future capability:** when deployed on Linux/DGX Spark,
`.aurora` connector declarations auto-generate OpenShell network
policy — Etsy API access mapped to `network_policies.etsy`, Gmail
mapped to `network_policies.gmail`. The connector list becomes the
security policy without additional configuration.

### Use Case B — The Beach Cleaning Non-Profit

Small non-profit organizing beach cleaning events. Grant-funded.

**Primary contract types:**
- `grant-report-draft` — agent compiled report from Drive data,
  director reviews inline before submitting
- `donor-acknowledgment-batch` — agent drafted batch of letters,
  director spot-checks a sample before batch send
- `volunteer-onboarding` — new application, agent drafted welcome
  sequence, director approves
- `board-prep` — meeting minutes drafted from audio transcript,
  director reviews

---

## 17 — Build Sequence

### Phase 1 — Contract runtime core
**Target: pure runtime, no UI, no agent integration**

- contracts.db schema — four tables, indexes
- SQLiteContractStorage implementing ContractStorage interface
- SignalWriter — touches .signal after every SQLite commit
- ContractRuntime — state machine, role enforcement, TTL, timeout
- Resume token — UUID v4, single-use, stored in contracts table
- Clarification routing — in-process, routes questions and answers
- Deferred surfacing — `surface_after` respected in `getPending()`
- Hierarchy management — parent/child linking, failure propagation
- Completion notification interface — pluggable, engram hooks here
- TypeRegistry — register domain contract types from .aurora packages
- ConnectorState CRUD in contracts.db

**Tests:**
- Every valid state transition
- Every invalid transition (rejected with typed error)
- Deferred surfacing — contract holds until surface_after
- Resolver timeout — returns to waiting_approval
- Clarification round-trip — question, answer, surface update
- Resume token — single-use validation, replay rejected
- TTL expiry — contract fails when expires_at passed
- Concurrent writes — SQLite serialization verified
- Signal touch — fires after commit, not before
- Artist reseller offer contract end-to-end
- Non-profit grant draft contract end-to-end

**Done when:** Both use case contracts traverse all states in tests.
Pure runtime. No UI. No agent. No OpenClaw.

### Phase 2 — OpenClaw plugin
**Target: agent can call tools, contracts flow, connector flows testable**

- Plugin scaffold — `openclaw/plugin-sdk/*` imports only
- setup-entry.ts — HTTP route for Pulse PWA static files
- index.ts — full entry, all services and tools
- ContractRuntime registered as `registerService`
- WebSocketServer registered as `registerService`
- SignalWatcher — watches .signal, queries getPending(), pushes WS
- Five primary agent tools registered
- Two orchestrator/worker tools registered
- ConnectorManager — OpenClawChannelConnector + AuraConnectorStore
- File Bridge tools registered: `aura_fs_read`, `aura_fs_write`,
  `aura_fs_patch`, `aura_fs_move`, `aura_fs_delete`, `aura_fs_list`,
  `aura_fs_archive`, `aura_fs_search`
- PARA directory tree created at package install time
- file_locks table added to contracts.db
- Chokidar watcher started as part of plugin service
- Path jail enforced on all fs tools
- diff-match-patch integrated for fuzzy search/replace matching
- Local install via `--link`
- Smoke test: agent calls `aura_surface_decision`, contract reaches
  `waiting_approval`, resume via CLI, agent continues

**Prototype open questions to verify:**
- Can `registerHttpRoute` handle WebSocket upgrade? If not, WS
  server runs on separate port (7700) — this is the expected answer
- Is Canvas navigation needed? No — we're building our own PWA
- `registerService` crash recovery — test and document behavior

**Done when:** All tools callable. Signal fires on writes. Resume
works via CLI. Engram receives completion notifications.

### Phase 3 — Pulse PWA
**Target: full lifecycle works end to end with generic contracts**

- React PWA scaffold
- WebSocket client — full SurfaceProtocol implementation
- All surface states — Silent through Completion
- Voice layer — system TTS prototype, ElevenLabs production path
- DecisionCard — renders from contract surface schema
- Clarification inline dialogue — expands within card
- Artifact review and edit — inline editor, artifact attaches to resume
- Connector card — all flow types (browser redirect, secure input)
- History surface — rendered UI from contracts.db query
- On reconnect — receives pending contracts immediately
- Morning brief surface — scheduled, autonomous log + observations

**Done when:** Full lifecycle including clarification and connector
flow works end to end with generic contracts.

### Phase 4 — Artist reseller scenario
**Target: real email, real decision, full six-beat demo**

- `offer-received`, `listing-draft`, `shipping-delay`, `inventory-alert`
  domain types registered and tested
- Artist reseller `.aurora` package scaffold with `aurora.manifest.yaml`,
  `aurora-registry.json`, `openclaw.json.template`, `aura-app` stub
- Gmail via gog/Pub/Sub: `gog gmail watch serve` daemon → `POST /hooks/gmail`
  → OpenClaw mapping → agent turn. No custom OAuth. Agent is the email
  parser. One-time setup via `openclaw webhooks gmail setup` wizard.
- Etsy connector (aura-connector, manual-guide API key flow),
  `aura_query_listing` tool for live asking price
- `aurora-registry.json` bootstrap: installs required plugins via
  `openclaw plugins install` at gateway start; writes `plugins.allow`
  to `openclaw.json` (walled garden enforcement delegated to OpenClaw)
- Pulse onboarding surface: registry install checklist, optional items
  tap-to-install. User never sees a terminal.
- Response dispatch: after Resolver commits, agent calls `gog gmail reply`
  via exec tool to send from agent's Gmail account
- End-to-end: forwarded email → agent reasons → contract created →
  deferred to owner's wake time → card appears → voice speaks →
  Resolver engages → clarification if needed → Resolver edits draft →
  commits → response sent from agent address → completion voice →
  card clears → engram extracts buyer pattern

**Done when:** Full six-beat demo cycle runs on a real forwarded email.

### Phase 5 — Multi-platform `.aurora` real build
**Target: connector patterns harden, npm packages ship, aura-app proven**

- Extract Phase 4 Etsy built-in → `@aura/etsy-connector` npm package
  (proper structure, tests, published to npm, installed via
  `openclaw plugins install @aura/etsy-connector`)
- `@aura/ebay-connector` — eBay OAuth 2.0 user token flow; first real
  OAuth `aura-connector`; hardens the browser-redirect auth pattern
- `@aura/poshmark-app` — Poshmark `aura-app`; Fastify + Lobster pipelines;
  approval gates wired to Aura contracts instead of Telegram
- `@aura/mercari-app` — Mercari `aura-app`; same scaffold as Poshmark;
  different selectors
- eBay `offer-received` platform variant fields: `ebay_item_id`,
  `ebay_order_id`
- `aurora.manifest.yaml` with five real connectors: gmail, etsy, ebay,
  poshmark-app, mercari-app — this is where manifest bugs surface
- `aura_install_expert` tool — Pulse Expert Store install flow;
  validates purchase, appends to `plugins.allow`, calls install CLI
- Pulse Expert Store surface — browse and tap-to-install certified packages
- Multi-connector state management in Pulse onboarding checklist

**Done when:** All five connectors active in one `.aurora` instance.
Expert Store install flow works end to end. First `@aura/` npm packages live.

### Phase 6 — Non-profit scenario
**Target: second vertical proves generality**

- `grant-report-draft` and `donor-acknowledgment-batch` types
- Non-profit `.aurora` package scaffold
- Google Drive connector (openclaw-channel)
- End-to-end: agent compiles report from Drive data → draft contract
  → director reviews inline → edits document → commits → report saved
  → engram extracts grant writer profile

**Done when:** Second scenario runs without Phase 1-2 changes.
The generality of the foundation is proven.

### Phase 7 — Onboarding flow
**Target: cold start to first autonomous action**

- Onboarding YAML for both packages
- Voice conversation loop in Pulse
- Connector cards offered during conversation
- active-context.md written throughout, final state on handoff
- Engram seeded from onboarding conversation
- First heartbeat scheduled on handoff
- Morning brief delivered after first night of operation

**Done when:** A completely cold start — no prior context — runs
through onboarding, connects at least one service, produces a real
autonomous action log entry, and delivers a morning brief.

---

## 18 — The File Bridge & PARA Directory Architecture

### Why a brokered filesystem

OpenClaw's workspace is intentionally contained. That containment is
correct for the agent's own operational files — AGENTS.md, SOUL.md,
active-context.md, session transcripts. But it creates a gap for
shared work: code projects, research artifacts, listing drafts,
grant reports. When multiple agents need to read and write the same
files, and external CLI agents (Claude Code, OpenCode) also need
access, a shared directory outside any agent workspace is required.

The answer is not symlinks. OpenClaw explicitly states that symlinks
resolving outside the workspace are ignored by sandbox seed copies
and may break silently if sandboxing is enabled. We do not use
symlinks anywhere.

The answer is the File Bridge: a brokered filesystem layer in the
aura-pulse plugin that translates agent tool calls into safe, logged,
and signaled OS operations on a shared project directory.

### Two access paths, one directory

```
~/.aura/projects/studio-ops/        ← PROJECT_ROOT
```

**Path A — OpenClaw agents via File Bridge tools**
Agent calls `aura_fs_patch` → plugin validates path against
PROJECT_ROOT → executes write → logs to contracts.db → touches
`.signal` → all agents notified.

**Path B — External CLI agents (Claude Code, OpenCode) via direct access**
Orchestrator spawns Claude Code via ACP with PROJECT_ROOT as cwd →
Claude Code writes directly to disk → Chokidar detects the change →
plugin logs the external write to contracts.db with
`source: external-cli` → touches `.signal` → all agents notified.

Both paths end at the same place. The `.signal` fires. contracts.db
has the record. Every agent sees the update regardless of whether
it came from the broker or from an external CLI.

### The PARA directory structure

PARA — Projects, Areas, Resources, Archive — organizes by
actionability, not by topic. This maps naturally to how an agent
team actually works.

```
~/.aura/
  projects/
    studio-ops/                    ← one per .aurora package instance
      projects/                    ← active work, defined completion state
        2026-03-poshmark-redesign/
          brief.md
          tasks.md                 ← contract IDs referenced here
          src/                     ← code if applicable
          .aura/
            .signal                ← project-scoped signal
            locks/                 ← ephemeral write locks
        2026-03-spring-collection/
          listing-drafts/
          photography-brief.md

      areas/                       ← ongoing responsibilities, no done state
        inventory/
          thresholds.yaml
          last-check.md            ← updated by inventory sub-agent each run
        reviews/
          response-templates.md
          pending-responses.md
        platforms/
          etsy-performance.md
          poshmark-performance.md

      resources/                   ← reference, research, accumulated knowledge
        research/
          2026-03-24-pricing-analysis.md   ← research agent writes here
          2026-03-etsy-seo-recommendations.md
        style-guide/
          listing-voice.md
          photography-standards.md
        owner-preferences.md       ← distilled from engram for quick access

      archive/                     ← completed projects, old research
        2026-02-winter-collection/
        .trash/                    ← soft deletes land here, not rm -rf
```

### What each PARA layer means for agents

**Projects** — active work with a contract attached. An orchestrator
spawns workers here. Claude Code operates here. The research agent
writes final artifacts here when they're actionable. Every file
write in `projects/` is logged with project context and strict
locking. When a project completes, the orchestrator calls
`aura_fs_archive` and the directory moves to `archive/`.

**Areas** — ongoing responsibilities without a completion state.
The heartbeat sub-agents write here. The inventory watcher updates
`areas/inventory/last-check.md` on every run. The primary agent
reads these files in the morning brief. Not a contract. Not a
memory. A live operational document any agent can read.

**Resources** — reference material that informs work. Research
output that isn't yet attached to an active project lands here
first. The primary agent can surface research from `resources/`
when relevant to a decision. Engram extracts from here during
consolidation passes.

**Archive** — completed, inactive. Soft-deleted files go to
`.trash/` rather than being permanently removed. The owner can
recover anything.

### The File Bridge tool suite

```typescript
// All tools registered by aura-pulse plugin
// All tools enforce PROJECT_ROOT path jail
// All writes log to contracts.db and touch .signal

aura_fs_read(path, options?)
// Read file contents. Chunks large files to protect context window.
// No lock required. Logs to autonomous_log.

aura_fs_write(path, content, reason)
// Create or overwrite. Creates parent directories automatically.
// Acquires lock → writes → releases lock → logs → signals.
// reason is required and written to contract_events.

aura_fs_patch(path, search, replace, reason)
// The Aider pattern. Search/Replace blocks.
// Uses diff-match-patch for fuzzy matching on whitespace errors.
// Safest edit operation for local models.
// Format:
// search: "old_code();"
// replace: "new_code();"
// Acquires lock → applies patch → validates result → logs → signals.

aura_fs_move(source, destination, reason)
// Move or rename. Handles cross-device moves.
// Logs both source removal and destination creation.

aura_fs_delete(path, reason)
// Soft delete only. Moves to .trash/ with timestamp prefix.
// Never rm -rf. Owner can always recover.

aura_fs_list(path, options?)
// List directory contents with metadata.
// Used by orchestrator to understand project state.

aura_fs_archive(project_path, reason)
// Move completed project from projects/ to archive/.
// Updates any contracts referencing this path.

aura_fs_search(query, scope?)
// Search file contents across the PARA tree.
// scope: "projects" | "areas" | "resources" | "all"
```

### The Aider search/replace pattern — why it matters

Local models (Qwen, Gemma, Llama) struggle with unified diffs.
They hallucinate context lines and get offsets wrong. Exact string
matching is dramatically more reliable. The search/replace block
format from Aider is the right primitive for `aura_fs_patch`:

```
search: |
  function calculatePrice(item) {
    return item.basePrice;
  }
replace: |
  function calculatePrice(item, discount = 0) {
    return item.basePrice * (1 - discount);
  }
```

The `diff-match-patch` library (Google, Apache 2.0) handles fuzzy
matching for minor whitespace variations in the search block. This
means local models don't need to reproduce whitespace perfectly —
close enough is close enough.

### File locking — preventing concurrent corruption

When multiple agents or an external CLI agent and an OpenClaw agent
try to write the same file simultaneously, corruption is possible.
The plugin implements ephemeral file locks.

```sql
-- In contracts.db
CREATE TABLE file_locks (
  path TEXT PRIMARY KEY,
  locked_by_agent TEXT NOT NULL,
  locked_at TEXT NOT NULL,
  lock_expires_at TEXT NOT NULL,  -- auto-release if agent crashes
  operation TEXT NOT NULL         -- what the agent is doing
);
```

Lock acquisition: write to `file_locks`. Lock release: delete from
`file_locks`. Lock expiry: `lock_expires_at` is 30 seconds from
acquisition. If an agent crashes mid-write, the lock auto-expires
and other agents can proceed.

For Chokidar-detected external CLI writes: the plugin cannot
acquire a pre-write lock because it doesn't know the write is
coming. Instead it detects the write via Chokidar, retroactively
logs it, and checks if a lock was held. If a concurrent lock was
held, it flags the conflict in contracts.db for the orchestrator
to resolve.

### Chokidar — watching for external changes

Chokidar watches PROJECT_ROOT for changes from any source:

```typescript
chokidar.watch(PROJECT_ROOT, {
  ignored: [
    /(^|[\/\\])\../,  // dotfiles except .aura/
    '**/node_modules/**',
    '**/.git/**',
  ],
  persistent: true,
  ignoreInitial: true,
}).on('change', (path) => {
  // Check if this was a broker write (already logged)
  // If not, log as external-cli write to autonomous_log
  // Touch .signal
});
```

This ensures the Pulse PWA and the OpenClaw agents always reflect
reality, even when Claude Code or a manual VS Code edit changes a
file.

### Safety constraints

**Path jail** — every tool call validates the resolved absolute
path starts with PROJECT_ROOT. `../` traversal is rejected with a
typed error before any filesystem operation.

**Protected paths** — `.git/`, `.env`, `node_modules/` are
read-only by default. The plugin rejects writes to these paths
regardless of what the agent requests.

**Required reason** — every write, move, and delete requires a
`reason` parameter. This is written to `contract_events` in
contracts.db. The owner can review exactly why every file changed
via the history surface in the Pulse PWA.

**Soft delete only** — `aura_fs_delete` never calls `rm`. It
moves the target to `.trash/` with a timestamp prefix. The owner
can recover anything.

### The multi-business model — future phase

The current architecture is one `.aurora` package, one business,
one PARA tree at `~/.aura/projects/studio-ops/`. This is the
correct scope for Phase 1.

The door to multiple businesses is already designed. When Sheryl
wants to add her fine art business alongside the reseller business,
a second `.aurora` package installs a second PARA tree:

```
~/.aura/projects/
  sheryl-shops/         ← reseller business
  sheryl-fine-artist/   ← fine art business
```

Two separate agent teams. Two separate contract stores. Two separate
engram memory trees. The Aura installation is aware of both. Each
business is fully isolated. Cross-talk happens only when the primary
agent explicitly bridges them.

The `aura_onboard` tool is the deterministic mechanism that sets
up a new PARA tree, provisions the agent's email, seeds the
active-context.md, and begins the onboarding conversation. It runs
at first install from the Expert Store and any time the owner says
"I have another business I'd like you to help with." Same tool,
idempotent, works for first install and second business equally.

This is a future phase. For now: one business, one tree, full focus.

### Updated directory map (complete)

```
~/.aura/
  projects/
    studio-ops/                    ← PROJECT_ROOT for this package
      projects/                    ← PARA: active work
      areas/                       ← PARA: ongoing responsibilities
      resources/                   ← PARA: reference and research
      archive/                     ← PARA: completed and inactive
        .trash/                    ← soft deletes
  shared/
    studio-ops/                    ← operational data (not file assets)
      contracts/
        contracts.db
        .signal
      memory/
        engram/
        engram.db
      connectors/
        connectors.db

~/.openclaw/                       ← OpenClaw owns this entirely
  workspace/                       ← primary agent workspace
    AGENTS.md
    SOUL.md
    active-context.md
  workspace-orchestrator/
    AGENTS.md
    active-context.md
  agents/
    studio-ops-primary/agent/auth-profiles.json
    studio-ops-orchestrator/agent/auth-profiles.json
```

---

## 19 — What This Is Not

**Not a demo trick.** Every decision serves the platform. The demo
is the first scenario that runs on the platform.

**Not OpenClaw-dependent.** The contract runtime has no OpenClaw
imports. The plugin is the adapter. Different frontend, different
adapter, same runtime, same contracts.db.

**Not a terminal experience.** Auth, connections, decisions, and
history all surface through the Pulse PWA. The owner never opens
a terminal.

**Not a closed system.** TypeRegistry, ConnectorManager, storage
interface, and engram observer are all extension points.

**Not finished.** The platform evolves. The protocol is versioned.
This document is the approved foundation. Changes require
deliberate revision.

---

## 19 — Resolved Decisions

All of the following are locked. Do not relitigate without a
strong implementation reason.

| Decision | Resolution |
|---|---|
| Contract storage | SQLite (contracts.db) |
| Event mechanism | Signal file (.signal) + SQLite WAL |
| Memory system | Engram (v9.0.108, 2026.3.22 SDK compatible) |
| Agent harness | OpenClaw (existing multi-agent setup) |
| Shared file access pattern | File Bridge (aura_fs_* tools) via plugin broker. No symlinks. |
| External CLI file access | Direct PROJECT_ROOT access. Chokidar detects and retroactively logs. |
| File edit format | Aider search/replace blocks with diff-match-patch fuzzy matching |
| File delete behavior | Soft delete to .trash/ only. Never rm -rf. |
| Concurrent write protection | file_locks table in contracts.db, 30s auto-expiry |
| Directory organization | PARA — Projects, Areas, Resources, Archive |
| Multi-business model | Future phase — separate PARA trees per .aurora package |
| New business onboarding tool | aura_onboard — deterministic, idempotent, future phase |
| Agent topology | Depth 0 primary, depth 1 orchestrator, depth 2 workers |
| Human-facing surface | Pulse PWA (React, standalone, not OpenClaw Canvas) |
| Auth (OpenClaw services) | OpenClaw channel connectors (inherit existing OAuth) |
| Auth (custom services) | AuraConnectorStore in contracts.db, encrypted tokens |
| Plugin SDK surface | `openclaw/plugin-sdk/*` subpaths only |
| OpenShell | Not needed for prototype, applicable for future Linux/DGX |
| LCM compatibility | Structural — contracts.db as Immutable Store, active-context.md as Active Context |
| Multi-tenancy | SQLite now, Postgres later via storage interface swap |
| A2A for events | No — A2A for agent communication, signal file for surface events |
| UI for history | Rendered Pulse surface from contracts.db query, not raw files |
| Use cases | Artist reseller + beach cleaning non-profit |
| aura_surface_decision | Primary agent only |
| aura_report_to_primary | Orchestrator + workers |

---

## 20 — Remaining Open Questions

These are prototype-level unknowns. Answer them in Phase 2.
Do not design around assumptions.

1. **WebSocket in registerHttpRoute** — test whether OpenClaw's
   HTTP route handler supports WS upgrade. Expected answer: no.
   Resolution: WS server runs on port 7700 via separate
   `registerService`. HTTP route serves static PWA files only.

2. **registerService crash behavior** — if ContractRuntime service
   crashes, does `registerService` auto-restart? Test and document.
   If not, implement supervision in the service itself.

3. **Etsy API availability** — does Etsy's OAuth API support the
   access patterns we need, or do we need web monitoring? Check
   rate limits and available scopes. Poshmark and Mercari almost
   certainly need web monitoring (no official API).

4. **Engram observer API** — what is the exact API for registering
   a completion observer with engram? Check engram's plugin
   architecture in v9.0.108 source.

5. **OpenClaw channel connector credential access** — can the
   aura-pulse plugin read credentials from OpenClaw's Gmail channel
   connector that was set up for a different purpose? Or does each
   use case need its own OAuth flow? Check `auth-profiles.json`
   read access in the plugin SDK.

6. **Chokidar concurrent lock conflict resolution** — when Chokidar
   detects an external CLI write that conflicts with a held lock,
   what is the orchestrator's resolution protocol? Define the
   conflict resolution flow in Phase 2 when first encountered in
   practice. Do not over-engineer before seeing a real case.

7. **aura_fs_patch atomicity** — if diff-match-patch finds no
   match for the search block, the patch must fail cleanly without
   partial writes. Verify the error path produces a typed error
   the agent can reason about and retry from without human
   intervention.

8. **PROJECT_ROOT configuration** — how does the plugin know
   which PROJECT_ROOT to enforce for which agent? The `.aurora`
   manifest declares it, but the plugin needs to resolve the
   correct root per package instance at runtime. Verify
   `api.runtime.agent.resolveAgentWorkspaceDir()` provides
   enough context to locate the correct `~/.aura/projects/<id>/`
   path, or whether the plugin config needs an explicit override.

---

*Version 0.5 — LOCKED FOR IMPLEMENTATION*
*Updated: March 25, 2026 — File Bridge and PARA architecture added*
*No code written before this version. Code begins with Phase 1.*
*Changes to this document require explicit approval and version bump.*
