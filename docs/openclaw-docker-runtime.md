# Supported OpenClaw Docker Runtime

This project should use a repo-owned wrapper around OpenClaw's supported Docker flow for long-lived Aura integration testing.

Use this runtime when you want:

- a persistent OpenClaw gateway
- one-time onboarding instead of redoing setup on every test run
- isolation from the real `~/.openclaw` on the host machine
- a path that still matches upstream OpenClaw Docker conventions
- no second checkout of the upstream OpenClaw repo just to run the gateway

Preferred development mode for now:

- keep OpenClaw in Docker
- keep Aura Pulse on localhost during heavy UI development
- use the Dockerized Pulse UI only for later end-to-end container validation

Do not use the Phase 5 test container for this. That container is intentionally throwaway and exists only to run the Aura test suite in isolation.

## Runtime Shape

The supported setup now lives in this repo under `aura-pulse/` and uses the published OpenClaw image plus the documented manual Docker flow:

- compose file: `aura-pulse/docker-compose.openclaw.yml`
- onboarding wrapper: `aura-pulse/scripts/openclaw-docker-onboard.sh`
- startup wrapper: `aura-pulse/scripts/openclaw-docker-up.sh`

It persists state outside the container with bind mounts:

- `OPENCLAW_CONFIG_DIR` bind-mounts to `/home/node/.openclaw`
- `OPENCLAW_WORKSPACE_DIR` bind-mounts to `/home/node/.openclaw/workspace`

That means onboarding only needs to happen once as long as those paths stay in place.

## Recommended Layout

Use dedicated Aura-owned state paths inside this repo so the runtime cannot touch the user's live OpenClaw install and does not depend on a second OpenClaw checkout.

```bash
cd aura-pulse

cp .env.openclaw.example .env.openclaw   # optional reference only

export OPENCLAW_IMAGE="ghcr.io/openclaw/openclaw:2026.3.24"
export OPENCLAW_CONFIG_DIR="$PWD/.openclaw-docker/config"
export OPENCLAW_WORKSPACE_DIR="$PWD/.openclaw-docker/workspace"

sh ./scripts/openclaw-docker-onboard.sh
sh ./scripts/openclaw-docker-up.sh
```

OpenClaw's Docker guide is the source of truth:

- `https://docs.openclaw.ai/install/docker`
- `https://docs.openclaw.ai/providers/ollama`

## Remote Ollama

For Aura, use the recommended native Ollama API path during onboarding or explicit config.

Current verified reachable host:

```text
http://192.168.68.116:11434
```

Recommended provider config shape:

```json5
{
  models: {
    providers: {
      ollama: {
        baseUrl: "http://192.168.68.116:11434",
        apiKey: "ollama-local",
        api: "ollama"
      }
    }
  }
}
```

Notes:

- The endpoint was verified from the host with `curl http://192.168.68.116:11434/api/tags`.
- OpenClaw docs recommend the native Ollama API for reliable tool calling.
- If a specific deployment needs the OpenAI-compatible `/v1` mode, treat that as an explicit exception rather than the default Aura path.

## One-Time Onboarding

Run interactive onboarding through the repo-owned wrapper:

```bash
cd aura-pulse
sh ./scripts/openclaw-docker-onboard.sh
```

If you want a scripted first boot, run the documented manual onboarding command through the same compose wrapper:

```bash
docker compose -f docker-compose.openclaw.yml run --rm --no-deps --entrypoint node openclaw-gateway \
  dist/index.js onboard --mode local --non-interactive --no-install-daemon \
  --auth-choice ollama \
  --custom-base-url "http://192.168.68.116:11434" \
  --custom-model-id "qwen3:14b" \
  --accept-risk
```

The wrapper does not replace upstream conventions. It packages the documented manual flow into this repo while still using the published image and persistent bind mounts.

