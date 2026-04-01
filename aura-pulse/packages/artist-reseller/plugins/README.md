# Package Plugins

This directory is reserved for future `artist-reseller` package-owned OpenClaw plugins.

Guidelines:

- Keep package-deliverable plugins inside this directory so the package remains self-contained.
- Prefer manifest-relative paths for package-owned plugin bundles.
- Shared platform plugins like `aura-pulse` can still live outside the package when they are owned by the wider Aura platform.
- If a future plugin is specific to the artist reseller domain, install it from here and keep its config deterministic in `aurora.manifest.yaml`.
