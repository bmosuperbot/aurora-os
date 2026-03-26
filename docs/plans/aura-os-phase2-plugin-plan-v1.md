# Aura OS — Phase 2 Plan
**OpenClaw Plugin + Service Layer**
version: 1.0 | status: implementation-ready
date: March 26, 2026

---

## 01 — What Phase 2 Delivers

Phase 2 turns the completed contract runtime into a live OpenClaw-integrated
system.

By the end of this phase:

- Aura exists as a loadable OpenClaw plugin with a valid manifest,
  package metadata, and link-install workflow.
- Agents can call Aura tools against the Phase 1 runtime rather than
  touching SQLite or filesystem state directly.
- A background WebSocket service pushes contract and connector events
  to a Pulse client.
- Connector requests are testable end to end.
- The brokered File Bridge exists for shared project work and external
  CLI cooperation.
- Completion notifications leave the runtime through a plugin-owned
  bridge so Engram can observe completed contracts without coupling the
  runtime package to Engram internals.

This phase does not build the full Vue Pulse product surface. Phase 2
only creates the plugin, event transport, connector flow plumbing,
testing harness, and minimal operator surface needed to prove the stack.

---

## 02 — Locked Inputs

This document operationalizes three already-decided sources:

- Foundation plan v0.5: Phase 2 is the OpenClaw plugin phase.
- Technical research: OpenClaw plugin packaging, runtime helpers,
  connector auth constraints, and the separate WebSocket server
  expectation are already researched.
- Completed Phase 1 runtime: the contract runtime package already owns
  the state machine, SQLite storage, signal touching, resume tokens,
  connector CRUD, completion notifier interface, and file lock table.

Phase 2 therefore consumes the runtime. It does not redesign it.

### Important note for the coding agent

This document is intended to be self-contained. If it conflicts with the
older Phase 2 bullets or sketches in the foundation plan, follow this
document.

The main discrepancies from the original foundation plan v0.5 are:

- `file_locks` was described there as a Phase 2 addition, but it already
  landed in Phase 1. Do not add a new migration for it unless the schema
  genuinely needs new columns.
- The foundation doc contains an older `connectors.db` sketch, but the
  implemented Phase 1 runtime already stores connector state and encrypted
  token fields in `contracts.db`. Treat `contracts.db` as the Phase 2
  source of truth for connectors.
- The foundation doc says the PARA tree is created at package install
  time. Current OpenClaw plugin installs do not support relying on
  lifecycle scripts, so PARA/bootstrap work must happen idempotently at
  runtime startup or through an explicit CLI/setup command.
- The foundation doc assumes a `setup-entry.ts` split. That split still
  makes architectural sense and remains the plan, but current OpenClaw
  docs clearly describe `setupEntry` behavior mainly for channel plugins.
  Because Aura is a non-channel plugin, actual loader behavior must be
  verified early and the fallback is to call the same lightweight route
  registrar from `index.ts`.
- The foundation doc leaves Engram observer wiring as an open question.
  Phase 2 should not couple the runtime package directly to Engram.
  Instead, keep the runtime Engram-agnostic and implement a plugin-owned
  completion bridge.

These are not optional refinements. They reflect the current repo state
and the current external platform constraints as of March 26, 2026.

---

## 03 — Verified External Constraints

### OpenClaw plugin constraints

- Use `definePluginEntry` for the full plugin entry.
- Ship `openclaw.plugin.json` in the package root. Even an empty-config
  plugin must provide a JSON schema.
- Use focused `openclaw/plugin-sdk/*` imports only. Do not use the
  monolithic root barrel and do not import bundled extension internals.
- Register behavior through the documented registry surface only:
  `registerTool`, `registerService`, `registerHttpRoute`, `registerCli`,
  hooks, and runtime helpers.
- Native plugins run in-process with the OpenClaw gateway and are not
  sandboxed. A plugin bug can destabilize the gateway.
- `openclaw plugins install` uses `npm install --ignore-scripts` for
  npm-sourced plugins. Do not rely on `postinstall` or native builds.

### OpenClaw setup-entry nuance — RESOLVED

