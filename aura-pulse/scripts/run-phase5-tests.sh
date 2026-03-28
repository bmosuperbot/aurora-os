#!/bin/sh
set -eu

pnpm --filter @aura/aura-pulse exec vitest run \
  tests/unit/config.test.js \
  tests/unit/registry-bootstrap.test.js \
  tests/unit/trigger-bootstrap.test.js \
  tests/unit/contract-executor.test.js \
  tests/unit/tool-loader.test.js \
  tests/integration/completion-bridge.test.js \
  tests/integration/service-boot.test.js \
  tests/integration/cli-smoke.test.js \
  tests/integration/websocket.test.js \
  tests/integration/artist-reseller-e2e.test.js \
  tests/integration/complete-requires-integration.test.js \
  tests/integration/executor-e2e.test.js

pnpm --filter @aura/contract-runtime exec vitest run \
  tests/integration/terminal-cleanup.test.js \
  tests/integration/ttl-expiry.test.js \
  tests/integration/resolver-timeout.test.js

pnpm --filter @aura/aura-pulse typecheck
pnpm --filter @aura/contract-runtime typecheck