# Aura OS — Phase 5 Current Status
status: implemented-with-known-gaps
date: March 28, 2026

> Superseded by `docs/plans/aura-os-phase5-status-v2.md` for the March 29 Pulse relay, provider, and A2UI work. Use the v2 file for the next agent handoff.

---

## 01 — Current State

Phase 5 is materially implemented in the repo.

The contract runtime now supports:

- execution notifications when a contract enters `executing`
- explicit `complete_requires` enforcement before `aura_complete_contract`
- default contract TTL population from `aura_surface_decision`
- active TTL scheduling plus terminal-contract retention cleanup

The OpenClaw plugin now supports:

- `ContractExecutor` wake-up through `api.runtime.system.enqueueSystemEvent()` plus `requestHeartbeatNow()`
- contributed tool loading from `aurora-registry.json`
- declarative trigger bootstrap from `triggers[]`
- opt-in registry/bootstrap writes for safe isolated testing
- idempotent service startup and shutdown
- synchronous plugin registration compatible with the OpenClaw runtime actually used in Docker

The artist-reseller package now contains:

- domain-type defaults for `default_complete_requires`
- contributed tool metadata for Etsy
- trigger declarations for Gmail preset, calendar heartbeat, and morning brief cron
- Poshmark `posh-pusher` scaffold templates

Validation completed during this pass:

- `@aura/aura-pulse` test suite passed locally: 21 files, 100 tests
- `pnpm --filter @aura/aura-pulse build:standalone` now produces a portable standalone bundle under `aura-pulse/dist/openclaw-plugin-standalone`
- the isolated OpenClaw Docker runtime was switched to load Aura from that standalone bundle path
- the isolated OpenClaw Docker runtime was recreated after the plugin lifecycle refactor
- the previous Aura plugin startup warnings were eliminated in the live container runtime:
  - `plugin register returned a promise; async registration is ignored`
  - `aura-pulse ws error: EADDRINUSE`
  - `cli registration missing explicit commands metadata`
- the VS Code browser was confirmed to be connected to the containerized OpenClaw runtime rather than the host OpenClaw instance
- the isolated runtime now has the Gmail preset configured and the Aura connector table marks Gmail as `active`

---

## 02 — What Was Added Or Changed

### Contract runtime

- `ExecutionNotifier` was added and wired into `ContractRuntime`
- `ContractRuntime.hasType()` was added so the plugin can skip duplicate type registration
- `TtlManager` now starts from `ContractRuntimeService`
- terminal retention cleanup was added for `complete` and `failed` contracts
- `complete_requires?: string[]` was added to the contract shape
- `autonomous_log` filtering now supports `contract_id`

### OpenClaw plugin

- `ContractExecutor` resolves execution goals from `domain-types.json`
- execution wakes now use in-process OpenClaw runtime APIs rather than webhook POSTs
- `aura_complete_contract` now checks the autonomous log before allowing completion
- `aura_surface_decision` now supports `ttl_hours` and `complete_requires`
- contributed tools are loaded from the `.aurora` registry when their connector is active
- trigger bootstrap writes Gmail preset and heartbeat content only when bootstrap is explicitly enabled
- plugin registration was refactored to synchronous registration plus a managed runtime stack service
- runtime and WebSocket services now guard against double start and double stop

### Artist-reseller package

- `aurora-registry.json` now includes tool metadata, trigger declarations, and the Poshmark watcher scaffold declaration
- `domain-types.json` now carries `default_complete_requires`
- `apps/posh-pusher/` now contains reference templates for `server.js`, `docker-compose.yml`, `process.config.js`, `package.json`, `README.md`, and `lobster.pipeline.js`

### Package identity and compatibility

- the plugin package name was changed from `@aura/openclaw-plugin` to `@aura/aura-pulse`
- that rename aligns the package identity with the OpenClaw plugin ID `aura-pulse`
- CLI registration now passes explicit command metadata that is compatible with the current OpenClaw Docker image runtime

---

## 03 — Docker Environments Used

Two separate Docker environments now exist for Phase 5 work.

### A. Throwaway repo-local Phase 5 test container

Purpose:

- run a focused Aura regression suite in isolation
- avoid touching the host `~/.openclaw`
- validate runtime, plugin, and typecheck behavior in a disposable container

Files:

- `aura-pulse/Dockerfile.phase5-tests`
- `aura-pulse/docker-compose.phase5-tests.yml`
- `aura-pulse/.dockerignore`
- `aura-pulse/scripts/run-phase5-tests.sh`

What it runs:

- selected `@aura/aura-pulse` unit and integration tests
- selected `@aura/contract-runtime` integration tests
- `pnpm --filter @aura/aura-pulse typecheck`
- `pnpm --filter @aura/contract-runtime typecheck`

Important constraint:

- this environment is disposable and is not the long-lived OpenClaw validation target

### B. Persistent isolated upstream OpenClaw runtime

Purpose:

- validate Aura against the supported upstream OpenClaw Docker flow
- keep state across restarts
- stay isolated from the user's personal OpenClaw install

Current validated local layout used during this pass:

- OpenClaw checkout: `~/Documents/openclaw-aura`
- isolated config: `~/Documents/openclaw-aura-state/config`
- isolated workspace: `~/Documents/openclaw-aura-state/workspace`
- image: `ghcr.io/openclaw/openclaw:latest`
- remote Ollama: `http://192.168.68.116:11434`

Current host port mapping used for the isolated runtime:

- `28789 -> 18789` gateway
- `28790 -> 18790` bridge

Why `28789` instead of `18789`:

- the host already had a personal OpenClaw runtime bound to `127.0.0.1:18789`
- moving the isolated runtime to `28789` removed ambiguity and guaranteed that the VS Code browser session was hitting the container runtime

Important operational notes from this pass:

- the browser Control UI required device pairing once it was pointed at the actual container runtime
- the browser device was approved in the isolated runtime and then reconnected successfully
- Aura is currently loaded into this runtime through a workspace bind mount because the plugin is not yet packaged for clean standalone installation

See also: `docs/openclaw-docker-runtime.md`

---

## 04 — Confirmed Drift From The Phase 5 Plan

These are the important places where the implemented system intentionally differs from the original Phase 5 plan, or where reality forced additional work that the plan did not account for.

### Drift 1 — Executor wake path changed from webhook POST to in-process runtime APIs

Original plan:

- `ContractExecutor` would POST to a Gateway webhook and rely on `hooks.mappings`

Actual implementation:

- `ContractExecutor` uses `api.runtime.system.enqueueSystemEvent()` and `requestHeartbeatNow()`

Reason:

- this matches the Phase 5 addendum and the supported in-process OpenClaw execution path
- it removes token handling, webhook mapping complexity, and unnecessary loopback HTTP

### Drift 2 — Bootstrap is opt-in and disabled by default

Original plan:

- registry/bootstrap helpers would write `openclaw.json`, seed triggers, and install/restart plugins as part of plugin startup

Actual implementation:

- `bootstrapEnabled` defaults to `false`
- config writes, trigger writes, plugin installs, and gateway restart paths are skipped unless explicitly enabled

Reason:

- the user's personal OpenClaw setup had to remain untouched
- safe isolated testing required no-op bootstrap by default

### Drift 3 — Plugin registration had to become synchronous

Original plan:

- the loader/tool bootstrap path was described as async work during `register()`

Actual implementation:

- `register()` is synchronous from OpenClaw's perspective
- startup moved into a managed service that performs async initialization exactly once

Reason:

- the OpenClaw runtime in Docker ignores promised completion from `register()` in practice
- eager async startup inside `register()` caused the warning `plugin register returned a promise; async registration is ignored`

### Drift 4 — Runtime services needed idempotent guards not called out in the plan

Original plan:

- the plan assumed the plugin lifecycle would start services once

Actual implementation:

- `ContractRuntimeService.start()` and `WebSocketService.start()` now guard against duplicate starts and duplicate stops

Reason:

- OpenClaw lifecycle behavior plus the earlier eager-start pattern produced duplicate startup and `EADDRINUSE` on port `7700`

### Drift 5 — Aura package identity had to be aligned with the plugin ID

Original plan:

- package naming was not treated as a runtime concern

Actual implementation:

- private package renamed to `@aura/aura-pulse`

Reason:

- the OpenClaw runtime was warning on ID/package mismatch and the rename removed that ambiguity

### Drift 6 — Container runtime version skew required compatibility work

Original plan:

- no explicit runtime-version skew work was described

