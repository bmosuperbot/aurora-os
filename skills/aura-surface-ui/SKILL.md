---
name: aura-surface-ui
description: Render structured Aura Pulse interfaces with aura_render_surface, Aura custom components, and valid A2UI JSON. Use when asked to show tables, KPI tiles, dashboards, inbox summaries, sales views, text-plus-button panels, or interactive business UIs in Pulse instead of plain chat. Also use when asked to produce or validate surfaceUpdate/dataModelUpdate/beginRendering JSON, fix malformed aura_render_surface payloads, or wire button actions back into the OpenClaw kernel.
---

# Aura Surface UI

Use this skill when the agent should present information in Aura Pulse as structured UI instead of a text-only reply.

## Critical Contract

- When reading this skill or `references/components.md`, use the host `read` tool on the OpenClaw workspace path. Do not use `aura_fs_read`, `aura_fs_list`, or `aura_fs_search` for workspace skills, `AGENTS.md`, `HEARTBEAT.md`, or other files under `/home/node/.openclaw/workspace`.
- `aura_render_surface.a2ui_messages` must be an array.
- For a normal Aura Pulse render, send the standard trio in this order:
   1. `surfaceUpdate`
   2. `dataModelUpdate`
   3. `beginRendering`
- Each entry in `a2ui_messages` must be the real protocol object itself, such as `{ "surfaceUpdate": { ... } }`. Do not wrap messages in `{ "a2uiType": "surfaceUpdate", "data": { ... } }`.
- `surfaceUpdate.components` must be an array of objects shaped like `{ "id": "...", "component": { ... } }`.
- Component props must use canonical names such as `text`, `label`, `title`, `columns`, `rows`, and `actionId`. For built-in A2UI `Text`, use `text: { "literalString": "..." }`, not `value`. Do not invent variants like `valueText`, `labelText`, or `titleText`.
- Do not send ad hoc shapes such as `[{"type":"message","value":"...","actionLabel":"..."}]` unless you are intentionally relying on the frontend fallback path.
- Do not send `components` as an object map when you can avoid it. Prefer the canonical array shape.
- If you include an Aura `ActionButton`, always give it a stable `actionId`.
- If you only need one line of text and one button, still use valid A2UI unless the caller explicitly wants a fallback-only test.
- `beginRendering` must include `surfaceId`, `root`, and `catalogId`. Do not replace it with `{ "a2uiType": "beginRendering", "state": "success" }`.

## Workflow

1. Choose a stable `surface_id` that describes the view, such as `sales-last-week` or `inbox-summary`.
2. Build one A2UI surface with the standard message trio:
   - `surfaceUpdate`
   - `dataModelUpdate`
   - `beginRendering`
3. Prefer Aura business components for business data:
   - `MetricGrid` for KPI tiles
   - `DataTable` for rows and columns
   - `ActionButton` for direct owner actions
4. Call `aura_render_surface` with:
   - the same `surface_id`
   - optional `title`, `summary`, `voice_line`
   - `a2ui_messages`
5. If the owner acts on the rendered UI, Aura Pulse sends the action back to the kernel as a surface action event. Treat it as a direct owner interaction and update the surface or continue the task.
6. When the view is obsolete, call `aura_clear_surface` with the same `surface_id`.

## Minimal Valid Example

Use this exact structure for a simple text-plus-button interface:

```json
[
   {
      "surfaceUpdate": {
         "surfaceId": "pulse-live-test",
         "components": [
            {
               "id": "root",
               "component": {
                  "Column": {
                     "children": {
                        "explicitList": ["headline", "cta"]
                     }
                  }
               }
            },
            {
               "id": "headline",
               "component": {
                  "Text": {
                     "text": {
                        "literalString": "Pulse to agent round trip works."
                     }
                  }
               }
            },
            {
               "id": "cta",
               "component": {
                  "ActionButton": {
                     "label": "Acknowledge",
                     "actionId": "acknowledge_test",
                     "style": "primary"
                  }
               }
            }
         ]
      }
   },
   {
      "dataModelUpdate": {
         "surfaceId": "pulse-live-test",
         "contents": []
      }
   },
   {
      "beginRendering": {
         "surfaceId": "pulse-live-test",
         "root": "root",
         "catalogId": "https://aura-os.ai/a2ui/v1/aura-catalog.json"
      }
   }
]
```

