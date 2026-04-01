# Aura OS — Phase 5b Plan

**Expert Store Prototype + Reseller Package + Package Onboarding**

version: 3.2 | status: draft
date: March 31, 2026
validates-with: Sheryl (non-technical artist/reseller — real E2E user)

---

## 00 — The Pitch

Aurora OS gives small business owners an AI operations agent. Install a
package, answer some questions, and your agent handles your daily operations.

**Phase 5b proves this with one user, one package, and one workflow.**

Sheryl — a non-technical artist/reseller — runs the CLI installer, opens
Pulse, completes onboarding, and handles a simulated marketplace offer.
No code. No JSON. No terminal beyond the installer.

---

## 01 — Three Deliverables

1. **Expert Store CLI** — reads a package manifest, presents choices,
   installs everything using OpenClaw's own CLI. No custom config writing.

2. **Reseller package** — complete, self-contained reference implementation.
   Manifest, agent files, domain types, cron definitions, heartbeat
   checklist, Engram with LCM.

3. **Package onboarding** — agent-driven first-run via BOOTSTRAP.md in
   Pulse. Agent learns who the owner is and what it can do.

**Done when:** Sheryl completes the full flow without help.

---

## 02 — Leverage OpenClaw, Don't Reinvent It

OpenClaw is extensive. Before building anything, we ask: "Does OpenClaw
already solve this?" The answer is usually yes.

| Need | OpenClaw solution | Our job |
|---|---|---|
| Register agents | `openclaw agents add` | Call from installer |
| Set config values | `openclaw config set <path> <value>` | Call from installer |
| Schedule cron jobs | `openclaw cron add --name --cron --message` | Call from installer |
| Install plugins | `openclaw plugins install <path\|spec>` | Call from installer |
| Enable plugins | `openclaw plugins enable <id>` | Call from installer |
| Install skills | `openclaw skills install <slug>` | Call from installer |
| Persistent memory | `openclaw-engram` plugin (LCM + hybrid search) | Install + configure |
| Heartbeat checklist | `HEARTBEAT.md` workspace file (native) | Provide content |
| First-run onboarding | `BOOTSTRAP.md` workspace file (native) | Provide content |
| Health verification | `openclaw doctor` + `openclaw health` | Call after install |
| Engram verification | `openclaw engram setup` + `openclaw engram doctor` | Call after install |
| Plugin diagnostics | `openclaw plugins doctor` | Call after install |
| Model provider auth | `openclaw models auth login --set-default` | Prompt during install |
| Connector auth | `openclaw webhooks gmail setup --account <email>` | Prompt during install |
| Sub-agent spawning | `sessions_spawn` tool (native) | Agent uses at runtime |
| Worker discovery | `agents_list` tool (native) | Agent uses at runtime |
| Orchestrator allow | `openclaw config set agents.list.<id>.subagents.allowAgents` | Call from installer |
| Agent-to-agent allow | `openclaw config set tools.agentToAgent.*` | Call from installer |

**The installer is a thin orchestration layer.** It reads the manifest,
presents choices, and calls OpenClaw CLI commands. That's it. No JSON
editing, no config templates, no custom health checks. If OpenClaw has a
CLI command for it, we use it.

---

## 03 — Deliverable 1: Expert Store CLI

### What it does

`install.mjs` reads `aurora.manifest.yaml` and walks the user through
setup. It is the prototype for what becomes a `/aura/setup` endpoint or
standalone app — decision deferred, logic is the same.

### Interactive flow

