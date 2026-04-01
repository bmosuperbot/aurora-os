# Session C4 — Cron, Heartbeat, and Hardening

**Goal:** Verify cron and heartbeat work, then stress-test the full system
with edge cases and error scenarios. Fix everything that breaks. The system
should be bulletproof before Sheryl touches it.

**Estimated effort:** 1-2 sessions. This is the messy debugging session.
Take the time here so C5 is clean.

---

## Prerequisites

- C1 + C2 + C3 complete — installer, onboarding, and offer flow proven
- Gateway running, Pulse connected, agent onboarded

## Files to read (in order)

1. `aura-pulse/packages/artist-reseller/agents/main/HEARTBEAT.md` — 30-min checklist
2. `aura-pulse/packages/artist-reseller/agents/main/AGENTS.md` — morning brief example (lines ~197-212)
3. `aura-pulse/packages/artist-reseller/aurora.manifest.yaml` — cron definitions (lines ~105-127)

Only read other files if debugging requires it.

---

## Part 1: Cron — Morning Brief

### 1. Check cron is registered

```bash
docker compose -f docker-compose.openclaw.yml run --rm -T openclaw-cli cron list
```

Should show Morning Brief with schedule `0 7 * * *`.

### 2. Trigger the morning brief manually

```bash
docker compose -f docker-compose.openclaw.yml run --rm -T openclaw-cli \
  cron trigger morning-brief
```

Or send: "Give me a morning brief."

### 3. Verify morning brief surface

Expected:
- surface_type: "brief", icon: "MB"
- Sections: pending decisions, overnight activity, today's deadlines
- Gathers from `aura_list_contracts`, Engram, PARA files
- If no data: graceful empty state ("No pending decisions. Inbox is clear.")

### 4. Verify brief content

- [ ] Uses Sheryl's name
- [ ] References her platforms (Poshmark, Etsy)
- [ ] Mentions completed offers from C3 if any
- [ ] Engram recall returns relevant context
- [ ] Surface renders correctly in Pulse

---

## Part 2: Heartbeat

### 1. Check heartbeat config

```bash
docker compose -f docker-compose.openclaw.yml run --rm -T openclaw-cli \
  config get agents.defaults.heartbeat
```

Should show: every 30m, active hours 08:00-22:00.

### 2. Verify heartbeat turns in gateway logs

```bash
docker compose -f docker-compose.openclaw.yml logs --tail 200 openclaw-gateway | grep -i heartbeat
```

Expected: agent reads HEARTBEAT.md, runs the checklist, replies
`HEARTBEAT_OK` if nothing needs attention.

### 3. Verify heartbeat is silent unless needed

The agent should NOT call `aura_surface` during heartbeat unless something
actionable is found. Silent heartbeats = correct.

---

## Part 3: Hardening — Edge Cases

This is the critical section. Test everything that could go wrong when
a real user is sitting in front of Pulse.

### Agent behavior edge cases

Test each and verify correct behavior:

| # | Test | Send to agent | Expected |
|---|---|---|---|
| 1 | Empty message | "" or just whitespace | Agent handles gracefully, surfaces something useful or asks what they need |
| 2 | Off-topic question | "What's the weather like?" | Agent stays in role, redirects to business topics politely |
| 3 | Ambiguous offer | "Someone made me an offer" (no details) | Agent asks clarifying questions via aura_surface, doesn't guess |
| 4 | Multiple requests | "Check my offers and also draft a listing for my new jacket" | Agent handles sequentially or delegates, doesn't drop one |
| 5 | Unknown platform | "I got an offer on Depop" | Agent handles gracefully even though Depop isn't in her platforms |
| 6 | Follow-up after silence | (wait 5+ minutes, then send a message) | Agent still knows context, uses Sheryl's name, no cold restart |

### Surface rendering edge cases

| # | Test | Expected |
|---|---|---|
| 7 | Very long listing title | Metrics and text don't overflow or break layout |
| 8 | Special characters in buyer name | `buyer_name: "José's Vintage 'Shop'"` renders correctly |
| 9 | Multiple surfaces in sequence | Each new surface replaces or stacks correctly in Pulse |
| 10 | Action button clicked twice rapidly | No duplicate processing, no error surface |

### Contract edge cases

| # | Test | Expected |
|---|---|---|
| 11 | Accept an offer (not counter) | Full accept flow: confirmation → ship-by date → label/shipped actions |
| 12 | Decline an offer | Decline confirmation, optional courtesy message |
| 13 | Two offers simultaneously | Agent handles both, separate surfaces, no confusion |
| 14 | Offer with missing fields | "Got an offer on Poshmark" (no amount, no item) → agent asks for details |

