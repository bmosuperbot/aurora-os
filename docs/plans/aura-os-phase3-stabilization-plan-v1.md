# Aura OS — Phase 3 Stabilization Plan
**Pulse PWA: Integration Hardening & Standards Alignment**
version: 1.0 | status: current source of truth
date: March 27, 2026

---

## 01 — Purpose

This document is the hard-copy source of truth for the Phase 3 stabilization
pass.

Its purpose is narrower than the original Phase 3 implementation plan:
Phase 3 has now been coded, and the work is no longer to design the PWA from
scratch. The work is to verify that the Pulse PWA behaves correctly against the
real Phase 1 runtime and Phase 2 plugin, adheres to the spirit of the
foundation architecture, and uses current React and A2UI guidance where later
framework knowledge is more accurate than pre-implementation assumptions.

This document does not replace the foundation plan or the original Phase 3
build plan as historical design artifacts. It supersedes them for the current
stabilization and alignment work.

---

## 02 — Source-Of-Truth Order

When evaluating a mismatch during stabilization, use this precedence order:

1. **Tested integration behavior across Phase 1, Phase 2, and Phase 3**
   The actual runtime/plugin/PWA contract is authoritative for concrete wire
   semantics, message names, resume-token handling, and state transitions.

2. **Foundation Plan v0.5**
   The foundation plan remains authoritative for architectural intent,
   structural rules, trust boundaries, and product philosophy.

3. **Updated framework documentation**
   Use current React, A2UI, and OpenClaw guidance for renderer/client behavior,
   theming, message processing, and plugin integration details when those
   details were not yet settled at foundation-plan time.

4. **Earlier Phase 3 implementation planning**
   The original Phase 3 implementation plan remains useful, but if it conflicts
   with tested code behavior or later framework knowledge, this stabilization
   plan wins.

---

## 03 — Scope

### In scope

- Pulse PWA correctness and behavioral stability
- WebSocket transport parity between plugin and PWA
- Resume-token correctness and reconnect recovery behavior
- React surface-state correctness
- A2UI React integration, catalog safety, and theme alignment
- History, connector, completion, and morning-brief behavior
- PWA packaging completeness: manifest, icons, asset paths, installability
- Targeted Phase 1 or Phase 2 corrections when a concrete Phase 3 integration
  bug is traced upstream
- Cross-phase cleanup that improves code clarity, removes drift, and increases
   compliance with the foundation architecture now that all three phases exist

### Out of scope

- Broad speculative redesign of the contract runtime
- Broad speculative redesign of the plugin service layer
- New Phase 4 business flows or connector capability expansion
- Rewriting the original foundation architecture because of local UI issues

---

## 04 — Non-Negotiable Architectural Rules

The stabilization pass must preserve these structural rules from the foundation
plan unless a later implementation detail merely refines how they are realized:

- **Contracts remain the operational source of truth.**
  The Pulse PWA is a surface over the contract runtime. It is not allowed to
  invent a parallel workflow model.

- **The plugin remains the transport authority.**
  Reconnect/bootstrap behavior is server-authoritative. The PWA should recover
  by consuming the plugin's bootstrap flow, not by maintaining a competing
  local recovery protocol.

- **Human approval remains structural.**
  Resolve actions that pass approval gates must continue to depend on valid,
  single-use resume tokens.

- **A2UI remains client-controlled.**
  Agents describe structure and semantics. The client controls rendering,
  styling, catalogs, and allowed components.

- **The brokered File Bridge remains the only filesystem path for agents.**
  If a Phase 3 issue exposes a mismatch here, fix it in the plugin or runtime,
  not by weakening the architecture.

---

## 05 — Implementation Posture

Treat Phase 1 and Phase 2 as stable by default, but not as untouchable.

If the PWA exposes a concrete mismatch in the runtime or plugin, the correct
response is to fix the smallest upstream layer necessary. Do not force the PWA
to compensate for a backend contract bug merely because the backend is already
tested.

Use this decision rule:

1. If the PWA is inconsistent with the real backend contract, fix Phase 3.
2. If Phase 3 exposes a real contract or lifecycle mismatch upstream, apply a
   targeted Phase 1 or Phase 2 correction.
3. Do not reopen architecture without concrete evidence.

Now that Phase 1, Phase 2, and Phase 3 all exist in code, review the system as
one integrated product rather than as isolated phase deliverables. If a naming
pattern, state shape, transport edge, or architectural boundary is technically
working but unnecessarily messy, duplicated, or misleading relative to the
foundation concepts, cleanup is in scope so long as it is minimal, justified,
and preserves tested behavior.

---

## 06 — Primary Workstreams

### Workstream A — Transport Contract Alignment

The first priority is to make the PWA and plugin agree exactly on the wire.

Validate and normalize:

- runtime-to-surface message names
- surface-to-runtime message names
- payload envelopes
- resume-token field names
- clarification message routing
- completion payloads
- connector request and completion payloads
- reconnect/bootstrap semantics

