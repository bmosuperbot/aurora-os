---
name: aura-surface-ui
description: Show information in Aura Pulse as a structured interface. Use when asked to display tables, KPI tiles, dashboards, summaries, sales views, inbox overviews, or any business data in Pulse instead of plain chat. Also use when an owner asks a question that warrants a visual answer, when a contract completes and a summary panel would help, or when the agent wants to offer an interactive action button to the owner.
---

# Aura Surface UI

Use this skill when the agent should present information in Aura Pulse as structured UI instead of a text-only reply.

## Primary Tool: aura_surface

Call `aura_surface` to show business information in Pulse. Describe what you want to display using the `sections` array. The tool handles all Pulse formatting automatically - you never write wire-format JSON.

### Standard Surface Metadata

For current Aura business packages, treat these as the standard surface fields alongside `surface_id`, `title`, and `sections`:

- `voice_line` - one short spoken summary line. This is required by the current `aura_surface` tool contract.
- `icon` - a short chip label such as `MB`, `OF`, or `SS`
- `surface_type` - usually `workspace`, `attention`, `monitor`, `brief`, or `plan`
- `priority` - `low`, `normal`, or `high`

Current Aura agent prompts also rely on `icon`, `surface_type`, and `priority`. Include them unless the package prompt explicitly says otherwise.

### Section Types

Each entry in `sections` must have a `type` field. Available types:

| type | Use for |
|---|---|
| `heading` | A title or section label. Requires `text`. |
| `text` | A paragraph or body line. Requires `text`. |
| `metrics` | KPI tiles. Requires `items` array with `id`, `label`, `value`. Optional `title`, `detail`, `tone`. |
| `table` | A data grid. Requires `columns` (each with `id`, `label`) and `rows` (objects with matching keys plus `id`). Optional `title`, `caption`. |
| `action` | A button. Requires `label` and `action_id`. Optional `style` (`primary` or `secondary`) and `context` (small primitive payload). |
| `editor` | An editable draft box. Requires `defaultValue`, `submitLabel`, `action_id`, and `context`. |

### Minimal Example

```json
{
  "surface_id": "sales-last-week",
  "title": "Sales Last Week",
  "sections": [
    { "type": "heading", "text": "Sales performance for last week" },
    {
      "type": "metrics",
      "title": "Overview",
      "items": [
        { "id": "revenue", "label": "Revenue", "value": "$482", "detail": "+12% vs prior week", "tone": "positive" },
        { "id": "orders", "label": "Orders", "value": 3 }
      ]
    },
    {
      "type": "table",
      "title": "Closed orders",
      "caption": "Newest first",
      "columns": [
        { "id": "order", "label": "Order" },
        { "id": "buyer", "label": "Buyer" },
        { "id": "gross", "label": "Gross", "align": "right" }
      ],
      "rows": [
        { "id": "r1", "order": "A-104", "buyer": "Alex", "gross": "$182" },
        { "id": "r2", "order": "A-103", "buyer": "Mina", "gross": "$160" }
      ]
    },
    { "type": "action", "label": "Inspect A-104", "action_id": "inspect_order", "style": "secondary", "context": { "orderId": "A-104" } }
  ]
}
```

### Workflow

1. Choose a stable `surface_id` that describes the view.
2. Choose the matching surface metadata: `voice_line`, `icon`, `surface_type`, and `priority`.
3. Build a `sections` array describing what the owner should see.
4. Call `aura_surface` with the `surface_id`, metadata fields, and `sections`.
5. **Once aura_surface succeeds, you are DONE.** Reply with a brief summary of what you displayed (e.g. "Here's your sales summary - showing revenue, orders, and recent transactions."). Do NOT call any other tools after a successful surface render unless the owner explicitly asks for more.
6. When the owner clicks an action button, Pulse sends the `action_id` and `context` back as a surface action event. Handle it and call `aura_surface` again to update the view if needed.
7. When the view is no longer needed, clear or replace it using the tools available in the current package. Only call `aura_clear_surface` if that tool is actually available to the agent.

### Rules

- **After a successful `aura_surface` call, STOP. Reply to the owner and wait.** Do not read files, run commands, call other tools, or do follow-up work unless the owner asks.
- Use `aura_surface` for informative or exploratory UI. Do not use it for approvals or tracked workflow state - those belong in contracts.
- Keep one logical view per `surface_id`. Update it by calling `aura_surface` again with the same id.
- Use a `heading` section for the top-level title so the panel has visual structure.
- Valid metric tones in current Aura UI are `default`, `positive`, `negative`, `warning`, `info`, and `critical`.
- Keep `action` context small: identifiers and short primitives only.
- For `table` rows, pre-format currency and dates yourself (e.g. `"$182"` not `182`). Do not rely on client-side formatting.
- Read the `references/components.md` file only if you need the advanced `aura_render_surface` path.

---

## Advanced Tool: aura_render_surface

Use `aura_render_surface` only when `aura_surface` cannot express what you need - for example, a layout that requires custom A2UI components not available as section types.

When you use `aura_render_surface`, read `references/components.md` first for exact JSON shapes.

Critical contract for `aura_render_surface`:
- `a2ui_messages` must be a native array value - not a quoted JSON string.
- Send the standard trio in order: `surfaceUpdate` -> `dataModelUpdate` -> `beginRendering`.
- Each entry must be a real protocol object like `{ "surfaceUpdate": { ... } }`.
- Do not use wrapper shapes like `{ "type": "a2ui.surfaceUpdate", "data": { ... } }`.
- Use `Text.text: { "literalString": "..." }`, not `Text.value`.
- `beginRendering` must include `surfaceId`, `root`, and `catalogId`.
