# Aura OS — Phase 4b Plan
**Core Cleanup: Remove Backend Side Effects, Define the Execution Seam**
version: 1.0 | status: implementation-ready
date: March 28, 2026

---

## 00 — Why This Phase Exists

Phase 4 shipped a working end-to-end demo. In doing so it made two
architectural mistakes that would undermine Phase 5 if left in:

1. **Backend-fired side effects.** `_sendGmailReply` in `websocket-service.js`
   fires a Gmail reply automatically when a Resolver commits with
   `send_response: true`. The backend is executing work that belongs to the
   agent. The `gog gmail` skill is already registered in OpenClaw. The agent
   should call it — not the plugin layer.

2. **Platform code in core.** `aura-query-listing.js` contains Etsy-specific
   API logic inside the `openclaw-plugin` package. Every new marketplace
   integration would require a change to core. That is the opposite of the
   `.aurora` package model.

Phase 4b removes both of these before Phase 5 builds the `ContractExecutor`
and tool-contribution loader on top. Phase 5 must be purely additive. It
cannot be a cleanup-plus-build exercise.

---

## 01 — The Correct Architecture (Locked In After Phase 4)

**Core (`openclaw-plugin`) is responsible for:**
- Contract lifecycle: create → waiting_approval → resolver_active →
  executing → complete / failed
- State machine enforcement and resume-token validation
- Surfacing decisions to the Resolver (Pulse PWA)
- Connector seeding and credential storage
- Autonomous log writes from tool calls
- Engram completion payloads on contract completion (bridge stays in core —
  it is a generic post-completion hook, not platform-specific)
- Plugin/registry bootstrap

**Core is NOT responsible for:**
- Calling any external service (Gmail, Etsy, Poshmark, etc.)
- Knowing about any specific platform or connector protocol
- Running any LLM-facing work after `executing` is reached

**The `.aurora` package is responsible for:**
- Declaring domain contract types (`domain-types.json`)
- Declaring required plugins, skills, and tools (`aurora-registry.json`)
- Contributing connector-specific tools that the agent uses during execution
  (`tools/` directory — Phase 5 loads these)
- Supplying execution instructions via the contract's `intent.goal` and
  surface prompt — the contract tells the agent what to do, the package
  supplies the tools to do it with

**The agent is responsible for:**
- All work in the `executing` state
- Calling registered skills (`gog gmail reply`, Etsy tool, etc.)
- Calling `aura_log_action` and `aura_complete_contract` to close the contract
- Never guessing — the contract's goal is the explicit instruction set

**Determinism comes from the contract, not from backend automation.**
The runtime will (Phase 5) enforce `complete_requires` — the agent cannot
close a contract until the declared tool calls have been recorded. The
backend fires nothing. The agent does the work. The contract validates it.

---

## 02 — What Phase 4b Delivers

By the end of this phase:

- `_sendGmailReply`, `spawnGog`, and `execFile`-of-gog are deleted from
  `websocket-service.js`. The `resolve` handler transitions to `executing`
  and stops. No email is sent automatically, ever.
- `aura-query-listing.js` is deleted from `openclaw-plugin/src/tools/` and
  unregistered from `index.js`. Core has zero Etsy knowledge.
- `artist-reseller/aurora-registry.json` gains a `tools` section declaring
  the Etsy lookup tool contribution (stub — loader is Phase 5).
- `artist-reseller/tools/etsy-lookup.js` contains the Etsy API logic moved
  verbatim from the deleted core file.
- The `executing` state is documented as the Phase 5 executor entry point.
  A `// TODO(phase-5): invoke ContractExecutor` comment marks the seam.
- `intent.goal` templates are added to each contract type in
  `artist-reseller/domain-types.json` — explicit agent instructions per
  type, used by the executor when it wakes up.
- The E2E integration test (Phase 4 Beat 6a) is updated: it no longer asserts
  that `gog gmail reply` was called by the backend. It asserts that the
  contract reached `executing` with correct `resume.artifacts`, and that those
  artifacts contain everything the agent would need to complete the work.
- `aura_complete_contract` stub tool is added to core — accepts `contract_id`
  and `summary`, transitions to `complete`. This is the terminal tool the
  agent will call. It must exist before the executor can call it.
- 85/85 tests pass.
- Zero typecheck errors.

**Not in Phase 4b:**
- Building the `ContractExecutor` (Phase 5)
- Loading `artist-reseller/tools/etsy-lookup.js` at runtime (Phase 5)
- Enforcing `complete_requires` (Phase 5)
- Any new contract types or scenarios

---

## 03 — File Inventory

### Delete
| File | Reason |
|---|---|
| `packages/openclaw-plugin/src/tools/aura-query-listing.js` | Etsy code moves into `.aurora` package |