The OpenClaw SDK docs and the `sdk-setup` page are definitive:
`setupEntry` and `defineSetupPluginEntry` are exclusively for channel plugins.
OpenClaw uses `setupEntry` when a channel is disabled, unconfigured, or when
deferred loading is enabled — none of which apply to Aura.

Aura does not set `openclaw.setupEntry` in `package.json`. We keep a
lightweight `setup-entry.ts` internal module as an architectural boundary
for HTTP route registration logic, but it is called directly from `index.ts`
at startup, not through the OpenClaw `setupEntry` mechanism.

### Engram integration constraints

- Engram is local-first and markdown-authoritative.
- Engram already exposes service, tool, CLI, HTTP, and MCP surfaces.
- The public docs describe operations and memory architecture, but do
  not document a stable in-process "observer registration" contract.

That means the Aura runtime package must remain Engram-agnostic, and
the plugin must own the adapter boundary.

---

## 04 — Starting State From Phase 1

The plugin starts from a stronger base than the older foundation bullet
list assumed.

Already present in `packages/contract-runtime`:

- `SQLiteContractStorage`
- `ContractRuntime`
- `getPending()`
- `resume()` with single-use token consumption
- `logAutonomousAction()`
- connector read/update support
- `CompletionNotifier` interface
- `file_locks` table and storage methods
- `.signal` touch after writes

Implication:

- Phase 2 does not add `file_locks` to the schema. It uses the existing
  table.
- Phase 2 does not re-implement connector persistence. It layers plugin
  services and tool surfaces on top of the existing runtime contract.
- The older separate `connectors.db` sketch is superseded by the actual
  Phase 1 implementation. Connector state and encrypted token fields live
  in `contracts.db`.

---

## 05 — Package Layout

Create a second package alongside the runtime:

```text
aura-pulse/
  packages/
    contract-runtime/
    openclaw-plugin/
      package.json
      openclaw.plugin.json
      tsconfig.json
      index.ts
      setup-entry.ts
      api.ts
      runtime-api.ts
      src/
        config/
          schema.ts
          paths.ts
        services/
          contract-runtime-service.ts
          websocket-service.ts
          signal-watcher.ts
          connector-manager.ts
          completion-bridge.ts
          file-bridge-watcher.ts
        transport/
          websocket-protocol.ts
          route-static.ts
        tools/
          aura-surface-decision.ts
          aura-report-to-primary.ts
          aura-log-action.ts
          aura-query-contracts.ts
          aura-query-connections.ts
          aura-request-connection.ts
          aura-fs-read.ts
          aura-fs-write.ts
          aura-fs-patch.ts
          aura-fs-move.ts
          aura-fs-delete.ts
          aura-fs-list.ts
          aura-fs-archive.ts
          aura-fs-search.ts
        connectors/
          openclaw-channel-connector.ts
          aura-connector-store.ts
          crypto.ts
        fs/
          path-jail.ts
          para.ts
          patcher.ts
          locks.ts
        cli/
          aura-cli.ts
        test-support/
          mock-runtime.ts
      tests/
        unit/
        integration/
```

`api.ts` and `runtime-api.ts` exist to match current OpenClaw plugin
module conventions and to prevent internal self-import mistakes later.

---

## 06 — Stack Decisions

### Language and module format

- TypeScript ESM for the plugin package.
- No runtime transpilation dependency on Aura code generation.
- Ship source in a form OpenClaw can load directly.

Rationale: the OpenClaw docs, examples, and plugin loader conventions are
all TypeScript-first. Phase 1 deliberately stayed JS for the runtime
package; that does not need to constrain the plugin package.

### Dependencies

- `openclaw` SDK subpaths
- `@sinclair/typebox` for tool parameter schemas (required by `registerTool`)
- `ws` for the WebSocket server
- `chokidar` for external file change watching
- `diff-match-patch` for fuzzy search/replace patching
- no native modules

Rationale: OpenClaw installs plugins with lifecycle scripts disabled.
The dependency tree must stay pure JS/TS.

### Data and path model

Use Aura-owned directories outside the OpenClaw workspace:

