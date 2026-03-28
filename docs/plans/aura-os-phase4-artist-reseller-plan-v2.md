# Aura OS — Phase 4 Plan
**Artist Reseller Scenario: Real Email, Real Platforms, Full Six-Beat Demo**
version: 2.0 | status: implementation-ready
date: March 27, 2026

---

## 00 — Strategic Frame (Read This First)

OpenClaw is the operating system and package manager layer. Aura does not
rebuild what OpenClaw ships. Aura wraps it.

| Layer | Who owns it | Aura's role |
|---|---|---|
| Plugin install, enable, disable | `openclaw plugins install` CLI | Curate the allowlist; call the CLI |
| Bundle installs (Codex/Claude/Cursor format) | `openclaw plugins install <path or tgz>` | Distribute signed bundles; own the resolver URL |
| Hook ingress (Gmail, webhooks) | OpenClaw gateway webhook engine | Configure mappings; point at Aura agent |
| Tool allowlist / security policy | `openclaw.json` — `plugins.allow`, `tools.deny` | Bootstrap and own the config file |
| Skills | OpenClaw skill root (`~/.openclaw/skills/`) | Ship skill files; symlink on install |
| Agent intelligence | Pi agent (the agent reasons, parses, decides) | Provide tool surface; let agent do its job |
| Memory / entity profiles | Engram HTTP API (port 4318) | Call the API; never reimplement |
| App lifecycle (pm2 / docker) | Native process managers | Scaffold; agent picks and deploys |

**The onus of maintaining connectors, plugins, and skills sits with the
OpenClaw ecosystem and third-party authors. Aura's job is:**

1. A curated `aurora-registry.json` that declares what installs automatically
2. A bootstrap process that calls `openclaw plugins install` for each entry
3. A `plugins.allow` list in `openclaw.json` that enforces the walled garden
4. A Pulse UI surface for onboarding and Expert Store installs — user never
   sees a terminal

Everything else (OAuth, webhooks, memory extraction, skill execution) is
delegated to the layer that already owns it.

---

## 01 — What Phase 4 Delivers

Phase 4 activates the Aura stack with real external services and a real
business scenario.

By the end of this phase:

- **Three new domain contract types** registered and tested: `listing-draft`,
  `shipping-delay`, `inventory-alert`.
- **Gmail via gog/Pub/Sub** wired end-to-end: Google Pub/Sub push →
  `gog gmail watch serve` → `POST /hooks/gmail` → OpenClaw mapping →
  agent turn with Aura tools in scope. No custom OAuth. No plugin-level
  email parsing. The agent reads, reasons, and calls `aura_surface_decision`.
- **`offer-received` contracts** created by the agent from forwarded
  Poshmark, Etsy, and Mercari offer emails.
- **Engram entity lookup** enriches contracts with buyer history before the
  surface appears — agent calls `GET /engram/v1/entities/:name` directly.
- **Response dispatch** after Resolver commit: agent calls `gog gmail reply`
  via the exec tool to send from the agent's Gmail account.
- **Etsy connector** (`aura-connector` shape, manual-guide API key flow),
  with `aura_query_listing` tool for live asking price.
- **Engram completion payloads** are type-aware and tagged for entity
  extraction.
- **`aurora-registry.json`** declares required and optional plugins; bootstrap
  logic in `index.js` installs missing entries via `openclaw plugins install`
  at gateway start.
- **Pulse onboarding surface**: first-load checklist showing registry install
  progress. User taps optional items to install. No terminal required.
- **Artist reseller `.aurora` package scaffold**: `aurora.manifest.yaml`,
  `aurora-registry.json`, `openclaw.json` template, `aura-app` stub, PARA
  subdirs, README.
- **Four connector source types** codified in `connector-state.d.ts`:
  `openclaw-channel`, `aura-connector`, `aura-skill`, `aura-app`.
- **Full six-beat integration test** passes with all external APIs mocked.

**Done when:** A real forwarded marketplace offer email flows end to end —
forwarded email → agent reasons → contract deferred to wake time → card
appears → voice speaks → Resolver engages → owner edits draft → commits →
agent sends reply via gog → completion voice → card clears → Engram
extracts buyer pattern.

Phase 5 (non-profit scenario + Poshmark aura-app) starts only when this
cycle runs cleanly.

---

## 02 — Starting State From Phase 3

Phase 4 builds on a specific foundation. Do not re-implement anything
already present.

**Already present:**

- `offer-received` and `grant-report-draft` domain types — registered and
  end-to-end tested
- `OpenClawChannelConnector` — `seedIfAbsent()` and `isActive()` built in
  Phase 2, **zero call sites anywhere in the codebase**
- `AuraConnectorStore` — `readDecrypted()`, `write()`, `patch()` working,
  AES-256 encryption in contracts.db
- `aura_request_connection` tool — triggers connector card in Pulse PWA
- `EngramCompletionBridge` — POSTs to `POST /engram/v1/memories` on
  completion; content is flat text, not type-aware
- `registerHook` — typed in `plugin-types.d.ts`, never called in `index.js`
  (and confirmed: this is for plugin lifecycle events, not Gmail webhook
  ingress — that goes through the OpenClaw webhook engine separately)
- All Pulse PWA surface states including connector card flows
- History surface and morning brief operational

**Phase 2 built the channel connector abstraction and left it disconnected.**
Phase 4's first job is wiring what already exists before adding anything new.

---

## 03 — Architecture: How Gmail Actually Works

The v1 plan assumed plugin-level hook registration (`api.registerHook`) was
the Gmail ingress path. Research confirmed this is wrong. The correct chain:

```
Gmail inbox
  → Google Pub/Sub topic (gcloud pubsub)
  → gog gmail watch serve  (daemon, port 8788, managed by OpenClaw)
  → POST /hooks/gmail       (OpenClaw webhook engine)
  → hooks.mappings entry    (openclaw.json — routes to agent turn)
  → Isolated agent turn     (agent reads email, calls aura tools)
  → aura_surface_decision   (creates offer-received contract)
```

**The agent IS the email parser.** OpenClaw's Gmail hook mapping delivers
`from`, `subject`, `body`, and `snippet` already extracted into the agent's
message context via `messageTemplate`. The agent reasons about the content
and calls Aura tools. No plugin-level `GmailMessageHandler` is needed and
none will be built.

