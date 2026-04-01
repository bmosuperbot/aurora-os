# Aura Surface Components

## Standard Render Payload

Call `aura_render_surface` with `a2ui_messages` that look like this:

```json
[
  {
    "surfaceUpdate": {
      "surfaceId": "sales-last-week",
      "components": [
        {
          "id": "root",
          "component": {
            "Column": {
              "children": {
                "explicitList": ["headline", "metrics", "orders", "inspect"]
              }
            }
          }
        },
        {
          "id": "headline",
          "component": {
            "Text": {
              "text": {
                "literalString": "Sales performance for last week"
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
                {
                  "id": "revenue",
                  "label": "Revenue",
                  "value": "$482",
                  "detail": "+12% vs prior week",
                  "tone": "positive"
                },
                {
                  "id": "orders",
                  "label": "Orders",
                  "value": 3,
                  "detail": "2 Etsy, 1 direct"
                }
              ]
            }
          }
        },
        {
          "id": "orders",
          "component": {
            "DataTable": {
              "title": "Closed orders",
              "caption": "Newest first",
              "columns": [
                { "id": "order", "label": "Order" },
                { "id": "buyer", "label": "Buyer" },
                { "id": "channel", "label": "Channel" },
                { "id": "gross", "label": "Gross", "align": "right" }
              ],
              "rows": [
                { "id": "row-1", "order": "A-104", "buyer": "Alex", "channel": "Etsy", "gross": "$182" },
                { "id": "row-2", "order": "A-103", "buyer": "Mina", "channel": "Direct", "gross": "$160" },
                { "id": "row-3", "order": "A-102", "buyer": "Chris", "channel": "Etsy", "gross": "$140" }
              ]
            }
          }
        },
        {
          "id": "inspect",
          "component": {
            "ActionButton": {
              "label": "Inspect A-104",
              "actionId": "inspect_order",
              "style": "secondary",
              "actionContext": {
                "orderId": "A-104",
                "channel": "Etsy",
                "gross": 182
              }
            }
          }
        }
      ]
    }
  },
  {
    "dataModelUpdate": {
      "surfaceId": "sales-last-week",
      "contents": []
    }
  },
  {
    "beginRendering": {
      "surfaceId": "sales-last-week",
      "root": "root",
      "catalogId": "https://aura-os.ai/a2ui/v1/aura-catalog.json"
    }
  }
]
```

## Minimal Text + Button Payload

Use this when you need the simplest interactive Pulse surface that still follows the canonical A2UI shape.

```json
[
  {
    "surfaceUpdate": {
      "surfaceId": "pulse-visible-button-live",
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
                "literalString": "Visible button check"
              }
            }
          }
        },
        {
          "id": "cta",
          "component": {
            "ActionButton": {
              "label": "Visible Ack",
              "actionId": "visible_ack",
              "style": "primary"
            }
          }
        }
      ]
    }
  },
  {
    "dataModelUpdate": {
      "surfaceId": "pulse-visible-button-live",
      "contents": []
    }
  },
  {
    "beginRendering": {
      "surfaceId": "pulse-visible-button-live",
      "root": "root",
      "catalogId": "https://aura-os.ai/a2ui/v1/aura-catalog.json"
    }
  }
]
```

## Canonical Shape Rules

- `a2ui_messages` must be an array.
- `surfaceUpdate.components` must be an array, not an object map.
- Each component entry must look like:

```json
{
  "id": "headline",
  "component": {
    "Text": {
      "text": {
        "literalString": "Hello"
      }
    }
  }
}
```

- `dataModelUpdate.contents` should usually be an empty array for these Aura surfaces unless you are intentionally supplying data-model contents.
- `beginRendering.root` must match the root component id.

## Canonical Complex Planning Example

Use this shape for a richer planning surface with metrics, a table, and an action button.

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

## Wrong Complex Planning Shape

This is not canonical A2UI and should not be sent:

```json
[
  {
    "a2uiType": "surfaceUpdate",
    "data": {
      "components": {
        "headline": { "type": "Text", "valueText": "Tonight's grant search plan" },
        "metrics": { "type": "MetricGrid", "titleText": "Overview" },
        "action": { "type": "ActionButton", "labelText": "Open shortlist", "onClick": "runOpenShortlist" }
      }
    }
  }
]
```

## Aura Custom Components

### MetricGrid

Use for KPI tiles.

```json
{
  "MetricGrid": {
    "title": "Overview",
    "metrics": [
      {
        "id": "revenue",
        "label": "Revenue",
        "value": "$482",
        "detail": "+12% vs prior week",
        "tone": "positive"
      }
    ]
  }
}
```

Supported metric fields:

- `id`: required string
- `label`: required string
- `value`: required string or number
- `detail`: optional string
- `tone`: optional `default`, `positive`, `warning`, `critical`

### DataTable

Use for lists of business records.

```json
{
  "DataTable": {
    "title": "Closed orders",
    "caption": "Newest first",
    "columns": [
      { "id": "order", "label": "Order" },
      { "id": "gross", "label": "Gross", "align": "right" }
    ],
    "rows": [
      { "id": "row-1", "order": "A-104", "gross": "$182" }
    ],
    "emptyText": "No rows available."
  }
}
```

Supported table fields:

- `title`: optional string
- `caption`: optional string
- `emptyText`: optional string
- `columns`: required array of column definitions
- `rows`: required array of row objects

Column fields:

- `id`: required string key used to read each row value
- `label`: required string
- `align`: optional `left`, `center`, or `right`

### ActionButton

Use for explicit owner actions inside a rendered surface.

```json
{
  "ActionButton": {
    "label": "Inspect A-104",
    "actionId": "inspect_order",
    "style": "secondary",
    "actionContext": {
      "orderId": "A-104",
      "gross": 182,
      "priority": true
    }
  }
}
```

When clicked, Aura Pulse sends a surface action event back to the kernel with:

- `surfaceId`
- `actionName`
- `sourceComponentId`
- `context`

### DraftEditor

Use for owner-editable draft text such as counteroffers, buyer notifications, or listing revisions.

```json
{
  "DraftEditor": {
    "defaultValue": "Hello buyer, thanks for the offer.",
    "submitLabel": "Send revised draft",
    "actionId": "send-revised",
    "actionContext": {
      "listingId": "L-104",
      "platform": "Etsy"
    }
  }
}
```

When submitted, Aura Pulse sends the same small primitive `actionContext` values back plus the edited draft text in `context.draftText`.

## Authoring Notes

- Keep `surfaceId` stable while updating the same logical view.
- Use preformatted currency, dates, and percentages in `DataTable` rows.
- Do not send large nested objects in `actionContext`. Keep it to identifiers and small primitives.
- If you need a different view after an action, call `aura_render_surface` again with updated messages for the same `surface_id` or replace it with a new one.
