# Blueprint: Repeat Buyer Tracker

## Trigger

The agent notices the same buyer username appearing in multiple offers or
transactions. Suggest this when:
- Engram recall returns 3+ interactions with the same buyer
- The owner asks "have I sold to this person before?"
- Morning brief data shows repeat buyer patterns

## Description

Builds a tracking script that maintains a buyer profile database in PARA.
Each buyer gets a markdown file with purchase history, offer patterns,
preferred categories, and average spend. The agent uses this data to
enrich offer surfaces with buyer context.

## Build Spec

Build a Node.js utility with the following structure:

```
projects/builds/repeat-buyer-tracker/
├── tracker.js         — buyer profile CRUD operations
├── migrate.js         — seed from Engram entity data
├── package.json       — minimal dependencies
└── README.md          — usage instructions
```

tracker.js exports functions:
- `recordInteraction(buyerId, platform, type, details)` — logs an offer,
  sale, or message to the buyer's profile
- `getBuyerProfile(buyerId)` — returns the full profile
- `getTopBuyers(limit)` — returns buyers sorted by interaction count
- `getBuyersByPlatform(platform)` — filter by marketplace

Buyer profiles are stored as markdown files in
`areas/buyer-patterns/{buyer-id}.md` with YAML frontmatter:

```yaml
---
buyer_id: vintage_lover_22
platforms: [poshmark, mercari]
first_interaction: 2026-03-15
total_purchases: 3
total_spend: 142.00
avg_offer_ratio: 0.78
preferred_categories: [vintage-denim, jewelry]
---
```

migrate.js reads existing Engram entity data via `memory_entities` to
seed initial profiles. Run once after install.

The agent calls tracker.js functions before surfacing offer decisions to
enrich the context with buyer history.

## Output

- `projects/builds/repeat-buyer-tracker/` — utility directory
- Buyer profiles in `areas/buyer-patterns/` (PARA)

## Dependencies

- Engram plugin (for initial migration and ongoing entity data)
- `aura_fs_*` tools (for reading/writing buyer profiles)