Files most likely to change:

- `aura-pulse/packages/openclaw-plugin/src/transport/websocket-protocol.js`
- `aura-pulse/packages/openclaw-plugin/src/services/websocket-service.js`
- `aura-pulse/packages/pulse-pwa/src/ws/protocol.ts`
- `aura-pulse/packages/pulse-pwa/src/ws/client.ts`

Success condition:
the PWA and plugin agree on every inbound and outbound message shape with no
lossy normalization, ad hoc translation, or client-only drift.

### Workstream B — Contract-State Alignment

The PWA's local state vocabulary must match the actual contract lifecycle.

Review and correct:

- status names
- local state assumptions around pending vs waiting_approval
- clarification and resolver-active transitions
- completion and clear behavior
- artifact-review transitions

Files most likely to change:

- `aura-pulse/packages/pulse-pwa/src/ws/protocol.ts`
- `aura-pulse/packages/pulse-pwa/src/ws/surface-store.ts`
- `aura-pulse/packages/contract-runtime/src/runtime/contract-runtime.js`
- `aura-pulse/packages/contract-runtime/src/runtime/state-machine.js`

Success condition:
the React store behaves as a faithful surface over the runtime state machine,
not as a separate application-level approximation.

### Workstream C — Resume Token & Reconnect Integrity

The approval gate is structural and must remain so through the UI.

Validate and correct:

- token delivery into surfaced contracts
- token consumption on resolve
- replay rejection behavior
- reconnect restoration of pending contracts
- absence of conflicting client-side recovery logic

Files most likely to change:

- `aura-pulse/packages/openclaw-plugin/src/services/websocket-service.js`
- `aura-pulse/packages/pulse-pwa/src/ws/client.ts`
- `aura-pulse/packages/pulse-pwa/src/ws/surface-store.ts`
- `aura-pulse/packages/contract-runtime/src/runtime/contract-runtime.js`

Success condition:
decision recovery after reconnect works via the server bootstrap path, and
resolve actions remain impossible without a valid current token.

### Workstream D — React Surface-State Hardening

The Pulse PWA must present a coherent surface lifecycle.

Review and correct:

- decision mode
- resolver-active mode
- clarifying mode
- artifact review behavior
- confirming mode
- completion mode
- connector overlay restoration
- history overlay interactions
- morning brief routing behavior

Files most likely to change:

- `aura-pulse/packages/pulse-pwa/src/App.tsx`
- `aura-pulse/packages/pulse-pwa/src/ws/surface-store.ts`
- `aura-pulse/packages/pulse-pwa/src/surface/DecisionCard/DecisionCard.tsx`
- `aura-pulse/packages/pulse-pwa/src/surface/ArtifactPanel/ArtifactPanel.tsx`
- `aura-pulse/packages/pulse-pwa/src/surface/ConnectorCard/ConnectorCard.tsx`
- `aura-pulse/packages/pulse-pwa/src/history/HistoryOverlay.tsx`
- `aura-pulse/packages/pulse-pwa/src/morning-brief/MorningBrief.tsx`

Success condition:
every supported UI flow is deterministic, understandable, and consistent with
the contract-runtime lifecycle.

### Workstream E — A2UI Standards Alignment

React remains the correct framework choice for Pulse.

The stabilization pass must ensure that the PWA follows current A2UI guidance:

- use the React/web-core processing model rather than custom protocol drift
- keep the catalog allowlisted and client-controlled
- capture artifact edits predictably into resolve payloads
- keep styling theme-driven and semantic-hint based
- avoid introducing agent-controlled visual styling

Files most likely to change:

- `aura-pulse/packages/pulse-pwa/src/a2ui/aura-catalog.tsx`
- `aura-pulse/packages/pulse-pwa/src/a2ui/aura-theme.ts`
- `aura-pulse/packages/pulse-pwa/src/surface/ArtifactPanel/ArtifactPanel.tsx`

Success condition:
artifact rendering is standards-aligned, safe, and predictable without losing
the intended Aura-specific catalog boundary.

### Workstream F — Product-Behavior Review Against Foundation Intent

The PWA should reflect the product behavior described in the foundation plan,
even where implementation details evolved later.

Review these behaviors explicitly:

- decision surfacing
- clarification dialogue
- completion acknowledgment
- connector card overlays
- rendered history rather than raw file views
- morning brief behavior

For every divergence discovered, classify it as one of:

- bug
- acceptable implementation update
- intentional improvement over the earlier plan

Success condition:
the code matches the spirit of the foundation document while avoiding stale
framework assumptions.

### Workstream G — PWA Packaging Completeness

The app must be a working standalone PWA, not merely a React dev surface.

Validate and correct:

- manifest presence and correctness
- icon paths and formats
- static asset wiring
- installability
- responsive layout integrity
- voice fallback behavior

Files most likely to change:

- `aura-pulse/packages/pulse-pwa/index.html`
- `aura-pulse/packages/pulse-pwa/public/*`
- `aura-pulse/packages/pulse-pwa/vite.config.ts`

Success condition:
the application loads cleanly as a real PWA shell on desktop and mobile widths.

### Workstream H — Cross-Phase Code Hygiene & Concept Compliance

With all three phases implemented, perform a selective cleanup pass across the
runtime, plugin, and PWA where the codebase drifts from the shared concepts
even if individual parts still function.

Review and correct:

- duplicate or conflicting state vocabulary across layers
- misleading naming that obscures foundation concepts
- unnecessary translation layers between runtime, plugin, and PWA
- weakly justified abstractions introduced during agentic coding
- local workarounds that should instead be resolved at the correct layer
- code paths that technically work but violate the intended contract/surface
   relationship

Guardrails:

- prefer small, high-confidence refactors
- preserve passing behavior unless correcting a real defect
- do not churn stable code for stylistic reasons alone
- tie every cleanup change back to a concrete architectural or integration gain

Success condition:
the codebase reads as one coherent system implementing the foundation concepts,
rather than three separately generated phases stitched together.

---

## 07 — Execution Order

Implement stabilization in this order:

1. Transport contract alignment
2. Contract-state alignment
3. Resume-token and reconnect integrity
4. React surface-state hardening
5. A2UI standards alignment
6. Product-behavior review against foundation intent
7. PWA packaging completeness
8. Cross-phase code hygiene and concept compliance
9. Final verification pass

This order is mandatory because visual or component-level cleanup done before
transport and lifecycle alignment will create churn.

---

## 08 — Verification Matrix

Phase 3 stabilization is done only when the following are proven:

1. **Transport parity**
   Plugin and PWA agree on every WebSocket message shape with no lossy client
   normalization.

2. **Reconnect recovery**
   Pending contracts reappear after reconnect using server bootstrap alone.

3. **Resolver loop**
   A full decision flow works end to end:
   `decision -> engage -> clarification -> resolve with token -> completion`.

4. **Replay protection**
   A reused token is rejected from the UI path.

5. **Connector flows**
   Request, decline, never-resurface, and complete flows all render and clear
   correctly.

6. **A2UI artifact editing**
   A2UI messages render in React, artifact edits are captured into the resolve
   payload, and only the Aura-approved catalog is renderable.

7. **History and morning brief**
   Both work against real plugin endpoints and actual runtime behavior.

8. **PWA shell integrity**
   Manifest, icons, static assets, and responsive layout all work cleanly.

9. **Cross-phase code coherence**
   Runtime, plugin, and PWA terminology and boundaries are clean enough that
   the system reads as one implementation of the foundation concepts.

10. **Targeted upstream correction readiness**
   If a Phase 3 issue is traced into Phase 1 or Phase 2, the smallest necessary
   upstream fix can be applied without reopening broader architecture.

---

## 09 — Primary File Set

### PWA

- `aura-pulse/packages/pulse-pwa/src/ws/protocol.ts`
- `aura-pulse/packages/pulse-pwa/src/ws/client.ts`
- `aura-pulse/packages/pulse-pwa/src/ws/surface-store.ts`
- `aura-pulse/packages/pulse-pwa/src/App.tsx`
- `aura-pulse/packages/pulse-pwa/src/surface/DecisionCard/DecisionCard.tsx`
- `aura-pulse/packages/pulse-pwa/src/surface/ArtifactPanel/ArtifactPanel.tsx`
- `aura-pulse/packages/pulse-pwa/src/surface/ConnectorCard/ConnectorCard.tsx`
- `aura-pulse/packages/pulse-pwa/src/history/HistoryOverlay.tsx`
- `aura-pulse/packages/pulse-pwa/src/morning-brief/MorningBrief.tsx`
- `aura-pulse/packages/pulse-pwa/src/a2ui/aura-catalog.tsx`
- `aura-pulse/packages/pulse-pwa/src/a2ui/aura-theme.ts`
- `aura-pulse/packages/pulse-pwa/index.html`

### Plugin

- `aura-pulse/packages/openclaw-plugin/src/transport/websocket-protocol.js`
- `aura-pulse/packages/openclaw-plugin/src/services/websocket-service.js`

### Runtime

- `aura-pulse/packages/contract-runtime/src/runtime/contract-runtime.js`
- `aura-pulse/packages/contract-runtime/src/runtime/state-machine.js`

### Planning Authority

- `docs/plans/aura-os-foundation-plan-v0.5.md`
- `docs/plans/aura-os-phase3-pulse-pwa-plan-v1.md`
- `docs/plans/aura-os-phase3-stabilization-plan-v1.md`

---

## 10 — Final Rule

Do not preserve drift merely because it already exists in code.

Do not preserve stale planning assumptions merely because they were written
earlier.

Preserve the architecture. Preserve the trust boundaries. Preserve the product
intent.

Then make the code correct.