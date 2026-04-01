# Aura OS — Phase 6 Plan
**Non-Profit Scenario: Second Vertical Proves Generality**
version: 1.0 | status: blocked-on-phase-5b
date: March 31, 2026
depends-on: aura-os-phase5b-reseller-package-plan-v1.md

---

## 00 — Strategic Frame

Phase 6 answers one question: **does the contract layer generalize?**

The artist-reseller scenario proved the stack works for one domain. Phase 6
proves it works for two without touching the runtime or plugin core. If the
non-profit scenario requires a single change to `contract-runtime` or the
base plugin service layer, that change is a design defect to understand —
not an expected cost.

The second thing Phase 6 addresses is the **A2UI payload blocker** inherited
from Phase 5. Workspace surfaces are architecturally sound but the live model
cannot reliably emit canonical `a2ui_messages` arrays. This blocks the non-
profit scenario's most valuable surface: a grant-deadline dashboard that the
director checks daily. Solving this is prerequisite infrastructure, not
Phase 6 scope creep.

### What Phase 5 actually delivered vs. the foundation plan

The foundation plan's Phase 5 described multi-platform npm packages
(`@aura/etsy-connector`, `@aura/ebay-connector`, etc.) and an Expert Store.
The actual Phase 5 delivered:

- `ContractExecutor` — closes the resolver-to-agent loop
- `PulseCommandRelay` — direct owner commands via `runEmbeddedPiAgent()`
- Generic workspace surfaces (`aura_render_surface` / `aura_clear_surface`)
- Pulse UI redesign (Luminous HUD aesthetic, panel system, command dock)
- A2UI component catalog expansion (`DraftEditor`, metric tones)
- Repo-owned Docker OpenClaw runtime

The npm connector packages, eBay OAuth, and Expert Store are deferred. They
are valuable but not prerequisite for the generality proof. Phase 6 focuses
on what the foundation plan intended: **second vertical, same infrastructure**.

---

## 01 — Starting State

### Already exists for non-profit

| Asset | Location | Status |
|---|---|---|
| `grant-report-draft` domain type | `contract-runtime/src/domain-types/grant-report-draft.js` | Registered, validated, tested |
| `GrantReportDraftContext` type decl | `contract-runtime/src/domain-types/grant-report-draft.d.ts` | Fields: funder_name, grant_id, report_period, deadline, draft_path, data_sources |
| Integration test | `contract-runtime/tests/integration/grant-report-draft.test.js` | Full lifecycle: create → surface → approve → execute → complete |
| Test fixtures | `contract-runtime/tests/helpers/fixtures.js` | `makeGrantContract()`, `directorResolver()` |
| `DraftEditor` component | `pulse-pwa/src/a2ui/aura-catalog.tsx` | Inline editing, submit with `context.draftText` |
| Google Drive connector | `artist-reseller/aurora.manifest.yaml` | Declared as `openclaw-channel`, optional |
| Generic domain-type loader | `openclaw-plugin/src/domain-types/loader.js` | Reads `domain-types.json`, builds `ContractTypeDefinition` array |
| Contributed tool loader | `openclaw-plugin/src/services/tool-loader.js` | Reads `aurora-registry.json`, loads tools by `packageId` |

### Hardcoded to artist-reseller (must change)

| Location | What's hardcoded |
|---|---|
| `index.js` lines 504–505 | `loadAuroraPackageJsonSync(…, 'artist-reseller', 'aurora-registry.json', …)` |
| `index.js` lines 511–512 | `loadAuroraPackageJsonSync(…, 'artist-reseller', 'domain-types.json', …)` |
| `tool-loader.js` line 43 | `entry.packageId ?? 'artist-reseller'` fallback |
| `contract-executor.js` line 7 | `const DEFAULT_PACKAGE_ID = 'artist-reseller'` |

These four sites are the only places that assume a single `.aurora` package.
Phase 6 replaces them with a package discovery mechanism.

### Current blocker inherited from Phase 5

The live model emits `a2ui_messages` as a JSON string instead of a native
array. `aura_render_surface` correctly rejects this. The blocker is model
argument quality, not transport or validation. Phase 6 resolves this with a
surface compiler that accepts simpler structured inputs.