```text
~/.aura/
  shared/<package-id>/
    contracts.db
    .signal
    artifacts/
  projects/<package-id>/
    projects/
    areas/
    resources/
    archive/
    .trash/
```

No symlinks. No direct agent filesystem access to these paths. Agents reach
them only through Aura plugin tools.

### PARA creation timing

The older foundation wording said "created at package install time."
Do not implement that literally. Because OpenClaw ignores install scripts,
PARA scaffolding must be created idempotently on first service startup or
through a setup CLI command.

---

## 07 — Plugin Identity, Manifest, and Config

### `package.json`

The package metadata should declare:

- `type: "module"`
- `openclaw.extensions: ["./index.ts"]`

Do NOT include `openclaw.setupEntry`. The OpenClaw docs confirm that
`setupEntry` and `defineSetupPluginEntry` are exclusively for channel plugins
(loaded when a channel is disabled, unconfigured, or deferred). Aura is a
non-capability plugin. OpenClaw will ignore `setupEntry` for this shape.
Call the lightweight route registrar directly from `index.ts` at startup.

Do not enable deferred full load flags; they are channel-specific.

### `openclaw.plugin.json`

The manifest should declare a non-capability plugin:

- `id: "aura-pulse"`
- name and description
- JSON schema for plugin config

Recommended config fields:

- `auraRoot`: base Aura data directory, default `~/.aura`
- `workspaceId`: stable package/workspace slug such as `studio-ops`
- `wsPort`: default `7700`
- `pulseStaticDir`: optional override for served static assets
- `signalDebounceMs`: default `75`
- `engramBridgeEnabled`: default `true`
- `engramHttpUrl`: Engram access HTTP base URL, default `http://localhost:4318`
- `projectRootOverride`: optional explicit File Bridge root

Do not store secrets in plugin config. Connector encryption keys and the
Engram auth token must come from environment, not from JSON config. The
Engram bearer token is read from `AURA_ENGRAM_AUTH_TOKEN` at startup.

---

## 08 — Service Topology

Phase 2 should register two top-level background services and keep their
internal collaborators separate.

### Service A — `ContractRuntimeService`

Responsibilities:

- resolve Aura data paths
- initialize SQLite storage against `contracts.db`
- instantiate `ContractRuntime`
- inject a plugin-owned completion notifier bridge
- expose the runtime instance to tool handlers

This service is the only place allowed to construct the runtime.

### Service B — `WebSocketService`

Responsibilities:

- start a `ws` server on the configured port
- manage connection registry and heartbeats
- own the `SignalWatcher`
- own connector and completion push delivery
- bootstrap pending contracts on client connect

### Internal collaborator — `SignalWatcher`

Implement the defensive pattern from the foundation plan:

- debounce `.signal` events at 50-100ms, default 75ms
- keep `lastCheckedAt` in memory
- query only changed contracts since `lastCheckedAt`
- on startup or restart, allow epoch recovery behavior

Do not query the full contracts table on every signal.

### Internal collaborator — `FileBridgeWatcher`

Use `chokidar` to watch the File Bridge root for external CLI changes.
When a change occurs:

- attribute it as `source: external-cli`
- record the event in the log layer
- touch `.signal`
- notify connected clients if the change affects surfaced work

If a watched change collides with an active file lock, log a typed
conflict event and fail open to orchestration review rather than trying
to silently merge writes.

---

## 09 — Tool Surface

Phase 2 exposes the locked foundation tools.

### Contract tools

`aura_surface_decision`

- primary agent only
- creates or updates a human-resolved contract and moves it to
  `waiting_approval`
- returns contract id, status, and any surface metadata needed for the
  agent to continue reasoning

`aura_report_to_primary`

- orchestrator and workers only
- creates an agent-resolved contract for the primary agent instead of
  surfacing to the human

`aura_log_action`

- records a pre-authorized autonomous action through
  `runtime.logAutonomousAction()`

`aura_query_contracts`

- read-only query surface over contract state and recent history
- supports common filters such as id, status, parent, resolver type,
  and recency

### Connector tools

`aura_query_connections`