```
╔══════════════════════════════════════════════╗
║         Aura OS — Expert Package Setup       ║
╚══════════════════════════════════════════════╝

  Package:  Art & Vintage Resale
  Agent:    studio-ops 🎨
  Timezone: America/New_York
  Ollama:   qwen3:14b @ http://192.168.68.116:11434

  Available sub-agents:

    1. Listing Drafter [recommended]
       Drafts marketplace listings from item descriptions and photos.

    2. Offer Monitor [recommended]
       Monitors inbox for marketplace offer emails.

    3. Shipping Tracker
       Tracks shipments across carriers and flags delays.

    4. Platform Monitor
       Monitors inventory levels and platform metrics.

    5. Software Engineer [recommended]
       Builds custom scripts, tools, and integrations on demand.

  Select (1,2,5 or Enter for recommended): _

  Scheduled jobs from this package:

    ☑ 1. Morning Brief — 0 7 * * *
    ☐ 2. Weekly Sales Summary — 0 17 * * 5

  Accept recommended? (Y/n): _

  Installing...

    ✓ Registered studio-ops (main agent)
    ✓ Registered studio-ops-orchestrator
    ✓ Registered listing-drafter
    ✓ Registered offer-monitor
    ✓ Registered software-engineer
    ✓ Copied workspace files
    ✓ Customized BOOTSTRAP.md with installed capabilities
    ✓ Installed aura-pulse plugin (local)
    ✓ Installed openclaw-engram (memory)
    ✓ Enabled plugins: aura-pulse, openclaw-engram, lobster
    ✓ Configured Engram (LCM + local LLM: qwen3:14b @ ...)

  Provider authentication:

  Set up model provider auth now? (y/N): y
  Running: openclaw models auth login
  Follow the prompts to authenticate your model provider.

    ✓ Model provider auth configured

  Set up Gmail connector now? (y/N): n
    · Skipped Gmail (run `openclaw webhooks gmail setup --account <email>` later)

    ✓ Applied plugin allowlists
    ✓ Configured heartbeat (every 30m, 8AM–10PM)
    ✓ Configured sub-agent permissions + allowAgents
    ✓ Created Aura PARA directories
    ✓ Added cron: Morning Brief (0 7 * * *)

    ✓ Plugin doctor passed
    ✓ Engram setup verified
    ✓ Engram doctor passed
    ✓ Health check passed

╔══════════════════════════════════════════════╗
║                  Setup Complete              ║
╚══════════════════════════════════════════════╝

  Package:      Art & Vintage Resale
  Main agent:   studio-ops 🎨
  Orchestrator: studio-ops-orchestrator
  Workers:      listing-drafter, offer-monitor, software-engineer
  Plugins:      aura-pulse, openclaw-engram, lobster
  Memory:       Engram (qwen3:14b @ http://192.168.68.116:11434)
  Crons:        Morning Brief
  Heartbeat:    every 30m (America/New_York)
  Workspace:    ~/.openclaw/workspace

  Open Pulse to meet Studio Ops.

  Verify: openclaw agents list --bindings
          openclaw plugins list
          openclaw cron list
```

### What the installer does (all OpenClaw CLI)

```
 1. Parse aurora.manifest.yaml
 2. Present sub-agent selection (interactive or --non-interactive)
 3. Present cron job selection from manifest

 4. openclaw agents add <main-id> --workspace <dir> --non-interactive
 5. openclaw agents set-identity --agent <main-id> --from-identity
 6. openclaw agents add <orchestrator-id>     (if workers selected)
 7. openclaw agents add <worker-id>           (for each selected)

 8. Copy workspace files to agent workspaces:
    Main:         AGENTS.md SOUL.md TOOLS.md IDENTITY.md USER.md
                  BOOTSTRAP.md HEARTBEAT.md onboarding.yaml
    Orchestrator: AGENTS.md TOOLS.md
    Workers:      AGENTS.md TOOLS.md

 9. Customize BOOTSTRAP.md with selected capabilities + crons

10. openclaw plugins install <aura-plugin-path>
11. openclaw plugins install @joshuaswarren/openclaw-engram --pin
12. openclaw plugins enable aura-pulse
13. openclaw plugins enable openclaw-engram
14. openclaw plugins enable lobster
15. Configure Engram (the big one):
    openclaw config set plugins.slots.memory "openclaw-engram"
    openclaw config set plugins.entries.openclaw-engram.enabled true
    openclaw config set plugins.entries.openclaw-engram.config.searchBackend "qmd"
    openclaw config set plugins.entries.openclaw-engram.config.captureMode "implicit"
    openclaw config set plugins.entries.openclaw-engram.config.localLlmEnabled true
    openclaw config set plugins.entries.openclaw-engram.config.localLlmUrl "<ollama-url>"
    openclaw config set plugins.entries.openclaw-engram.config.localLlmModel "<model>"
    openclaw config set plugins.entries.openclaw-engram.config.lcmEnabled true

16. Auth flow (interactive, skippable):
    openclaw models auth login --set-default  (model provider)
    openclaw webhooks gmail setup --account <email>  (Gmail connector)

17. openclaw config set plugins.allow [...]
18. openclaw config set agents.list[<main-index>].default true
19. Read `tool-policy.json` from the package
20. openclaw config set agents.list[<agent-index>].tools.allow [...]
21. openclaw config set tools.agentToAgent.enabled true
22. openclaw config set tools.agentToAgent.allow [<main>, <orchestrator>, <workers>]
23. openclaw config set plugins.entries.aura-pulse.config.auraRoot <aura-root>
24. openclaw config set plugins.entries.aura-pulse.config.workspaceId <main-id>
25. openclaw config set agents.defaults.heartbeat.every "30m"
26. openclaw config set agents.defaults.heartbeat.activeHours.*
27. openclaw config set agents.defaults.subagents.maxSpawnDepth 2
28. openclaw config set agents.list[<orch-index>].subagents.allowAgents [<workers>]

29. Create Aura project directories under the configured Aura root

30. openclaw cron add --name "Morning Brief" --cron "0 7 * * *" \
      --tz <tz> --session isolated --agent <main-id> \
      --message "<prompt from manifest>"
    (repeat for each selected cron)

31. openclaw plugins doctor
32. openclaw engram setup --json
33. openclaw engram doctor --json
34. openclaw doctor + openclaw health
35. Print summary
```