**Prerequisites for this chain (one-time setup):**

```bash
# 1. Install gog (gogcli) — handles Gmail OAuth and Watch API
brew install gogcli    # or follow https://gogcli.sh

# 2. Authorize gog for the agent Gmail account
gog auth login --account studio-ops@gmail.com

# 3. Run the OpenClaw wizard (installs gcloud, sets up Pub/Sub, Tailscale Funnel)
openclaw webhooks gmail setup --account studio-ops@gmail.com

# 4. The wizard writes hooks.gmail config and enables the gmail preset
#    Gateway auto-starts gog gmail watch serve on next boot
```

**openclaw.json Gmail mapping** (wizard writes defaults; Aura bootstrap
may override the messageTemplate and agentId):

```json5
{
  hooks: {
    enabled: true,
    token: "${OPENCLAW_HOOK_TOKEN}",
    presets: ["gmail"],
    mappings: [
      {
        match: { path: "gmail" },
        action: "agent",
        wakeMode: "now",
        name: "Gmail",
        agentId: "aura-studio-ops",
        sessionKey: "hook:gmail:{{messages[0].id}}",
        messageTemplate: "New email from {{messages[0].from}}\nSubject: {{messages[0].subject}}\n\n{{messages[0].body}}",
        deliver: false,
      }
    ]
  }
}
```

`deliver: false` — the agent does not echo a reply to the chat channel; it
creates a contract instead. The contract surfaces via Pulse.

**Reply path:** After the owner resolves, the agent calls `gog gmail reply`:

```bash
gog gmail reply \
  --account studio-ops@gmail.com \
  --thread-id <threadId> \
  --body "<response text>"
```

`gog` is invocable from the agent via the exec tool (allowlisted). Aura
does not need to own Gmail OAuth, an HTTP client, or a send API wrapper.

The `openclaw-channel` connector records in contracts.db describe Gmail's
state for Pulse display purposes — connected/not-offered — independent of
the Pub/Sub chain. `seedIfAbsent` still runs at startup to maintain these
records.

---

## 04 — Connector Taxonomy

All four source types are codified in `connector-state.d.ts`. Implementors
choose the correct type at design time based on the platform:

| Source type | When to use | Auth / execution | Phase 4 example |
|---|---|---|---|
| `openclaw-channel` | Platform is an OpenClaw-native channel | OpenClaw manages auth and hooks | Gmail, Calendar, Drive |
| `aura-connector` | Platform has a REST API; Aura holds the key | AES token in contracts.db (`AuraConnectorStore`) | Etsy |
| `aura-skill` | Official CLI tool exists; tool manages its own auth | CLI keychain (e.g. gog, stripe CLI) | gog for Gmail reply |
| `aura-app` | No API exists; browser automation required | pm2 or docker process; OpenClaw browser tool | Poshmark (Phase 5) |

**Implementation note on `aura-app` (stub only in Phase 4):**

Add the `aura-app` literal to the `ConnectorSource` union type and a JSDoc
comment. No runtime behavior. `aura-app` entries have a lifecycle
(start/stop/restart) rather than token state. The full implementation — PM2
vs Docker detection, scaffold generation, and process management — is Phase 5
scope, driven by the Poshmark scenario.

```ts
// connector-state.d.ts — add to ConnectorSource union
| 'aura-app'    // TODO(phase-5): pm2 or docker process managed app.
                // Reference implementation: posh-pusher pattern.
                // Agent scaffolds; Aura manages lifecycle via exec tool.
```

**The App Builder pattern (document in `.aurora` README):** When the agent
encounters a platform with no API and no OpenClaw channel, the protocol is:
1. Propose an app architecture (Fastify backend + Lobster pipelines or
   equivalent)
2. Scaffold under `~/.aura/projects/<workspace>/apps/<app-name>/`
3. Ship both a `process.config.js` (pm2) and a `docker-compose.yml`
4. Detect `which pm2` vs `docker info`; remove the unused scaffold file
5. Wire Lobster approval gates to Aura contracts instead of Telegram
6. Register result as `aura-app` connector in the manifest
7. Emit a `POST /hooks/wake` to `localhost:18789` for each event that
   should create a contract

---

## 05 — `aurora-registry.json` and the Walled Garden

### File location

```
aura-pulse/packages/artist-reseller/aurora-registry.json
```

This file is bundled with the `.aurora` package. It is the authoritative
source for what the Aura plugin installs and permits. Phase 5 introduces a
hosted registry URL; Phase 4 uses this bundled file only.

### Schema

```json
{
  "version": "1.0",
  "plugins": {
    "required": [
      {
        "id": "engram",
        "package": "@openclaw/engram",
        "version": "2.1.0",
        "tier": "free",
        "description": "Persistent memory and entity profiles for the agent."
      },
      {
        "id": "lobster",
        "package": "@clawdbot/lobster",
        "version": "latest",
        "tier": "free",
        "description": "Pipeline runner for multi-step browser automation."
      }
    ],
    "optional": [
      {
        "id": "expert/etsy-connector",
        "package": "@aura/etsy-connector",
        "version": "1.0.0",
        "tier": "paid",
        "purchaseToken": null,
        "description": "Live Etsy listing price lookup and inventory management.",
        "note": "Phase 4 ships the built-in aura-connector implementation. This entry is the future Expert Store bundle form."
      }
    ]
  },
  "openclawConfig": {
    "plugins": {
      "allow": ["aura-pulse", "engram", "lobster", "browser"],
      "load": {
        "paths": ["~/.aura/packages/openclaw-plugin/index.js"]
      }
    },
    "tools": {
      "alsoAllow": ["lobster", "browser", "exec"]
    }
  }
}
```

### Walled garden enforcement

`aurora-registry.json` → bootstrap → writes `plugins.allow` into
`openclaw.json`. OpenClaw's own engine enforces the list — only IDs in
`allow` load. This is not Aura code; it is OpenClaw's config system.

### Distribution model: npm-direct, ClawHub bypassed

Aura publishes its own business-hardened connectors, skills, and plugins
to npm under the `@aura/` scope. Installation is always via the OpenClaw
CLI — ClawHub is not involved:

```bash
openclaw plugins install @aura/etsy-connector
openclaw plugins install @aura/quickbooks-sync
openclaw plugins install @aura/poshmark-app
```