- read-only connector status view
- returns `status`, `source`, `capability_without`, `capability_with`,
  and `never_resurface`
- never returns raw secrets or decrypted tokens

`aura_request_connection`

- triggers a connector card push to the Pulse transport
- writes connector state transitions into `contracts.db`
- supports browser redirect, secure input, and manual-guide flows

### File Bridge tools

`aura_fs_read`
`aura_fs_write`
`aura_fs_patch`
`aura_fs_move`
`aura_fs_delete`
`aura_fs_list`
`aura_fs_archive`
`aura_fs_search`

All mutating tools must:

- enforce the project-root path jail
- acquire and release file locks through the existing runtime storage
- log the operation
- touch `.signal` after successful mutation

### Tool gating model

Primary enforcement is by tool availability in the agent topology.
Only agents that should be able to use a tool receive it.

If OpenClaw exposes stable invocation metadata for caller identity during
implementation, add a second validation layer in the handlers. If it does
not, do not block Phase 2 on that gap; rely on topology-level tool exposure
and keep the runtime-side contracts typed.

---

## 10 — Web and WebSocket Transport

### Static HTTP route

Register a plugin HTTP route for static Pulse assets.

Phase 2 scope:

- serve a minimal shell or placeholder assets
- confirm path resolution and auth behavior
- prove that the gateway can host Pulse-owned static content

The `registerHttpRoute` call must declare `auth` explicitly. Use
`auth: "plugin"` for this route (Aura manages its own session validation
for the Pulse PWA). Use `match: "prefix"` so the single route handles
all asset paths under the prefix. See SDK docs: routes with conflicting
`auth` levels on overlapping paths are rejected at registration time.

Do not build the full Vue 3 PWA here. That belongs to Phase 3.

### WebSocket server

Assume the expected architecture from the foundation and research docs:

- static assets served through `registerHttpRoute`
- WebSocket traffic served by a separate `ws` server on port `7700`

Supported runtime-to-surface messages in Phase 2:

- decision
- surface update
- clarification answer
- clear
- completion
- connector request
- connector complete

Supported surface-to-runtime messages in Phase 2:

- engage
- ask clarification
- resolve
- abandon
- initiate connector
- complete connector
- decline connector

On connect or reconnect:

- immediately query `getPending()`
- push any currently surfacable `waiting_approval` contracts
- do not depend on missed signal events for recovery

---

## 11 — Connector Manager

The plugin owns one `ConnectorManager` facade with two adapters.

### `OpenClawChannelConnector`

Purpose:

- detect availability and status of channel-backed connectors
- reuse OpenClaw-owned auth where the platform already has a channel

Constraints:

- never copy raw channel credentials into plugin logs or tool output
- read-only inspection paths should report availability, not secret values
- if OpenClaw does not expose reusable auth for the needed connector,
  fail closed and route that service through the Aura connector flow

### `AuraConnectorStore`

Purpose:

- manage Aura-owned connector states already stored in `contracts.db`
- persist encrypted token fields for browser-redirect and secure-input
  connectors

Implementation rule:

- encrypt `oauth_token_enc` and `refresh_token_enc` with Node `crypto`
  using an operator-provided master key
- refuse to persist credentials when the key is unavailable
- store only encrypted blobs and metadata such as expiry timestamps

### Decline and resurface behavior

- `declineConnector(connectorId, never)` updates connector state
- `never = true` sets `never_resurface`
- future suggestion logic must respect `never_resurface` before offering
  a connector again

---

## 12 — File Bridge

The File Bridge is part of Phase 2 because it is the shared-work contract
between Aura agents and external CLI agents.

### Root rules

- all file operations are jailed to a single resolved project root
- reject paths that escape through `..`, symlinks, or alternate mounts
- normalize before validation and after move targets resolve

### Operation semantics

`read`

- chunk large files
- no lock required

`write`

- create parent directories automatically
- acquire lock, write atomically, release lock

`patch`

- use Aider-style search/replace blocks
- use `diff-match-patch` to tolerate small whitespace drift
- fail cleanly and atomically if no safe match is found

`move`