Every configuration action is a CLI call. No JSON editing. No config
templates. The platform does the work.

### Flags

```
node install.mjs                       # interactive
node install.mjs --non-interactive     # defaults only
node install.mjs --workers listing-drafter,offer-monitor
node install.mjs --docker              # CLI via docker compose
node install.mjs --dry-run             # preview only
node install.mjs --ollama-url http://192.168.68.116:11434
node install.mjs --ollama-model qwen3:14b
node install.mjs --tz America/New_York
```

Env vars: `OLLAMA_URL`, `OLLAMA_MODEL`, `OPENCLAW_WORKSPACE_DIR`

### Uninstaller

```
 1. openclaw cron list --json → find jobs with agentId=studio-ops
 2. openclaw cron rm <job-id>              (for each package cron)
 3. openclaw agents delete <worker-id>     (for each, --force)
 4. openclaw agents delete <orchestrator-id> --force
 5. openclaw agents delete <main-id> --force
 6. Remove workspace files (preserve USER.md)
 7. Remove sub-agent workspace directories
 8. openclaw plugins disable aura-pulse
 9. openclaw plugins uninstall aura-pulse --keep-files
10. openclaw config unset plugins.allow
11. openclaw config unset tools.allow
12. openclaw config unset tools.profile
13. openclaw config unset tools.alsoAllow
14. openclaw config unset plugins.slots.memory
15. openclaw config unset plugins.entries.openclaw-engram.config
16. openclaw config unset agents.defaults.heartbeat
17. openclaw config unset agents.defaults.subagents
18. Print confirmation (Engram plugin left installed, memory preserved)
```

---

## 04 — Deliverable 2: The Reseller Package

Complete, self-contained reference implementation. Everything a package
needs to deploy from zero.

### Package structure

```
packages/artist-reseller/
├── aurora.manifest.yaml         ← single source of truth
├── aurora-registry.json         ← plugin/tool/trigger declarations
├── domain-types.json            ← contract type schemas (4 types)
├── onboarding.yaml              ← declarative onboarding flow
│
├── agents/
│   ├── main/
│   │   ├── AGENTS.md            ← instructions + A2UI examples
│   │   ├── SOUL.md              ← persona, tone, boundaries
│   │   ├── TOOLS.md             ← tool usage notes
│   │   ├── IDENTITY.md          ← name, emoji, vibe
│   │   ├── USER.md              ← empty (filled during onboarding)
│   │   ├── BOOTSTRAP.md         ← first-run ritual (template)
│   │   └── HEARTBEAT.md         ← 30-min checklist
│   │
│   ├── orchestrator/
│   │   └── AGENTS.md
│   │
│   └── workers/
│       ├── listing-drafter/
│       │   └── AGENTS.md
│       ├── offer-monitor/
│       │   └── AGENTS.md
│       ├── shipping-tracker/
│       │   └── AGENTS.md
│       ├── platform-monitor/
│       │   └── AGENTS.md
│       └── software-engineer/
│           └── AGENTS.md
│
├── blueprints/
│   ├── README.md               ← blueprint format + concept
│   ├── posh-pusher.md          ← Poshmark browser automation
│   ├── repeat-buyer-tracker.md ← buyer profile database
│   ├── batch-listing-generator.md ← bulk listing creation
│   └── sales-analytics-dashboard.md ← revenue + platform analytics
│
├── scripts/
│   ├── install.mjs
│   └── uninstall.mjs
│
└── tools/
    └── etsy-lookup.js
```

