# Session C2 — Package Onboarding in Pulse

**Goal:** Open Pulse, trigger the BOOTSTRAP.md onboarding flow, and verify
the agent completes all 7 steps. USER.md is populated. BOOTSTRAP.md is deleted.

**Estimated effort:** 1 session. Mostly prompt tuning if the agent doesn't
follow BOOTSTRAP.md correctly.

---

## Prerequisites

- C1 complete — gateway running, installer passed, all CLI checks green
- Pulse PWA buildable and connectable to the gateway websocket

## Files to read (in order)

1. `aura-pulse/packages/artist-reseller/agents/main/BOOTSTRAP.md` — the 7-step ritual
2. `aura-pulse/packages/artist-reseller/agents/main/AGENTS.md` — how the agent uses aura_surface
3. `aura-pulse/packages/artist-reseller/agents/main/SOUL.md` — personality
4. `aura-pulse/packages/artist-reseller/agents/main/IDENTITY.md` — name/emoji
5. `aura-pulse/packages/artist-reseller/agents/main/USER.md` — empty template (verify it starts empty)

Only read other files if debugging requires it.

## Steps

### 1. Start Pulse

Option A — localhost (preferred for fast iteration):
```bash
cd aura-pulse/packages/pulse-pwa
pnpm dev
```

Option B — Docker:
```bash
cd aura-pulse
AURA_DOCKER_INCLUDE_PULSE=1 sh ./scripts/openclaw-docker-up.sh
```

Open Pulse in browser. Verify websocket connects to the gateway
(check browser console for WS connection).

### 2. Trigger first session

Send any message to the agent. BOOTSTRAP.md should trigger the onboarding
flow automatically on the agent's first turn.

Expected: Agent greets using IDENTITY.md personality ("Hey — I'm Studio
Ops...") via `aura_surface`, not a text reply.

### 3. Verify each onboarding step

Walk through as if you are Sheryl. Answer the discovery questions naturally:

- Name: "Sheryl"
- Platforms: "Poshmark and Etsy"
- Listings: "About 50"
- What I sell: "Vintage clothing and handmade jewelry"
- Takes most time: "Responding to offers and writing listings"

**After each answer, verify:**
- Agent asks only ONE question at a time
- Agent uses `aura_surface` (surfaces appear in Pulse, not as text)
- Agent writes to USER.md after each answer

### 4. Connector status (step 3 of onboarding)

Agent should surface a status card showing:
- Gmail: connected/not connected (depends on Docker pre-config)
- Etsy: not connected
- Explains what each enables/disables

### 5. Schedule review (step 4)

Agent should surface the installed cron jobs:
- Morning Brief at 7 AM — asks if time works
- Reviews heartbeat — "Every 30 minutes I'll check for new offers..."

### 6. Capability test (step 5)

Agent should silently test:
- `aura_fs_list` on PARA root
- `engram.recall` with a test query
- `aura_list_contracts`

Then surface a results card with ✓/✗ for each.

### 7. Handoff (step 6)

Agent surfaces a summary of everything configured.
"Forward me your next offer email and I'll show you what I can do."

### 8. Clean up (step 7)

Agent should delete BOOTSTRAP.md. Verify the file is gone from the
workspace directory.

### 9. Verify USER.md

Read USER.md from the workspace. It should contain:
- Name: Sheryl
- Platforms: Poshmark, Etsy
- Listing count: ~50
- Categories: vintage clothing, handmade jewelry
- Pain point: offers and listings

## Exit criteria

- [ ] Agent greets with correct personality via `aura_surface`
- [ ] Discovery questions asked one at a time
- [ ] Each answer written to USER.md immediately
- [ ] Connector status card surfaces correctly
- [ ] Cron schedule surfaced and confirmed
- [ ] Capability test results surfaced (✓/✗ for each tool)
- [ ] Handoff summary surfaces correctly
- [ ] BOOTSTRAP.md deleted from workspace
- [ ] USER.md contains all discovery answers
- [ ] Engram captured onboarding context (test: `engram.recall` for "Sheryl" in next session)

## Likely issues

- **Agent uses text instead of aura_surface** — this is the #1 risk. The
  agent may reply with text that the owner can't see. Fix: strengthen the
  "you MUST use aura_surface" instruction in AGENTS.md.
- **Agent asks all questions at once** — BOOTSTRAP.md says "one at a time"
  but the agent may batch them. Fix: add stronger "WAIT for each answer"
  language.
- **Capability test fails** — `aura_fs_list` or `aura_list_contracts` may
  fail if the plugin isn't loaded correctly. Check `openclaw plugins list`
  and gateway logs.
- **BOOTSTRAP.md not deleted** — `exec rm BOOTSTRAP.md` may not work if
  exec is restricted. Check tool permissions. Alternative: agent uses
  `write` to empty the file.

## Handoff to C3

Once all exit criteria pass, note:
- Any AGENTS.md or BOOTSTRAP.md prompt changes made
- Whether the agent properly uses aura_surface for everything
- Whether Engram captured the onboarding conversation
- Any tool permission issues encountered

C3 will simulate an offer. The agent should now know Sheryl's name and
platforms from USER.md and Engram.