OpenClaw's resolver tries ClawHub first, then falls back to npm. Publishing
to npm is the ClawHub bypass — no dependency on ClawHub availability,
no ClawHub review process, no ClawHub quality signal contaminating Aura's
curation. The Aura npm org IS the trust boundary.

This applies to all Aura-built artifacts:
- Business-hardened connectors: `@aura/etsy-connector`, `@aura/plaid-sync`
- Curated skill bundles: `@aura/reseller-skills`, `@aura/nonprofit-skills`
- Domain-specific plugins: `@aura/poshmark-app`, `@aura/grant-manager`

Third-party Expert Store submissions may publish to their own npm org
(`@expert/stripe-advanced`) and submit for Aura registry inclusion. The
registry entry points at their npm package; the `plugins.allow` append is
the certification gate.

**Adding an Expert Store item in Phase 5:**
1. User taps "Install" in Pulse Expert Store surface
2. Pulse calls `aura_install_expert` tool (Phase 5)
3. Tool validates purchase/certification against Aura backend
4. Tool appends plugin ID to `plugins.allow` in `openclaw.json`
5. Tool runs `openclaw plugins install @aura/<pkg>` (or `@expert/<pkg>`)
6. Tool runs `openclaw gateway restart`
7. Pulse onboarding surface shows green

Phase 4 establishes the registry schema and the `plugins.allow` mechanism.
Phase 5 builds the auth gate and the Expert Store install tool.

---

## 06 — Phase A: Additional Domain Types

*No dependencies. Run in parallel with all other phases.*

### `listing-draft`

| Field | Type | Required | Notes |
|---|---|---|---|
| `platform` | string | yes | `'etsy'`, `'poshmark'`, `'mercari'` |
| `listing_id` | string | yes | Platform listing identifier |
| `listing_title` | string | yes | Draft title text |
| `draft_status` | string | yes | `'draft'`, `'ready'`, `'needs_photos'` |
| `draft_path` | string | yes | PARA-relative path to draft file |
| `category` | string | yes | Item category for performance tracking |

### `shipping-delay`

| Field | Type | Required | Notes |
|---|---|---|---|
| `platform` | string | yes | Selling platform |
| `order_id` | string | yes | Platform order identifier |
| `carrier` | string | yes | Shipping carrier name |
| `tracking_number` | string | yes | Carrier tracking number |
| `expected_date` | string | yes | ISO date originally promised |
| `delay_reason` | string | yes | Brief reason string |

### `inventory-alert`

| Field | Type | Required | Notes |
|---|---|---|---|
| `platform` | string | yes | Selling platform |
| `category` | string | yes | Item category |
| `current_stock` | number | yes | Items currently listed |
| `sold_last_30_days` | number | yes | Sales velocity |
| `restock_suggestion` | string | yes | Agent's recommendation text |

### Implementation

Follow the `offer-received` pattern exactly:

- `src/domain-types/<type>.js` — validator function, `ContractTypeDefinition`
  export
- `src/domain-types/<type>.d.ts` — companion `.d.ts` with context interface
- Register in `type-registry.js` alongside existing types
- Unit tests: valid case, missing required field, wrong field type

**Relevant files:**
- `aura-pulse/packages/contract-runtime/src/domain-types/offer-received.js`
- `aura-pulse/packages/contract-runtime/src/domain-types/offer-received.d.ts`
- `aura-pulse/packages/contract-runtime/src/runtime/type-registry.js`

---

## 07 — Phase B: Connector Seeds + Registry Bootstrap

*No external dependencies. Run in parallel with A, D, F.*

### Step 1 — Seed connector records at startup

In `index.js`, after `runtimeService.start()`:

```js
const channelConnector = new OpenClawChannelConnector(storage, api.logger)
const auraStore = new AuraConnectorStore(storage, api.logger)

// openclaw-channel connectors — seeded so Pulse can display state
await channelConnector.seedIfAbsent('gmail',
    'Cannot monitor the business inbox or reply to buyer messages.',
    'Can receive offer emails and send replies on behalf of the business.')

await channelConnector.seedIfAbsent('calendar',
    'Cannot check the owner\'s schedule for deadlines.',
    'Can read your schedule and create reminders for listing and shipping deadlines.')

await channelConnector.seedIfAbsent('drive',
    'Cannot access project documents and reports.',
    'Can read and write project documents and reports in Google Drive.')

// Reflect actual Gmail hook state — check if hints.gmail config present
const gmailConfigured = Boolean(api.runtime?.config?.hooks?.gmail?.account)
if (gmailConfigured) {
    // OpenClawChannelConnector has no patch() method. Use storage directly:
    const existing = await storage.readConnector('gmail')
    if (existing) {
        await storage.writeConnector({
            ...existing,
            status: 'active',
            connected_at: existing.connected_at ?? new Date().toISOString(),
            updated_at: new Date().toISOString(),
        })
    }
    // Alternatively: add patch(id, patch) to OpenClawChannelConnector
    // following the same read-modify-write pattern as AuraConnectorStore.patch()
}

// aura-connector connectors — seeded for Pulse connector card display
// (full Etsy implementation in Phase F)
await _seedIfAbsent(auraStore, {
    id: 'etsy',
    source: 'aura-connector',
    status: 'not-offered',
    capability_without: 'Cannot verify current Etsy listing prices when an offer arrives.',
    capability_with: 'Can look up live asking price for any Etsy listing.',
    updated_at: new Date().toISOString(),
})
```

`_seedIfAbsent` for `AuraConnectorStore` is a one-liner: read, return if
present, write if absent. Add as a private module-level helper.

### Step 2 — Registry bootstrap

On startup, read `aurora-registry.json` and ensure all `required` plugins
are installed. Use the exec tool path available during bootstrap or spawn
`child_process.execSync` for the install commands. This runs synchronously
before `register()` returns so the gateway doesn't boot unconfigured.

```js
import registry from '../../../artist-reseller/aurora-registry.json' assert { type: 'json' }

async function bootstrapRegistry(api) {
    const listResult = await execCmd('openclaw plugins list --json')
    const loaded = JSON.parse(listResult).map(p => p.id)
    let needsRestart = false

    for (const plugin of registry.plugins.required) {
        if (!loaded.includes(plugin.id)) {
            api.logger.info(`[aura-registry] installing ${plugin.package}@${plugin.version}`)
            await execCmd(`openclaw plugins install ${plugin.package}@${plugin.version}`)
            needsRestart = true
        }
    }

    if (needsRestart) {
        api.logger.info('[aura-registry] restarting gateway after plugin installs')
        await execCmd('openclaw gateway restart')
    }
}
```