### The manifest

The manifest declares everything the installer needs. Cron prompts and
Engram config live inline — simple, no indirection.

```yaml
domain:
  id: artist-reseller
  name: Art & Vintage Resale
  description: >
    Operations agent for art, vintage, and handmade resale businesses.

identity:
  name: Studio Ops
  emoji: "🎨"
  theme: Calm, organized, detail-oriented

agents:
  main:
    id: studio-ops
    workspace_files:
      - AGENTS.md, SOUL.md, TOOLS.md, IDENTITY.md
      - USER.md, BOOTSTRAP.md, HEARTBEAT.md
  orchestrator:
    id: studio-ops-orchestrator
    required_if_workers: true
  workers:
    - id: listing-drafter
      name: Listing Drafter
      description: Drafts marketplace listings from descriptions and photos.
      default: true
    - id: offer-monitor
      name: Offer Monitor
      description: Monitors inbox for marketplace offer emails.
      default: true
    - id: shipping-tracker
      name: Shipping Tracker
      description: Tracks shipments and flags delays.
      default: false
    - id: platform-monitor
      name: Platform Monitor
      description: Monitors inventory levels and platform metrics.
      default: false
    - id: software-engineer
      name: Software Engineer
      description: Builds custom scripts, tools, and integrations on demand.
      default: true

connectors:
  gmail:
    required: true
    capability_without: Cannot monitor inbox or reply to buyers.
    capability_with: Can receive offer emails and send replies.
  etsy:
    required: false
    capability_with: Can look up live asking prices on offers.

heartbeat:
  every: "30m"
  active_hours: { start: "08:00", end: "22:00" }
  tasks:
    - Check inbox for new offer emails
    - Check for shipping status updates
    - Flag contracts approaching TTL expiry

crons:
  - id: morning-brief
    name: Morning Brief
    schedule: "0 7 * * *"
    default: true
    session: isolated
    prompt: >
      Compile a morning brief. Check pending contracts, overnight
      activity, and today's deadlines. Surface via aura_surface.
  - id: weekly-sales
    name: Weekly Sales Summary
    schedule: "0 17 * * 5"
    default: false
    session: isolated
    prompt: >
      Compile a weekly sales summary. Query Engram for the past 7 days.
      Break down by platform. Surface via aura_surface.

plugins:
  required:
    - id: openclaw-engram
      install: "@joshuaswarren/openclaw-engram --pin"
      slot: memory
      config:
        searchBackend: qmd
        captureMode: implicit
        localLlmEnabled: true
        lcmEnabled: true
      verify:
        - openclaw engram setup --json
        - openclaw engram doctor --json
    - id: aura-pulse
      install: local
      path: ../../openclaw-plugin
  optional:
    - id: lobster
      install: bundled

skills: []

config:
  plugins.allow: [aura-pulse, openclaw-engram, lobster]
  plugins.slots.memory: openclaw-engram
  tool_policy_file: tool-policy.json
  agents.list.<package-agent>.tools.allow: [package-owned deterministic set]

para:
  areas: [inventory, buyer-patterns]
  resources: [platform-policies]
```

### Agent files — all complete

| File | Purpose | Status |
|---|---|---|
| `agents/main/AGENTS.md` | A2UI examples for all 4 contract types + morning brief + sales summary | Done |
| `agents/main/SOUL.md` | Warm, efficient, transparent boundaries | Done |
| `agents/main/TOOLS.md` | Notes for aura_fs_*, aura_surface, engram, contract tools | Done |
| `agents/main/IDENTITY.md` | Studio Ops 🎨 | Done |
| `agents/main/USER.md` | Empty template (filled during onboarding) | Done |
| `agents/main/BOOTSTRAP.md` | 7-step onboarding ritual (template, customized at install) | Done |
| `agents/main/HEARTBEAT.md` | 30-min checklist (inbox, shipping, TTL) | Done |
| `agents/orchestrator/AGENTS.md` | Orchestrator instructions (depth 1, never talks to owner) | Done |
| `agents/workers/listing-drafter/AGENTS.md` | Listing specialist | Done |
| `agents/workers/offer-monitor/AGENTS.md` | Offer parsing specialist | Done |
| `agents/workers/shipping-tracker/AGENTS.md` | Shipping specialist | Done |
| `agents/workers/platform-monitor/AGENTS.md` | Inventory specialist | Done |
| `agents/workers/software-engineer/AGENTS.md` | Custom build specialist (all packages) | Done |
| `onboarding.yaml` | Declarative onboarding flow definition | Done |
| `domain-types.json` | 4 contract type schemas | Done |
| `aurora-registry.json` | Plugin/tool/trigger declarations | Done |
| `blueprints/*.md` | 4 build blueprints (posh-pusher, buyer tracker, batch listings, analytics) | Done |
| `aurora.manifest.yaml` | Package manifest v3 (agents, crons, heartbeat, plugins, Engram+LCM) | Done |

