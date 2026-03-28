# Aura OS — Phase 5 Plan
**ContractExecutor: Closing the Loop Between Resolver and Agent**
version: 1.0 | status: implementation-ready
date: March 28, 2026

---

## 00 — Strategic Frame

Phase 4 built the human half of the contract lifecycle: the Resolver sees an
offer, makes a decision, and commits via the Pulse surface. Phase 4b cleaned
the seam: the runtime transitions to `executing`, and the backend stops there.

Phase 5 builds the machine half: what happens after `executing`.

The `// TODO(phase-5): ContractExecutor.wake(contractId)` comment in
`websocket-service.js` is the entry point for everything in this document.
The goal is to make that comment disappear — replaced by a service that wakes
the correct agent, with the correct tools in scope, given the correct goal, and
validates that the agent did the required work before the contract closes.

This is the phase that completes the autonomy loop:

```
Gmail hook → agent reasons → contract → Resolver decides → executing
                                              ↑ this phase ↓
                                    ContractExecutor wakes agent
                                   agent calls tools (gog, etsy, etc.)
                                   agent calls aura_complete_contract
                                   contract → complete → Engram extracts
```

By the end of this phase, the full loop runs without any human-operated step
between the Resolver's decision and the agent's delivery of the result.

---

## 01 — Foundation Plan: What's True, What's Drifted

This section is the authoritative reconciliation of `foundation-plan-v0.5`
against the codebase as it exists after Phase 4b. Read this before any
implementation work. Where this document and the foundation plan conflict,
this document wins.

### §05 — Multi-agent topology: `active-context.md`

Foundation plan describes `active-context.md` as an explicit file the
primary agent writes to continuously. In practice, active context is managed
by Engram (memory) and the agent's own session state. Aura has no
infrastructure obligation here. Contracts are the Aura source of truth.
`active-context.md` may exist in the agent workspace as an agent-authored
artifact; Aura does not create, read, or validate it.

### §05 — Multi-agent topology: `executing → active` for subtask spawning

Foundation plan §08 shows the transition `executing → active` triggered by
"subtask spawned." This is architecturally correct and `spawnSubtask()` is
already implemented in `ContractRuntime`. However, Phase 5 does not implement
nested subtask dispatch. The ContractExecutor handles only:

- `executing → complete` (success via `aura_complete_contract`)
- `executing → failed` (unhandled error or timeout)

The `executing → active` path (child spawned, parent waits) is Phase 6.
Do not build parallel sub-agent wiring in Phase 5.

### §06 — Connector taxonomy: `aura-skill` and the exec tool

Foundation plan §06 states: "Plugin calls the CLI via exec tool (allowlisted)."

This is wrong after Phase 4b. The corrected position, locked in by the
architectural cleanup:

- **The plugin calls nothing.** The plugin is a contract lifecycle manager.
- **The agent calls skills.** `gog gmail reply` is a registered OpenClaw
  skill. The agent calls it directly in the `executing` state. The plugin
  never invokes `gog` or any other CLI.
- **`aura-skill` connector records** exist in `contracts.db` for display
  purposes only — so Pulse shows "Gmail reply via gog: connected." The record
  describes a capability; it is not an execution mechanism.

The foundation plan's exec-tool wiring in the plugin layer is removed
entirely. If you find any code calling `execFile` on `gog` (or any skill),
delete it — it is a Phase 4 regression.

### §08 — State machine: `complete_requires`

Foundation plan mentions completeness validation implicitly. Phase 5 makes
it explicit. `BaseContract` gains a `complete_requires?: string[]` field.
Before `aura_complete_contract` calls `runtime.transition(→complete)`, it
queries the `autonomous_log` for the contract's ID and verifies that every
tool name in `complete_requires` appears at least once. Missing entries cause
the tool call to return an error — the contract stays in `executing`.

This is the determinism guarantee the foundation plan specifies without
naming it. The contract spec, not the backend, enforces what the agent must do.

### §10 — TTL enforcement

Foundation plan §10 lists TTL enforcement as a runtime responsibility.
`TtlManager` exists in `contract-runtime`. However, no scheduled runner calls
it — TTL is never actually enforced. Phase 5 wires the TTL runner into
`ContractRuntimeService` as a background interval. `waiting_approval` contracts
past `expires_at` transition to `failed` automatically. `resolver_active`
contracts past the inactivity timeout return to `waiting_approval`.

### §06 — `aura-app`: posh-pusher pattern

Foundation plan §06 and the Phase 4 plan describe `aura-app` connectors as
PM2-or-Docker processes the agent scaffolds under `~/.aura/projects/`. Phase 5
builds the first `aura-app` reference implementation: the Poshmark watcher.
This confirms the full lifecycle:

- Agent scaffolds the app under `~/.aura/projects/<workspace>/apps/posh-pusher/`
- PM2 vs Docker detection: `which pm2` → PM2; else → Docker Compose
- App emits `POST /hooks/wake` to the OpenClaw gateway when an event occurs
- Gateway routes the POST to an agent turn via `hooks.mappings`
- Agent creates an `offer-received` contract
- ContractExecutor picks it up after Resolver commits

---

## 02 — The Locked Architecture After Phase 4b

Before reading the implementation sections, anchor on these invariants.
Nothing in Phase 5 changes them.

```
openclaw-plugin (core)
  └── contract lifecycle only
  └── zero knowledge of any platform or connector protocol
  └── zero calls to external services (Gmail, Etsy, Poshmark)
  └── zero calls to any skill (gog, lobster, etc.)
  └── fires ExecutionNotifier.onExecuting(contract) → ContractExecutor
  └── fires CompletionNotifier.onComplete(contract) [for TTL/cleanup signaling only]
  └── Engram captures contract context automatically as a native OpenClaw plugin
        (no explicit bridge or observe POST — implicit capture from agent conversation)

artist-reseller (.aurora package)
  └── domain types (offer-received, listing-draft, etc.)
  └── execution goals (per type, per action, with {{token}} substitution)
  └── contributed tools (etsy-lookup.js → aura_query_listing)
  └── aurora-registry.json → declares all of the above

agent (OpenClaw LLM turn)
  └── ALL work that transforms the world
  └── calls contributed tools (aura_query_listing, gog gmail, etc.)
  └── calls aura_log_action for transparency
  └── calls aura_complete_contract as terminal step
  └── cannot skip complete_requires — the contract rejects premature close
```