### Modify
| File | Changes |
|---|---|
| `packages/openclaw-plugin/src/services/websocket-service.js` | Remove `_sendGmailReply`, `spawnGog`, `execFile` import. `resolve` handler ends at `runtime.resume()` + `buildClear`. Add `// TODO(phase-5)` comment at executing seam. |
| `packages/openclaw-plugin/index.js` | Remove `buildQueryListing` import and registration. Remove `execFile` import if unused after above. |
| `packages/openclaw-plugin/tests/integration/artist-reseller-e2e.test.js` | Remove Beat 6a (`execFile` / `gog gmail reply` assertion). Rewrite Beat 6 to assert contract is in `executing` state with correct `resume.artifacts`. Remove `execFile` mock entirely. |
| `packages/artist-reseller/aurora-registry.json` | Add `tools` section with Etsy lookup stub entry. |
| `packages/artist-reseller/domain-types.json` | Add `execution_goal` field to each type spec — the agent instruction template for the executor. |

### Create
| File | Purpose |
|---|---|
| `packages/artist-reseller/tools/etsy-lookup.js` | Etsy API logic verbatim from deleted core file. Module-only — not loaded at runtime until Phase 5. |
| `packages/openclaw-plugin/src/tools/aura-complete-contract.js` | New core tool. Agent calls this to close a contract. Validates contract exists, transitions to `complete`. |

---

## 04 — Implementation Steps

### Step A — Delete `aura-query-listing.js` and deregister

Remove the file. Remove the `buildQueryListing` import and its registration
call in `index.js`. Confirm typecheck passes.

### Step B — Strip `_sendGmailReply` from `websocket-service.js`

In the `resolve` case of `_handleInbound`:
```js
// BEFORE (Phase 4 — wrong)
await this._runtime.resume(...)
this._broadcast(buildClear(...))
if (artifacts?.['send_response'] === true) {
    // ... send email ...
}

// AFTER (Phase 4b — correct)
await this._runtime.resume(...)
this._broadcast(buildClear(...))
// TODO(phase-5): ContractExecutor wakes here for contracts in 'executing'
// The agent reads resume.artifacts and drives tool calls to completion.
// Required tools and completion conditions are declared in the .aurora
// package's workflows.json (Phase 5).
```

Remove `spawnGog`, `execFile` import, `randomUUID` import (if only used for
Gmail reply logging — confirm no other callers first). Remove
`_sendGmailReply` method entirely.

### Step C — Create `artist-reseller/tools/etsy-lookup.js`

Move the Etsy logic from the deleted core tool verbatim. The file is a
plain ES module exporting a `buildEtsyLookup(store, logger)` factory
returning a `RegisteredTool`-shaped object. Not imported at startup yet —
Phase 5 builds the loader.

### Step D — Update `aurora-registry.json`

Add a `tools` section:
```json
"tools": [
  {
    "id": "etsy-lookup",
    "module": "./tools/etsy-lookup.js",
    "connector": "etsy",
    "description": "Fetch the current asking price for an Etsy listing. Requires the Etsy connector to be active.",
    "contributes": ["aura_query_listing"]
  }
]
```

This is the declaration. The loader that reads it is Phase 5.

### Step E — Add `execution_goal` to `domain-types.json`

Each type entry gets an `execution_goal` string — the explicit instruction
the executor passes to the agent when the contract hits `executing`:

```json
{
  "type": "offer-received",
  "execution_goal": {
    "counter": "The owner has chosen to counter this offer. Use the gog gmail skill to reply to the buyer on thread {{gmail_thread_id}} using the response_body from the resolver artifacts. Then call aura_log_action with action='email_response_sent' and aura_complete_contract.",
    "accept":  "The owner has accepted this offer. Use the gog gmail skill to send an acceptance reply on thread {{gmail_thread_id}}. Then call aura_log_action and aura_complete_contract.",
    "decline": "The owner has declined this offer. No reply is needed unless decline_with_message is true in the resolver artifacts. Call aura_complete_contract when done."
  }
}
```

Mustache-style `{{field}}` tokens are substituted from `contract.intent.context`
at executor invocation time (Phase 5). The loader already reads `domain-types.json`
— adding `execution_goal` is a data-only change, no loader code change needed.
The field is optional per spec (existing types without it just don't drive
automated execution).

### Step F — Add `aura-complete-contract` tool to core

```js
// packages/openclaw-plugin/src/tools/aura-complete-contract.js
export function buildCompleteContract(runtime) {
    return {
        name: 'aura_complete_contract',
        description: 'Mark a contract as complete after all required work is done. ' +
            'Call this as the final step of any executing contract. ' +
            'The runtime will reject the transition if required tool calls have not been recorded.',
        parameters: { ... },  // contract_id: string, summary: string
        async execute(_id, { contract_id, summary }) {
            await runtime.transition(contract_id, 'complete', {
                id: 'aura-pulse', type: 'agent'
            })
            return { content: [{ type: 'text', text: JSON.stringify({ ok: true, contract_id, summary }) }] }
        },
    }
}
```

Register in `index.js`. This tool is the only valid path to `complete` for
an agent-executed contract. The human Resolver path (already working) is
unchanged.

### Step G — Rewrite Beat 6 in the E2E test

