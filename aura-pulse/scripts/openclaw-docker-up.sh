#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
. "$SCRIPT_DIR/openclaw-docker-env.sh"

pnpm --dir "$AURA_PULSE_ROOT/packages/openclaw-plugin" run build:standalone
rm -rf "$OPENCLAW_CONFIG_DIR/extensions/aura-pulse"
rm -rf "$OPENCLAW_WORKSPACE_DIR/openclaw-plugin-standalone"
mkdir -p "$OPENCLAW_CONFIG_DIR/extensions"
rsync -a "$AURA_PULSE_ROOT/dist/openclaw-plugin-standalone/" "$OPENCLAW_CONFIG_DIR/extensions/aura-pulse/"
node "$SCRIPT_DIR/configure-openclaw-docker-runtime.mjs"

services="openclaw-gateway"
if [ "${AURA_DOCKER_INCLUDE_PULSE:-0}" = "1" ]; then
	services="$services aura-pulse-pwa"
fi

docker compose -f "$AURA_PULSE_ROOT/docker-compose.openclaw.yml" up -d $services

dashboard_url=""
for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do
	dashboard_url=$(
		docker compose -f "$AURA_PULSE_ROOT/docker-compose.openclaw.yml" exec -T openclaw-gateway openclaw dashboard --no-open 2>/dev/null \
		| sed -n "s|^Dashboard URL: http://127.0.0.1:18789|http://127.0.0.1:${OPENCLAW_GATEWAY_PORT}|p"
	)
	if [ -n "$dashboard_url" ]; then
		break
	fi
	sleep 2
done

if [ -n "$dashboard_url" ]; then
	echo "OpenClaw Dashboard: $dashboard_url"
else
	echo "OpenClaw Gateway: http://127.0.0.1:${OPENCLAW_GATEWAY_PORT}/"
fi
echo "Aura Pulse websocket: ws://127.0.0.1:${OPENCLAW_PULSE_WS_PORT}/aura/surface"
if [ "${AURA_DOCKER_INCLUDE_PULSE:-0}" = "1" ]; then
	echo "Aura Pulse UI: http://127.0.0.1:${OPENCLAW_PULSE_UI_PORT}/"
fi