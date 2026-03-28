# Aura OS

Aura OS is a sovereign agent operating system for business-owner workflows: persistent contracts, transparent orchestration, package-scoped domain logic, and a UI/runtime split between Aura Pulse and OpenClaw.

---

## Workspace

```text
aurora-os/
  aura-pulse/
    packages/
      contract-runtime/   # @aura/contract-runtime
      openclaw-plugin/    # @aura/aura-pulse
      artist-reseller/    # @aura/artist-reseller
      pulse-pwa/          # @aura/pulse-pwa
  docs/
    openclaw-docker-runtime.md
    plans/
      aura-os-foundation-plan-v0.5.md
      aura-os-phase1-code-plan-v2.md
      aura-os-phase2-plugin-plan-v1.md
      aura-os-phase3-pulse-pwa-plan-v1.md
      aura-os-phase3-stabilization-plan-v1.md
      aura-os-phase4-artist-reseller-plan-v2.md
      aura-os-phase4b-cleanup-plan-v1.md
      aura-os-phase5-executor-plan-v1.md
      aura-os-phase5-status-v1.md
```

---

## Packages

### `@aura/contract-runtime`

Contract lifecycle core:

- typed lifecycle transitions
- resume tokens and resolver flow
- clarification loops and deferred surfacing
- TTL enforcement and resolver timeout
- terminal-contract retention cleanup
- connector state persistence and audit logging

### `@aura/aura-pulse`

OpenClaw plugin layer:

- contract runtime service and WebSocket surface
- `ContractExecutor` wake path into the main OpenClaw agent session
- contributed tool loading from `.aurora` package metadata
- trigger/bootstrap wiring with safe opt-in config writes
- file bridge and Pulse-facing routes

### `@aura/artist-reseller`

First domain package:

- `aurora-registry.json`
- domain type definitions and execution goals
- trigger declarations
- Etsy contributed tool metadata
- Poshmark `posh-pusher` scaffold templates

### `@aura/pulse-pwa`

Pulse UI package for the decision surface and history experience. It has manual demo assets, but it was not the main focus of the latest Phase 5 runtime validation pass.

---

## Current Status

| Area | Status |
|------|--------|
| `@aura/contract-runtime` | Implemented and extended for Phase 5 |
| `@aura/aura-pulse` | Phase 5 core implemented and validated against isolated Docker OpenClaw |
| `@aura/artist-reseller` | Registry, triggers, domain types, and app scaffolds in place |
| `@aura/pulse-pwa` | Present with manual demos; not yet part of the latest full runtime validation path |

The old README state is no longer accurate. The current Phase 5 reconciliation, implementation summary, and drift list now live in `docs/plans/aura-os-phase5-status-v1.md`.

---

## Requirements

- Node.js >= 24
- pnpm >= 9
- Docker for the containerized validation paths

---

## Local Validation

From `aura-pulse/`:

```sh
pnpm install

pnpm --filter @aura/contract-runtime test
pnpm --filter @aura/contract-runtime typecheck

pnpm --filter @aura/aura-pulse test
pnpm --filter @aura/aura-pulse typecheck
```

Phase 5 regression harness:

```sh
cd aura-pulse
sh ./scripts/run-phase5-tests.sh
```

Disposable Docker harness for the same focused Phase 5 path:

```sh
cd aura-pulse
docker compose -f docker-compose.phase5-tests.yml up --build phase5-tests
```

---

## Docker Runtime

There are two different Docker stories in this repo:

- `aura-pulse/docker-compose.phase5-tests.yml` is the throwaway regression-test container
- `docs/openclaw-docker-runtime.md` describes the supported long-lived upstream OpenClaw Docker runtime used for real integration validation

Use the long-lived runtime for anything involving real OpenClaw onboarding, remote Ollama, or browser-based validation.

---

## Important Docs

- `docs/plans/aura-os-phase5-executor-plan-v1.md` — original Phase 5 implementation plan plus addenda
- `docs/plans/aura-os-phase5-status-v1.md` — current implementation status, runtime notes, and confirmed drift from plan
- `docs/openclaw-docker-runtime.md` — supported persistent OpenClaw Docker runtime and isolation rules
- `docs/openclaw-manual-smoke.md` — current preflight and manual smoke path for the isolated runtime

---

## Before Full End-To-End Testing

The main remaining work before broad end-to-end and manual testing is:

1. run the refreshed manual smoke path against the isolated runtime
2. decide whether the next pass should prove live Gmail delivery or only the Aura-side execution loop
3. activate Etsy only if that contributed-tool path is intentionally in scope

That status is tracked in `docs/plans/aura-os-phase5-status-v1.md`.