---

## 02 — What Phase 6 Delivers

By the end of this phase:

1. **Multi-package discovery** — the plugin discovers and loads N `.aurora`
   packages. Domain types, contributed tools, triggers, and registry entries
   from all packages are merged at startup. No hardcoded package IDs in
   plugin core.

2. **Non-profit `.aurora` package** — `packages/beach-cleanup/` with its own
   manifest, registry, domain types, and contributed tools. Structurally
   identical to `artist-reseller/`. Shares the same contract runtime, plugin
   services, and Pulse surface.

3. **`donor-acknowledgment-batch` domain type** — batch review pattern: agent
   drafts N donor letters, director spot-checks a sample, commits the batch.
   Different from single-item contracts. Proves the type system handles
   diverse interaction patterns.

4. **`volunteer-onboarding` domain type** — new application arrives, agent
   drafts welcome sequence, director approves. Simpler single-item flow that
   rounds out the non-profit scenario.

5. **A2UI surface compiler** — a helper layer between the agent's tool call
   and the raw A2UI protocol. The agent fills structured, domain-shaped
   fields (title, metrics, table data). The compiler emits canonical
   `a2ui_messages`. Eliminates the freehand JSON generation that the local
   model cannot reliably produce.

6. **Google Drive contributed tool** — `aura_query_drive` reads document
   content from Google Drive via the OpenClaw channel connector. Used by the
   non-profit agent to pull grant data sources. Registered conditionally on
   `drive` connector status, same pattern as `aura_query_listing` for Etsy.

7. **AGENTS.md seed strategy** — a tracked `agents/` seed directory in the
   repo that syncs into `.openclaw-docker/workspace/` on container start.
   Versioned, reviewable, no longer ephemeral.

8. **End-to-end generality test** — both the artist-reseller and non-profit
   scenarios load into the same runtime instance. Each uses its own domain
   types, tools, and triggers. Neither interferes with the other.

**Done when:** The non-profit grant-report scenario runs end to end — Drive
data → compiled report → contract → director reviews inline via DraftEditor
→ edits document → commits → report saved → engram extracts grant writer
profile — **without any changes to `@aura/contract-runtime` or the base
plugin service layer** (i.e., without changes to files that existed before
this phase, only additions).

---

## 03 — Architecture: Multi-Package Discovery

### The package manifest index

The plugin config gains an `auraPackages` array. This replaces the hardcoded
`'artist-reseller'` references.

```typescript
interface AuraPluginConfig {
  auraRoot: string;
  workspaceId: string;
  auraPackages: string[];   // e.g. ['artist-reseller', 'beach-cleanup']
}
```

When `auraPackages` is absent or empty, the plugin falls back to discovering
packages by scanning `<auraRoot>/packages/*/aurora.manifest.yaml` (or
`<monorepo>/packages/*/aurora.manifest.yaml` in dev). This means existing
setups with a single package continue working without config changes.

### Merged loading at startup

```
for each packageId in discoveredPackages:
  load aurora-registry.json   → merge into registryManifest
  load domain-types.json      → merge into domainTypesManifest
```

Merge rules:
- **Domain types**: append. Duplicate `type` names across packages are an
  error (logged and skipped). Each type must be globally unique.
- **Tools**: append. Each tool's `packageId` is set explicitly, never
  defaulted. The tool loader resolves the correct package directory per tool.
- **Triggers**: append. Each trigger carries its `packageId` for context.
- **Connector declarations**: not merged at the plugin level — connectors
  are per-manifest. The Pulse onboarding surface shows connectors grouped
  by package.

### ContractExecutor package resolution

The executor currently defaults to `'artist-reseller'` for `domain-types.json`
lookups. After this change, the executor resolves the package from the
contract's `type` field → registered type definition → originating package.

The type registry already stores each type definition. Phase 6 adds a
`packageId` field to `ContractTypeDefinition`:

```typescript
interface ContractTypeDefinition {
  type: string;
  version: string;
  description: string;
  packageId: string;        // ← new: which .aurora package owns this type
  validate(contract: BaseContract): string[];
}
```

