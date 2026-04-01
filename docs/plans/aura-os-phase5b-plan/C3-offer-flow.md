# Session C3 — Simulated Offer Decision Chain

**Goal:** Simulate a marketplace offer arriving, verify the full decision
chain surfaces correctly in Pulse, and complete a contract resolution.

**Estimated effort:** 1 session. Mostly verifying surface rendering and
contract state transitions.

---

## Prerequisites

- C1 + C2 complete — gateway running, agent onboarded, USER.md populated
- Agent knows owner is "Sheryl" who sells on Poshmark and Etsy

## Files to read (in order)

1. `aura-pulse/packages/artist-reseller/agents/main/AGENTS.md` — the offer-received example (lines ~99-138)
2. `aura-pulse/packages/artist-reseller/domain-types.json` — offer-received schema + execution_goal
3. `aura-pulse/packages/artist-reseller/agents/main/USER.md` — verify Sheryl's data is there

Only read other files if debugging requires it.

## Steps

### 1. Verify agent knows Sheryl

Send a message: "Hey, what can you do for me?"

Expected: Agent reads USER.md, uses "Sheryl" naturally, surfaces a
capabilities summary referencing her platforms (Poshmark, Etsy).

### 2. Simulate an offer

There are two ways to trigger an offer contract:

**Option A — Direct contract creation via CLI:**
```bash
docker compose -f docker-compose.openclaw.yml run --rm -T openclaw-cli \
  exec "aura_surface_decision" --json '{
    "type": "offer-received",
    "context": {
      "platform": "poshmark",
      "listing_id": "posh-abc123",
      "listing_title": "Vintage Levi'\''s 501 Red Tab — W28 L30",
      "offer_amount": 30,
      "asking_price": 45,
      "buyer_id": "vintage_lover_22"
    }
  }'
```

**Option B — Send a simulated email message to the agent:**
"I just got an offer on Poshmark. Someone named vintage_lover_22 offered
$30 on my Vintage Levi's 501 Red Tab that I have listed at $45."

Option B tests the agent's ability to parse the offer and create the
contract itself. Prefer this for the E2E test.

### 3. Verify offer surface

The agent should call `aura_surface` with:
- surface_type: "attention"
- priority: "high"
- icon: "OF"
- voice_line mentioning the $30 offer on Levi's
- Metrics: offer amount, asking price, spread, buyer info
- Actions: Accept, Counter, Decline

Verify in Pulse:
- [ ] Surface renders with correct metrics
- [ ] Action buttons are clickable
- [ ] voice_line appears in the command timeline

### 4. Click "Counter at $38"

This triggers the counter-offer flow. Expected:
- Agent surfaces a NEW surface with an `editor` section
- Draft counter message pre-filled
- "Send counter" submit button
- Alternative quick actions (counter at $40, accept original)

### 5. Edit the draft and click "Send counter"

Modify the draft text slightly (proves the editor works). Click submit.

Expected:
- Agent reads `context.draftText` from the action
- Surfaces a SENT CONFIRMATION (not the editor again)
- voice_line: "Counter sent to the buyer at $38."
- Action: "Set reminder for response", "Done"

### 6. Click "Done" (mark resolved)

Expected:
- Contract marked complete
- Surface shows completion confirmation
- `aura_log_action` called

### 7. Verify contract state

```bash
docker compose -f docker-compose.openclaw.yml run --rm -T openclaw-cli \
  exec "aura_list_contracts" --json '{"status": "completed"}'
```

The offer contract should show as completed with the counter resolution.

### 8. Test decline flow (optional)

Repeat steps 2-3 with a new offer, then click "Decline" to verify that
path works too.

### 9. Verify Engram learned

The offer interaction should be captured by Engram:
```
engram.recall({ query: "vintage_lover_22 offer Levi's" })
```

Or via CLI if available. The agent should know about this buyer in future
interactions.

## Exit criteria

- [ ] Agent uses Sheryl's name from USER.md in voice_lines
- [ ] Offer surface renders with correct metrics, actions, icon, priority
- [ ] Counter flow: editor appears with pre-filled draft
- [ ] Draft is editable, submittable
- [ ] Sent confirmation surfaces after submit (not re-showing editor)
- [ ] Contract completes successfully
- [ ] `aura_list_contracts` shows the completed offer
- [ ] Engram captured the buyer interaction
- [ ] No text-only replies — everything through aura_surface

## Likely issues

- **Contract creation fails** — domain type validation may reject fields.
  Check `domain-types.json` field requirements vs what was sent.
- **Surface schema validation errors** — the agent may produce invalid
  section JSON. Check gateway logs for tool call errors. Fix in AGENTS.md
  examples if patterns are wrong.
- **Editor section not rendering** — Pulse PWA may have a bug in the
  editor component. Check browser console.
- **Action callback not routed** — when user clicks a button, the action
  may not reach the agent. Check websocket message format.
- **Agent re-shows same surface instead of advancing** — AGENTS.md has
  explicit rules about this. May need strengthening.

## Handoff to C4

Once all exit criteria pass, note:
- Any surface schema fixes made
- Whether contract state machine worked correctly
- Any AGENTS.md prompt adjustments for the offer flow
- Whether Engram recall returns offer context

C4 will test the morning brief cron and heartbeat, then do a Sheryl
dry-run to see if the full flow holds together.