- support rename and cross-directory move

`delete`

- soft delete only
- move to `.trash/` with timestamp prefix

`archive`

- move completed project work into `archive/`

`search`

- search across `projects`, `areas`, `resources`, or `all`

### Logging rule

Every mutating file operation is durable and auditable. The log entry is
part of the trust model, not an optional debug feature.

---

## 13 — Completion Bridge to Engram

Phase 1 already introduced a `CompletionNotifier` interface. Phase 2 now
implements a real plugin-side bridge.

### Required architecture

- the runtime package remains unaware of Engram
- the plugin injects `EngramCompletionBridge` into `ContractRuntime`
- the bridge translates `onComplete(contract)` into an Engram-facing
  write or enqueue action

### Hard rule

Do not import undocumented Engram internals into the runtime package.

### Confirmed sink: Engram HTTP API

The Engram `api.md` documents a stable HTTP access layer. The correct sink
for the completion bridge is `POST /engram/v1/memories` — the explicit
memory write path. This is the documented, stable surface.

Implementation requirements:

- Engram must have `agentAccessHttp.enabled: true` in its plugin config
- The bridge reads `engramHttpUrl` from plugin config (default `http://localhost:4318`)
- The bridge reads the bearer token from `AURA_ENGRAM_AUTH_TOKEN` env var
- On `onComplete(contract)`, POST to `/engram/v1/memories` with the
  `Authorization: Bearer <token>` header
- Write `category: "decision"`, include contract id, type, and outcome
  summary in `content`
- Log and swallow HTTP errors — bridge failure must not affect the runtime
  state machine
- When `engramBridgeEnabled` is `false` or the token is absent, the bridge
  is a no-op stub (same interface, no HTTP call)

Do not use the Engram MCP surface or CLI as the bridge mechanism.
Do not reach into `(globalThis as any).__openclawEngramOrchestrator` —
this is an undocumented in-process interface that is not a stable contract.

### Implementation sequence

1. Read the Engram `api.md` write envelope schema before implementing.
2. Implement `EngramCompletionBridge` as a thin HTTP client behind the
   `CompletionNotifier` interface.
3. Wire the bridge in `ContractRuntimeService`.

### Scope boundary

Phase 2 only delivers completion notification plumbing. It does not enable
shared-context injection, compounding, governance, or other Engram features.

---

## 14 — CLI Surface

Register a small CLI surface because Phase 2 must prove operator control
outside the UI.

Minimum commands:

- `openclaw aura pending`
  show current pending contracts and connector requests
- `openclaw aura resume --contract <id> --token <token> --action <action>`
  consume a resume token and continue a contract
- `openclaw aura connectors`
  show connector state summary
- `openclaw aura status`
  show plugin path resolution, ws status, signal watcher status, and
  engram bridge status

This CLI is the smoke-test backbone for Phase 2 and the operator escape
hatch before the full Pulse surface exists.

---

## 15 — Testing Strategy

Use Vitest for the plugin package. Follow OpenClaw's plugin testing
patterns and mock runtime stores per instance rather than mutating shared
prototypes.

### Unit tests

- config normalization and path resolution
- route/static asset resolver
- runtime store bootstrap and teardown
- signal watcher debounce and `lastCheckedAt` behavior
- connector token crypto round-trip
- path jail rejection cases
- `aura_fs_patch` atomic failure path
- CLI argument parsing

### Integration tests

- plugin service boot with mocked `PluginRuntime`
- contract creation triggers WebSocket push
- reconnect bootstrap pushes pending contracts
- connector request and completion update storage correctly
- file bridge write logs and signals
- Chokidar-detected external write produces an observable event
- completion bridge receives completed contracts from runtime

### Manual smoke run

Use local linked install:

```bash
openclaw plugins install --link /path/to/aura-pulse/packages/openclaw-plugin
```

Required manual proof:

1. plugin loads and passes `openclaw plugins inspect aura-pulse`
2. static route serves Pulse placeholder content
3. WebSocket server accepts a client connection
4. primary agent calls `aura_surface_decision`
5. contract reaches `waiting_approval`
6. operator resumes via CLI
7. agent continues
8. completion bridge emits an Engram-facing notification