This is the minimum change to the contract-runtime type system. It adds a
field; it removes nothing; it breaks nothing. Existing types that don't set
`packageId` default to `'artist-reseller'` for backward compatibility during
the transition.

---

## 04 — Architecture: A2UI Surface Compiler

### The problem

The live model (Ollama qwen3:14b) cannot reliably emit `a2ui_messages` as a
native array argument. It serializes the array to a JSON string, which
`aura_render_surface` correctly rejects. Prompt engineering has been
exhausted as a mitigation.

### The solution: `aura_surface` as the primary tool

Instead of expecting the agent to construct raw `a2ui_messages`, the existing
`aura_surface` tool becomes the canonical surface emission path. The agent
fills structured, flat, domain-meaningful fields:

```
aura_surface({
  surface_id: "grant-deadlines",
  title: "Upcoming Grant Deadlines",
  voice_line: "You have two grants due this month.",
  icon: "GD",
  surface_type: "monitor",
  sections: [
    {
      type: "metric-grid",
      items: [
        { label: "Due This Week", value: "1", tone: "warning" },
        { label: "Due This Month", value: "3", tone: "default" },
      ]
    },
    {
      type: "data-table",
      columns: ["Grant", "Funder", "Deadline", "Status"],
      rows: [
        ["CCC Q1", "CA Coastal Commission", "Apr 15", "Draft ready"],
        ["EPA Beach", "EPA Region 9", "Apr 30", "Data collection"],
      ]
    }
  ]
})
```

The `aura_surface` tool already exists and already handles this shape. The
gap is that `aura_render_surface` was added in Phase 5 as an alternative
path that exposes raw A2UI — and that raw path is what the model cannot
drive.

**Decision: `aura_surface` is the agent-facing tool. `aura_render_surface`
becomes an internal/advanced path.** The compiler inside `aura_surface`
translates structured sections into canonical `a2ui_messages` before pushing
to the WebSocket. The agent never constructs `a2ui_messages` directly.

### What changes

- `aura_surface` tool: add validation for known section types, emit compiled
  `a2ui_messages` to the WebSocket via `kernel_surface`. No schema change to
  the tool — it already accepts sections.
- `aura_render_surface`: kept but documented as advanced/internal. Not
  removed. Not offered to the agent by default in AGENTS.md.
- Plugin-side compiler function: `compileSections(sections) → a2ui_messages[]`.
  Deterministic. No LLM involvement. Maps section types (`metric-grid`,
  `data-table`, `action-button`, `editor`, `text`) to the A2UI catalog
  components already registered in `aura-catalog.tsx`.

This is not a new tool. It is completing the tool that already exists.

---

## 05 — Non-Profit `.aurora` Package

### Package: `packages/beach-cleanup/`

```
packages/beach-cleanup/
  package.json
  aurora.manifest.yaml
  aurora-registry.json
  domain-types.json
  openclaw.json.template
  tools/
    drive-lookup.js          ← contributed tool: aura_query_drive
  README.md
```

### `aurora.manifest.yaml`

```yaml
identity:
  name: Beach Ops
  email: null

connectors:
  gmail:
    source: openclaw-channel
    required: true
    capability_without: Cannot monitor inbox or send board communications.
    capability_with: Can receive grant notifications and send donor acknowledgments.

  calendar:
    source: openclaw-channel
    required: false
    capability_without: Cannot check event schedule or board meeting dates.
    capability_with: Can read schedule and create grant deadline reminders.

  drive:
    source: openclaw-channel
    required: true
    capability_without: Cannot access grant reports, budgets, or board documents.
    capability_with: Can read Drive documents to compile grant reports and board prep.

plugins:
  registry: aurora-registry.json
```

### `domain-types.json`

Three domain types:

**`grant-report-draft`** — already exists in contract-runtime as a code-level
type. Phase 6 adds it to the non-profit's `domain-types.json` as a
declarative entry that the generic loader handles. The code-level type
definition in `contract-runtime/src/domain-types/` remains as the reference
implementation and test fixture. The declarative loader produces equivalent
validation.

**`donor-acknowledgment-batch`** — new type. Fields:

