# Aura OS — Technical Research
**Implementation Feasibility: OpenClaw Plugin Architecture, Auth, NemoClaw/OpenShell**
date: March 24, 2026
status: complete — informs plan v0.5

---

## 01 — OpenClaw Plugin Architecture

### What we are building against

Plugins extend OpenClaw with new capabilities: channels, model
providers, speech, image generation, web search, agent tools, or any
combination. Publish to ClawHub or npm — OpenClaw tries ClawHub first
and falls back to npm automatically.

The aura-pulse plugin is a **tool + service + HTTP route plugin** —
the non-channel, non-provider shape. This is the most flexible and
least constrained plugin type.

### The SDK surface — confirmed correct for v2026.3.22+

Always import from a specific subpath. Each subpath is a small,
self-contained module. This keeps startup fast and prevents circular
dependency issues.

The critical imports for aura-pulse:

```typescript
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";
import { upsertAuthProfile } from "openclaw/plugin-sdk/provider-auth";
```

The old `openclaw/extension-api` bridge is removed with no
compatibility shim. Plugins that import from it will break. The
backwards-compatibility layer `openclaw/plugin-sdk/compat` is also
deprecated and will be removed in the next major release.

**Implication for aura-pulse:** We must build against `openclaw/plugin-sdk/*`
subpaths from day one. Do not use the compat layer. Do not use
`extension-api`. This is a hard requirement.

### Registration methods available to aura-pulse

The `register(api)` callback receives an `OpenClawPluginApi`
object with these methods for tools and infrastructure:
`api.registerTool(tool, opts?)`, `api.registerHook(events, handler)`,
`api.registerHttpRoute(params)`, `api.registerService(service)`,
`api.registerCli(registrar, opts?)`.

All five are relevant to our plugin:
- `registerTool` — for `aura_surface_decision`, `aura_log_action`, etc.
- `registerService` — for the ContractRuntime background service
- `registerHttpRoute` — for the WebSocket upgrade endpoint
- `registerHook` — for shutdown cleanup
- `registerCli` — optional, for `openclaw aura status` commands

### Breaking change: registerHttpHandler removed

Plugin SDK removed `api.registerHttpHandler(...)`. Plugins must
register explicit HTTP routes via `api.registerHttpRoute({ path, auth,
match, handler })`, and dynamic webhook lifecycles should use
`registerPluginHttpRoute(...)`.

**This matters for us.** The plan assumed `registerHttpRoute` — which
is correct. But we need to verify WebSocket upgrade support within
`registerHttpRoute`. The HTTP route handler may need to handle the
WS upgrade manually or via a separate mechanism. Needs prototype
verification.

### Plugin config access

`api.pluginConfig` gives access to plugin-specific config from
`plugins.entries.<id>.config` in openclaw.json.
`api.runtime.config` provides load and persist operations for the
full OpenClaw config.

Our plugin config (wsPort, contractPath, etc.) comes through
`api.pluginConfig`. The agent-specific directories come through
`api.runtime.agent`.

### Runtime agent helpers — critical for our use

The `api.runtime.agent` namespace covers agent workspace,
identity, timeouts, and session store. Key methods include
`resolveAgentDir`, `resolveAgentWorkspaceDir`, `resolveAgentIdentity`,
`ensureAgentWorkspace`, and session store helpers.

These are how we find the correct directory for each agent's
active-context.md, connector state, and contract store. We do not
hardcode paths. We use `api.runtime.agent.resolveAgentWorkspaceDir()`
to get the right location per agent.

### Plugin manifest — required fields

Every native plugin must ship an `openclaw.plugin.json` in the
package root. OpenClaw uses this to validate config without executing
plugin code. Even plugins with no config must ship a schema.

```json
{
  "id": "aura-pulse",
  "name": "Aura Pulse",
  "description": "Contract-based decision surface for Aura agents",
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "wsPort": { "type": "number" },
      "contractPath": { "type": "string" },
      "activeContextPath": { "type": "string" },
      "ttsProvider": { "type": "string" }
    }
  }
}
```

### Setup entry — important for our use case

The `setup-entry.ts` file is a lightweight alternative to
`index.ts` that OpenClaw loads when it only needs setup surfaces.
It avoids loading heavy runtime code (crypto, CLI, background
services) during setup flows. Setup entry must register HTTP routes
required before gateway listen and gateway methods needed during
startup. It should NOT include background services or heavy imports.

