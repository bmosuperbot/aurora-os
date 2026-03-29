#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
. "$SCRIPT_DIR/openclaw-docker-env.sh"

pnpm --dir "$AURA_PULSE_ROOT/packages/openclaw-plugin" run build:standalone
rm -rf "$OPENCLAW_WORKSPACE_DIR/openclaw-plugin-standalone"
mkdir -p "$OPENCLAW_WORKSPACE_DIR"
rsync -a "$AURA_PULSE_ROOT/dist/openclaw-plugin-standalone/" "$OPENCLAW_WORKSPACE_DIR/openclaw-plugin-standalone/"
node "$SCRIPT_DIR/configure-openclaw-docker-runtime.mjs"

services="openclaw-gateway"
if [ "${AURA_DOCKER_INCLUDE_PULSE:-0}" = "1" ]; then
	services="$services aura-pulse-pwa"
fi

docker compose -f "$AURA_PULSE_ROOT/docker-compose.openclaw.yml" up -d $services

echo "OpenClaw Control UI: http://127.0.0.1:${OPENCLAW_GATEWAY_PORT}/"
echo "Aura Pulse websocket: ws://127.0.0.1:${OPENCLAW_PULSE_WS_PORT}/aura/surface"
if [ "${AURA_DOCKER_INCLUDE_PULSE:-0}" = "1" ]; then
	echo "Aura Pulse UI: http://127.0.0.1:${OPENCLAW_PULSE_UI_PORT}/"
fi