### Blueprints — agent-recommended builds

Each package ships a `blueprints/` directory containing pre-written build
prompts. When the agent recognizes a situation matching a blueprint's
trigger, it recommends the build to the owner. If approved, the
orchestrator delegates the blueprint's build spec to the software-engineer
worker, which builds the tool and announces the result.

Blueprints are prompt content, not code. The value is in the curated
instructions. This applies to any business functionality — connectors,
analytics, automation, data tools — not just platform integrations.

**Reseller package blueprints (scaffolded, not built):**
- `posh-pusher` — browser automation for Poshmark (no API)
- `repeat-buyer-tracker` — buyer profile database for enriching offers
- `batch-listing-generator` — bulk listing creation from CSV input
- `sales-analytics-dashboard` — revenue trends and platform comparison

The agent reads `blueprints/` at runtime and surfaces recommendations
when triggers match. This is how the agent ecosystem extends itself —
the package defines what *could* be built, the agent decides *when* to
suggest it, and the software-engineer does the building.

**Not in 5b scope:** Building or running any blueprint. The blueprints
are prompt scaffolds only. The software-engineer worker and the blueprint
system are proven when a blueprint is successfully recommended, approved,
built, and used in a real session. That's Phase 6+ territory.

### Standard workers (all packages)

The **software-engineer** worker ships with every Aurora package. It can build
custom scripts, tools, and integrations on demand. When the orchestrator
receives a build request, it spawns the software-engineer with a clear task
description. Output goes to `projects/builds/`. This is the agent ecosystem's
ability to extend itself — the business can ask for something that doesn't
exist yet, and the agent builds it.

### Sub-agent communication

Agents communicate via OpenClaw's native `sessions_spawn` tool. The primary
agent delegates to the orchestrator (depth 1), which spawns workers (depth 2).
Results flow back via the announce chain — automatic, no custom wiring.

Key config the installer sets:
- `agents.defaults.subagents.maxSpawnDepth: 2` (main → orch → worker)
- `agents.defaults.subagents.maxChildrenPerAgent: 5`
- `agents.list.<orchestrator>.subagents.allowAgents: [<selected-workers>]`
- `tools.agentToAgent.enabled: true`
- `tools.agentToAgent.allow: [<main>, <orchestrator>, <selected-workers>]`

Workers only get `AGENTS.md` + `TOOLS.md` (no SOUL.md, IDENTITY.md, USER.md,
HEARTBEAT.md, BOOTSTRAP.md). The installer prunes the default OpenClaw
workspace scaffolding so only the package-managed files remain.

Reference: https://docs.openclaw.ai/tools/subagents

### Domain types

- `offer-received` — marketplace offer, owner decides accept/counter/decline
- `listing-draft` — listing ready for review, approve/revise/discard
- `shipping-delay` — shipment late, notify buyer or wait
- `inventory-alert` — stock low, restock or dismiss

---

## 05 — Deliverable 3: Package Onboarding

After install, the user opens Pulse. BOOTSTRAP.md triggers the onboarding
ritual. Seven steps:

### 1. Greet