**Implication:** We should split aura-pulse into a setup entry and
a full entry. The setup entry registers the HTTP route for the Pulse
PWA. The full entry loads the ContractRuntime service, WebSocket
server, and all tools. This follows the correct pattern and avoids
slowing gateway startup.

### Plugin state management

`createPluginRuntimeStore(...)` gives a mutable slot for
runtime-backed helpers. It provides `setRuntime`, `clearRuntime`,
`tryGetRuntime`, and `getRuntime`. `getRuntime()` throws with a
custom message if the runtime was never set.

This is the correct pattern for holding the ContractRuntime instance
across the plugin lifecycle. We create a runtime store for the
ContractRuntime, set it on service start, clear it on shutdown.

### Local development installation

For in-repo plugins: place under `extensions/` — automatically
discovered. For external plugins during development: `openclaw plugins
install --link /path/to/aura-pulse`.

Development workflow: link install. No need to publish during
prototype phase.

---

## 02 — Authentication Architecture

### What auth-profiles.json actually is

Credentials for model providers are stored in `auth-profiles.json`,
located in the agent directory:
`~/.openclaw/agents/<agentId>/agent/auth-profiles.json`. The file is
managed by `upsertAuthProfile` and read by `ensureAuthProfileStore`.

Auth profiles are stored per agent in a JSON file. The structure
contains a `profiles` array with entries of type `api-key` (provider
name + key string) or `oauth` (provider, access token, refresh token,
expiration timestamp).

**Critical finding:** `auth-profiles.json` is designed for **model
provider credentials** — Anthropic, OpenAI, etc. It is not a
general-purpose credential store for arbitrary service connections
(Gmail, Etsy, Square). This is the most important auth finding.

### The gap: service connector auth has no native OpenClaw mechanism

OpenClaw's auth infrastructure (`upsertAuthProfile`,
`provider-auth` SDK, OAuth flows) is scoped to **model providers**.
There is no built-in mechanism for storing OAuth tokens for Gmail,
Etsy, Square, or other business service connectors.

This means the aura-pulse plugin must implement its own credential
storage for service connectors. Options:

**Option A — OS Keychain via the exec tool**
Store credentials in the macOS Keychain using `security` CLI.
Secure. No external dependency. Requires `api.runtime.system` for
execution. Token refresh must be managed by the plugin.

**Option B — Encrypted file in agent workspace**
Encrypt connector tokens with a key derived from a machine-specific
secret. Store in `~/.openclaw/agents/<agentId>/agent/connectors.enc`.
Portable. Requires implementing encryption in the plugin.

**Option C — Plugin-managed sqlite store**
Store connector tokens in the same SQLite database as the contract
store. Encrypted column for sensitive fields. Plugin owns the full
credential lifecycle.

**Recommendation:** Option C for the prototype — everything in one
SQLite database, one dependency, one place to look. Production:
OS Keychain for sensitive tokens.

### Provider plugin auth flow — usable for service connectors

Plugins can register model providers so users can run OAuth or
API-key setup inside OpenClaw. A provider plugin can participate
in five phases: Auth (`auth[].run(ctx)` performs OAuth, API-key
capture, device code, or custom setup), Non-interactive setup,
Wizard integration, Implicit discovery, and model catalog
contribution.

The `auth[].run(ctx)` pattern is interesting. The context provides:
- `prompter` — for interactive terminal input
- `runtime` — access to OpenClaw runtime
- `openUrl` — open a browser URL (this is the OAuth redirect mechanism)
- `oauth.createVpsAwareHandlers` — VPS-aware OAuth callback handling

**Key insight:** `openUrl` and `oauth.createVpsAwareHandlers` are
the mechanism for opening a browser for OAuth consent. This is
available through the provider plugin registration path. We can
register a "dummy" provider plugin for each connector service that
uses this auth infrastructure — not to provide model inference, but
to piggyback the OAuth flow mechanism.

Or more cleanly: use `openUrl` directly from within a tool's execute
function when the agent calls `aura_request_connection`.

### OAuth callback port

When performing an OAuth login on a remote server, the browser
might fail to send the callback to `http://127.0.0.1:1455`.

