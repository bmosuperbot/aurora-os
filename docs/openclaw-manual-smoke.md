# OpenClaw Manual Smoke

This is the current manual smoke path for Aura against the isolated Docker OpenClaw runtime.

Use this after the standalone bundle has been built and the isolated runtime has been pointed at it.

---

## Preconditions

From `aura-pulse/`:

```bash
pnpm --filter @aura/aura-pulse build:standalone
pnpm --filter @aura/aura-pulse demo:artist
```

What that preflight confirms:

- OpenClaw is healthy on `http://127.0.0.1:28789`
- Aura is loading from `/home/node/.openclaw/extensions/aura-pulse`
- the isolated runtime has the Gmail preset configured for `studio-ops@gmail.com`
- the Aura connector table shows Gmail as `active`

If the preflight fails, do not continue to manual testing. Fix the runtime first.

---

## Current Isolated Runtime

The validated isolated runtime used in this repo lives at:

- repo-owned wrapper: `aura-pulse/docker-compose.openclaw.yml`
- isolated config: `aura-pulse/.openclaw-docker/config/openclaw.json`
- isolated workspace: `aura-pulse/.openclaw-docker/workspace`
- gateway URL: `http://127.0.0.1:28789`
- Pulse websocket: `ws://127.0.0.1:28790/aura/surface`
- preferred local Pulse UI: `http://127.0.0.1:4175`

The current plugin load path is:

```text
/home/node/.openclaw/extensions/aura-pulse
```

That is the path the next agent should assume unless it is explicitly changed.

---

## Important Limitations

- Gmail is active at the Aura connector-state layer because the isolated OpenClaw config now includes the Gmail preset and account.
- This is sufficient for Aura-side routing and connector-state validation.
- It does **not** prove that a real Gmail send/watch flow has completed successfully end to end.
- Etsy is still inactive in the isolated runtime, so `aura_query_listing` will not be registered until a real Etsy credential is supplied.

---

## Smoke Checklist

1. Open the containerized Control UI at `http://127.0.0.1:28789`.
2. Confirm the page connects successfully and stays connected.
3. Confirm the gateway logs show Aura starting from the standalone bundle without plugin load errors.
4. Confirm Gmail is the active Aura connector and Etsy is still inactive unless intentionally configured.
5. Use the agent to create a real or synthetic `offer-received` contract through the supported current path.
6. Resolve the contract from the decision surface.
7. Confirm the contract moves to `executing` and the executor wake is recorded.
8. Confirm `aura_complete_contract` does not allow completion until required actions have been logged.
9. Confirm the contract reaches `complete` and appears in history.

---

## Current Recommended Scope

For the next chat, the best manual sequence is:

1. Keep the test focused on the isolated OpenClaw Control UI at `28789`.
2. Verify the executor and `complete_requires` loop first.
3. Treat Etsy as out of scope unless a real credential is intentionally added.
4. Treat full Gmail delivery as a separate follow-up verification unless the Gog/Gmail auth path is explicitly completed during that session.