Beat 6 currently has three sub-beats: gog called (6a), Engram tagged (6b),
autonomous log (6c).

After Phase 4b:
- **Beat 6a (removed):** gog is no longer called by the backend — this
  assertion tests the wrong actor
- **Beat 6b (keep):** Engram POST still fires from `EngramCompletionBridge`
  on `complete` — this is a core generic hook, not platform-specific. Keep
  this assertion. The test must drive the contract to `complete` explicitly
  via `runtime.transition(...)` as it did before.
- **Beat 6c (keep as Beat 6b):** autonomous log entry for `email_response_sent`
  — this will NOT be present after Phase 4b since the backend no longer logs
  it. Replace with an assertion that `resume.artifacts` contains
  `send_response: true`, `response_body`, and `gmail_thread_id` — everything
  the agent would need. The log entry for `email_response_sent` will return
  in Phase 5 when the agent calls `aura_log_action` itself.
- **New Beat 6a:** assert contract status is `executing` after `resolve`.
  Assert `resume.artifacts` shape is complete and correct.
- Remove `execFile` mock from the test entirely.

### Step H — Confirm tests and typecheck

```bash
pnpm --filter @aura/aura-pulse test
pnpm --filter @aura/aura-pulse typecheck
```

Target: 85 passed (adjusted for removed Beat 6a), zero type errors.

---

## 05 — The Execution Seam (What Phase 5 Connects To)

After Phase 4b, the `resolve` handler in `websocket-service.js` looks like:

```js
case 'resolve':
    await this._runtime.resume(contractId, token, resolver, action, value, artifacts)
    this._broadcast(buildClear(contractId, 'resolved'))
    // TODO(phase-5): ContractExecutor.wake(contractId)
    // The runtime has already transitioned to 'executing'.
    // The executor reads resume.artifacts, substitutes execution_goal
    // tokens from contract context, and invokes the agent with the
    // package-supplied tools in scope.
    break
```

Phase 5 replaces the comment with a real call. Nothing else in this file
changes. The seam is clean.

---

## 06 — `aurora-registry.json` Shape After Phase 4b

```json
{
  "version": "1.0",
  "plugins": {
    "required": [ ... ],
    "optional": [ ... ]
  },
  "tools": [
    {
      "id": "etsy-lookup",
      "module": "./tools/etsy-lookup.js",
      "connector": "etsy",
      "description": "Fetch the current asking price for an Etsy listing.",
      "contributes": ["aura_query_listing"]
    }
  ],
  "openclawConfig": { ... }
}
```

The `tools` array is the extension point Phase 5 iterates. Each entry names
a module path relative to the `.aurora` package root, the connector it
depends on (so the loader can skip if not active), and the tool names it
contributes to the agent's context.

---

## 07 — What Phase 5 Receives

| Artifact | State |
|---|---|
| `resolve → executing` transition | Clean, no side effects |
| `// TODO(phase-5)` seam | One call site, clearly marked |
| `aura_complete_contract` tool | Registered, tested |
| `artist-reseller/tools/etsy-lookup.js` | Exists, not yet loaded |
| `aurora-registry.json` `tools` section | Declared, not yet iterated |
| `execution_goal` in `domain-types.json` | Declared, not yet substituted |
| `ContractExecutor` interface | To be defined in Phase 5 |
| Tool contribution loader | To be built in Phase 5 |
| `complete_requires` enforcement | To be built in Phase 5 |

Phase 5 is purely additive. It wires the executor, loads the tools, and
enforces completion. It does not need to clean anything up.

---

## 08 — Verification Checklist

**Core cleanup**
- [ ] `_sendGmailReply` deleted from `websocket-service.js`
- [ ] `spawnGog` deleted from `websocket-service.js`
- [ ] No `gog` or `gmail` string literals remain in `openclaw-plugin/src/`
- [ ] No `etsy` string literals remain in `openclaw-plugin/src/`
- [ ] `aura-query-listing.js` deleted from core tools
- [ ] `buildQueryListing` import removed from `index.js`

**Execution seam**
- [ ] `resolve` handler ends at `runtime.resume()` + `buildClear`
- [ ] `// TODO(phase-5): ContractExecutor.wake(contractId)` comment present
- [ ] `aura_complete_contract` tool registered and tested

**`.aurora` package**
- [ ] `artist-reseller/tools/etsy-lookup.js` exists with Etsy logic
- [ ] `aurora-registry.json` has `tools` section with etsy-lookup entry
- [ ] `domain-types.json` `offer-received` type has `execution_goal` map
- [ ] `domain-types.json` `listing-draft` type has `execution_goal` stub
- [ ] `domain-types.json` `shipping-delay` type has `execution_goal` stub
- [ ] `domain-types.json` `inventory-alert` type has `execution_goal` stub

**Tests and types**
- [ ] Beat 6a (gog called by backend) removed from E2E test
- [ ] New Beat 6a asserts contract is in `executing` with correct artifacts
- [ ] `execFile` mock removed from E2E test
- [ ] All remaining tests pass
- [ ] Zero typecheck errors