`execCmd` wraps `child_process.exec` with a promise. Install errors are
logged but do not throw — a missing optional plugin is not fatal at boot.

### Step 3 — Write `plugins.allow` to `openclaw.json`

On first run (or if `plugins.allow` is absent), merge the `openclawConfig`
block from `aurora-registry.json` into the live `openclaw.json`:

```js
async function ensureOpenClawConfig(api) {
    const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json')
    const current = JSON.parse(await fs.readFile(configPath, 'utf8').catch(() => '{}'))

    if (!current.plugins?.allow) {
        current.plugins ??= {}
        current.plugins.allow = registry.openclawConfig.plugins.allow
        current.plugins.load ??= registry.openclawConfig.plugins.load
        await fs.writeFile(configPath, JSON.stringify(current, null, 2))
        api.logger.info('[aura-registry] wrote plugins.allow to openclaw.json')
    }
}
```

This is the walled garden gate. OpenClaw enforces it at plugin load time.
Aura only writes the list; OpenClaw does the blocking.

### Step 4 — First-run connector prompt

If `gmail` status is still `not-offered` after the startup check (wizard
has not been run), push a connector request to the WebSocket immediately so
the owner sees the Gmail setup card on first Pulse load:

```js
if (!gmailConfigured) {
    webSocketService.pushConnectorRequest('gmail')
}
```

**Relevant files:**
- `aura-pulse/packages/openclaw-plugin/index.js` — all wiring goes here
- `aura-pulse/packages/openclaw-plugin/src/connectors/openclaw-channel-connector.js`
- `aura-pulse/packages/openclaw-plugin/src/connectors/aura-connector-store.js`
- `aura-pulse/packages/artist-reseller/aurora-registry.json` (new)

---

## 08 — Phase C: `offer-received` Context Fields (Type Extension)

*No dependencies. Run in parallel with A, B, D.*

The existing `offer-received` domain type validates the base marketplace
offer fields. Phase 4 adds optional fields that the agent populates when
creating the contract from a Gmail-sourced offer:

**Add to `offer-received.js` validator (all optional):**

| Field | Type | Source |
|---|---|---|
| `gmail_thread_id` | string? | From agent's email context |
| `gmail_message_id` | string? | From agent's email context |
| `buyer_history` | string? | From `GET /engram/v1/entities/:name` |

**Current `offer-received.d.ts` (read this before editing — do not delete existing fields):**

```ts
// CURRENT — actual interface in the file today:
export interface OfferReceivedContext {
    platform: 'poshmark' | 'etsy' | 'mercari';  // ← literal union, not string
    listing_id: string;
    listing_title: string;
    asking_price: number;
    offer_amount: number;
    buyer_id: string;
    budget_threshold?: number;                   // ← existing optional, keep it
    vendor_history?: Array<{ date: string; outcome: string; amount: number }>;  // ← keep
}
```

**After Phase C — add three new optional fields, keep all existing:**

```ts
export interface OfferReceivedContext {
    platform: 'poshmark' | 'etsy' | 'mercari';
    listing_id: string;
    listing_title: string;
    asking_price: number;
    offer_amount: number;
    buyer_id: string;
    budget_threshold?: number;
    vendor_history?: Array<{ date: string; outcome: string; amount: number }>;
    // Phase 4 additions:
    gmail_thread_id?: string;
    gmail_message_id?: string;
    buyer_history?: string;                      // from GET /engram/v1/entities/:name
}
```

These fields are not validated as required — the agent may create an
`offer-received` contract without them (e.g. when manually triggered from
chat). The response dispatch in Phase E only fires when `gmail_thread_id`
is present.

---

## 09 — Phase D: Artist Reseller `.aurora` Package Scaffold

*No dependencies. Run in parallel with all other phases.*

### Package location

```
aura-pulse/packages/artist-reseller/
    aurora.manifest.yaml        -- identity, connectors, plugins, apps
    aurora-registry.json        -- bundled registry (§05)
    openclaw.json.template      -- security config template (no secrets)
    package.json
    README.md                   -- setup guide + App Builder pattern docs
    apps/
        posh-pusher/            -- aura-app scaffold (stub, Phase 5)
            process.config.js   -- pm2 scaffold
            docker-compose.yml  -- docker scaffold
            README.md           -- agent decision tree: pm2 vs docker
```

### `aurora.manifest.yaml`

```yaml
# Aura OS — Artist Reseller Package Manifest
# Version: 1.0

identity:
  name: Studio Ops
  # email provisioned during Gmail connector setup (gog auth login)
  email: null

connectors:
  # openclaw-channel connectors — OpenClaw manages auth
  gmail:
    source: openclaw-channel
    required: true
    setup_command: "openclaw webhooks gmail setup --account <your-agent-gmail>"
    capability_without: Cannot monitor the inbox or reply to buyer messages.
    capability_with: Can receive marketplace offer emails and send replies.

  calendar:
    source: openclaw-channel
    required: false
    capability_without: Cannot check the owner's schedule.
    capability_with: Can read schedule and create deadline reminders.

  drive:
    source: openclaw-channel
    required: false
    capability_without: Cannot access project documents.
    capability_with: Can read and write reports and listing drafts in Drive.

  # aura-connector connectors — Aura holds the API key
  etsy:
    source: aura-connector
    required: false
    flow: manual-guide
    capability_without: Cannot verify live Etsy listing prices.
    capability_with: Can look up current asking price when an offer arrives.

apps:
  # aura-app entries added by agent at deploy time (Phase 5+)
  # managed_by: 'pm2' | 'docker'  -- agent detects via `which pm2` / `docker info`
  # See apps/posh-pusher/ for scaffold templates

plugins:
  # managed via aurora-registry.json — not duplicated here
  registry: aurora-registry.json

security:
  # Phase 5: openclaw.json enforcement details
  # See openclaw.json.template for the full policy structure
  note: >
    openclaw.json.template ships conservative defaults. Review before going
    to production. Key levers: plugins.allow, tools.deny, exec.security,
    hooks.allowedAgentIds.
```