| Field | Type | Required | Notes |
|---|---|---|---|
| `batch_id` | string | yes | Unique batch identifier |
| `donor_count` | number | yes | Total letters in batch |
| `sample_size` | number | yes | How many the director reviews |
| `sample_indices` | number[] | yes | Which letters are shown for spot-check |
| `campaign` | string | yes | Fundraising campaign name |
| `total_raised` | number | yes | Campaign total for context |
| `template_path` | string | yes | Path to letter template in PARA |
| `donor_list_path` | string | yes | Path to donor CSV/JSON in PARA |

Execution goals:
- `approve_batch`: Send all letters. Log each send. Complete.
- `revise_template`: Director edited the template. Re-generate sample with
  new template. Return to `waiting_approval` with updated sample.
- `cancel_batch`: Archive the batch. Complete without sending.

**`volunteer-onboarding`** — new type. Fields:

| Field | Type | Required | Notes |
|---|---|---|---|
| `volunteer_name` | string | yes | |
| `volunteer_email` | string | yes | |
| `application_date` | string | yes | ISO-8601 |
| `skills` | string[] | no | Self-reported skills |
| `availability` | string | no | Schedule description |
| `welcome_draft_path` | string | yes | Path to welcome sequence draft |
| `background_check` | string | no | `pending`, `passed`, `waived` |

Execution goals:
- `approve`: Send welcome sequence via Gmail. Log. Complete.
- `request_info`: Director needs more information. Agent sends info request
  email to volunteer. Returns to `waiting_approval` when response arrives.
- `decline`: Send polite decline. Log. Complete.

### `aurora-registry.json`

```json
{
  "version": "1.0",
  "plugins": {
    "required": [
      {
        "id": "engram",
        "package": "@openclaw/engram",
        "version": "2.1.0",
        "tier": "free"
      }
    ]
  },
  "tools": [
    {
      "id": "drive-lookup",
      "packageId": "beach-cleanup",
      "module": "./tools/drive-lookup.js",
      "connector": "drive",
      "description": "Read document content from Google Drive.",
      "contributes": ["aura_query_drive"],
      "requires_connector": true
    }
  ],
  "triggers": [
    {
      "id": "gmail-grants",
      "kind": "gmail-preset",
      "preset": "gmail",
      "instruction": "If the email is from a grant funder or contains grant report keywords, call aura_surface_decision with type='grant-report-draft'. Include: funder name, grant ID, deadline, and any attachments as data_sources."
    },
    {
      "id": "morning-brief",
      "kind": "cron",
      "schedule": "0 7 * * *",
      "message": "Execute the standing order: Morning Brief (Program: daily-brief).",
      "instruction": "Generate the morning brief. Summarize pending decisions, upcoming grant deadlines, volunteer applications, and donor campaign status."
    }
  ]
}
```

---

## 06 — Google Drive Contributed Tool

### `tools/drive-lookup.js`

Same pattern as `artist-reseller/tools/etsy-lookup.js`: exports a
`buildDriveLookup(storage, logger)` function that returns a `RegisteredTool`.