---

## 03 — What Phase 5 Delivers

### Functional definition

By the end of this phase, the following is demonstrably true:

1. When a Resolver commits a `counter` action on an `offer-received` contract,
   the agent receives an isolated turn containing the exact execution goal
   text, has `aura_query_listing` and `gog gmail reply` available in scope,
   and is expected to call them and then call `aura_complete_contract`.

2. If the agent calls `aura_complete_contract` before calling `gog gmail reply`
   (when `complete_requires` declares it required), the tool returns an error
   and the contract stays `executing`. The agent cannot cheat.

3. A `posh-pusher` aura-app is scaffolded by the agent under the correct path,
   registered as an `aura-app` connector, and its events create `offer-received`
   contracts via a gateway hook — without any plugin-level Poshmark knowledge.

4. TTL enforcement runs. A `waiting_approval` contract left unanswered for
   24 hours (or whatever `expires_at` is set to) transitions to `failed`.
   This is visible in the Pulse history surface.

5. The `aurora-registry.json → tools[]` declaration is live: Etsy lookup is
   registered with the runtime at startup when the `etsy` connector is active.
   The agent can call `aura_query_listing` without any core change.

### Phase decomposition

| Phase | Name | Dependencies |
|---|---|---|
| A | ExecutionNotifier + ContractExecutor | None (seam already prepared) |
| B | Tool Contribution Loader | A must exist so tools are available at execution time |
| C | `complete_requires` enforcement | A (executor wakes agent with complete_requires visible) |
| D | Poshmark aura-app | A, B, C complete (full loop required to validate the scenario) |
| E | TTL enforcement wiring | None (independent of executor) |

### Not in Phase 5

- Phase 6: nested subtask dispatch (`executing → active → child contracts`)
- Expert Store install auth gate (`aura_install_expert`) — the registry format
  exists; the purchase validation backend and the gated install tool are Phase 6
- Non-profit domain package — second `.aurora` package is pure pattern repetition;
  confirm Phase 5 is stable first
- A2UI dynamic component rendering — currently stubbed in `ComponentRef` on
  `BaseContract`; remains a stub

---

## 04 — Phase A: ExecutionNotifier and ContractExecutor

### 04.1 — The seam

After `runtime.resume()`, the runtime transitions to `executing`. The current
code in `websocket-service.js`:

```js
await this._runtime.resume(contractId, token, resolver, action, value, artifacts)
this._broadcast(buildClear(contractId, 'resolved'))
// TODO(phase-5): ContractExecutor.wake(payload['contractId'])
```

Phase 5 replaces the TODO with a live call. The executor runs asynchronously
— it must not block the WebSocket message handler. Errors are logged and do
not throw back to the caller.

### 04.2 — ExecutionNotifier interface (contract-runtime)

Mirror the `CompletionNotifier` pattern exactly:

```ts
// packages/contract-runtime/src/runtime/execution-notifier.d.ts
export interface ExecutionNotifier {
    onExecuting(contract: BaseContract): Promise<void>;
}
```

Add to `ContractRuntime`:

```ts
// contract-runtime.d.ts — add optional second constructor param
constructor(
    storage: ContractStorage,
    completionNotifier?: CompletionNotifier,
    config?: ContractRuntimeConfig,
    executionNotifier?: ExecutionNotifier,
): ContractRuntime
```

In `contract-runtime.js`, call `this._executionNotifier?.onExecuting(contract)`
inside the `transition` method immediately after writing the `executing` state
to storage — same pattern as `onComplete`.

**Important:** The notifier receives the full `BaseContract` in its
post-transition state, including `resume.artifacts` and `resume.action`.
These are the primary inputs to execution goal resolution.

### 04.3 — ContractExecutor service

New file: `packages/openclaw-plugin/src/services/contract-executor.js`

```js
export class ContractExecutor {
    // Implements ExecutionNotifier
    async onExecuting(contract) {
        try {
            await this._wake(contract)
        } catch (err) {
            this._logger.warn(`[executor] failed to wake for ${contract.id}: ${String(err)}`)
        }
    }
}
```

`_wake(contract)` does four things in sequence:

1. **Resolve the execution goal.** Read the `.aurora` package's
   `domain-types.json` (path from `AuraPluginConfig.auraRoot`). Find the
   entry matching `contract.type`. Look up `entry.execution_goal[resume.action]`
   (falls back to `entry.execution_goal.default` if present, else the
   contract's `intent.goal`). Substitute `{{token}}` placeholders from
   `contract.intent.context`.

2. **Assemble the wake message.** Format the full context the agent needs:
   - Resolved execution goal (with substituted tokens)
   - Contract ID (agent passes this to `aura_complete_contract`)
   - Resume action and artifacts summary

3. **POST to the gateway executor hook.** Use the gateway hook mechanism —
   the confirmed pattern from Phase 4's Gmail chain:
   ```
   POST http://localhost:<gatewayPort>/hooks/aura-executor
   Authorization: Bearer <OPENCLAW_HOOK_TOKEN>
   { contractId, executionGoal: <resolved string>, resume: { action, artifacts } }
   ```
   The gateway routes this via `hooks.mappings` to an agent turn.

4. **Record the executor wake** in `autonomous_log` with
   `action: 'executor_wake'`, `contract_id: contractId`. This confirms
   in the audit trail that the executor fired.

### 04.4 — Gateway hook mapping (bootstrap)

`ensureOpenClawConfig` in `index.js` must write the executor hook mapping
into `openclaw.json` if absent:

```json
{
  "hooks": {
    "mappings": [
      {
        "match": { "path": "aura-executor" },
        "action": "agent",
        "wakeMode": "now",
        "agentId": "aura-studio-ops",
        "sessionKey": "executor:{{contractId}}",
        "messageTemplate": "{{executionGoal}}\n\nContract ID: {{contractId}}\nAction taken: {{resume.action}}"
      }
    ]
  }
}
```

`sessionKey: "executor:{{contractId}}"` gives each contract execution its
own isolated agent session. Multiple contracts in `executing` simultaneously
get separate sessions and do not race.

### 04.5 — Wiring ContractExecutor into the plugin

In `index.js`, after `runtimeSvc.start()`:

```js
const executor = new ContractExecutor({
    auraRoot:      cfg.auraRoot,
    gatewayPort:   cfg.gatewayPort,       // new config field
    hookToken:     process.env['OPENCLAW_HOOK_TOKEN'],
    storage,
    logger:        api.logger,
})

// Pass executor as the execution notifier when constructing runtime
// (ContractRuntimeService wraps ContractRuntime; expose a setter or
// accept it at construction in ContractRuntimeService)
runtimeSvc.setExecutionNotifier(executor)
```

Then in `websocket-service.js`, the TODO line becomes:

```js
this._broadcast(buildClear(contractId, 'resolved'))
this._executor?.onExecuting(await this._runtime.get(contractId)).catch(
    (err) => this._logger.warn(`executor error: ${String(err)}`)
)
```

Where `this._executor` is passed to `WebSocketService` at construction as
an optional 7th parameter (`ExecutionNotifier | null`).

### 04.6 — Token substitution

Token substitution is a pure function — no I/O, fully testable:

```js
// packages/openclaw-plugin/src/services/contract-executor.js
function substituteTokens(template, context) {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) =>
        key in context ? String(context[key]) : `{{${key}}}`
    )
}
```

Unknown tokens are left as `{{key}}` — the agent sees them literally and can
decide how to handle missing data. They are never silently dropped.

---

## 05 — Phase B: Tool Contribution Loader

### 05.1 — Design

The loader reads `aurora-registry.json → tools[]` and dynamically imports
each module at plugin startup. Contributed tools are registered with the
OpenClaw runtime alongside core tools. From the agent's perspective they are
indistinguishable from built-in tools.

The loader runs in `index.js` during plugin registration — after core tools
are registered but before `register()` returns.

### 05.2 — Loader logic

```js
// packages/openclaw-plugin/src/services/tool-loader.js

export async function loadContributedTools(registry, auraRoot, storage, logger, registerFn) {
    for (const entry of registry.tools ?? []) {
        // Connector gating: only register if the named connector is active
        if (entry.connector) {
            const connector = await storage.readConnector(entry.connector)
            if (connector?.status !== 'active') {
                logger.debug?.(`[tool-loader] skipping ${entry.id}: ${entry.connector} not active`)
                continue
            }
        }

        const modulePath = path.resolve(auraRoot, entry.module)
        let mod
        try {
            mod = await import(modulePath)
        } catch (err) {
            logger.warn(`[tool-loader] failed to import ${entry.id}: ${String(err)}`)
            continue
        }

        // Convention: module exports buildX(storage, logger) factory function
        const factoryName = Object.keys(mod).find(k => k.startsWith('build'))
        if (!factoryName) {
            logger.warn(`[tool-loader] ${entry.id}: no build* export found`)
            continue
        }

        const tool = mod[factoryName](storage, logger)
        registerFn(tool)
        logger.info(`[tool-loader] registered contributed tool: ${tool.name} (from ${entry.id})`)
    }
}
```

**Connector gating** is the security boundary: `aura_query_listing` is only
registered when the Etsy connector is `active`. An agent without an active
Etsy connector cannot call the Etsy API — not because we block the call at
runtime, but because the tool does not exist in its tool list.

### 05.3 — Calling the loader in `index.js`

```js
// After core tool registrations, before end of register()
await loadContributedTools(
    registry,          // the imported aurora-registry.json
    cfg.auraRoot,
    storage,
    api.logger,
    (tool) => api.registerTool(toAgentTool(tool, tool.name)),
)
```

### 05.4 — The `auraRoot` config field

`AuraPluginConfig` already has `auraRoot: string`. The `artist-reseller`
package root is resolved from it at startup. For Phase 5, the loader resolves
`entry.module` relative to the `.aurora` package directory:

```js
// packages/openclaw-plugin/src/config/paths.js — add:
export function resolveAuroraPackageDir(auraRoot, packageId) {
    // packages/artist-reseller sits next to openclaw-plugin in the monorepo
    // In production: ~/.aura/packages/<packageId>/
    return path.resolve(auraRoot, 'packages', packageId)
}
```

The `aurora-registry.json` `module` field is already `"./tools/etsy-lookup.js"` —
a path relative to the package root. The loader resolves it against the
package directory, not `auraRoot` directly.

### 05.5 — Dynamic import and ESM

All modules in this codebase are native ESM (`"type": "module"` in
`package.json`). `import(modulePath)` works without any transpilation. The
loader uses absolute file paths — `path.resolve(...)` returns an absolute
path, and Node.js ESM accepts absolute paths with `import()`.

---

## 06 — Phase C: `complete_requires` Enforcement

### 06.1 — Schema change

Add to `BaseContract` in `contract-runtime/src/types/base-contract.d.ts`:

```ts
/**
 * Tool names the agent must call (via aura_log_action) before
 * aura_complete_contract will accept the contract.
 * Populated by the domain type's default or by aura_surface_decision params.
 */
complete_requires?: string[];
```

Add the corresponding field in `base-contract.js` (the validator/schema file
if one exists, or rely on JSON pass-through — verify existing pattern from
`offer-received.js`).

### 06.2 — Tool enforcement in `aura-complete-contract.js`

Replace the current unconditional `runtime.transition` call with:

```js
async execute(_id, params) {
    const p = params
    const contract = await runtime.get(p.contract_id)
    if (!contract) {
        return { content: [{ type: 'text', text: JSON.stringify({
            ok: false, error: `Contract ${p.contract_id} not found`
        }) }], isError: true }
    }

    const required = contract.complete_requires ?? []
    if (required.length > 0) {
        const log = await storage.queryAutonomousLog({ contract_id: p.contract_id })
        const called = new Set(log.map(e => e.action))
        const missing = required.filter(name => !called.has(name))
        if (missing.length > 0) {
            return { content: [{ type: 'text', text: JSON.stringify({
                ok: false,
                error: `Cannot complete: required actions not yet recorded: ${missing.join(', ')}`,
                missing,
            }) }], isError: true }
        }
    }

    await runtime.transition(p.contract_id, 'complete', {
        id: 'agent-primary', type: 'agent',
    })
    return { content: [{ type: 'text', text: JSON.stringify({
        ok: true, contract_id: p.contract_id, summary: p.summary
    }) }] }
}
```

`buildCompleteContract` now needs `storage` as a second parameter. Update
the factory signature and the registration call in `index.js`.

### 06.3 — Who sets `complete_requires`?

Two sources, in priority order:

1. **`aura_surface_decision` call site** — the agent creating the contract
   can pass `complete_requires` explicitly alongside `type`, `goal`, etc.
   This is the most flexible path: the agent reasons about what tools are
   mandatory given the specific context.

2. **Domain type default** — `domain-types.json` can declare a
   `default_complete_requires` per type (not per action). If
   `aura_surface_decision` does not pass `complete_requires`, the bootstrap
   logic seeds the field from the domain type default at contract creation
   time.

For `offer-received / counter`, the practical requirement is:
```json
["email_response_sent"]
```

The agent must call `aura_log_action` with `action: 'email_response_sent'`
before it can call `aura_complete_contract`. This validates that the Gmail
reply was actually sent (and logged) before the contract closes.

### 06.4 — `aura_surface_decision` signature change

Add optional `complete_requires` to the TypeBox schema:

```js
complete_requires: Type.Optional(Type.Array(Type.String(), {
    description: 'Tool action names the agent must log before completing this contract.',
}))
```

Write it directly to the contract JSON at creation time alongside the other
intent fields.

---

## 07 — Phase D: Poshmark aura-app

### 07.1 — Why Poshmark and why Phase 5

Poshmark has no public API. The only automation path is browser-level. This
makes it the canonical `aura-app` test case — the Phase 5 proof that the
`.aurora` package model works for platforms without REST APIs, not just Etsy.

The foundation plan §04 and §06 describe the `aura-app` lifecycle. Phase 5
implements it for the first time.

### 07.2 — The posh-pusher app

The agent scaffolds and launches `posh-pusher` when the owner grants Poshmark
access through the Pulse connector surface. The app is:

```
~/.aura/projects/<workspaceId>/apps/posh-pusher/
  package.json         — Fastify + Lobster dependencies
  server.js            — HTTP server; POST /notify with offer event body
  lobster.pipeline.js  — Lobster browser pipeline for offer page watching
  process.config.js    — PM2 configuration (4 variants: dev/prod × restart policy)
  docker-compose.yml   — Docker Compose alternative
  README.md            — Human-readable; agent writes it
```

`server.js` receives offer events from the Lobster pipeline and emits:

```
POST http://localhost:<gatewayPort>/hooks/wake
Authorization: Bearer <OPENCLAW_HOOK_TOKEN>
{
  "path": "posh-offer",
  "platform": "poshmark",
  "listing_id": "...",
  "listing_title": "...",
  "offer_amount": 45,
  "buyer_id": "...",
  "thread_url": "..."
}
```

The gateway routes `path: "posh-offer"` to an agent turn via `hooks.mappings`.
The agent reads the payload, calls `aura_surface_decision` with type
`offer-received`, and the regular contract flow begins.

The plugin has zero Poshmark knowledge. The `posh-pusher` app has zero
contract knowledge. The gateway hook is the bridge.

### 07.3 — The `aura-app` connector lifecycle

The full lifecycle, implemented in Phase 5:

1. **Not offered** → connector card appears in Pulse when agent determines
   Poshmark offers are coming in (from email or owner mention). Card shows
   capability description. Source: `aura-app`.

2. **Pending** → owner taps "Set Up". Agent scaffolds the app:
   - Agent calls `aura_fs_write` to create scaffold files
   - Agent calls `aura_log_action` with `action: 'app_scaffolded'`
   - Agent detects PM2 vs Docker via `aura_fs_search` (look for `pm2` in PATH)
   - Agent calls `aura_request_connection` to write connector state to pending

3. **Activating** → agent starts the process:
   - For PM2: agent uses exec tool — `pm2 start process.config.js`
   - For Docker: agent uses exec tool — `docker compose up -d`
   - Agent verifies the server is listening (HTTP health check via fetch tool)
   - Agent calls `aura_request_connection` with updated status `active`

4. **Active** → offers flow through `localhost:18789/hooks/posh-offer`.
   Gateway → agent turn → `aura_surface_decision` → contract → Pulse.

5. **Error** → agent detects unhealthy process, uses exec tool to restart,
   logs via `aura_log_action`.

### 07.4 — New `aura-app` connector source type implementation

The `aura-app` literal is already in the `ConnectorSource` union from Phase 4.
Phase 5 adds the process-state fields to `ConnectorState`:

```ts
// connector-state.d.ts — add to ConnectorState (already optional fields)
app_pid?: number;              // PM2 process ID or Docker container ID
app_health_url?: string;       // Health check endpoint inside the app
app_start_cmd?: string;        // How to start: 'pm2 start ...' or 'docker compose up -d'
app_restart_count?: number;    // For display in Pulse
```

No storage migration needed — these fields live in the JSON `payload` column
of the `connectors` table.

### 07.5 — `aurora-registry.json` changes for Poshmark

The `artist-reseller/aurora-registry.json` gains a Poshmark entry in the
`tools` section (no REST API, so no contributed tool — just a declaration
that Lobster must be active):

```json
{
  "id": "poshmark-watcher",
  "module": null,
  "connector": "poshmark",
  "description": "Poshmark offer watcher via Lobster browser automation. No REST API — agent scaffolds posh-pusher app.",
  "contributes": [],
  "requires_connector": true,
  "app_scaffold": "./apps/posh-pusher/"
}
```

The loader skips entries with `"module": null` and `"contributes": []`.
The `app_scaffold` field is informational for Phase 5 — the agent is told
about its package root and can reference scaffold templates from there.

---

## 08 — Phase E: TTL Enforcement Wiring

### 08.1 — Current state

`TtlManager` in `contract-runtime` has the logic. `ContractRuntimeService`
starts the runtime but does not call `ttlManager.start()`. TTL never fires.
Any contract in `waiting_approval` beyond its `expires_at` silently stays
there.

### 08.2 — What to wire

In `ContractRuntimeService.start()`, after `this._runtime.initialize()`:

```js
// ContractRuntime exposes _ttlManager publicly via the d.ts
// Verify: this._runtime._ttlManager (it's public in the type def)
this._runtime._ttlManager.start()
```

TTL config defaults (acceptable for Phase 5; override via `AuraPluginConfig`
extension if needed):
- `checkIntervalMs`: 60_000 (check every minute)
- `resolverTimeoutMs`: 600_000 (10 minutes of resolver_active before returning to waiting_approval)

The foundation plan §08 specifies: `waiting_approval` past `expires_at` →
`failed`. The TTL manager already implements this. No new logic needed.

### 08.3 — `expires_at` population

`aura_surface_decision` currently does not set `expires_at` on new contracts.
Add a default of 24 hours from creation:

```js
// aura-surface-decision.js — in the contract template
expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
```

Override is possible via a `ttl_hours` parameter on the tool (Phase 5 optional;
add the TypeBox field but make it optional with a 24-hour default).

---

## 09 — File Inventory

### New files

| File | Purpose |
|---|---|
| `packages/contract-runtime/src/runtime/execution-notifier.d.ts` | `ExecutionNotifier` interface |
| `packages/contract-runtime/src/runtime/execution-notifier.js` | No-op base impl (mirrors completion-notifier.js pattern) |
| `packages/openclaw-plugin/src/services/contract-executor.js` | `ContractExecutor` class implementing `ExecutionNotifier` |
| `packages/openclaw-plugin/src/services/tool-loader.js` | `loadContributedTools()` factory |
| `packages/artist-reseller/apps/posh-pusher/server.js` | Fastify stub (agent fills in) |
| `packages/artist-reseller/apps/posh-pusher/process.config.js` | PM2 config template |
| `packages/artist-reseller/apps/posh-pusher/docker-compose.yml` | Docker Compose template |

### Modified files

| File | Changes |
|---|---|
| `packages/contract-runtime/src/runtime/contract-runtime.d.ts` | Add `executionNotifier` 4th constructor param; call `onExecuting` in `resume()` |
| `packages/contract-runtime/src/runtime/contract-runtime.js` | Wire `_executionNotifier`; call `onExecuting` after `executing` commit |
| `packages/contract-runtime/src/types/base-contract.d.ts` | Add `complete_requires?: string[]` |
| `packages/contract-runtime/src/index.d.ts` | Export `ExecutionNotifier` |
| `packages/openclaw-plugin/src/services/contract-runtime-service.js` | Add `setExecutionNotifier()`, wire TTL start, wire executor to runtime |
| `packages/openclaw-plugin/src/services/websocket-service.js` | Replace TODO with live `executor.onExecuting()` call; add optional 7th constructor param |
| `packages/openclaw-plugin/src/services/websocket-service.d.ts` | Add 7th constructor param type |
| `packages/openclaw-plugin/src/tools/aura-complete-contract.js` | Add `storage` param; validate `complete_requires` before transitioning |
| `packages/openclaw-plugin/src/tools/aura-surface-decision.js` | Add `complete_requires` and `ttl_hours` optional params; set `expires_at` |
| `packages/openclaw-plugin/index.js` | Construct `ContractExecutor`; call `loadContributedTools()`; add `gatewayPort` to config; extend `ensureOpenClawConfig` with executor hook mapping |
| `packages/openclaw-plugin/src/config/schema.js` | Add `gatewayPort: number` (default `18789`) |
| `packages/openclaw-plugin/src/config/schema.d.ts` | Same |
| `packages/artist-reseller/aurora-registry.json` | Add Poshmark entry under `tools` |
| `packages/artist-reseller/domain-types.json` | Add `default_complete_requires` per type |
| `packages/artist-reseller/apps/posh-pusher/` | Scaffold templates (not agent-generated; starter files only) |

---

## 10 — Test Strategy

### Unit tests

**`contract-executor.test.js`**
- `_resolveGoal` — returns correct goal template for type/action pair
- `_substituteTokens` — replaces `{{key}}` from context; leaves unknown tokens as-is
- `onExecuting` — swallows errors, logs them, does not rethrow

**`tool-loader.test.js`**
- Loads a module with a `build*` export and registers the returned tool
- Skips a module if connector status is not `active`
- Logs a warning and continues if `import()` fails
- Logs a warning and continues if no `build*` export found

**`aura-complete-contract.test.js`**
- Success: no `complete_requires`; transitions to `complete`
- Success: `complete_requires` satisfied in `autonomous_log`; transitions to `complete`
- Failure: `complete_requires` has missing entry; returns `isError: true`; contract stays `executing`
- Failure: contract not found; returns `isError: true`

**`token-substitution.test.js`** (extracted pure function)
- `{{gmail_thread_id}}` substituted from context
- Multiple tokens in one string
- Unknown token left as `{{key}}`
- Empty context — all tokens left as-is

### Integration tests

**`executor-e2e.test.js`** (new integration test)

This test covers the full loop from `resolve` to the executor POST:

- Beat 1–5: reuse the existing artist-reseller E2E beats (surface → resolve → `executing`)
- Beat 6a: spy on `api.runtime.system.enqueueSystemEvent` and `api.runtime.system.requestHeartbeatNow`
  - Verify `enqueueSystemEvent` called with goal text containing substituted `thread-abc123`
  - Verify `requestHeartbeatNow` called with `{ sessionKey: 'agent:main:main', reason: 'executor:<contractId>' }`
  - (mock `loadConfig()` returns default single-agent config)
- Beat 6b: `autonomous_log` contains `executor_wake` entry
- Beat 6c: `runtime.transition(→complete)` fires `CompletionNotifier.onComplete` — verify it does not throw
  (Engram captures the contract context automatically from the agent conversation; no explicit POST to verify)

**`tool-loader-integration.test.js`**

- Mock `aurora-registry.json` with an Etsy entry
- Seed the SQLite connector with `status: 'active'` for `etsy`
- Call `loadContributedTools(...)` against the real `etsy-lookup.js` module
- Verify `api.registerTool` was called with a tool named `aura_query_listing`
- Repeat with `status: 'not-offered'` — verify no tool registered

**`complete-requires-integration.test.js`**

- Create a contract with `complete_requires: ['email_response_sent']`
- Drive to `executing`, call `aura_complete_contract` — verify rejected
- Call `aura_log_action` with `action: 'email_response_sent'`
- Call `aura_complete_contract` again — verify success

### Regression: existing suite must stay at 85/85

All existing tests pass unchanged. The executor integration with
`WebSocketService` is opt-in (7th constructor param defaults to null).
The existing `artist-reseller-e2e.test.js` does not pass an executor
— the TODO path is simply a no-op null check.

---

## 11 — Foundation Plan Source-of-Truth Order

This is the precedence order for the Phase 5 implementation pass, updating
the order established in Phase 3 stabilization:

1. **Tested cross-phase behavior** — if `artist-reseller-e2e.test.js` says
   how `resolve → executing` works, that is authoritative for the seam.

2. **This Phase 5 plan** — resolves all Phase 4/4b drift and is the current
   implementation reference.

3. **Foundation Plan v0.5** — authoritative for architectural intent,
   philosophical rules, and role boundaries. See §01 of this document for
   confirmed drift items.

4. **Phase 4 / Phase 4b plans** — historical accuracy; Phase 5 plan is
   settled against those.

---

## 12 — Done When

The following checklist defines completion. All must be true simultaneously.

**Core loop:**
- [ ] `ContractExecutor.onExecuting()` is called after every `executing` transition
- [ ] The executor calls `enqueueSystemEvent(goal, { sessionKey })` + `requestHeartbeatNow({ sessionKey })` on every execution
- [ ] `executor_wake` appears in `autonomous_log` for every execution

**Tool contribution:**
- [ ] `aura_query_listing` is registered when the Etsy connector is `active`
- [ ] `aura_query_listing` is NOT registered when Etsy connector is absent or not-offered
- [ ] Dynamic import failure does not crash the plugin

**Completeness enforcement:**
- [ ] `aura_complete_contract` rejects if `complete_requires` items are missing from the log
- [ ] `aura_complete_contract` succeeds when all required items are present
- [ ] `aura_surface_decision` passes `complete_requires` through to the contract

**TTL:**
- [ ] `TtlManager` is started in `ContractRuntimeService.start()`
- [ ] Contracts in `waiting_approval` past `expires_at` transition to `failed`
- [ ] New contracts from `aura_surface_decision` have a 24-hour default `expires_at`

**Poshmark:**
- [ ] `aura-app` connector lifecycle documented in `artist-reseller/aurora-registry.json`
- [ ] `posh-pusher` scaffold templates exist under `artist-reseller/apps/posh-pusher/`
- [ ] Poshmark `offer-received` contract flow is identical in structure to the Etsy flow

**Quality:**
- [ ] All unit tests pass (new + existing)
- [ ] `executor-e2e.test.js` passes
- [ ] `tool-loader-integration.test.js` passes
- [ ] `complete-requires-integration.test.js` passes
- [ ] Zero typecheck errors across `contract-runtime` and `openclaw-plugin`
- [ ] No `gog`, `gmail`, `etsy`, or `poshmark` string literals in `openclaw-plugin/src/`
  (except in `schema.d.ts` JSDoc examples and `websocket-protocol.js` comments)

---

## 13 — Addendum: Phases F and G
**Based on: OpenClaw automation docs review + architectural Q&A, March 28, 2026**

This addendum supersedes any conflicting detail in sections 01–12 above. It
adds two phases to the Phase 5 scope and corrects the ContractExecutor
implementation approach in Phase A.

---

### §A Correction: ContractExecutor uses `enqueueSystemEvent` + `requestHeartbeatNow`, not a webhook POST

**Supersedes §04.3 and §04.4.**

The original plan called `POST /hooks/aura-executor` from inside
`ContractExecutor._wake()`, requiring `gatewayPort`, `OPENCLAW_HOOK_TOKEN`,
and a `hooks.mappings` entry written to `openclaw.json` at bootstrap.

**All of that is dropped.** The plugin runs in-process with the Gateway.
`api.runtime.system.enqueueSystemEvent` + `api.runtime.system.requestHeartbeatNow`
are the direct path — no HTTP round-trip, no token management, no isolated
background session:

```js
// ContractExecutor._wake(contract)
const cfg = await this._api.runtime.config.loadConfig();
const agentId =
    cfg.agents?.list?.find(a => a.default)?.id ??
    cfg.agents?.list?.[0]?.id ??
    'main';
const sessionKey = cfg.session?.scope === 'global'
    ? 'global'
    : `agent:${agentId}:${cfg.session?.mainKey ?? 'main'}`;

await this._api.runtime.system.enqueueSystemEvent(resolvedGoal, { sessionKey });
this._api.runtime.system.requestHeartbeatNow({
    sessionKey,
    reason: `executor:${contract.id}`,
});
```

`api.runtime` is passed to `ContractExecutor` at construction from
`register(api)`. `enqueueSystemEvent` prepends the goal text to the main
agent's next prompt for that session. `requestHeartbeatNow` schedules a
turn for that session within ~250ms (coalescing timer), retrying if the
session is busy. The main agent receives the goal with its full registered
tool set (`aura_complete_contract`, `aura_log_action`, etc.) intact.

**`sessionKey` derivation** mirrors `resolveMainSessionKey(cfg)` from
OpenClaw's `src/config/sessions/main-session.ts` — inlined rather than
imported so the plugin has no coupling to OpenClaw internals. For the
default single-agent setup this produces `"agent:main:main"`.

**`enqueueSystemEvent` contract:**
- `sessionKey` is **required** — throws if blank
- In-memory queue, max 20 events per session, drained at next prompt
- Deduplicates consecutive identical texts (safe to call per contract)

**Drops from the implementation entirely:**
- `ContractExecutor` constructor params `gatewayPort`, `hookToken`
- `ensureOpenClawConfig` executor mapping block
- `AuraPluginConfig.gatewayPort` field and schema entry
- `postSystemEvent()` helper
- `api.runtime.subagent` usage in `ContractExecutor` for contract wakes
  (`ContractExecutor._wake()` uses `enqueueSystemEvent` + `requestHeartbeatNow`;
  §F cron reconciliation keeps `subagent.run()` — it's a discrete task
  needing only built-in `cron.list`/`cron.add`, no plugin tools)

**Drops from §09 modified files table:**
- `schema.js` / `schema.d.ts` `gatewayPort` entry

---

### §F: Declarative Triggers Registry

#### The naming fix

`hooks[]` is renamed `triggers[]` in `aurora-registry.json`. The word
"hooks" collides with three distinct OpenClaw mechanisms. `triggers[]` is
unambiguous: declarations of what external events cause a contract to be
created.

#### The three OpenClaw automation mechanisms — distinct layers

| Mechanism | What it is | How Aura uses it |
|---|---|---|
| **Lifecycle hooks** | TypeScript handlers registered via `api.registerHook(event, fn)` or `HOOK.md` files; run in-process on Gateway events (`gateway:startup`, `command:new`, `agent:bootstrap`, `message:received`) | Plugin-internal only — e.g. cron reconciliation on startup |
| **Webhooks** (`/hooks/<name>`) | HTTP ingress exposed by the Gateway; external daemons POST to them; routed via `hooks.mappings[]` | What `gog gmail watch serve` and `posh-pusher` POST to |
| **Gmail Pub/Sub** | Three-tier pipeline: Gmail inbox → Google Pub/Sub topic → `gog gmail watch serve` daemon → `POST /hooks/gmail` (webhook layer) → agent turn | Gmail offer detection |

Plugin-registered lifecycle hooks appear in `openclaw hooks list` alongside
file-based hooks. They are not HTTP. Not external. In-process event listeners.

#### `triggers[]` — final three entries

```json
"triggers": [
  {
    "id": "gmail-offers",
    "kind": "gmail-preset",
    "description": "Watches Gmail inbox for marketplace offer emails via gog + Pub/Sub",
    "creates": "offer-received",
    "instruction": "If the email is a marketplace offer (Poshmark, Mercari, eBay, Depop), call aura_surface_decision with type='offer-received'. Include: platform, listing title, offer amount, buyer username, gmail thread ID."
  },
  {
    "id": "calendar-monitor",
    "kind": "heartbeat",
    "description": "Periodic calendar check via gog. No push mechanism available — heartbeat is the correct fit.",
    "directive": "- Run: gog calendar list --account {{gmail_account}} --days 1 --tag \"[aura]\"\n  For each event returned that has no matching open contract (check via aura_query_contracts), call aura_surface_decision with the appropriate type."
  },
  {
    "id": "morning-brief",
    "kind": "cron",
    "description": "Daily morning brief at 7am Pacific",
    "creates": "morning-brief",
    "schedule": "0 7 * * *",
    "tz": "America/Los_Angeles",
    "session": "isolated",
    "instruction": "Generate the morning brief. Summarize: pending decisions awaiting the owner, autonomous actions taken overnight, calendar items in the next 48h. Call aura_surface_decision with type='morning-brief'."
  }
]
```

**Why `calendar-monitor` is heartbeat, not webhook:**
`gog calendar` is a pull command — no push mechanism exists without a
separate Pub/Sub setup. The heartbeat decision flowchart (OpenClaw docs) is
explicit: "Monitor calendar for upcoming events → Heartbeat: natural fit for
periodic awareness." Checking every 30 minutes is appropriate latency for
calendar events tagged `[aura]`. Calendar event IDs are stable — the agent
cross-references `aura_query_contracts` to avoid duplicates in the same turn.

**`gog` covers both Gmail and Calendar** — one tool, one auth setup, already
a required dependency for Gmail Pub/Sub. Zero additional installation cost.
The `--account` value is the same `hooks.gmail.account` that bootstrap
already writes to `openclaw.json`, substituted into the heartbeat directive.

#### `ensureTriggers(registry, api)` — new bootstrap function

Called from `register(api)` immediately after `ensureOpenClawConfig`.

**`gmail-preset` processing:**
Merges `hooks.presets: ["gmail"]` into `openclaw.json`. Idempotent (Set
deduplication). Gateway auto-starts `gog gmail watch serve` when
`hooks.gmail.account` is configured — plugin does not touch `gog` directly.

**`heartbeat` processing:**
Appends `directive` text to workspace `HEARTBEAT.md`. Idempotent: skips if
the first 40 characters of the directive are already present. Substitutes
`{{gmail_account}}` from `AuraPluginConfig`.

**`cron` processing:**
Registers a `gateway:startup` typed lifecycle hook via
`api.registerHook('gateway:startup', handler)`. The handler fires once when
the Gateway starts and calls `api.runtime.subagent.run()` with a
reconciliation prompt. The agent calls `cron.list`, compares against declared
trigger IDs, and calls `cron.add` for any missing jobs. Idempotent — the
agent won't duplicate existing jobs.

A subagent is correct here: cron reconciliation only needs `cron.list` and
`cron.add`, both of which are OpenClaw built-in tools available in any
session. No plugin-registered tools, no AGENTS.md standing-order context
required. Using a subagent keeps the startup hook isolated and doesn't
interrupt any in-progress main-agent session.

```js
api.registerHook('gateway:startup', async () => {
    const ids = cronTriggers.map(t => t.id).join(', ')
    await api.runtime.subagent.run({
        sessionKey: 'aura:cron-reconcile',
        message:
            `[Aura startup] Reconcile scheduled cron jobs against .aurora registry.\n` +
            `Declared triggers: ${ids}.\n` +
            `Call cron.list, then cron.add for any not yet registered.\n` +
            `Schedules: morning-brief = 0 7 * * * America/Los_Angeles.`,
        deliver: false,
    })
})
```

#### Standing orders — cron triggers

Cron trigger `instruction` in the registry is a summary. The full standing
order lives in `AGENTS.md` (auto-injected every session). The cron job's
`message` references the standing order by name, not duplicating it:

```
## Standing Order: Morning Brief (Program: daily-brief)

**Authority:** Read contracts DB, autonomous_log, query calendar via gog
**Trigger:** Cron job `morning-brief` — 0 7 * * * PT (registered on startup)
**Approval gate:** None — brief is surfaced as read-only morning-brief contract
**Escalation:** If calendar unavailable, surface brief with note

### Steps
1. aura_query_contracts(status='waiting_approval') — pending decisions
2. aura_query_contracts(status='complete', updated_after=yesterday) — overnight actions
3. gog calendar list --account <account> --days 2
4. aura_surface_decision(type='morning-brief', ...)
```

#### New and modified files

| File | Change |
|---|---|
| `packages/openclaw-plugin/src/services/trigger-bootstrap.js` | **New** — `ensureTriggers(registry, api)` |
| `packages/artist-reseller/aurora-registry.json` | Add `triggers[]` with 3 entries |
| `packages/openclaw-plugin/index.js` | Call `ensureTriggers()`; register `gateway:startup` hook for cron reconciliation |
| `packages/openclaw-plugin/src/config/schema.js` | Add `workspaceDir: string` (for HEARTBEAT.md path) |

#### Phase F "Done When"

- [ ] `triggers[]` in `aurora-registry.json` has 3 entries (gmail-preset, heartbeat, cron)
- [ ] Bootstrap writes `hooks.presets: ["gmail"]` to `openclaw.json` from `gmail-preset` trigger
- [ ] Bootstrap appends `calendar-monitor` directive to `HEARTBEAT.md` (idempotent; `{{gmail_account}}` substituted)
- [ ] Plugin registers `gateway:startup` typed hook; fires subagent cron reconciliation on start
- [ ] No occurrence of the word "hooks" in `aurora-registry.json`

---

### §G: Contract Queue Management — TTL Deletion

**No archival status. No new columns. No schema migration. No new service.**

Engram is installed as a native OpenClaw plugin alongside the Aura plugin.
It automatically captures contract context from the agent conversation turn
where `aura_complete_contract` is called (including all goal text injected
via `enqueueSystemEvent` with `{{token}}`-substituted fields). No explicit
observe POST or bridge needed. SQLite is the live operational store, not the
long-term archive. Terminal contracts are deleted after a retention window by
extending `TtlManager`'s existing check loop.

#### `TtlManager._cleanup()` — added to existing check interval

```js
async _cleanup() {
    const now = Date.now()
    const completeCutoff = new Date(now - this._config.completeRetentionDays * 86_400_000).toISOString()
    const failedCutoff   = new Date(now - this._config.failedRetentionDays   * 86_400_000).toISOString()

    // Clean orphaned log rows before deleting contracts
    // (handles case where ON DELETE CASCADE is not set on foreign keys)
    this._db.prepare(
        `DELETE FROM autonomous_log WHERE contract_id NOT IN (SELECT id FROM contracts)`
    ).run()
    this._db.prepare(
        `DELETE FROM contract_log WHERE contract_id NOT IN (SELECT id FROM contracts)`
    ).run()

    const deleted = this._db.prepare(`
        DELETE FROM contracts
        WHERE (status = 'complete' AND updated_at < ?)
           OR (status = 'failed'   AND updated_at < ?)
    `).run(completeCutoff, failedCutoff).changes

    if (deleted > 0) this._logger.info(`[ttl] deleted ${deleted} expired terminal contracts`)
}
```

Called from the existing `_check()` interval — not a separate timer. No
agent turn. No webhook. No `autonomous_log` entry. Pure SQL maintenance.

`GET /aura/history` naturally excludes deleted rows because they no longer
exist. No filter changes anywhere.

#### New config fields

```js
// ContractRuntimeConfig / AuraPluginConfig
completeRetentionDays: 30,   // delete complete contracts after 30 days
failedRetentionDays:    7,   // delete failed contracts after 7 days
```

#### Modified files — Phase G

| File | Change |
|---|---|
| `packages/contract-runtime/src/runtime/ttl-manager.js` | Add `_cleanup()`, call from check loop |
| `packages/contract-runtime/src/runtime/ttl-manager.d.ts` | Add `completeRetentionDays`, `failedRetentionDays` to config type |
| `packages/openclaw-plugin/src/config/schema.js` | Add `ttl.completeRetentionDays` (30), `ttl.failedRetentionDays` (7) |

#### Phase G "Done When"

- [ ] `TtlManager._cleanup()` deletes `complete` rows older than 30 days
- [ ] `TtlManager._cleanup()` deletes `failed` rows older than 7 days
- [ ] Orphaned `autonomous_log` and `contract_log` rows cleaned before contract deletion
- [ ] No schema migration required — zero new columns or tables
- [ ] No agent turn, no webhook, no `autonomous_log` entry for maintenance operations
- [ ] `GET /aura/history` naturally excludes deleted rows

---

### §H: Future seam — `api.registerContextEngine()` (Phase 6+)

Not implemented in Phase 5. Documented as the architectural anchor.

`api.registerContextEngine(id, factory)`, selected via
`plugins.slots.contextEngine` in `openclaw.json`, is the kernel seam for
Aura OS's context orchestration layer. A Phase 6 `AuraContextEngine`
implementing `ingest()` / `assemble()` / `compact()` would control what loads
into agent context, from which memory tiers, in what order — integrating
Engram's memory graph with the contract runtime's pending decisions. This is
the "kernel" in the Agent OS analogy. The API surface is confirmed to exist
and is stable for external plugins.

---

### Updated complete phase decomposition

| Phase | Name | Key notes |
|---|---|---|
| A | ExecutionNotifier + ContractExecutor | `enqueueSystemEvent` + `requestHeartbeatNow` — no webhook POST |
| B | Tool Contribution Loader | Unchanged |
| C | `complete_requires` enforcement | Unchanged |
| D | Poshmark aura-app | Unchanged |
| E | TTL enforcement wiring | Unchanged |
| F | Declarative Triggers Registry | `triggers[]`; 3 entries; `ensureTriggers()`; cron via `gateway:startup` hook |
| G | Contract Queue Management | `TtlManager._cleanup()`; 3 file changes; no migration |

F depends on A only for the `api` reference being wired through to the plugin
(same construction pattern). F's cron reconciliation uses `subagent.run()`
independently — unaffected by the §A correction. G depends on E only in that
it follows the same `start()`/`stop()` wiring pattern. Both can be implemented
in parallel with B, C, D.
