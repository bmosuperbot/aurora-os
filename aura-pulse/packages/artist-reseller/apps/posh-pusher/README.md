# posh-pusher

Reference Aura app scaffold for monitoring Poshmark offers.

Expected environment variables:

- `PORT`: Local HTTP port for the watcher service.
- `AURA_GATEWAY_URL`: Base URL of the OpenClaw gateway.
- `AURA_HOOK_PATH`: Hook path used for wake notifications.
- `OPENCLAW_HOOK_TOKEN`: Bearer token for gateway hook auth.

Runtime behavior:

1. Lobster detects a new offer.
2. The app posts the normalized payload to `/notify`.
3. The server forwards the payload to the configured OpenClaw hook.