### Tool failure edge cases

| # | Test | Expected |
|---|---|---|
| 15 | Engram recall returns nothing | Agent proceeds without memory context, doesn't error |
| 16 | PARA directory empty | `aura_fs_list` returns empty list, agent doesn't crash |
| 17 | Contract list empty | `aura_list_contracts` returns [], morning brief says "nothing pending" |

### Record all issues

For each test, record:
- **Pass/Fail**
- **What went wrong** (if fail)
- **File to fix** (AGENTS.md prompt? TOOLS.md? Pulse component? Plugin code?)
- **Fix applied** (or deferred with reason)

---

## Part 4: Uninstall / Reinstall Cycle

### 1. Uninstall

```bash
cd aura-pulse/packages/artist-reseller
node scripts/uninstall.mjs --docker
```

### 2. Verify clean state

```bash
docker compose -f ../../docker-compose.openclaw.yml run --rm -T openclaw-cli agents list
docker compose -f ../../docker-compose.openclaw.yml run --rm -T openclaw-cli plugins list
docker compose -f ../../docker-compose.openclaw.yml run --rm -T openclaw-cli cron list
docker compose -f ../../docker-compose.openclaw.yml run --rm -T openclaw-cli config get plugins.slots.memory
docker compose -f ../../docker-compose.openclaw.yml run --rm -T openclaw-cli config get agents.defaults.heartbeat
```

All should be clean/empty/default. No orphaned config keys.

### 3. Reinstall

```bash
node scripts/install.mjs --docker --non-interactive \
  --ollama-url http://192.168.68.116:11434/v1 \
  --ollama-model qwen3:14b
```

### 4. Verify reinstall matches original

Same checks as C1 exit criteria. Everything should be identical to a fresh
install — no state leakage from the previous run.

### 5. Quick onboarding smoke test

Open Pulse, verify BOOTSTRAP.md triggers, answer 1-2 questions, verify
surfaces render. Don't need the full onboarding — just confirm it starts.

---

## Part 5: Performance and Polish

### Response time

- [ ] First surface appears within 10 seconds of sending a message
- [ ] Offer surface appears within 15 seconds of describing an offer
- [ ] Morning brief appears within 20 seconds of request

### Voice lines

- [ ] voice_lines are natural, not robotic
- [ ] voice_lines use Sheryl's name where appropriate
- [ ] voice_lines are concise (one sentence, not a paragraph)

### Surface quality

- [ ] Metrics show correct labels and values
- [ ] Tables are well-formatted with clear headers
- [ ] Action buttons have clear, actionable labels
- [ ] Icons are consistent (OF, LD, SD, IA, MB, SS)
- [ ] Priority levels feel right (offers = high, brief = normal)

---

## Exit criteria

Everything below must pass before moving to C5:

### Cron + Heartbeat
- [ ] Morning brief surfaces correctly (with and without data)
- [ ] Heartbeat runs silently when nothing needs attention
- [ ] Heartbeat surfaces correctly when something is actionable

### Edge cases
- [ ] All 17 edge case tests pass (or issues documented and fixed)
- [ ] Agent never drops to text-only replies
- [ ] Agent handles missing data gracefully
- [ ] Agent handles ambiguous input by asking clarifying questions

### Uninstall/Reinstall
- [ ] Uninstaller leaves no orphaned config
- [ ] Reinstall produces identical result to fresh install
- [ ] USER.md preserved after uninstall (unless --include-user-data)
- [ ] PARA directories preserved after uninstall

### Polish
- [ ] Response times acceptable
- [ ] Voice lines natural and personalized
- [ ] Surface quality consistent across all scenarios
- [ ] No console errors in Pulse PWA

---

## Likely issues

- **Morning brief with no data** — agent may error or produce garbage.
  Fix the AGENTS.md morning brief example to handle empty state.
- **Heartbeat too noisy** — strengthen HEARTBEAT.md "reply HEARTBEAT_OK
  if nothing" instruction.
- **Agent breaks character on edge cases** — may need stronger guardrails
  in SOUL.md for off-topic handling.
- **Uninstaller leaves config residue** — add missing `config unset` calls.
- **Surface rendering bugs** — may need Pulse PWA fixes for edge cases
  (long text, special chars, rapid clicks).

## Handoff to C5

Once all exit criteria pass, document:
- List of all fixes made during hardening (file + description)
- Any known limitations that Sheryl should avoid
- Recommended test scenarios for Sheryl
- Exact installer command for Sheryl's machine
