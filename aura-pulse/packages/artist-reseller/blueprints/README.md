# Aurora Blueprints

Build blueprints are pre-written prompts that the agent can recommend and
execute when specific business situations arise. Each blueprint describes
**what** to build, **when** to suggest it, and **how** the software-engineer
worker should implement it.

## How it works

1. The agent recognizes a situation that matches a blueprint's trigger.
2. The agent surfaces a recommendation to the owner via `aura_surface`.
3. If approved, the agent delegates the blueprint to the orchestrator.
4. The orchestrator spawns the software-engineer worker with the build spec.
5. The worker builds the tool/app and announces the result.
6. The agent surfaces the completed build for the owner to review.

## Blueprint format

Each `.md` file in this directory is a blueprint. The agent reads them to
understand what it can offer to build. The format:

- **trigger** — when should the agent recommend this?
- **description** — what does it build, in plain language?
- **build_spec** — the detailed prompt for the software-engineer worker
- **output** — what gets created and where
- **dependencies** — what's needed (plugins, connectors, APIs)

## Adding blueprints

New blueprints can be added to any Aurora package. They're prompt content,
not code — the value is in the curated instructions. The software-engineer
worker does the building.
