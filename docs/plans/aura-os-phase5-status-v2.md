# Aura OS — Phase 5 Current Status
status: implemented-with-active-a2ui-blocker
date: March 29, 2026

---

## 01 — Executive Summary

Phase 5 is still materially implemented, but the center of gravity has moved.

The earlier executor and plugin-lifecycle work remains in place. The major new work after the March 28 snapshot is the Aura Pulse owner-command path and the generic workspace-surface path:

- Pulse can now accept owner text commands from the real browser UI
- those commands are relayed directly into `agent:main:pulse`
- direct relay now uses `api.runtime.agent.runEmbeddedPiAgent()` instead of the older queue plus heartbeat wake-up path for Pulse-originated owner commands
- generic non-contract Pulse workspace surfaces can now be rendered through `aura_render_surface`
- the Pulse PWA now has a persistent command dock and a workspace-surface mode for kernel-driven A2UI panels

The current blocker is no longer transport or session wake-up. The blocker is that the live model can reach `aura_render_surface`, but still generates malformed `a2ui_messages` payloads during real browser-driven runs, so the tool rejects the render before Pulse can display the intended interface.

---

## 02 — What Changed Since Status v1

### Pulse owner-command path

The old status file described executor wake-up through:

- `api.runtime.system.enqueueSystemEvent()`
- `requestHeartbeatNow()`

That still describes contract execution wake-up, but it is no longer the right description for Pulse owner commands.

Pulse owner commands and Pulse surface actions now use a dedicated direct relay:

- `PulseCommandRelay`
- `api.runtime.agent.runEmbeddedPiAgent()`
- explicit Pulse session-store and session-file management for `agent:main:pulse`
- a local per-session promise chain so later Pulse commands serialize correctly instead of disappearing behind heartbeat timing

This was implemented because the queue plus heartbeat path was unreliable for back-to-back owner commands in the dedicated Pulse session.

### Provider/model handling for direct runs

The first direct-run implementation exposed a stale provider problem:

- direct runs inherited an old `anthropic` provider or auth context from session state
- the live runtime then failed with `No API key found for provider "anthropic"`

The relay now fixes that explicitly by resolving and passing:

- `provider`
- `model`
- `thinkLevel`

on every direct Pulse run.

This matches the pattern used by the upstream OpenClaw `voice-call` plugin.

### Generic Aura Pulse workspace surfaces

The repo now contains a new generic surface path that is not tied to contracts:

- `aura_render_surface`
- `aura_clear_surface`
- websocket protocol support for `kernel_surface` and `clear_kernel_surface`
- Pulse PWA workspace rendering and panel management

This lets an agent present dashboards, tables, metric grids, and interactive workspaces directly in Pulse without forcing everything through contract cards.

### Browser-side owner command UX

The Pulse PWA now includes:

- a persistent command dock
- command submission over the plugin websocket
- command acknowledgement/status handling
- workspace panel rendering for generic kernel surfaces
- fallback rendering for malformed agent message payloads when possible

This means real browser-driven owner commands are now part of the live validation path, not just synthetic websocket tests.

### Aura surface authoring guidance

The repo now contains explicit surface-authoring docs for the agent runtime:

- `skills/aura-surface-ui/SKILL.md`
- `skills/aura-surface-ui/references/components.md`

These define the canonical A2UI contract for `aura_render_surface`, including:

- `surfaceUpdate`
- `dataModelUpdate`
- `beginRendering`
- `MetricGrid`
- `DataTable`
- `ActionButton`

The tool itself now validates those shapes at runtime instead of trusting descriptive docs alone.

---

## 03 — Files Added Or Changed In This Pass

### OpenClaw plugin

Core relay and runtime typing work:

- `aura-pulse/packages/openclaw-plugin/src/services/pulse-command-relay.js`
- `aura-pulse/packages/openclaw-plugin/src/types/plugin-types.d.ts`
- `aura-pulse/packages/openclaw-plugin/tests/unit/pulse-command-relay.test.js`

Websocket protocol and relay integration:

- `aura-pulse/packages/openclaw-plugin/src/services/websocket-service.js`
- `aura-pulse/packages/openclaw-plugin/src/services/websocket-service.d.ts`
- `aura-pulse/packages/openclaw-plugin/src/transport/websocket-protocol.js`
- `aura-pulse/packages/openclaw-plugin/tests/integration/websocket.test.js`

Generic Pulse surface tools:

- `aura-pulse/packages/openclaw-plugin/src/tools/aura-render-surface.js`
- `aura-pulse/packages/openclaw-plugin/src/tools/aura-clear-surface.js`
- `aura-pulse/packages/openclaw-plugin/tests/unit/aura-render-surface.test.js`

Plugin registration and service wiring:

- `aura-pulse/packages/openclaw-plugin/index.js`
- `aura-pulse/packages/openclaw-plugin/tests/unit/plugin-registration.test.js`

Tool-description and contract-clarity updates:

- `aura-pulse/packages/openclaw-plugin/src/tools/aura-fs-read.js`
- `aura-pulse/packages/openclaw-plugin/src/tools/aura-fs-list.js`
- `aura-pulse/packages/openclaw-plugin/src/tools/aura-fs-search.js`
- `aura-pulse/packages/openclaw-plugin/src/tools/aura-fs-patch.js`
- `aura-pulse/packages/openclaw-plugin/src/tools/aura-query-connections.js`
- `aura-pulse/packages/openclaw-plugin/src/tools/aura-request-connection.js`
- `aura-pulse/packages/openclaw-plugin/src/tools/aura-complete-contract.js`
- `aura-pulse/packages/openclaw-plugin/src/tools/aura-surface-decision.js`

### Pulse PWA

Workspace surface and command UX:

- `aura-pulse/packages/pulse-pwa/src/App.tsx`
- `aura-pulse/packages/pulse-pwa/src/surface/CommandDock.tsx`
- `aura-pulse/packages/pulse-pwa/src/surface/WorkspaceSurface.tsx`
- `aura-pulse/packages/pulse-pwa/src/a2ui/aura-catalog.tsx`
- `aura-pulse/packages/pulse-pwa/src/theme/aura.css`

Client protocol and state handling:

- `aura-pulse/packages/pulse-pwa/src/ws/client.ts`
- `aura-pulse/packages/pulse-pwa/src/ws/protocol.ts`
- `aura-pulse/packages/pulse-pwa/src/ws/surface-store.ts`

Pulse PWA tests:

- `aura-pulse/packages/pulse-pwa/tests/integration/decision-flow.e2e.test.tsx`
- `aura-pulse/packages/pulse-pwa/tests/integration/pulse-harness.ts`
- `aura-pulse/packages/pulse-pwa/tests/unit/surface-store.test.ts`

### Agent-facing surface guidance

- `skills/aura-surface-ui/SKILL.md`
- `skills/aura-surface-ui/references/components.md`

---

## 04 — Validation Completed After Status v1

### Local tests

Targeted tests for the new relay and websocket path passed locally.

Most important confirmed runs in this pass:

- `packages/openclaw-plugin/tests/unit/pulse-command-relay.test.js`
- `packages/openclaw-plugin/tests/integration/websocket.test.js`

Combined result during the relay pass:

- `11 tests passed`

### Standalone bundle and redeploy

The standalone plugin bundle was rebuilt successfully after the direct-relay changes:

- `pnpm --filter @aura/aura-pulse build:standalone`

The generated standalone bundle was synced into the trusted isolated OpenClaw workspace and the gateway was restarted.

### Live browser validation that succeeded

The following were validated from the real Pulse browser UI in VS Code, not just with synthetic websocket messages:

1. Pulse accepted owner commands from the command dock.
2. The direct relay scheduled and serialized those commands inside `agent:main:pulse`.
3. Gateway logs showed the first direct run completed before the second started.
4. The live transcript showed the agent using the normal host `read` tool on `/home/node/.openclaw/workspace/skills/aura-surface-ui/SKILL.md`.
5. The transcript showed the expected success markers:
   - `DIRECT_RELAY_EPSILON`
   - `DIRECT_RELAY_ZETA`
6. After the repo-owned Docker cutover, the same direct owner-command path completed successfully in the migrated runtime with:
   - `REPO_OWNED_RUNTIME_OK`

This confirmed that the direct owner-command path is live and that the earlier tool-selection problem is fixed for workspace skill reads.

### Live browser validation that did not succeed yet

The new non-notification workspace-surface path was tested from the real Pulse browser UI.

Result:

- the agent reached `aura_render_surface`
- the live model generated malformed `a2ui_messages`
- the tool rejected the call
- Pulse did not render the intended workspace surface
- a stricter follow-up owner prompt after the repo-owned Docker cleanup still failed in the same way for `surface_id` `sales-last-week-explicit`

Observed live failure:

- `aura_render_surface.a2ui_messages string must contain valid JSON.`

The stricter follow-up prompt explicitly told the agent to:

- read the Aura surface skill and component reference with the normal host `read` tool
- call `aura_render_surface` exactly once
- pass `a2ui_messages` as a native array argument, not a JSON string
- use only built-in components for a small sales dashboard

Even with those instructions, the live session still emitted a string value for `a2ui_messages` and failed validation before Pulse could render the interface. That means prompt specificity alone has not resolved the canonical A2UI emission problem for the active model.

This is the current blocker.

---

## 05 — Current Runtime And Browser Environment

The persistent isolated OpenClaw Docker runtime is still the main validation target.

Current preferred layout is now repo-owned:

- compose wrapper: `aura-pulse/docker-compose.openclaw.yml`
- isolated config: `aura-pulse/.openclaw-docker/config`
- isolated workspace: `aura-pulse/.openclaw-docker/workspace`
- image: `ghcr.io/openclaw/openclaw:2026.3.24`
- remote Ollama: `http://192.168.68.116:11434`

The repo-owned runtime is now healthy after the cutover from the old external container:

- `http://127.0.0.1:28789/healthz` returns `{"ok":true,"status":"live"}`
- `http://127.0.0.1:28789/readyz` returns `{"ready":true}`
- the Aura plugin websocket binds inside the container on `7700` and is published on host `28790`
- the local Pulse page reconnects successfully and shows `live`

Current host paths in use during this pass:

- Control UI: `http://127.0.0.1:28789`
- Pulse PWA: `http://127.0.0.1:4175`
- Pulse websocket path used by the browser: `ws://127.0.0.1:28790/aura/surface`

Current local Pulse dev launch target:

- `VITE_PLUGIN_URL=http://127.0.0.1:28789`
- `VITE_WS_URL=ws://127.0.0.1:28790/aura/surface`
- host dev port `4175`

Important operational note:

- the repo now contains a clean path to publish the Pulse websocket directly from Docker on host port `28790`
- the old manual bridge/forwarder should no longer be treated as the desired steady-state setup once the repo-owned wrapper is adopted

One repo-owned runtime cleanup also landed after the cutover:

- the Aura plugin should load from the synced workspace bundle path only
- the duplicate `/workspaces/aurora-os/aura-pulse/dist/openclaw-plugin-standalone` load path was identified as the source of the repeated duplicate-plugin warning and should not be reintroduced
- the repo-owned config helper now removes that legacy path and keeps `/home/node/.openclaw/workspace/openclaw-plugin-standalone` as the single active Aura plugin load target
- the local Pulse VS Code task now targets the repo-owned gateway/API ports directly with `VITE_PLUGIN_URL=http://127.0.0.1:28789`, `VITE_WS_URL=ws://127.0.0.1:28790/aura/surface`, and local dev port `4175`

---

## 06 — The Provider Situation

The provider issue that appeared during this pass is understood.

### What went wrong

After replacing the Pulse owner-command path with direct `runEmbeddedPiAgent()` runs, the first live implementation allowed the reused Pulse session to inherit stale model/auth context.

That caused a live runtime failure:

- `No API key found for provider "anthropic"`

### What fixed it

The relay now resolves and passes provider settings explicitly on every direct Pulse run:

- `provider`
- `model`
- `thinkLevel`

That prevents stale session state from silently selecting the wrong provider.

### How the upstream voice plugin handles this

The upstream OpenClaw `voice-call` plugin uses the same pattern.

Its response generator:

- resolves `modelRef` from plugin config or runtime defaults
- splits that into `provider` and `model`
- resolves `thinkLevel` from the selected provider/model pair
- passes those values explicitly into `runEmbeddedPiAgent()`

That is the same pattern the Pulse relay now follows.

### Important distinction

The current A2UI rendering blocker is not a provider bug.

The provider bug is fixed.
The current blocker is malformed A2UI tool arguments generated by the live model.

---

## 07 — What We Are Trying To Solve Right Now

The active goal is now very specific:

1. Send an owner request from the real Pulse browser UI.
2. Have the agent read the Aura surface skill with the normal host tools.
3. Have the agent generate valid canonical A2UI payloads.
4. Call `aura_render_surface` successfully.
5. See the actual workspace interface appear in Pulse.

The system is currently failing at step 3.

More precisely:

- the live agent can reach `aura_render_surface`
- the live agent does not yet reliably emit canonical `a2ui_messages`
- the tool rejects malformed wrapper shapes or broken JSON strings before the UI render happens

This means the current problem is a generation and tool-contract problem, not a base websocket transport problem.

Running Pulse inside Docker with the same test OpenClaw environment may still be worthwhile for cleanliness and reproducibility, because it would remove the extra host bridge variable.

But it will not fix the specific failure currently blocking the live A2UI render. The model is failing before the payload ever reaches the browser renderer.

---

## 08 — Best Next Options For The Next Chat

The next clean chat should start from one of these directions:

1. Make the non-notification render path more model-safe.

   Candidate approaches:

   - narrow the tool contract further so the model fills smaller structured fields instead of freehand A2UI JSON
   - add a helper or compiler layer that turns simpler business-shape inputs into canonical `a2ui_messages`
   - strengthen validation or auto-normalization only where it is safe and deterministic

2. Decide whether to run Pulse inside the Docker test environment.

   Reason:

   - it would remove the procedural `28790` bridge from the browser validation path
   - it would make the live test environment cleaner and easier to reason about

   Limitation:

   - it does not solve malformed A2UI payload generation by itself

3. Re-run the live browser-driven non-notification render after changing either the model or the tool contract.

   Success criterion:

   - Pulse shows a real workspace panel with a metric grid, table, and visible action button
   - the result is not merely an accepted command acknowledgement

---

## 09 — Practical Handoff Notes For The Next Agent Chat

Use this file instead of the March 28 status snapshot when reasoning about the current repo state.

The most important realities to carry forward are:

- Pulse owner commands no longer rely on the older heartbeat-only wake path
- the direct relay and provider fix are already in place and validated
- the Pulse command dock and workspace-surface UI exist in the repo now
- `aura_render_surface` exists and rejects malformed A2UI payloads on purpose
- the live blocker is agent-generated A2UI argument quality
- the key missing proof is a successful browser-driven non-notification workspace render