OpenClaw's OAuth callback listener is on port 1455. For service
connector OAuth flows we need our own callback endpoint registered
via `registerHttpRoute`. This avoids conflicts with OpenClaw's
own callback port.

### Token refresh is the plugin's responsibility for non-model connectors

OAuth tokens are refreshed automatically before expiry for model
providers. OpenClaw uses file locking during refresh operations to
prevent race conditions when multiple processes attempt concurrent
refreshes.

This automatic refresh is only for credentials stored in
`auth-profiles.json` — the model provider system. For service
connectors (Gmail, Etsy, etc.) stored in our own connector store,
we must implement refresh logic ourselves. This is a real
implementation task that belongs in Phase 2.

### auth-profiles.json structure (confirmed)

The auth-profiles.json structure:
```json
{
  "profiles": [
    {
      "id": "team-api-key",
      "type": "api-key",
      "provider": "anthropic",
      "key": "sk-ant-xxxxxxxxxxxxx"
    },
    {
      "id": "org-oauth",
      "type": "oauth",
      "provider": "anthropic",
      "accessToken": "...",
      "refreshToken": "...",
      "expiresAt": "2026-03-01T00:00:00Z"
    }
  ]
}
```


Profile IDs follow `<provider>:<name>` pattern. We could abuse
this for connector storage (e.g. `gmail-connector:studio-ops`)
but this would be coupling to an internal format not designed for
our use. Not recommended.

### The Canvas panel and OAuth browser flow

The plan assumed OAuth flows open in an in-app Canvas browser panel.
Research reveals the actual mechanism:

The macOS app embeds an agent-controlled Canvas panel using
WKWebView. Canvas can be shown/hidden, navigated, and evaluated via
the Gateway WebSocket. The agent can use `canvas.navigate` to direct
the Canvas to any URL including `http(s)` URLs.

**The OAuth browser flow via Canvas:**
1. Plugin registers an HTTP route as the OAuth callback endpoint
2. When owner accepts connection, plugin constructs the OAuth
   authorization URL with our callback URL
3. Plugin calls `canvas.navigate` (via `api.runtime.system` or
   a Canvas-specific runtime helper) to open the OAuth page in Canvas
4. Owner completes consent in the Canvas panel
5. Provider redirects to our callback URL
6. Plugin receives the auth code, exchanges for tokens, stores them
7. Canvas is navigated back to the Pulse PWA URL

This requires verifying that `api.runtime` exposes Canvas navigation.
The Canvas API surface is documented under nodes/canvas commands —
we need to confirm plugin access to `openclaw nodes canvas navigate`.

**Alternative for macOS:** Use `openUrl` to open the system default
browser. Simpler but breaks the "never leave the Aura surface"
experience. Only use as fallback.

---

## 03 — NemoClaw and OpenShell

### What NemoClaw is

NemoClaw is an NVIDIA plugin for secure installation of OpenClaw.
It installs the NVIDIA OpenShell runtime, part of the NVIDIA Agent
Toolkit, a secure environment for running autonomous agents, with
inference routed through NVIDIA cloud. The resulting environment runs
with Landlock + seccomp + network namespace isolation, using Nemotron
3 Super 120B.

NemoClaw is a curated, secured OpenClaw deployment — not a platform
to build on. It is enterprise-only, Linux-only, Docker-required,
and routes inference to NVIDIA's cloud. Not relevant to our macOS,
local-first architecture.

### What OpenShell actually is

OpenShell is the safe, private runtime for autonomous AI agents.
It uses Landlock filesystem restrictions, seccomp syscall filtering,
and network namespace isolation to create hermetic sandboxes for
agents. Written in Rust. 2.1k stars, 324 commits, active.

OpenShell is a Linux kernel-level security sandbox for agents. It is
genuinely novel infrastructure — production-grade, serious engineering.

### The OpenShell tasks/ directory

OpenShell has a `tasks/` directory in its repository structure. This
is the most relevant thing for Aura. Based on the directory structure
and OpenShell's purpose (running autonomous agents safely), the tasks
directory likely contains OpenShell's task primitive definition.

**Research gap:** We could not directly access the OpenShell README
contents or the tasks/ directory content. This requires manual
inspection of the repository. Recommended before finalizing the
contract schema.