The tool uses the OpenClaw `read` host tool (or the Google Drive API via the
channel connector's OAuth token) to fetch document content by Drive file ID
or path.

**Phase 6 implementation**: the simplest working path. The agent already has
access to Google Drive via the OpenClaw channel connector. The contributed
tool wraps the Drive API read into a clean interface:

```typescript
aura_query_drive({
  file_id: "1abc...",      // Google Drive file ID
  format: "text"           // "text" | "markdown" | "raw"
})
// Returns: { content: "...", title: "...", modified: "..." }
```

If the Drive connector is not active, the tool is not registered (same
conditional pattern as `aura_query_listing`). The agent falls back to
asking the director to paste content — degraded but functional.

---

## 07 — AGENTS.md Seed Strategy

### Problem

`.openclaw-docker/` is fully gitignored. The `AGENTS.md` inside it is not
versioned. Every container rebuild starts from whatever state the manual
copy left it in. Agent instructions drift between sessions.

### Solution

A tracked seed directory:

```
aura-pulse/agents/
  workspace/
    AGENTS.md              ← primary agent instructions (versioned)
    SOUL.md                ← agent personality (versioned)
  workspace-orchestrator/
    AGENTS.md              ← orchestrator instructions (versioned)
```

On container start (via a `docker-compose.openclaw.yml` entrypoint hook or a
startup script), the seed files are copied into the OpenClaw workspace:

```bash
cp -n aura-pulse/agents/workspace/* ~/.openclaw/workspace/
cp -n aura-pulse/agents/workspace-orchestrator/* ~/.openclaw/workspace-orchestrator/
```

`cp -n` (no-clobber) means manual edits inside the container are preserved
until a deliberate reset. A `--force-seed` flag overwrites everything for
clean-slate testing.

The existing `.openclaw-docker/workspace/AGENTS.md` with its Phase 5
instructions (voice_line, icon, surface_type, metric tones, editor section)
becomes the initial content of the tracked seed file.

---

## 08 — Workstream Sequence

### A — Multi-package discovery (infrastructure)

1. Add `auraPackages` to `AuraPluginConfig` schema with auto-discovery
   fallback
2. Replace the four hardcoded `'artist-reseller'` references in `index.js`,
   `tool-loader.js`, and `contract-executor.js`
3. Add `packageId` field to `ContractTypeDefinition`
4. Implement merged loading loop in `index.js`
5. Test: two packages loaded, types from both registered, tools from both
   available, no collisions

### B — A2UI surface compiler (unblock workspace surfaces)

1. Implement `compileSections()` in a new module
   `openclaw-plugin/src/a2ui/section-compiler.js`
2. Wire into `aura_surface` tool's WebSocket emit path
3. Demote `aura_render_surface` from AGENTS.md; keep the tool registered
   but not promoted
4. Test: structured section input → valid `a2ui_messages` array → Pulse
   renders panels
5. Live validation: owner command → agent reads skill → calls
   `aura_surface` → Pulse shows workspace panel

### C — Non-profit package scaffold

1. Create `packages/beach-cleanup/` with all manifest files
2. Add `@aura/beach-cleanup` to `pnpm-workspace.yaml`
3. Write `domain-types.json` with three types
4. Write `aurora-registry.json` with tools and triggers
5. Write `tools/drive-lookup.js`
6. Add `openclaw.json.template`

### D — AGENTS.md seed strategy

1. Create `aura-pulse/agents/` tracked directory
2. Move Phase 5 AGENTS.md content into seed
3. Add entrypoint hook to `docker-compose.openclaw.yml`
4. Document the `--force-seed` flow

### E — End-to-end generality test

1. Integration test: both packages loaded into one runtime, types from
   both registered, no conflicts
2. Grant-report-draft lifecycle: create → surface with DraftEditor →
   director reviews → edits → commits → executes → complete → Engram captures from conversation
3. Donor-acknowledgment-batch lifecycle: create → surface with sample →
   director spot-checks → approves batch → executes → complete
4. Volunteer-onboarding lifecycle: create → surface → director approves →
   executes → complete
5. Cross-package test: artist offer-received and non-profit grant-report
   coexist in the same contracts.db with independent lifecycles
6. Tool isolation: `aura_query_listing` only available when Etsy active,
   `aura_query_drive` only available when Drive active

### Dependency order

```
A (multi-package) ──┬──► C (non-profit scaffold) ──► E (E2E tests)
                    │
B (A2UI compiler)   │
                    │
D (AGENTS.md seed) ─┘
```

A and B are independent and can be built in parallel. C depends on A.
D is independent. E depends on A + C.

---

## 09 — Files Added / Changed

### New files

| File | What |
|---|---|
| `packages/beach-cleanup/package.json` | Package identity |
| `packages/beach-cleanup/aurora.manifest.yaml` | Non-profit manifest |
| `packages/beach-cleanup/aurora-registry.json` | Tools, triggers |
| `packages/beach-cleanup/domain-types.json` | Three domain types |
| `packages/beach-cleanup/openclaw.json.template` | Security policy |
| `packages/beach-cleanup/tools/drive-lookup.js` | Google Drive contributed tool |
| `packages/beach-cleanup/README.md` | Package documentation |
| `packages/openclaw-plugin/src/a2ui/section-compiler.js` | A2UI surface compiler |
| `packages/openclaw-plugin/src/a2ui/section-compiler.d.ts` | Type declarations |
| `packages/openclaw-plugin/tests/unit/section-compiler.test.js` | Compiler tests |
| `packages/openclaw-plugin/tests/unit/multi-package-loader.test.js` | Multi-package tests |
| `packages/contract-runtime/tests/integration/multi-package.test.js` | Cross-package coexistence |
| `aura-pulse/agents/workspace/AGENTS.md` | Tracked agent seed |
| `aura-pulse/agents/workspace/SOUL.md` | Tracked personality seed |
| `aura-pulse/agents/workspace-orchestrator/AGENTS.md` | Tracked orchestrator seed |

### Changed files

| File | What changes |
|---|---|
| `packages/openclaw-plugin/index.js` | Multi-package discovery loop replaces hardcoded `'artist-reseller'` |
| `packages/openclaw-plugin/src/services/tool-loader.js` | Remove `'artist-reseller'` fallback; require explicit `packageId` |
| `packages/openclaw-plugin/src/services/contract-executor.js` | Resolve package from type registry instead of `DEFAULT_PACKAGE_ID` |
| `packages/openclaw-plugin/src/config/schema.js` | Add `auraPackages` to config schema |
| `packages/openclaw-plugin/src/config/schema.d.ts` | Type declaration update |
| `packages/openclaw-plugin/src/tools/aura-surface.js` | Wire section compiler into emit path |
| `packages/contract-runtime/src/runtime/type-registry.js` | Add `packageId` to stored type definitions |
| `packages/contract-runtime/src/runtime/type-registry.d.ts` | Type declaration update |
| `aura-pulse/pnpm-workspace.yaml` | Add `beach-cleanup` |
| `aura-pulse/docker-compose.openclaw.yml` | Add seed copy entrypoint |

---

## 10 — Test Matrix

### Multi-package discovery (workstream A)

| Test | Assertion |
|---|---|
| Two packages discovered | Both `artist-reseller` and `beach-cleanup` types registered |
| Duplicate type name across packages | Error logged, second definition skipped |
| Missing `domain-types.json` in one package | Other package loads normally, warning logged |
| Missing `aurora-registry.json` in one package | Other package loads normally, warning logged |
| Tool `packageId` resolution | Each tool resolves to its own package directory |
| ContractExecutor resolves package from type | `offer-received` → `artist-reseller`; `grant-report-draft` → `beach-cleanup` |

### A2UI surface compiler (workstream B)

| Test | Assertion |
|---|---|
| `metric-grid` section compiles | Valid `MetricGrid` A2UI message |
| `data-table` section compiles | Valid `DataTable` A2UI message with columns and rows |
| `action-button` section compiles | Valid `ActionButton` A2UI message |
| `editor` section compiles | Valid `DraftEditor` A2UI message |
| `text` section compiles | Valid `Text` A2UI message |
| Mixed sections compile | Array of heterogeneous A2UI messages |
| Invalid section type | Typed error, no partial output |
| Empty sections array | Valid empty `a2ui_messages` array (renders blank panel) |

### Non-profit domain types (workstream C)

| Test | Assertion |
|---|---|
| `grant-report-draft` validation | Rejects missing `funder_name`, `grant_id`, `report_period`, `deadline`, `draft_path`, `data_sources` |
| `donor-acknowledgment-batch` validation | Rejects missing `batch_id`, `donor_count`, `sample_size`, `campaign` |
| `donor-acknowledgment-batch` lifecycle | Create → surface (sample shown) → approve → execute → complete |
| `donor-acknowledgment-batch` revise flow | Approve → revise_template → re-surface with new sample → approve → complete |
| `volunteer-onboarding` validation | Rejects missing `volunteer_name`, `volunteer_email`, `welcome_draft_path` |
| `volunteer-onboarding` lifecycle | Create → surface → approve → execute → complete |
| `volunteer-onboarding` request-info flow | Create → surface → request_info → waiting (re-enters on reply) |

### Drive contributed tool (workstream C)

| Test | Assertion |
|---|---|
| Drive connector active → tool registered | `aura_query_drive` in tool list |
| Drive connector inactive → tool skipped | `aura_query_drive` not in tool list |
| Tool returns document content | `{ content, title, modified }` shape |
| Invalid file ID | Typed error, not a crash |

### E2E generality (workstream E)

| Test | Assertion |
|---|---|
| Both packages coexist | 7 domain types registered (4 artist + 3 non-profit) |
| Artist offer + non-profit grant in same DB | Independent lifecycles, no interference |
| Engram learns from non-profit conversations | Engram natively observes conversations and extracts grant writer profile |
| Tools from both packages available | `aura_query_listing` (if Etsy active) + `aura_query_drive` (if Drive active) |

---

## 11 — What Changes in contract-runtime (Track Carefully)

The foundation plan's success criterion for Phase 6 is "runs without Phase
1-2 changes." One small addition is required:

**`packageId` on `ContractTypeDefinition`** — this is an additive field with
a backward-compatible default. It does not change the runtime's behavior. It
does not change the state machine, storage, schema, or any existing test.
It adds metadata that the plugin layer consumes for package resolution.

If this feels like a violation of the "no Phase 1-2 changes" rule, the
alternative is storing the type→package mapping entirely in the plugin layer
(a lookup table built at load time). Both approaches work. The `packageId`
field is cleaner because it keeps the mapping close to the type definition
rather than in a separate structure.

No other changes to `@aura/contract-runtime` are expected or permitted.

---

## 12 — Deferred to Later Phases

| Item | Original phase | Why deferred |
|---|---|---|
| `@aura/etsy-connector` npm package | Foundation Phase 5 | Etsy built-in works; npm extraction is packaging, not functionality |
| `@aura/ebay-connector` (OAuth browser-redirect) | Foundation Phase 5 | No eBay scenario exists yet; OAuth pattern can be proven with any connector |
| `@aura/poshmark-app` production | Foundation Phase 5 | Scaffold exists; production watcher needs Lobster pipeline work |
| `@aura/mercari-app` | Foundation Phase 5 | Same as Poshmark; no API, needs browser automation |
| Expert Store / `aura_install_expert` | Foundation Phase 5 | Requires npm publishing infrastructure; not needed for generality proof |
| `board-prep` domain type | Foundation Phase 6 (mentioned in §16) | Valuable but not required for the generality proof; add when board meeting scenario is built |
| Full onboarding voice flow | Foundation Phase 7 | Phase 7 scope; not blocked by Phase 6 |
| Multi-business PARA trees | Foundation §18 | Future phase; single business per package is sufficient |

---

## 13 — Risk Register

| Risk | Likelihood | Mitigation |
|---|---|---|
| `packageId` addition to type registry breaks existing tests | Low | Field is optional with default; existing tests don't set it |
| A2UI compiler doesn't cover all section types | Medium | Start with the five types already in `aura-catalog.tsx`; add as needed |
| Google Drive channel connector credentials not accessible from plugin | Medium | Fall back to agent using OpenClaw's built-in `read` tool with Drive path; contributed tool becomes a convenience wrapper |
| Two-package loading reveals merge conflicts in trigger IDs | Low | Trigger IDs are namespaced by package in the registry; runtime deduplicates on `packageId:triggerId` |
| `donor-acknowledgment-batch` "sample review" UX unclear in Pulse | Medium | Prototype with existing `DataTable` component showing sample letters; iterate based on what feels right |

---

## 14 — Success Criteria (Checklist)

- [ ] `pnpm test` passes with both packages loaded — no new failures in existing tests
- [ ] Non-profit grant-report-draft lifecycle runs end to end in integration test
- [ ] Donor-acknowledgment-batch lifecycle runs end to end in integration test
- [ ] Volunteer-onboarding lifecycle runs end to end in integration test
- [ ] `aura_surface` with structured sections renders a workspace panel in Pulse (A2UI blocker resolved)
- [ ] Artist-reseller and non-profit contracts coexist in the same contracts.db
- [ ] `aura_query_drive` registers when Drive connector is active
- [ ] No changes to `contract-runtime` beyond the additive `packageId` field
- [ ] AGENTS.md is tracked in the repo and synced on container start
- [ ] Live browser validation: owner sends "show grant deadlines" → agent calls `aura_surface` → Pulse shows panel
