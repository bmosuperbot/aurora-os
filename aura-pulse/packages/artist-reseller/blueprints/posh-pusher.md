# Blueprint: Poshmark Offer Watcher

## Trigger

The owner sells on Poshmark but Poshmark has no public API. The agent
cannot monitor offers or check listing status without browser automation.
Suggest this when:
- The owner lists Poshmark as a platform during onboarding
- The agent receives a manually forwarded Poshmark offer email
- The owner asks "can you check my Poshmark offers?"

## Description

Builds a lightweight Fastify server that uses Lobster browser automation
to monitor the owner's Poshmark closet for new offers. When an offer is
detected, the app posts a normalized payload to the OpenClaw gateway hook,
which triggers the standard offer-received contract flow.

## Build Spec

Build a Fastify HTTP server with the following structure:

```
projects/builds/posh-pusher/
├── server.js          — Fastify app with /notify endpoint
├── watcher.js         — Lobster pipeline: login → closet → scan offers
├── package.json       — dependencies: fastify, node-cron
├── .env.example       — PORT, AURA_GATEWAY_URL, OPENCLAW_HOOK_TOKEN
└── README.md          — setup instructions
```

The watcher runs on a configurable interval (default: every 15 minutes).
It logs into Poshmark using stored credentials, navigates to the closet's
offer inbox, and compares against a local seen-offers cache (JSON file).
New offers are normalized to the offer-received contract schema:
- platform: "poshmark"
- listing_title, offer_amount, buyer_id extracted from the page
- listing_id derived from the closet URL

The /notify endpoint accepts the normalized payload and POSTs it to
`${AURA_GATEWAY_URL}${AURA_HOOK_PATH}` with Bearer token auth.

Use Lobster's pipeline format for the browser automation steps. The
pipeline should handle login failures gracefully (retry once, then report
error to the agent).

## Output

- `projects/builds/posh-pusher/` — complete app directory
- The app runs via `node server.js` or can be managed with pm2/docker

## Dependencies

- `lobster` plugin (bundled, should be enabled)
- Poshmark account credentials (owner provides during setup)