**Why it matters:** If OpenShell has a well-defined task object
schema, we should review it before finalizing ours. Not to copy it —
our contract layer has different goals — but to check if they've
solved problems we haven't thought of.

### OpenShell relevance to Aura

**Not relevant now:** OpenShell is Linux-only. We are building on
macOS. It requires Docker and kernel-level Linux security primitives
(Landlock, seccomp, namespaces) that do not exist on macOS.

**Potentially relevant later:** If Aura ever supports Linux
deployments (NVIDIA DGX Spark as mentioned in v7 brief), OpenShell
becomes the natural security sandbox layer. The `.aurora` package
manifest could declare required filesystem paths and network
permissions that OpenShell enforces at the kernel level.

**The conceptual overlap:** OpenShell's security model (declared
permissions, enforced at runtime) mirrors our connector permission
model (declared in `.aurora` manifest, enforced by the contract
runtime). They are solving the same problem at different layers.

### NemoClaw vs Aura — the clean differentiation

| | NemoClaw/OpenShell | Aura |
|---|---|---|
| Platform | Linux + Docker | macOS (local) |
| Security | Kernel (Landlock, seccomp) | Relational (trust model) |
| Inference | NVIDIA Cloud | Local Ollama + BYOK |
| Target user | Enterprise IT | SMB owner |
| Setup | `curl \| bash` on Linux | Conversation |
| Privacy | Cloud routing with enterprise controls | Never leaves device |

OpenShell solves "how do enterprises run agents safely on servers."
Aura solves "how do individuals run agents safely on their Mac."
Same philosophical goal (sovereign, private, controlled), completely
different implementation and user.

---

## 04 — Engram SDK Compatibility

### The SDK break risk

External plugins that import from `openclaw/plugin-sdk` (the
monolithic root) or older paths fail to load with:
`Error: Cannot find module 'openclaw/plugin-sdk'` or similar errors
after the 2026.3.22 SDK restructuring.

Engram (joshuaswarren/openclaw-engram) was written before the
2026.3.22 SDK break. It almost certainly imports from either:
- `openclaw/plugin-sdk/compat` (deprecated)
- `openclaw/extension-api` (removed)
- The monolithic `openclaw/plugin-sdk` root (behavior changed)

**Action required:** Before integrating engram in Phase 2, inspect
its `index.ts` and `src/` imports. If it uses deprecated paths,
either:
a) Submit a PR to update engram to the new SDK surface
b) Fork and update ourselves
c) Wrap engram behind a compatibility shim in our plugin

Engram is 17 commits with 0 forks. It may need updating.
This is a known risk, not a blocker — but it must be resolved
before Phase 2 integration.

### Engram's architecture (confirmed correct for our needs)

Local-first memory plugin for OpenClaw. LLM-powered extraction,
plain markdown storage, hybrid search via QMD. Gives agents
persistent long-term memory across conversations.

The architecture is right. Markdown storage = human readable, local,
ownable. LLM extraction = async, doesn't block agent. Hybrid search
= reliable recall. The SDK compatibility issue is a packaging problem,
not an architectural one. The approach is sound.

---

## 05 — Key Implementation Decisions

Based on this research, the following decisions are now confirmed:

### Decision 1 — Plugin type: tool + service + HTTP route

Use `definePluginEntry` (not `defineChannelPluginEntry`). Register
tools, a background service (ContractRuntime), and HTTP routes.
Split into setup entry (HTTP routes, lightweight) and full entry
(services, tools, CLI commands).

### Decision 2 — Connector credential storage: plugin-managed SQLite

OpenClaw's `auth-profiles.json` is for model providers only. We
store service connector credentials (Gmail OAuth tokens, Etsy OAuth
tokens, API keys) in our own encrypted column in the contract SQLite
database. Token refresh is our responsibility.

### Decision 3 — OAuth browser flow: Canvas navigate + HTTP callback

For OAuth service connectors:
1. Plugin registers callback HTTP route via `registerHttpRoute`
2. Constructs OAuth authorization URL
3. Navigates Canvas panel to authorization URL
4. Receives callback at our registered route
5. Exchanges code for tokens, stores in SQLite connector store

Requires verifying Canvas navigation is accessible from plugin
runtime. Fallback: system browser via `openUrl`.

### Decision 4 — API key connectors: tool-driven secure input