### `openclaw.json.template`

Ships with the package. Setup script copies to `~/.openclaw/openclaw.json`
if absent, or merges if present. Contains no secrets — tokens come from
env vars:

```json5
{
  // Aura-managed plugin allowlist — only these plugin IDs load.
  // bootstrap adds IDs as Expert Store plugins are installed.
  plugins: {
    allow: ["aura-pulse", "engram", "lobster", "browser"],
    load: {
      paths: ["~/.aura/packages/openclaw-plugin/index.js"]
    },
    entries: {
      browser: { enabled: true },
      engram:  { enabled: true },
      lobster: { enabled: true },
    }
  },

  // Hook ingress — bootstrap writes hooks.gmail after wizard runs
  hooks: {
    enabled: true,
    token: "${OPENCLAW_HOOK_TOKEN}",
    presets: ["gmail"],
    // mappings overridden by bootstrap to set agentId: "aura-studio-ops"
  },

  // Exec security — allowlist enforced for gateway-host exec calls
  // Phase 5: tighten to specific binary paths
  tools: {
    exec: {
      host: "gateway",
      security: "allowlist",
      ask: "on-miss",
      pathPrepend: ["/opt/homebrew/bin", "/usr/local/bin"],
    },
    alsoAllow: ["lobster", "browser", "exec"]
  },

  // Phase 5: add agents.defaults.sandbox, hooks.allowedAgentIds,
  // per-agent tools.deny. Not enforced in Phase 4.
}
```

### `apps/posh-pusher/process.config.js` (pm2 scaffold stub)

```js
// pm2 process config — generated by agent during aura-app deploy
// Agent detects pm2 via `which pm2` before using this file
module.exports = {
  apps: [{
    name:        'posh-pusher',
    script:      './backend/server.js',
    cwd:         __dirname,
    watch:       false,
    // env populated by agent from .env during deploy
    env: {
      NODE_ENV: 'production',
      PORT:     '3456',
    }
  }]
}
```

### `apps/posh-pusher/docker-compose.yml` (docker scaffold stub)

```yaml
# Docker scaffold — generated by agent during aura-app deploy
# Agent detects docker via `docker info` before using this file
services:
  posh-pusher:
    build: .
    restart: unless-stopped
    ports:
      - "3456:3456"
    env_file:
      - .env
    volumes:
      - ./db:/app/db
```

### PARA subdirectory creation

`ContractRuntimeService.start()` already creates the root PARA tree. Add
artist-reseller-specific subdirs on first start (idempotent mkdir):

```
~/.aura/projects/studio-ops/
    areas/
        inventory/
        buyer-patterns/
    resources/
        platform-policies/
    apps/           ← aura-app deploy target (Phase 5)
```

### `package.json`

```json
{
    "name": "@aura/artist-reseller",
    "version": "0.1.0",
    "private": true,
    "type": "module",
    "devDependencies": {
        "@aura/contract-runtime": "workspace:*"
    }
}
```

---

## 10 — Phase E: Response Dispatch After Resolver Commit

*Depends on Phase C (gmail_thread_id field must exist).*

After the owner resolves a contract via the Resolver in Pulse, the plugin
dispatches a Gmail reply if the contract has a thread ID.

### WebSocket resolve handler extension

In `WebSocketService`, after the runtime processes a `resolve` message
and the contract transitions to `complete`:

```js
const ctx = contract.intent.context
if (msg.artifacts?.send_response === true && ctx.gmail_thread_id) {
    await _sendGmailReply({
        threadId:    ctx.gmail_thread_id,
        messageId:   ctx.gmail_message_id,
        body:        msg.artifacts.response_body,
        // Read from env — AuraPluginConfig has no agentGmailAccount field today.
        // Add agentGmailAccount to normalizeConfig() in config/schema.js (Phase B Step 0),
        // or read the env var directly here:
        account:     process.env['AURA_AGENT_GMAIL_ACCOUNT'] ?? '',
        logger:      this._logger,
        runtime,
        contractId:  contract.id,
    })
}
```

**Phase B Step 0 (prerequisite — add to config schema):**

`agentGmailAccount` is read from `config.accountIds['gmail']` — which is
already in `AuraPluginConfig` as of Phase 4. Set it in `openclaw.json`:

```json5
// openclaw.json — plugin config block
"aura-pulse": {
  "accountIds": {
    "gmail": "studio-ops@gmail.com"
  }
}
```

Read it in `_sendGmailReply`:

```js
account: typeof config.accountIds['gmail'] === 'string'
    ? config.accountIds['gmail']
    : '',
```

If absent, log a warning and skip the send — same pattern as missing
`AURA_ENGRAM_AUTH_TOKEN` in the completion bridge.

### `_sendGmailReply` implementation