Agent introduces itself using IDENTITY.md personality. Uses `aura_surface`
(owner can't see text replies). Sets the tone.

### 2. Discover

Asks questions one at a time. Writes answers to USER.md after each.
- Name and preferred address
- Platforms (Poshmark, Etsy, Mercari, eBay)
- Approximate listing count
- What they sell (art, vintage, handmade, mix)
- What takes the most time

### 3. Connectors

Reports what's connected and what's missing. Surfaces a status card.
Uses `capability_without` / `capability_with` from the manifest to explain
what each missing connector would enable.

### 4. Schedule review

Surfaces the cron jobs selected during install for owner approval.
- "I'm set up to send you a morning brief at 7 AM. Does that time work?"
Reviews heartbeat tasks.
- "Every 30 minutes during the day I'll check for new offers and shipping
  updates. I'll only bother you if something needs your attention."

### 5. Capability test

Agent silently verifies its core tools and reports results via
`aura_surface`:
- `aura_fs_list` on PARA root — filesystem working?
- `engram.recall` with a test query — memory responding?
- `aura_list_contracts` — contract system reachable?

Surfaces a results card (✓ connected / ✗ not working). Graceful
degradation: "This isn't working yet — I'll operate without it for now."

### 6. Handoff

Surfaces a summary of everything configured: connected tools, scheduled
jobs, capabilities (including which sub-agents are installed).
- "Forward me your next offer email and I'll show you what I can do."

### 7. Clean up

Deletes BOOTSTRAP.md (`exec rm BOOTSTRAP.md`). Ritual only runs once.

### What onboarding produces

- **USER.md** populated with owner name, platforms, categories, preferences
- **Engram seed** — extracted automatically from the onboarding conversation
  (Engram observes implicitly, no manual store needed)
- **Owner-approved cron schedule** — confirmed times for morning brief, etc.
- **Capability report** — agent knows exactly what works and what doesn't

---

## 06 — Engram + LCM

Engram is the memory layer. It's an OpenClaw plugin by
[joshuaswarren](https://github.com/joshuaswarren/openclaw-engram) that
replaces default OpenClaw memory with persistent, searchable, local-first
knowledge.

### What we configure

| Setting | Value | Why |
|---|---|---|
| `plugins.slots.memory` | `openclaw-engram` | Replaces default memory |
| `searchBackend` | `qmd` | Best recall quality (hybrid BM25 + vector + reranking) |
| `captureMode` | `implicit` | Learns automatically from every conversation |
| `localLlmEnabled` | `true` | Extracts knowledge via Ollama, not cloud |
| `localLlmUrl` | `<ollama-url>/v1` | Points to the user's Ollama instance |
| `localLlmModel` | `qwen3:14b` | Extraction model |
| `lcmEnabled` | `true` | Lossless Context Management |

### LCM (Lossless Context Management) — the selling point

When an AI agent hits its context window limit, the runtime silently
compresses old messages — that context is gone forever. LCM fixes this.

- **Proactive archiving** — every message indexed in local SQLite before
  compaction can discard it
- **Hierarchical summaries** — leaf summaries cover ~8 turns, depth-1
  covers ~32, depth-2 ~128
- **Fresh tail protection** — recent turns always use the most detailed
  summaries
- **Zero data loss** — raw messages retained for configurable retention
- **MCP expansion tools** — agent can search, describe, or expand any part
  of conversation history on demand

This means: the agent never forgets what happened earlier in a
conversation, even in long sessions. For a reseller handling 20 offers in
a day, this is the difference between the agent losing context at offer #8
vs remembering every decision across the full session.

### Verification

The installer runs:
- `openclaw engram setup --json` — validates config, scaffolds directories
- `openclaw engram doctor --json` — health diagnostics with remediation hints

---

## 07 — Workstreams

### A — Package completion

| Task | Status |
|---|---|
| `aurora.manifest.yaml` v3 — agents, crons, heartbeat, plugins, Engram+LCM | Done |
| `HEARTBEAT.md` — 30-min checklist | Done |
| `BOOTSTRAP.md` — 7-step onboarding with capability test + cron review | Done |
| `AGENTS.md` + all agent workspace files (incl. software-engineer) | Done |
| `domain-types.json` (4 contract types) | Done |
| `aurora-registry.json` | Done |
| `onboarding.yaml` | Done |

### B — Expert Store CLI

| Task | Status |
|---|---|
| `install.mjs` — all config via OpenClaw CLI | Done |
| `uninstall.mjs` — all cleanup via OpenClaw CLI | Done |
| Plugin install/enable via `openclaw plugins` | Done |
| Engram install + full config (LCM, local LLM, QMD search) | Done |
| Cron registration via `openclaw cron add` | Done |
| Heartbeat + sub-agent config + allowAgents via `openclaw config set` | Done |
| Auth flow: `openclaw models auth login` + `openclaw webhooks gmail setup` | Done |
| Plugin allowlists via `openclaw config set` | Done |
| Verification: `plugins doctor` + `engram setup` + `engram doctor` + `health` | Done |
| Skills install via `openclaw skills install` (placeholder for future) | Done |

### C — E2E validation (5 sessions)

| Session | Scope | Status |
|---|---|---|
| **C1** — Docker + Installer | Bring up env, run install.mjs, verify CLI | New |
| **C2** — Onboarding | Pulse open, BOOTSTRAP.md 7-step flow, USER.md populated | New |
| **C3** — Offer Flow | Simulated offer → decision chain → contract resolution | New |
| **C4** — Cron, Heartbeat, Hardening | Verify cron/heartbeat, edge cases, stress test, polish | New |
| **C5** — Sheryl Handoff | Clean-slate E2E, prep environment, real user test | New |

Each session has its own plan file in `docs/plans/aura-os-phase5b-plan/`.

### Dependency order

```
A (package files) ──► B (installer reads A) ──► C1 ──► C2 ──► C3 ──► C4 ──► C5
```

A and B are complete. C1 is next.

---

## 08 — What's NOT in 5b

| Item | Why |
|---|---|
| Aurora Install scripts/UI | Docker env assumed ready |
| `/aura/setup` endpoint or Electron app | CLI prototype first |
| A2UI section compiler | Agent has JSON examples, test in E2E |
| FS tool unit tests | E2E proves they work |
| Real OAuth flows | Mock or pre-configure in Docker |
| Multiple packages | One package, one prototype |
| EngramCompletionBridge | Not wired = already deprecated |
| Blueprint execution | Prompts scaffolded, builds are Phase 6+ |
| aura-app runtime (pm2/docker) | posh-pusher scaffold is prompt only |
| Production deployment | Docker + localhost only |

---

## 09 — Success Criteria

### Installer
- [ ] Reads manifest, presents interactive choices
- [ ] Sub-agent and cron selection works
- [ ] All agent registration via `openclaw agents add/set-identity`
- [ ] Plugins installed via `openclaw plugins install`
- [ ] Plugins enabled via `openclaw plugins enable`
- [ ] Engram fully configured (slot, searchBackend, captureMode, localLlm, LCM)
- [ ] Config set via `openclaw config set` (plugins.allow, per-agent tools, heartbeat, subagents)
- [ ] Orchestrator `allowAgents` set to selected worker IDs
- [ ] Auth flow prompts for model provider + connector setup (skippable)
- [ ] Crons registered via `openclaw cron add`
- [ ] BOOTSTRAP.md customized with installed capabilities and crons
- [ ] `openclaw plugins doctor` passes
- [ ] `openclaw engram setup --json` passes
- [ ] `openclaw engram doctor --json` passes
- [ ] `openclaw doctor` + `openclaw health` pass
- [ ] `uninstall.mjs` cleanly reverses everything (crons, agents, plugins, config)

### Package
- [ ] Manifest declares domain, agents, connectors, crons, heartbeat, plugins, Engram+LCM, PARA
- [ ] All agent files are generic — no hardcoded user info
- [ ] Software-engineer worker included as default (standard across all packages)
- [ ] HEARTBEAT.md provides meaningful 30-min checklist with HEARTBEAT_OK fallback
- [ ] Cron prompts in manifest are clear, actionable, reference correct tools
- [ ] Engram configured with LCM enabled and local LLM extraction

### Onboarding
- [ ] BOOTSTRAP.md triggers on first session in Pulse
- [ ] Agent greets with correct personality via `aura_surface`
- [ ] Discovery questions asked one at a time, answers written to USER.md
- [ ] Agent reports connector status (what's connected, what's missing, what each enables)
- [ ] Agent surfaces cron schedule for owner approval
- [ ] Agent runs capability test (FS, Engram, contracts) and reports results
- [ ] BOOTSTRAP.md deleted after completion
- [ ] Subsequent sessions: agent reads USER.md and uses owner's name naturally

### Sheryl test
- [ ] Runs installer without help (selects sub-agents, confirms crons)
- [ ] Completes onboarding conversation in Pulse
- [ ] Handles a simulated offer (full decision chain: offer → counter → send)
- [ ] Receives a morning brief that makes sense
- [ ] Understands what Studio Ops can do and how to use it
- [ ] Zero code reading, zero JSON editing
- [ ] PARA tree has correct directories after session

---

## 10 — What This Proves to Investors

1. **The manifest is the product.** One YAML file defines an entire
   business agent — identity, capabilities, schedule, memory config,
   onboarding. A new domain is a content change, not an architecture
   change.

2. **OpenClaw is the platform, Aurora is the experience.** We don't build
   cron, heartbeat, memory, or agent management. OpenClaw does. We build
   the business logic layer on top.

3. **Memory that never forgets.** Engram with LCM means the agent retains
   every conversation, every decision, every preference — locally, with
   zero data loss. No cloud dependency. No subscription. The agent gets
   smarter over time.

4. **A non-technical user validated it.** Sheryl's test proves the target
   audience can use it. Not developers. Not AI enthusiasts. Small business
   owners who want help.

5. **Every package ships a software engineer.** The software-engineer
   worker can build custom scripts, tools, and integrations on demand.
   When the business needs something that doesn't exist, the agent builds
   it. This is the moat — the agent ecosystem grows itself.

6. **The Expert Store is a distribution model.** Packages are installable,
   configurable, and self-onboarding. This is an app store for business
   agents.

---

## 11 — Open Questions (Narrow)

1. **Connector pre-configuration.** For the Sheryl test, Gmail needs to
   be connected before the agent talks. Pre-configure in Docker. Future:
   guided setup in the Expert Store UI.

2. **BOOTSTRAP.md deletion.** Verify: does the agent delete it (our
   instruction says `exec rm BOOTSTRAP.md`) or does OpenClaw handle this
   natively? Test during E2E.

---

## 12 — Key File Paths

For a fresh context window — these are the files that matter:

### Plan (under `docs/plans/aura-os-phase5b-plan/`)
- `00-master-plan.md` — this file (full spec, reference for all sessions)
- `C1-docker-and-installer.md` — session plan: Docker env + installer
- `C2-onboarding.md` — session plan: BOOTSTRAP.md onboarding flow
- `C3-offer-flow.md` — session plan: simulated offer decision chain
- `C4-cron-heartbeat-and-hardening.md` — session plan: cron, heartbeat, edge cases, polish
- `C5-sheryl-handoff.md` — session plan: clean E2E, Sheryl's environment, real user test

### Package (all under `aura-pulse/packages/artist-reseller/`)
- `aurora.manifest.yaml` — package manifest v3
- `aurora-registry.json` — plugin/tool/trigger declarations
- `domain-types.json` — 4 contract type schemas
- `onboarding.yaml` — declarative onboarding flow
- `scripts/install.mjs` — Expert Store CLI (400 lines)
- `scripts/uninstall.mjs` — clean uninstall (153 lines)

### Blueprints (under `blueprints/`)
- `README.md` — blueprint format and concept
- `posh-pusher.md` — Poshmark browser automation (aura-app pattern)
- `repeat-buyer-tracker.md` — buyer profile database
- `batch-listing-generator.md` — bulk listing creation
- `sales-analytics-dashboard.md` — revenue trends and platform analytics

### Agent files (under `agents/`)
- `main/AGENTS.md` — primary agent instructions + 9 A2UI examples (257 lines)
- `main/SOUL.md` — persona and boundaries
- `main/TOOLS.md` — tool usage notes
- `main/IDENTITY.md` — Studio Ops 🎨
- `main/USER.md` — empty owner profile template
- `main/BOOTSTRAP.md` — 7-step onboarding ritual (80 lines)
- `main/HEARTBEAT.md` — 30-min checklist (12 lines)
- `orchestrator/AGENTS.md` — orchestrator instructions
- `workers/{listing-drafter,offer-monitor,shipping-tracker,platform-monitor,software-engineer}/AGENTS.md`

### Foundation docs
- `docs/plans/aura-os-foundation-plan-v0.5.md` — overall architecture
- `docs/openclaw-docker-runtime.md` — Docker test environment setup

### Key external references
- OpenClaw CLI: https://docs.openclaw.ai/cli
- OpenClaw Cron: https://docs.openclaw.ai/automation/cron-jobs
- OpenClaw Heartbeat: https://docs.openclaw.ai/gateway/heartbeat
- Engram: https://github.com/joshuaswarren/openclaw-engram
- Sub-agents: https://docs.openclaw.ai/tools/subagents
- Models auth: https://docs.openclaw.ai/cli/models