For API key connectors (Yelp, Shippo):
The `aura_request_connection` tool triggers the Pulse PWA to display
a secure input card. The owner types the key. It returns to the
plugin via the WebSocket. The plugin stores it in the encrypted
SQLite connector store. Never echoed.

### Decision 5 — WebSocket for PWA: custom server via registerService

`registerHttpRoute` handles standard HTTP. WebSocket requires upgrade
handling. We run a separate WebSocket server (via the `ws` package)
as a `registerService`. The service listens on a configured port
(default 7700). The Pulse PWA connects to this port directly.
The HTTP route serves the PWA static files.

### Decision 6 — Agent workspace paths via api.runtime.agent

Never hardcode paths. Use `api.runtime.agent.resolveAgentWorkspaceDir()`
to locate:
- `active-context.md`
- `connectors.db` (our SQLite store)
- Contract log files
- Engram memory directory

### Decision 7 — Engram compatibility check before Phase 2

Inspect engram source before Phase 2 begins. Update SDK imports if
needed. Do not assume compatibility.

### Decision 8 — Stay on OpenClaw 2026.3.7 for prototype

If a plugin uses the legacy `openclaw/extension-api` interface,
the developer must update the code. Users are advised to contact the
plugin developer to confirm compatibility before upgrading.

Your existing multi-agent setup runs on 2026.3.7 and is stable. The
demo agent (aura-pulse) will be built against the new SDK surface
(`openclaw/plugin-sdk/*`) from scratch, so it will be compatible
with both 2026.3.7 (where the new SDK is available) and 2026.3.22+.
Do not upgrade the existing setup until after the prototype is
working. Upgrade separately and verify.

---

## 06 — Open Implementation Questions

These require prototype work to answer — they cannot be resolved
by documentation alone.

**Q1 — WebSocket upgrade in registerHttpRoute**
Can `registerHttpRoute` handle WebSocket upgrade requests? Or must
the WS server run on a separate port entirely? Prototype test:
register a route, attempt WS upgrade, observe behavior.

**Q2 — Canvas navigation from plugin runtime**
Is there an `api.runtime` method for sending Canvas navigation
commands? Or must we use the Gateway WebSocket protocol directly?
Check `api.runtime.system` and any undocumented Canvas helpers.
If no direct API exists, we can use the Gateway WebSocket as a
channel to send canvas commands.

**Q3 — registerService lifecycle and crash recovery**
If the ContractRuntime service crashes, does `registerService`
automatically restart it? Or does gateway restart only? Need to
understand the service lifecycle before relying on it for persistent
contract state.

**Q4 — Multiple agent instances and shared contract store**
If multiple agents in the same OpenClaw instance both have aura-pulse
enabled, do they share a contract store? Or does each agent get its
own? The answer depends on how we resolve the store path:
`resolveAgentWorkspaceDir()` would give each agent its own store
(correct behavior).

**Q5 — OpenShell tasks/ schema**
Manual inspection needed. Clone `github.com/NVIDIA/OpenShell` and
read `tasks/` directory. Compare against our contract schema.
Note any primitives we haven't considered.

---

## 07 — Recommended Research Follow-ups

Before writing plan v0.5 or starting Phase 1 implementation:

1. **Inspect OpenShell tasks/ directory** — read the task primitive
   schema. 30 minutes of reading before finalizing the contract schema.

2. **Check engram SDK imports** — `grep -r "extension-api\|plugin-sdk/compat" ~/.openclaw/extensions/openclaw-engram/`
   to confirm whether it needs updating.

3. **Prototype WebSocket in registerHttpRoute** — small test: can
   we upgrade an HTTP route to WebSocket within OpenClaw's gateway?
   If not, the WS server runs on its own port (simple workaround).

4. **Verify Canvas navigate from plugin** — check `api.runtime` docs
   or source for any canvas navigation helper. If absent, test
   Gateway WebSocket canvas commands from within a tool's execute
   function.

5. **Read provider-auth SDK** — `openclaw/plugin-sdk/provider-auth`
   exports `createProviderApiKeyAuthMethod`, `upsertAuthProfile`, and
   others. Understand if any of these are usable for service connector
   tokens before building custom storage.

---

*Research complete. Informs plan v0.5 and Phase 1 implementation.*
*Date: March 24, 2026*