`gog` is the reply path. The agent's Gmail account is the sending identity
(separate from the owner's account — provisioned during Gmail setup).

```js
async function _sendGmailReply({ threadId, messageId, body, account, logger, runtime, contractId }) {
    try {
        await execCmd(
            `gog gmail reply --account ${account} --thread-id ${threadId} --body ${JSON.stringify(body)}`
        )
        await runtime.logAutonomousAction({
            agent_id:       'aura-pulse',
            action:         'email_response_sent',
            summary:        `Replied to offer thread ${threadId}`,
            detail:         { threadId, messageId },
            contract_id:    contractId,
            connector_used: 'gmail',
        })
    } catch (err) {
        logger.error('[gmail-reply] send failed', err)
        await runtime.logAutonomousAction({
            agent_id:    'aura-pulse',
            action:      'email_send_failed',
            summary:     `Reply failed for thread ${threadId}: ${err.message}`,
            contract_id: contractId,
        })
        // Do not throw — contract is already complete
    }
}
```

`gog` must be allowlisted in `openclaw.json` under `tools.exec` allowlist
or reachable via `tools.exec.pathPrepend`. Document in README.

The morning brief query already surfaces `autonomous_log` entries — modify
the morning brief query to include `action: 'email_send_failed'` as a
follow-up action line.

**Relevant files:**
- `aura-pulse/packages/openclaw-plugin/src/services/websocket-service.js`
- `aura-pulse/packages/openclaw-plugin/src/services/completion-bridge.js`

---

## 11 — Phase F: Etsy Connector + `aura_query_listing` Tool

*No dependencies. Run in parallel with A, B, C, D.*

OpenClaw has no Etsy channel. Correct shape: `source: 'aura-connector'`.
The startup seed is already added in Phase B Step 1.

### Connector flow in Pulse

Etsy uses the **manual-guide** connector card flow already implemented in
the Pulse PWA. The card presents step-by-step instructions:

1. Go to etsy.com/developers → create app
2. Copy the API key
3. Paste into the secure input field in the card

The plugin receives the key via the `complete_connector` WebSocket message.
**The current `complete_connector` handler in `websocket-service.js` only
toggle status to `active` — it does not handle a credential payload.**
Phase F must extend the handler to extract an optional `credential` field
and store it via `AuraConnectorStore.write()`:

```js
case 'complete_connector': {
    const connId     = payload['connectorId']
    const credential = payload['credential']  // new — Etsy API key
    if (typeof connId === 'string') {
        const existing = await this._storage.readConnector(connId)
        if (existing) {
            const now = new Date().toISOString()
            const update = {
                ...existing,
                status: 'active',
                connected_at: existing.connected_at ?? now,
                updated_at: now,
            }
            if (typeof credential === 'string' && credential.length > 0) {
                // Store via AuraConnectorStore to get AES-256 encryption
                const store = new AuraConnectorStore(this._storage, this._logger)
                await store.write({ ...update, oauth_token_enc: credential })
            } else {
                await this._storage.writeConnector(update)
            }
            this.pushConnectorComplete(connId, 'active')
        }
    }
    break
}
```

The Pulse PWA `complete_connector` message must include
`{ connectorId: 'etsy', credential: '<api-key-from-input>' }`.

### `aura_query_listing` tool

```js
// tools/aura-query-listing.js
export default {
    name: 'aura_query_listing',
    description: 'Fetch current asking price and status for a marketplace listing.',
    parameters: {
        platform:   { type: 'string', description: 'etsy | poshmark | mercari' },
        listing_id: { type: 'string', description: 'Platform listing identifier' },
        reason:     { type: 'string', description: 'Why the agent needs this now' },
    },
    async execute({ platform, listing_id, reason }, { storage, logger, runtime }) {
        await runtime.logAutonomousAction({
            agent_id: 'aura-pulse',
            action:   'query_listing',
            detail:   { platform, listing_id, reason },
        })

        if (platform === 'etsy') {
            const store = new AuraConnectorStore(storage, logger)
            const creds = await store.readDecrypted('etsy')
            if (!creds || creds.status !== 'active') {
                return {
                    error: true,
                    capability_without: 'Cannot verify current Etsy listing prices.',
                    setup_hint: 'Connect Etsy in the Aura connectors panel.',
                }
            }
            const res = await fetch(
                `https://openapi.etsy.com/v3/application/listings/${listing_id}`,
                { headers: { 'x-api-key': creds.oauth_token_enc } }
            )
            if (!res.ok) throw new Error(`Etsy API ${res.status}`)
            const data = await res.json()
            return {
                listing_id,
                title:    data.title,
                price:    data.price.amount / data.price.divisor,
                currency: data.price.currency_code,
                status:   data.state,
            }
        }

        // Poshmark and Mercari: no public API — agent should use email context
        return {
            error: true,
            message: `No API available for ${platform}. Use offer amount from email context.`,
        }
    }
}
```

Register in `index.js` alongside the existing tools.

---

## 12 — Phase G: Pulse Onboarding Surface

*Depends on aurora-registry.json (Phase B). One new surface state in Pulse PWA.*

### When it appears

On first Pulse load after an `.aurora` package is installed — specifically
when any `required` plugin from the registry is not yet in `loaded` state,
or when the `gmail` connector is `not-offered`.

### What it shows

A checklist surface (not a voice surface). Simple. No Resolver. No audio.

```
Setting up Studio Ops                    [status dot]

Required
  ✓  Engram memory                       installed
  ↻  Lobster pipeline runner             installing...
  ○  Gmail inbox                         tap to set up

Optional — Expert Store
  +  Etsy Connector                      free trial / $4.99/mo
  +  QuickBooks Sync                     $9.99/mo  (Phase 5 placeholder)

                              [Continue when ready]
```

- Green checkmark: installed and active
- Spinning indicator: install in progress (WebSocket status stream)
- Circle: not installed, tap to trigger setup flow
- `+` badge: Expert Store item, taps into purchase/install flow (Phase 5:
  tapping shows a detail card; install is stubbed with a coming-soon message)

### Implementation

New `SurfaceState.Onboarding` in the Pulse PWA surface state machine.
The WebSocket plugin pushes an `onboarding_status` message on connection
when registry state is incomplete. Pulse transitions to Onboarding state
on receipt.

Plugin side: new `aura_get_registry_status` tool (or WebSocket push on
connect) that returns the current install state of each registry entry.

```ts
// pulse-pwa/src/surface/OnboardingView.tsx
// Reads onboardingStatus from WebSocket state
// Renders the checklist — no voice, no Resolver, no artifacts
// "Continue" button transitions to SurfaceState.Silent (normal operation)
```

Surface state machine addition:
```ts
type SurfaceState = 'Silent' | 'Decision' | ... | 'Onboarding'
// Onboarding → Silent on user "Continue" tap
// Onboarding → Decision if a contract surfaces while onboarding (show both)
```

---

## 13 — Phase H: Engram Integration (Structured Payloads)

*Depends on Phase A (type-aware branching). Run in parallel with E, F, G.*

### Current state

`EngramCompletionBridge._buildContent()` generates flat text:
```
Aura contract completed. Type: offer-received. ID: <id>. Goal: <goal>. Outcome: <outcome>.
```

Engram's extraction pipeline cannot build entity profiles from this.

### Type-aware content

Extend `_buildContent()` to branch on `contract.type`:

**`offer-received`:**
```
Marketplace offer resolution — ${platform}

Buyer: ${buyerId}
Listing: "${listingTitle}" (${listingId})
Offer: $${offerAmount} / Asking: $${askingPrice} (${discountPct}% off)
Owner action: ${resumeAction}
${resumeAction === 'counter' ? `Counter amount: $${artifacts.counter_amount}` : ''}
Clarifications exchanged: ${clarifications.length}
Time to decision: ${decisionLatencyMinutes} minutes
Response sent: ${artifacts.send_response ? 'yes' : 'no'}
```

**`listing-draft`:**
```
Listing draft reviewed — ${platform}

