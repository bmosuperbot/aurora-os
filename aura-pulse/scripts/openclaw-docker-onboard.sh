#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
. "$SCRIPT_DIR/openclaw-docker-env.sh"

docker compose -f "$AURA_PULSE_ROOT/docker-compose.openclaw.yml" run --rm --no-deps --entrypoint node openclaw-gateway dist/index.js onboard --mode local --no-install-daemon "$@"