# Supported OpenClaw Docker Runtime

This project should use OpenClaw's supported Docker flow for any long-lived Aura integration testing.

Use this runtime when you want:

- a persistent OpenClaw gateway
- one-time onboarding instead of redoing setup on every test run
- isolation from the real `~/.openclaw` on the host machine
- a path that matches upstream OpenClaw docs

Do not use the Phase 5 test container for this. That container is intentionally throwaway and exists only to run the Aura test suite in isolation.

## Runtime Shape

The supported setup lives in a separate checkout of the upstream OpenClaw repo and persists state outside the container:

- `OPENCLAW_CONFIG_DIR` bind-mounts to `/home/node/.openclaw`
- `OPENCLAW_WORKSPACE_DIR` bind-mounts to `/home/node/.openclaw/workspace`
- `OPENCLAW_HOME_VOLUME` optionally persists the rest of `/home/node`

That means onboarding only needs to happen once as long as those paths stay in place.

## Recommended Layout

Use a dedicated OpenClaw checkout and dedicated Aura state paths so the runtime cannot touch the user's live OpenClaw install.

```bash
git clone https://github.com/openclaw/openclaw.git ~/openclaw-aura
cd ~/openclaw-aura

mkdir -p "$HOME/Documents/openclaw-aura-state/config"
mkdir -p "$HOME/Documents/openclaw-aura-state/workspace"

export OPENCLAW_IMAGE="ghcr.io/openclaw/openclaw:latest"
export OPENCLAW_CONFIG_DIR="$HOME/Documents/openclaw-aura-state/config"
export OPENCLAW_WORKSPACE_DIR="$HOME/Documents/openclaw-aura-state/workspace"
export OPENCLAW_HOME_VOLUME="openclaw_aura_home"

./scripts/docker/setup.sh
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

Either run interactive onboarding in the OpenClaw repo root:

```bash
./scripts/docker/setup.sh
```

Or use OpenClaw's non-interactive Ollama onboarding if you want a scripted first boot:

```bash
docker compose run --rm --no-deps --entrypoint node openclaw-gateway \
  dist/index.js onboard --mode local --non-interactive --no-install-daemon \
  --auth-choice ollama \
  --custom-base-url "http://192.168.68.116:11434" \
  --custom-model-id "qwen3:14b" \
  --accept-risk
```

Use the setup script when you want the supported interactive path. Use the explicit
`onboard` command only when you need a scripted container bootstrap.

After onboarding, keep the gateway up:

```bash
docker compose up -d openclaw-gateway
```

## Day-To-Day Commands

From the OpenClaw repo root:

```bash
docker compose ps
docker compose logs -f openclaw-gateway
docker compose run --rm openclaw-cli dashboard --no-open
docker compose run --rm -T openclaw-cli models status
docker compose stop openclaw-gateway
docker compose up -d openclaw-gateway
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

The current isolated runtime is configured to load Aura from:

```text
/workspaces/aura-pulse/dist/openclaw-plugin-standalone
```

That means the container no longer depends on loading the plugin from the monorepo source package path.

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
- Treat the upstream runtime and the user's personal OpenClaw install as separate systems