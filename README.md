# Aura OS

Sovereign agent operating system. Persistent agents, shared memory, transparent orchestration — built for the business owner, not the developer.

---

## Repository layout

```
aurora-os/
  aura-pulse/
    packages/
      contract-runtime/   ← Phase 1 (complete)
  docs/
    aura-technical-research.md
    plans/
      aura-os-foundation-plan-v0.5.md
      aura-os-phase1-code-plan-v2.md
```

---

## Packages

### `@aura/contract-runtime` — `aura-pulse/packages/contract-runtime/`

The contract runtime core. No UI, no agent integration, no external dependencies.

Provides:
- **Contract lifecycle** — create → active → waiting_approval → resolver_active → executing → complete
- **State machine** — typed transitions with compare-and-swap concurrency control
- **Resume tokens** — single-use, 24-hour expiry, replay-resistant
- **Deferred surfacing** — `surface_after` holds contracts until the right moment
- **Clarification round-trips** — resolver asks, agent answers, surface updates
- **TTL enforcement** — expired contracts move to `failed` automatically
- **Resolver timeout** — idle `resolver_active` contracts return to `waiting_approval`
- **Hierarchy** — `spawnSubtask()` links child to parent, transitions parent `executing → active`
- **ConnectorState CRUD** — credential state persisted alongside contracts
- **Audit log** — every event appended to `contract_log`
- **Signal file** — `.signal` touched after every commit for real-time watchers

**Stack:** JavaScript + JSDoc, handwritten `.d.ts` types, `node:sqlite` (Node 24 built-in), Vitest, ESLint 9.

```sh
cd aura-pulse/packages/contract-runtime

npm install
npm test           # 86 tests, 0 failures
npm run typecheck  # 0 errors
npm run lint       # 0 errors
```

---

## Requirements

- Node.js ≥ 24.0.0
- npm ≥ 10

---

## Status

| Phase | Package | Status |
|-------|---------|--------|
| 1 | `@aura/contract-runtime` | Complete |
| 2 | `@aura/openclaw-plugin` | Not started |