The image is pinned on purpose. Do not default this runtime to `latest`, because upstream image changes can break the validation environment unexpectedly. Update the pinned tag intentionally when you want to move forward.

After onboarding, keep the gateway up:

```bash
sh ./scripts/openclaw-docker-up.sh
```

## Day-To-Day Commands

From `aura-pulse/`:

```bash
docker compose -f docker-compose.openclaw.yml ps
docker compose -f docker-compose.openclaw.yml logs -f openclaw-gateway
docker compose -f docker-compose.openclaw.yml exec -T openclaw-gateway openclaw dashboard --no-open
docker compose -f docker-compose.openclaw.yml exec -T openclaw-gateway openclaw models status
docker compose -f docker-compose.openclaw.yml stop openclaw-gateway
sh ./scripts/openclaw-docker-up.sh
```

To start the Pulse UI in Docker too:

```bash
cd aura-pulse
AURA_DOCKER_INCLUDE_PULSE=1 sh ./scripts/openclaw-docker-up.sh
```

Or directly through compose:

```bash
docker compose -f docker-compose.openclaw.yml --profile pulse-ui up -d openclaw-gateway aura-pulse-pwa
```

## Aura Boundary

The supported persistent OpenClaw runtime is the target environment for Aura integration, but Aura is not fully installable there yet.

That packaging blocker is now addressed through a generated standalone bundle.

## Standalone Aura Bundle

Build the current standalone Aura plugin bundle from `aura-pulse/`:

```bash
pnpm --filter @aura/aura-pulse build:standalone
```

Output:

```text
aura-pulse/dist/openclaw-plugin-standalone
```

This bundle now includes:

- a portable dependency tree created with `pnpm deploy --legacy --prod`
- a self-alias for `@aura/aura-pulse`
- vendored `artist-reseller` package assets under `vendor/artist-reseller/`
- vendored `contract-runtime` package assets under `vendor/contract-runtime/`

The repo-owned Docker wrapper syncs the freshly built standalone bundle into the isolated global OpenClaw extensions directory and configures OpenClaw to load Aura from:

```text
/home/node/.openclaw/extensions/aura-pulse
```

The startup wrapper refreshes that path from the current checkout before `docker compose up`:

```text
$OPENCLAW_CONFIG_DIR/extensions/aura-pulse
```

That keeps the repo-owned runtime self-contained, avoids duplicate plugin registration, and no longer requires a separate upstream repo checkout just to host Docker Compose.

## Pulse Websocket And UI Ports

The repo-owned wrapper publishes the Aura Pulse websocket directly:

- host `28790` -> container `7700`

The optional Dockerized Pulse UI is also available:

- host `4175` -> container `4175`

That removes the temporary manual bridge/forwarder that was previously needed for browser testing.

The Dockerized Pulse UI does not negate running Pulse in Docker. It gives you both options:

- run Pulse on the host during fast UI iteration
- or run Pulse in the same Docker stack when you want a tighter end-to-end environment

## Connector State In The Isolated Runtime

Current validated state in the isolated runtime:

- Gmail preset configured in isolated `openclaw.json`
- Gmail account configured as `studio-ops@gmail.com`
- Aura connector table marks Gmail as `active`
- Etsy remains `not-offered` until a real credential is supplied

Important nuance:

- Gmail being `active` here proves the safe isolated runtime is wired for the Gmail path at the Aura/OpenClaw config layer
- it does not by itself prove that a full live Gmail send/watch/auth flow has been exercised end to end

## Manual Smoke

Use the current preflight and smoke docs before manual testing:

```bash
pnpm --filter @aura/aura-pulse demo:artist
```

Then follow:

- `docs/openclaw-manual-smoke.md`

## Safety Rules

- Do not point this runtime at the host `~/.openclaw`
- Do not reuse the user's existing workspace paths
- Keep Aura bootstrap opt-in only
- Treat this repo-owned runtime and the user's personal OpenClaw install as separate systems