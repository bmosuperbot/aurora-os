# Session C1 — Docker Environment + Installer

**Goal:** Bring up a clean OpenClaw Docker environment and run `install.mjs`
successfully. Every `openclaw` CLI verification command passes.

**Estimated effort:** 1 session, mostly debugging CLI command compatibility.

---

## Prerequisites

- Docker Desktop running
- Ollama running at `http://192.168.68.116:11434` with `qwen3:14b` pulled
- No leftover state from previous test runs

## Files to read (in order)

1. `docs/openclaw-docker-runtime.md` — Docker setup, bind mounts, onboarding
2. `aura-pulse/packages/artist-reseller/scripts/install.mjs` — the installer
3. `aura-pulse/packages/artist-reseller/aurora.manifest.yaml` — what the installer reads

Only read other files if debugging requires it.

## Steps

### 1. Clean slate

```bash
cd aura-pulse
rm -rf .openclaw-docker/config .openclaw-docker/workspace
```

### 2. Build the standalone Aura plugin bundle

```bash
pnpm --filter @aura/aura-pulse build:standalone
```

Verify `aura-pulse/dist/openclaw-plugin-standalone` exists.

### 3. Docker onboarding (one-time)

```bash
export OPENCLAW_IMAGE="ghcr.io/openclaw/openclaw:2026.3.24"
export OPENCLAW_CONFIG_DIR="$PWD/.openclaw-docker/config"
export OPENCLAW_WORKSPACE_DIR="$PWD/.openclaw-docker/workspace"

sh ./scripts/openclaw-docker-onboard.sh
```

Use non-interactive mode if needed:
```bash
docker compose -f docker-compose.openclaw.yml run --rm --no-deps --entrypoint node openclaw-gateway \
  dist/index.js onboard --mode local --non-interactive --no-install-daemon \
  --auth-choice ollama \
  --custom-base-url "http://192.168.68.116:11434" \
  --custom-model-id "qwen3:14b" \
  --accept-risk
```

### 4. Start the gateway

```bash
sh ./scripts/openclaw-docker-up.sh
```

Verify: `docker compose -f docker-compose.openclaw.yml ps` shows gateway running.

### 5. Verify baseline

```bash
docker compose -f docker-compose.openclaw.yml run --rm -T openclaw-cli models status
docker compose -f docker-compose.openclaw.yml run --rm -T openclaw-cli health
```

Both should pass before running the installer.

### 6. Run the installer (dry-run first)

```bash
cd packages/artist-reseller
node scripts/install.mjs --docker --dry-run --non-interactive \
  --ollama-url http://192.168.68.116:11434 \
  --ollama-model qwen3:14b
```

Review the dry-run output. Every step should show `○ (dry-run)` with the
correct `openclaw` command.

### 7. Run the installer (real)

```bash
node scripts/install.mjs --docker --non-interactive \
  --ollama-url http://192.168.68.116:11434 \
  --ollama-model qwen3:14b
```

Watch for errors. The installer will report `✓` or `✗` for each step.

### 8. Verify installation

```bash
docker compose -f ../../docker-compose.openclaw.yml run --rm -T openclaw-cli agents list --bindings
docker compose -f ../../docker-compose.openclaw.yml run --rm -T openclaw-cli plugins list
docker compose -f ../../docker-compose.openclaw.yml run --rm -T openclaw-cli cron list
docker compose -f ../../docker-compose.openclaw.yml run --rm -T openclaw-cli config get plugins.slots.memory
docker compose -f ../../docker-compose.openclaw.yml run --rm -T openclaw-cli config get plugins.entries.openclaw-engram.config
```

## Exit criteria

All of these must pass:

- [ ] Gateway running in Docker
- [ ] `openclaw agents list` shows: studio-ops, studio-ops-orchestrator, listing-drafter, offer-monitor, software-engineer
- [ ] `openclaw plugins list` shows: aura-pulse (enabled), openclaw-engram (enabled), lobster (enabled)
- [ ] `openclaw cron list` shows: Morning Brief (0 7 * * *)
- [ ] `openclaw config get plugins.slots.memory` returns `openclaw-engram`
- [ ] `openclaw config get plugins.entries.openclaw-engram.config.lcmEnabled` returns `true`
- [ ] `openclaw config get tools.agentToAgent.enabled` returns `true` when sub-agents are installed
- [ ] `openclaw config get tools.agentToAgent.allow --json` includes `studio-ops`, `studio-ops-orchestrator`, and each installed worker
- [ ] PARA directories exist under Aura root (`.aurora/projects/studio-ops`, `.aurora/projects/studio-ops/areas/inventory`, etc.)
- [ ] Workspace files exist (`AGENTS.md`, `BOOTSTRAP.md`, `HEARTBEAT.md`, `USER.md`, etc.)
- [ ] Orchestrator + worker workspaces contain only `AGENTS.md` and `TOOLS.md`
- [ ] `openclaw plugins doctor` passes
- [ ] `openclaw health` passes

## Likely issues

- **CLI command syntax mismatch** — OpenClaw CLI may expect slightly
  different argument format than what `install.mjs` sends. Fix in
  `install.mjs` and re-run.
- **Plugin path resolution** — `aura-pulse` local install path may not
  resolve correctly inside Docker. Check the `--docker` compose path.
- **Engram install** — `@joshuaswarren/openclaw-engram --pin` may need
  the exact npm spec format OpenClaw expects. Check `openclaw plugins
  install --help`.
- **Config set quoting** — JSON values passed via CLI may need different
  quoting depending on shell escaping through Docker.

## Handoff to C2

Once all exit criteria pass, note:
- The exact Docker compose prefix for CLI commands (for reference)
- Any installer fixes made (file + line numbers)
- Whether Engram doctor reported any warnings
- The workspace root path where files were copied

C2 only needs to start Pulse and open it in a browser. No more CLI work.