---

## 16 — Build Order

Implement Phase 2 in this order.

### Step 1 — Scaffold the package

- create package structure
- add manifest, package metadata, tsconfig, test harness
- add shared config/path helpers

### Step 2 — Prove route and loader behavior

- implement `route-static.ts` with `auth: "plugin"` and `match: "prefix"`
- create a lightweight `setup-entry.ts` module as an internal architectural
  boundary (route registration logic lives here for clarity)
- call `route-static.ts` directly from `index.ts` during startup — do NOT
  use the `openclaw.setupEntry` mechanism, which is channel-only per docs

### Step 3 — Boot the runtime service

- wire `SQLiteContractStorage` to Aura paths
- instantiate `ContractRuntime`
- inject completion bridge stub

### Step 4 — Add the WebSocket transport

- start the `ws` service on port `7700`
- add connection tracking and reconnect bootstrap
- add `SignalWatcher`

### Step 5 — Register the contract and connector tools

- add the six core Aura tools
- keep handler code thin; all stateful work goes through services

### Step 6 — Register the File Bridge tools

- implement path jail, locking, patcher, and PARA bootstrap
- add `chokidar` watcher for external writes

### Step 7 — Add CLI operator commands

- implement `pending`, `resume`, `connectors`, `status`

### Step 8 — Wire the completion bridge

- implement `EngramCompletionBridge` using `POST /engram/v1/memories`
- read URL from `engramHttpUrl` config, token from `AURA_ENGRAM_AUTH_TOKEN`
- replace the stub injected in Step 3
- prove an end-to-end notification by completing a contract and verifying
  the memory appears in Engram via `openclaw engram search`

### Step 9 — Final smoke and hardening

- linked install
- plugin inspect
- contract flow smoke
- reconnect smoke
- connector flow smoke
- file bridge smoke

---

## 17 — Done Criteria

Phase 2 is done only when all of the following are true:

- Aura plugin loads through OpenClaw with valid manifest and config
- all six contract/connector tools are callable
- all eight File Bridge tools are callable
- signal changes trigger debounced WebSocket pushes
- reconnect bootstrap restores pending decisions without missed-event loss
- CLI resume works against a real pending contract
- connector request, completion, decline, and `never_resurface` flows work
- PARA roots are created idempotently on startup
- external CLI file writes are detected and logged
- contract completion emits an Engram-facing notification

---

## 18 — Open Questions That Must Be Verified Early

These are real prototype questions. Keep them explicit and answer them near
the start of implementation.

1. ~~Does OpenClaw honor `setupEntry` for non-channel plugins?~~
   **CLOSED.** The SDK docs confirm `setupEntry` and `defineSetupPluginEntry`
   are exclusively for channel plugins. Aura does not set `openclaw.setupEntry`
   in `package.json`. The lightweight route registrar is called from `index.ts`.

2. ~~Does `registerService` provide crash restart behavior?~~
   **CLOSED.** `registerService` provides `start()` / `stop()` lifecycle
   hooks called by OpenClaw on gateway start and shutdown — no crash restart
   supervision. Aura must supervise its own long-running internals (WebSocket
   server, SignalWatcher). Implement internal restart guards as needed,
   following the idempotency pattern in the Engram service source.

3. ~~What is the least-coupled supported Engram sink?~~
   **CLOSED.** The HTTP API at `POST /engram/v1/memories` is the stable
   documented sink. See Section 13 for the implementation spec.

4. Can Aura safely inspect reusable auth for OpenClaw-backed connectors, or
   should those services always route through explicit Aura-owned OAuth?

5. Does the final tool execution context expose caller identity strongly
   enough to add runtime role checks beyond tool availability? The
   `before_tool_call` hook (available in SDK ≥2026.3.22) receives
   `event.toolName` and session context — verify whether it exposes agent
   identity before implementing runtime role checks.

6. What is the exact conflict policy when a Chokidar-detected external write
   lands during an active Aura file lock?

Answer question 4, 5, and 6 early. Do not build the rest of the phase around guesses.