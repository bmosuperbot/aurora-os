# Blueprint: Sales Analytics Dashboard

## Trigger

The owner asks about sales trends, profitability, or performance over
time. Suggest this when:
- The owner asks "what's selling best?" or "how am I doing this month?"
- Weekly sales summaries show patterns worth deeper analysis
- The owner wants to compare platform performance

## Description

Builds a sales analytics script that reads transaction data from Engram
and PARA files, computes metrics (revenue trends, category performance,
platform comparison, sell-through rate, average days to sell), and outputs
structured data that the agent can surface via `aura_surface`.

## Build Spec

Build a Node.js utility:

```
projects/builds/sales-analytics/
├── analytics.js       — metric computation engine
├── formatters.js      — output formatters for aura_surface sections
├── package.json
└── README.md
```

analytics.js exports functions:
- `revenueByPeriod(startDate, endDate, groupBy)` — daily/weekly/monthly
  revenue with platform breakdown
- `categoryPerformance(period)` — which categories sell fastest and at
  the best margins
- `platformComparison(period)` — side-by-side platform metrics
- `sellThroughRate(category, period)` — items listed vs items sold
- `avgDaysToSell(category, platform)` — how long items sit before selling
- `topItems(period, limit)` — highest revenue items

Data sources:
- `memory_search` for transaction history
- `areas/inventory/` for current stock levels
- `aura_query_contracts` for offer resolution data

formatters.js converts analytics output into `aura_surface` section
arrays (metrics, tables, text summaries) that the agent can pass directly
to `aura_surface`.

## Output

- `projects/builds/sales-analytics/` — utility directory
- Agent calls analytics functions and surfaces results on demand

## Dependencies

- Engram plugin (primary data source)
- `aura_fs_*` tools (for inventory data)
- `aura_query_contracts` (for resolution history)