## Canonical Complex Planning Example

Use this exact structure for a richer planning panel with metrics, a table, and one action button:

```json
[
   {
      "surfaceUpdate": {
         "surfaceId": "grant-radar-skill-test",
         "components": [
            {
               "id": "root",
               "component": {
                  "Column": {
                     "children": {
                        "explicitList": ["headline", "metrics", "table", "action"]
                     }
                  }
               }
            },
            {
               "id": "headline",
               "component": {
                  "Text": {
                     "text": {
                        "literalString": "Tonight's grant search plan"
                     }
                  }
               }
            },
            {
               "id": "metrics",
               "component": {
                  "MetricGrid": {
                     "title": "Overview",
                     "metrics": [
                        { "id": "opportunities", "label": "Opportunities", "value": 3, "detail": "3 active matches", "tone": "positive" },
                        { "id": "deadlines", "label": "Deadlines", "value": 2, "detail": "2 due this week", "tone": "warning" },
                        { "id": "confidence", "label": "Confidence", "value": "78%", "detail": "Based on current filters" }
                     ]
                  }
               }
            },
            {
               "id": "table",
               "component": {
                  "DataTable": {
                     "title": "Priority grants",
                     "columns": [
                        { "id": "program", "label": "Program" },
                        { "id": "deadline", "label": "Deadline" },
                        { "id": "fit", "label": "Fit" }
                     ],
                     "rows": [
                        { "id": "row-1", "program": "City Arts Fund", "deadline": "Apr 3", "fit": "High" },
                        { "id": "row-2", "program": "Regional Maker Grant", "deadline": "Apr 6", "fit": "Medium" }
                     ]
                  }
               }
            },
            {
               "id": "action",
               "component": {
                  "ActionButton": {
                     "label": "Open shortlist",
                     "actionId": "open_shortlist",
                     "style": "primary"
                  }
               }
            }
         ]
      }
   },
   {
      "dataModelUpdate": {
         "surfaceId": "grant-radar-skill-test",
         "contents": []
      }
   },
   {
      "beginRendering": {
         "surfaceId": "grant-radar-skill-test",
         "root": "root",
         "catalogId": "https://aura-os.ai/a2ui/v1/aura-catalog.json"
      }
   }
]
```

## Rules

- Use `aura_render_surface` for informative or exploratory UI only. Do not use it for approvals or deterministic workflow state that should be tracked as a contract.
- Keep one conceptual screen per `surface_id`.
- Use a `Column` root for most business views.
- Keep labels short and human-readable.
- For `DataTable`, preformat display strings yourself. Do not rely on client-side formatting.
- For `ActionButton`, pass lightweight primitive context only when possible: strings, numbers, booleans.
- If a button or action changes the screen, render a replacement surface instead of narrating the change only in text.

## Invalid Shapes

Do not send these when you intend a normal Aura Pulse render:

```json
{
   "surfaceUpdate": {
      "surfaceId": "bad-example",
      "components": {
         "root": {
            "Text": {
               "value": "Wrong shape"
            }
         }
      }
   }
}
```

```json
[
   {
      "type": "message",
      "value": "This is not valid A2UI",
      "actionLabel": "Fallback only"
   }
]
```

```json
[
   {
      "a2uiType": "surfaceUpdate",
      "data": {
         "components": {
            "headline": {
               "type": "Text",
               "valueText": "Wrong wrapper and wrong prop names"
            }
         }
      }
   },
   {
      "a2uiType": "beginRendering",
      "state": "success"
   }
]
```

## Component Set

- Aura custom components:
  - `MetricGrid`
  - `DataTable`
  - `ActionButton`
- Useful stock A2UI components:
  - `Column`
  - `Row`
  - `Text`
  - `Button`
  - `Card`
  - `List`
  - `Tabs`
  - `Divider`

Read [references/components.md](references/components.md) for exact JSON shapes and a complete example payload.