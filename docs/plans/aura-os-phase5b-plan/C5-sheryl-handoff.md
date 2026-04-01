# Session C5 — Sheryl Test Handoff

**Goal:** Clean-slate full E2E run, prepare Sheryl's test environment and
cheat sheet, then hand off for the real user test.

**Estimated effort:** 1 short session for setup, then Sheryl runs it
independently. You observe and take notes.

---

## Prerequisites

- C1–C4 complete — everything working, edge cases handled, polish done
- All fixes from C4 committed
- Sheryl's machine has: Docker Desktop, Ollama with qwen3:14b, network
  access to Ollama host

---

## Part 1: Clean-Slate E2E (Your Final Run)

One last full run from zero. This is the dress rehearsal.

### 1. Full reset

```bash
cd aura-pulse/packages/artist-reseller
node scripts/uninstall.mjs --docker
```

Verify everything is clean.

### 2. Fresh install (interactive)

```bash
node scripts/install.mjs --docker \
  --ollama-url http://192.168.68.116:11434/v1 \
  --ollama-model qwen3:14b
```

Use interactive mode. Time it. Note any friction.

### 3. Full onboarding

Open Pulse. Walk through all 7 steps as Sheryl would. Time it.

### 4. Full offer flow

Send: "I got a $35 offer on my vintage corduroy blazer on Poshmark.
Buyer is retro_finds. I'm asking $55."

Complete the full chain: surface → counter → edit draft → send → done.

### 5. Morning brief

"What's happening today?"

Verify it references the offer.

### 6. Record timing

| Step | Time |
|---|---|
| Installer (interactive) | ___ min |
| Onboarding (all 7 steps) | ___ min |
| First offer (surface → resolution) | ___ min |
| Morning brief | ___ sec |
| **Total: install to useful** | ___ min |

Target: under 15 minutes total.

### 7. Confirm exit criteria from C4 still pass

Quick spot-check — don't repeat all 17 edge cases, just verify the
critical path is clean.

---

## Part 2: Prepare Sheryl's Environment

### 1. Sheryl's machine setup

Verify on her machine (or a clean machine):
- [ ] Docker Desktop installed and running
- [ ] Ollama accessible (verify with `curl http://192.168.68.116:11434/api/tags`)
- [ ] Node.js installed (for running install.mjs)
- [ ] Git clone of aurora-os repo (or just the package directory)
- [ ] pnpm available (for building standalone bundle)

### 2. Pre-build the standalone bundle

On her machine:
```bash
cd aura-pulse
pnpm install
pnpm --filter @aura/aura-pulse build:standalone
```

### 3. Docker onboarding (do this for her)

```bash
export OPENCLAW_IMAGE="ghcr.io/openclaw/openclaw:2026.3.24"
export OPENCLAW_CONFIG_DIR="$PWD/.openclaw-docker/config"
export OPENCLAW_WORKSPACE_DIR="$PWD/.openclaw-docker/workspace"
sh ./scripts/openclaw-docker-onboard.sh
sh ./scripts/openclaw-docker-up.sh
```

This is the "Aurora Install" step — we do it for her since it's not part
of the 5b scope. She starts from the Expert Store CLI.

### 4. Verify gateway is running

```bash
docker compose -f docker-compose.openclaw.yml ps
```

Gateway should be up and healthy.

---

## Part 3: Sheryl's Cheat Sheet

Create a simple one-page instruction for Sheryl. Print it or put it on
screen next to her.

```
┌─────────────────────────────────────────────┐
│           Welcome to Aurora OS              │
│                                             │
│  Step 1: Open Terminal                      │
│                                             │
│  Step 2: Run this command:                  │
│                                             │
│    cd aura-pulse/packages/artist-reseller   │
│    node scripts/install.mjs --docker        │
│                                             │
│  Step 3: Follow the prompts                 │
│    - Pick which helpers you want            │
│    - Confirm the schedule                   │
│    - Wait for "Setup Complete"              │
│                                             │
│  Step 4: Open your browser to:             │
│    http://localhost:5173                     │
│    (or http://localhost:4175 if Docker)      │
│                                             │
│  Step 5: Say hi to Studio Ops              │
│    - Answer its questions                   │
│    - It will learn about your business      │
│                                             │
│  Step 6: Try it out                         │
│    - Tell it about an offer you received    │
│    - Ask "what's going on today?"           │
│                                             │
│  That's it! No code. No files to edit.      │
└─────────────────────────────────────────────┘
```

---

## Part 4: The Sheryl Test

### Rules

- **You do NOT help.** Sit behind her. Watch. Take notes.
- If she asks a question, note what she asked but try "what do you think?"
  first. Only intervene if she's completely stuck for 2+ minutes.
- Do NOT touch the keyboard or mouse.
- Do NOT explain what the agent is doing or why.

### What to observe

Record each of these in real-time:

| Moment | What happened | Sheryl's reaction | Issue? |
|---|---|---|---|
| Installer starts | | | |
| Sub-agent selection | | | |
| Cron confirmation | | | |
| Setup Complete message | | | |
| Opens Pulse | | | |
| First agent greeting | | | |
| First discovery question | | | |
| Answers all questions | | | |
| Connector status card | | | |
| Schedule review | | | |
| Capability test results | | | |
| Handoff message | | | |
| Describes an offer | | | |
| Offer surface appears | | | |
| Clicks counter/accept/decline | | | |
| Edits draft (if counter) | | | |
| Resolution confirmation | | | |
| Asks for morning brief | | | |
| Brief surfaces | | | |

### Key questions to answer

After the test, ask Sheryl:

1. "What was confusing?"
2. "What did you expect to happen that didn't?"
3. "Would you use this every day?"
4. "What would make it better?"
5. "Did it feel like talking to an assistant or fighting with software?"

### Scoring

| Criteria | Pass | Fail |
|---|---|---|
| Completed installer without help | | |
| Completed onboarding without help | | |
| Successfully handled an offer | | |
| Understood what Studio Ops can do | | |
| Never saw code, JSON, or error messages | | |
| Would use it again | | |
| Total time under 20 minutes | | |

---

## Exit criteria

- [ ] Clean E2E passes on your final run
- [ ] Sheryl's environment is set up and verified
- [ ] Cheat sheet prepared
- [ ] Sheryl completes the test
- [ ] Observation notes collected
- [ ] Post-test feedback recorded
- [ ] All 6 scoring criteria pass

---

## After C5

Phase 5b is complete when Sheryl passes.

Deliverables for Phase 6 planning:
1. Sheryl's feedback notes
2. Timing data (install → useful)
3. List of UX friction points
4. List of features she asked about that don't exist yet
5. Hardening fixes from C4 (carried forward)
6. Decision: `/aura/setup` endpoint vs standalone Electron app for Expert Store
