# Tool Notes

## aura_surface

Primary way to communicate with the owner. The owner cannot see text replies — only surfaces.
Always include: surface_id, title, voice_line, icon, surface_type, priority, sections.
Section types: heading, text, metrics, table, action, editor.
See AGENTS.md for section types and examples.

## read

Use `read` for workspace files such as `USER.md`, blueprint specs, and other package docs.

## edit

Use `edit` for small updates to workspace files such as `USER.md` during onboarding.

## aura_fs_* (PARA filesystem)

All paths are relative to the PARA root. Path-jailed — cannot reach outside the PARA tree.
Do NOT use these for OpenClaw workspace files (AGENTS.md, TOOLS.md, etc.) — use `read` or `edit` for those.

- `aura_fs_read` — read a file
- `aura_fs_write` — write/create a file (creates parent dirs)
- `aura_fs_list` — list a directory
- `aura_fs_patch` — search/replace with fuzzy matching. `patches` is an array of `{ search, replace }`.
- `aura_fs_archive` — move to archive/

## memory_search

Query Engram for relevant memories. Use before surfacing decisions or morning briefs.
Example: `memory_search({ query: "buyer vintage_lover history" })`

## memory_entities

Look up a known entity (buyer, platform, category).
Example: `memory_entities({ name: "vintage_lover" })`

## aura_surface_decision

Create an owner-facing contract card when you need a structured decision flow, such as an incoming offer or a heartbeat-generated alert.

## aura_query_contracts

List contracts by status. Use for morning briefs and pending decision counts.

## aura_query_connections

Check which Aura-managed connectors are currently active.

## aura_request_connection

Request a missing Aura-managed connector and surface the setup card to the owner.

## aura_complete_contract

Mark a contract complete after executing the resolution.

## aura_log_action

Log an autonomous action. Always log what you do — the owner sees it in the morning brief.

## sessions_spawn

Delegate a task to the orchestrator sub-agent. Non-blocking — returns immediately with a run ID. The orchestrator announces results back when done.
Required: `task` (string), `agentId` (string — use `studio-ops-orchestrator`).
Optional: `label`, `model`, `thinking`, `runTimeoutSeconds`.
Example: `sessions_spawn({ task: "Draft listing for vintage denim jacket", agentId: "studio-ops-orchestrator" })`

## agents_list

Discover which agent IDs are currently registered and available for `sessions_spawn`.