Category: ${category}
Listing: "${listingTitle}"
Owner edits made: ${editCount}
Approval latency: ${approvalLatencyMinutes} minutes
Outcome: ${resumeAction}
```

**`shipping-delay`:**
```
Shipping delay handled — ${carrier}

Order: ${orderId} (${platform})
Expected: ${expectedDate} — delayed: ${delayReason}
Customer message: ${resumeAction === 'send' ? 'sent' : 'not sent'}
Owner edits: ${editCount}
```

**Default fallback:** current flat text unchanged.

### Structured tags

```js
const tags = [
    'aura-contract',
    `type:${contract.type}`,
    `id:${contract.id}`,
]
if (ctx.buyer_id)  tags.push(`buyer:${ctx.buyer_id}`)
if (ctx.platform)  tags.push(`platform:${ctx.platform}`)
if (resume.action) tags.push(`action:${resume.action}`)
```

### Agent-level Engram use (documented, not plugin code)

In the `.aurora` README, document that the Studio Ops agent should:

- Call `engram.entity_get <buyer_id>` when reasoning about repeat offers —
  Engram returns negotiation history across all prior contracts
- Call `engram.observe` after major resolutions to push the full reasoning
  context into extraction (not just the plugin completion summary)

These are agent-level MCP tool calls. The plugin's job is the completion
summary. The agent's job is the reasoning context.

**Relevant file:**
- `aura-pulse/packages/openclaw-plugin/src/services/completion-bridge.js`
  — `_buildContent()` is the method to extend (~78 lines currently)

---

## 14 — Phase I: End-to-End Integration Test

*Depends on Phases A–H. Last step of Phase 4.*

### File

```
aura-pulse/packages/openclaw-plugin/tests/integration/artist-reseller-e2e.test.js
```

### Mocks

- **Gmail hook payload**: inject directly into the agent session via a fake
  `POST /hooks/gmail` call to a test gateway instance, or simulate the
  runtime path the hook mapping takes when delivering to the agent
- **Engram HTTP**: `vi.stubGlobal('fetch', ...)` returning a fake entity
  profile for the buyer ID
- **Etsy API**: mock the fetch in `aura_query_listing`
- **gog gmail reply**: spy on `execCmd` for the reply command

### Six-beat assertions

1. **Email hook arrives** — inject Poshmark offer hook payload with known
   `thread_id`, `buyer_id`, `listing_id`, `offer_amount`
2. **Contract created** — assert `offer-received` contract in SQLite with
   `status: 'created'`, `gmail_thread_id` set, `buyer_history` from mocked
   Engram entity
3. **Decision surface pushed** — advance time past `surface_after`; assert
   `getPending()` returns the contract; assert WebSocket `decision` message
   sent with correct payload
4. **Resolver engages** — simulate `engage` WebSocket message; assert
   contract transitions to `resolver_active`
5. **Resolver commits** — simulate `resolve` with
   `{ action: 'counter', send_response: true, response_body: '...' }`
6. **Reply sent + Engram notified** — assert `gog gmail reply` exec
   command called with correct `--thread-id`; assert
   `POST /engram/v1/memories` received payload containing `buyer:<id>`
   and `action:counter` tags; assert `email_response_sent` in
   `autonomous_log`

### Manual demo script

```json
"demo:artist": "node tests/manual/artist-reseller-demo.mjs"
```

Connects to live plugin, forwards a real email for end-to-end manual
verification. Not run in CI.

---

## 15 — Verification Checklist

**Domain types (Phase A)**
- `listing-draft`, `shipping-delay`, `inventory-alert` validate correctly
- All three traverse `created → active → waiting_approval → complete` in
  unit tests
- Invalid context throws typed validation error

**Connector seeds + registry bootstrap (Phase B)**
- `seedIfAbsent` called for `gmail`, `calendar`, `drive`, `etsy` at startup
- Connector records exist in contracts.db after startup
- `gmail` reflects actual hook config state (`active` vs `not-offered`)
- Required plugins installed via `openclaw plugins install` if absent
- `plugins.allow` written to `openclaw.json` on first run
- First-run Gmail card pushed to WebSocket if Gmail not configured

**Context type extension (Phase C)**
- `offer-received` accepts `gmail_thread_id`, `gmail_message_id`,
  `buyer_history` as optional fields
- Contracts without these fields remain valid (agent may omit them)

**`.aurora` scaffold (Phase D)**
- `aurora.manifest.yaml`, `aurora-registry.json`, `openclaw.json.template`
  present and schema-valid
- Artist-reseller PARA subdirs created on first `ContractRuntimeService`
  start
- `apps/posh-pusher/` scaffold stubs present (pm2 + docker)
- `connector-state.d.ts` includes `aura-app` source type with `TODO(phase-5)`
  comment

**Response dispatch (Phase E)**
- `resolve` with `send_response: true` and `gmail_thread_id` → `gog gmail
  reply` execCmd called with correct args
- Reply logged to `autonomous_log` with `connector_used: 'gmail'`
- Reply failure → `email_send_failed` in log; contract remains `complete`
- `resolve` without `gmail_thread_id` → no send attempt, no error

**Etsy connector (Phase F)**
- `etsy` record seeded at startup; read, skip if present
- Manual-guide flow: key stored encrypted; `readDecrypted('etsy')` succeeds
- `aura_query_listing` returns price when active; returns error object when
  not active
- `aura_query_listing` for non-Etsy platform returns no-API error message

**Pulse onboarding (Phase G)**
- `onboarding_status` pushed on WebSocket connect when registry incomplete
- Pulse transitions to `Onboarding` state and renders checklist
- Each required item shows correct status (installed / installing / pending)
- "Continue" dismisses to `Silent` state
- Optional Expert Store items render with stub "coming soon" install tap

**Engram enrichment (Phase H)**
- `offer-received` POST contains `buyer:<id>` and `platform:<p>` tags
- Content includes resolution fields (action, amounts, latency)
- Other types send type-specific content
- Unknown contract type sends flat text fallback

**Integration test (Phase I)**
- All six beats assert in order
- Test is deterministic, hermetic, and passes in CI without network

---

## 16 — Scope Boundaries and Decisions

**OpenClaw is the OS and package manager. Aura wraps it.**
Do not build a custom plugin installer, a custom skill runner, a custom
OAuth server, or a custom webhook engine. All of these exist in OpenClaw.
Aura's value is curation, configuration, and the Pulse experience layer.

**gog handles Gmail OAuth and Watch. Aura does not.**
No custom Gmail API client. No token refresh code. No `gws` in Phase 4.
The wizard (`openclaw webhooks gmail setup`) runs once during onboarding.
`gog gmail reply` is the send path — invoked via exec tool by the agent.

**The agent is the email parser. The plugin is not.**
No `GmailMessageHandler`. No regex-based offer detection in plugin code.
The OpenClaw hook mapping delivers email content to the agent. The agent
reasons and calls `aura_surface_decision`. This is architecturally correct
and matches how all future automations will work.

**`plugins.allow` is the walled garden. OpenClaw enforces it.**
Aura bootstrap writes the list. OpenClaw's load pipeline blocks anything
not on the list. Phase 5 adds the Pulse Expert Store install flow that
appends to the list after purchase validation.

**npm-direct is the Expert Store distribution format. ClawHub is bypassed.**
Aura publishes all first-party plugins under `@aura/` on npm. Third-party
Expert Store items publish under their own npm org. Install in all cases:
`openclaw plugins install @aura/<pkg>` or `openclaw plugins install @expert/<pkg>`.
OpenClaw's resolver falls through to npm if ClawHub misses. No custom package
manager. No ClawHub dependency. Bundle format (`.tgz`) is an alternative for
items that ship as Claude/Codex/Cursor skill packs — same install command.

**`aura-app` is a type stub in Phase 4.**
The pm2/docker scaffold ships in `apps/posh-pusher/`. No runtime behavior.
Full `aura-app` lifecycle management (detect, deploy, start/stop, health
check) is Phase 5, driven by the Poshmark scenario.

**Out of scope for Phase 4:**
- Poshmark and Mercari native integrations (no API — Phase 5 aura-app)
- `donor-acknowledgment-batch`, `volunteer-onboarding` (Phase 5 non-profit)
- Expert Store purchase flow and auth gate (Phase 5)
- Per-agent sandbox and `hooks.allowedAgentIds` enforcement (Phase 5)
- Calendar and Drive connector activation (seeded, not activated)
- Onboarding voice conversation loop (Phase 6)

---

## 17 — Phase 5 and 6 Signals

Decisions made in Phase 4 that directly shape what comes next:

**Phase 5 will contain:**
- Poshmark `aura-app` (pm2 or docker, Lobster pipelines, contracts replace
  Telegram approval gates) — published as `@aura/poshmark-app` on npm
- Non-profit scenario: `donor-acknowledgment-batch`, `volunteer-onboarding`
- Expert Store purchase + install flow in Pulse (purchase token →
  `plugins.allow` append → `openclaw plugins install @aura/<pkg>`)
- First Aura npm packages published: `@aura/etsy-connector` extracted from
  the built-in implementation, `@aura/reseller-skills` skill bundle
- Hosted registry URL (Phase 4's bundled JSON becomes the seed; hosted
  registry adds revocation, analytics, paid plugin auth)
- Per-agent security config (`hooks.allowedAgentIds`, sandbox, `tools.deny`)

**Phase 6 will contain:**
- OpenClaw is the resolved OS layer. Aura OS as a product means the entire
  install experience: a single script that installs OpenClaw, gog, Lobster,
  configures Tailscale, runs `openclaw webhooks gmail setup`, installs the
  Aura plugin, opens Pulse — and the user never sees any of it
- Onboarding voice conversation loop (agent interviews user to configure
  identity, connectors, and persona before showing the Pulse home screen)
- Multi-workspace support (multiple `.aurora` packages installed
  simultaneously, each with its own registry scope)

---

## 18 — Note for the Coding Agent

This document supersedes `aura-os-phase4-artist-reseller-plan-v1.md` in
all respects.

**Addendum — npm-direct distribution (post-v1 decision):**

Aura publishes all business-hardened connectors, skills, and plugins to npm
under `@aura/`. ClawHub is not in the distribution chain. Install command
is always `openclaw plugins install @aura/<pkg>`. The OpenClaw resolver
hits npm directly when ClawHub misses. This means:
- No ClawHub account required to distribute Aura-certified plugins
- `@aura/` npm org is the trust boundary for first-party artifacts
- Third-party Expert Store items use their own npm org; Aura registry lists
  the package name; `plugins.allow` append is the certification gate
- Phase 4's inline Etsy implementation will be extracted into
  `@aura/etsy-connector` in Phase 5 as the first published package

**Key corrections from v1:**

- **No `GmailMessageHandler`** — eliminated. The agent handles email
  reasoning. Plugin provides tools. Do not build plugin-level email parsing.

- **No `gws`** — eliminated from Phase 4. `gog` and `gog gmail reply` are
  the Gmail CLI path. `gws` was never confirmed to integrate with the
  gog/Pub/Sub chain cleanly.

- **No `api.registerHook()` for Gmail** — confirmed this is for plugin
  lifecycle events, not external webhook ingress. Gmail ingress uses the
  OpenClaw webhook engine (`POST /hooks/gmail`), configured in
  `openclaw.json`.

- **`openclaw plugins install`** — not `npm install -g`. The install
  primitive is the OpenClaw CLI. Bootstrap calls the CLI via exec.

- **`plugins.allow` is the walled garden** — bootstrap writes it to
  `openclaw.json`. OpenClaw enforces it. No Aura-level blocking code.

- **Bundle format = Expert Store distribution** — `.tgz` in Codex/Claude/
  Cursor format. Installed via `openclaw plugins install`. Phase 5 adds
  the Aura resolver URL and purchase token gate.

- **`aura-app` is a type stub** — `connector-state.d.ts` gets the union
  literal. No runtime behavior. `apps/posh-pusher/` scaffold ships for
  reference. Full implementation is Phase 5.

If anything in this plan conflicts with the Phase 1–3 codebase as it
actually exists, the codebase wins over this document. Read before writing.
The most common failure mode is writing code that re-implements something
already present. Check `index.js`, `src/connectors/`, `src/services/`, and
`src/tools/` before adding anything.