Actual implementation:

- CLI registration passes `commands: [cli.name]` in addition to descriptors

Reason:

- the Docker image's bundled OpenClaw runtime only enforced `opts.commands`, while the local upstream checkout also understood descriptors

### Drift 7 — Standalone install now uses a generated bundle, not a published package flow

Original plan:

- implied end state is a normal plugin install into OpenClaw

Actual implementation:

- the persistent OpenClaw runtime now loads Aura from a generated standalone bundle under `aura-pulse/dist/openclaw-plugin-standalone`

Reason:

- a portable bundle was faster and lower-risk than forcing a publish-ready registry flow
- the bundle vendors the Aura package assets and deploys a portable dependency tree for OpenClaw

### Drift 8 — Poshmark lifecycle is scaffolded, not fully exercised end-to-end

Original plan:

- Phase 5 would validate the `aura-app` lifecycle with Poshmark scaffolding and runtime activation behavior

Actual implementation:

- scaffold templates and connector metadata exist
- the full agent-driven PM2-or-Docker activation path has not yet been taken through a real manual end-to-end run

### Drift 9 — One planned quality/test item is still missing as a standalone artifact

Original plan:

- called for `tool-loader-integration.test.js`

Actual implementation:

- the tool loader is covered by `tests/unit/tool-loader.test.js`, broader plugin tests, and live container validation
- there is no separate `tool-loader-integration.test.js` file yet

### Drift 10 — The plan's string-literal cleanliness rule is not met

Original plan:

- no `gog`, `gmail`, `etsy`, or `poshmark` string literals in `openclaw-plugin/src/`

Actual implementation:

- there are still platform-specific literals in `src/`, especially in trigger bootstrap and connector-facing descriptions

Reason:

- the registry/bootstrap path and connector UX copy still carry explicit provider names
- this is a cleanup target, not a runtime blocker

---

## 05 — What Needs To Happen Before Full End-To-End And Manual Testing

These are the real next steps before broad manual testing should be considered ready.

### True blockers

1. Exercise one real connector-backed end-to-end action path, not just connector-state activation.

   Current state:

   - Gmail is marked `active` in the isolated runtime because the safe OpenClaw config now includes the Gmail preset and account
   - Etsy remains inactive, so the contributed Etsy lookup tool is still skipped
   - no fresh manual run has yet proven a live Gmail send/watch flow from resolver decision through completion

   Why it matters:

   - full end-to-end Phase 5 validation still requires a real post-resolver execution path, not only synthetic tests or config-level connector activation

2. Execute the refreshed manual smoke path.

   Current state:

   - the old stale manual artist-reseller script has been replaced with a runtime preflight
   - the new runbook exists in `docs/openclaw-manual-smoke.md`
   - the actual manual smoke pass still needs to be performed in a fresh session

   Why it matters:

   - the docs and preflight now reflect the current runtime shape, but the real browser-driven smoke path still has to be executed end to end

### Recommended before broad testing

3. Decide whether Etsy activation is in scope for the next pass.

   Current state:

   - the current isolated runtime is ready for Gmail-backed or synthetic-contract testing
   - Etsy still requires a real credential before the contributed tool will register

4. Run one explicit end-to-end smoke checklist.

   Minimum useful path:

   - trigger creates contract
   - resolver commits action
   - executor wakes agent
   - agent performs required action
   - `aura_complete_contract` succeeds only after required log action exists
   - contract completes and is visible in history

5. Add the missing standalone integration artifact for the tool loader.

   This is not a hard blocker for manual testing, but it is still a gap against the written plan.

6. Verify whether Gmail auth/send needs a dedicated follow-up runbook.

   Gmail is now active at the Aura/OpenClaw config layer, but the repo should stay explicit about whether the next test pass is expected to prove live Gog/Gmail auth and delivery or only the Aura-side execution loop.

---

## 06 — Practical Next Step

The best next implementation step is:

1. use the standalone bundle already validated in the isolated runtime
2. run the new preflight with `pnpm --filter @aura/aura-pulse demo:artist`
3. perform the browser-driven smoke flow from `docs/openclaw-manual-smoke.md`
4. decide whether the next pass should prove live Gmail delivery or stay focused on the Aura-side execution/completion loop

Only after those three are in place does it make sense to spend time on broader manual UI testing.