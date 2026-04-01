# Blueprint: Batch Listing Generator

## Trigger

The owner has multiple items to list and creating them one at a time is
slow. Suggest this when:
- The owner says "I have a bunch of stuff to list"
- More than 3 listing-draft contracts are created in a single session
- The owner asks about bulk or batch listing

## Description

Builds a batch listing tool that takes a CSV or structured input (item
name, category, condition, measurements, price) and generates listing
drafts for multiple items at once. Each draft follows the listing-drafter
worker's style and gets written to the PARA projects directory for review.

## Build Spec

Build a Node.js utility:

```
projects/builds/batch-listing-generator/
├── generator.js       — reads input, generates drafts
├── templates/         — platform-specific listing templates
│   ├── etsy.md
│   ├── poshmark.md
│   └── mercari.md
├── example-input.csv  — sample input format
├── package.json
└── README.md
```

generator.js accepts:
- A CSV file path with columns: item_name, category, condition,
  measurements, asking_price, platform, notes
- OR a JSON array of item objects

For each item, it:
1. Selects the platform template
2. Generates a listing title (hook format: era + brand + material + type)
3. Fills in the template with item details
4. Writes the draft to `projects/listing-{slug}.md`
5. Returns a summary of all generated drafts

Templates follow the listing-drafter worker's style guide:
- Descriptive but concise
- Lead with the hook
- Include measurements (or flag as needed)
- 8-12 relevant search tags

The owner reviews each draft individually via the normal listing-draft
contract flow.

## Output

- `projects/builds/batch-listing-generator/` — tool directory
- Generated drafts in `projects/` (one per item)

## Dependencies

- `aura_fs_*` tools (for writing drafts)
- No external APIs required
