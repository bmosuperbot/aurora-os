# Aura Pulse UI Redesign Brief

## Context

Aura Pulse is the PWA frontend for Aurora OS. It displays structured "surfaces" pushed by an AI agent via WebSocket. The agent uses the `aura_surface` tool to describe business interfaces (dashboards, drafts, decision cards) using flat section objects. A compiler converts these to A2UI components which Pulse renders.

The current UI is placeholder quality — built for testing the agent pipeline, not for real use. Everything below needs proper design and implementation.

## Architecture

```
Agent (qwen3:14b via OpenClaw)
  → calls aura_surface(sections=[...])
    → Plugin compiles to A2UI components (Column, Text, MetricGrid, DataTable, ActionButton)
      → Pushed via WebSocket as kernel_surface message
        → Pulse PWA renders the surface card
          → Action buttons send surface_action messages back → agent receives callback
```

## Key Files

| File | Purpose |
|------|---------|
| `packages/pulse-pwa/` | The Pulse PWA (Vite + React) |
| `packages/pulse-pwa/src/surface/WorkspaceSurface.tsx` | Current surface renderer |
| `packages/pulse-pwa/src/a2ui/aura-catalog.tsx` | A2UI component catalog (MetricGrid, DataTable, ActionButton, Text) |
| `packages/pulse-pwa/src/ws/protocol.ts` | WebSocket protocol types (KernelSurface, A2UI messages, SurfaceAction) |
| `packages/pulse-pwa/src/ws/client.ts` | WebSocket client (connect, send, receive) |
| `packages/openclaw-plugin/src/tools/aura-surface.js` | Tool that compiles sections → A2UI components |

## What Currently Works

- Agent sends `aura_surface` tool calls with section types: `heading`, `text`, `metrics`, `table`, `action`
- Plugin compiles to A2UI components: `Column`, `Text`, `MetricGrid`, `DataTable`, `ActionButton`
- Pushed via WebSocket as `kernel_surface` messages to Pulse
- Pulse renders surfaces as cards with MIN/FIT/MAX/HIDE controls
- Action buttons send `surface_action` messages back to the agent
- Multi-step flows work (e.g., inquiry → draft → edit → confirm → done)
- Action context is populated on every button (account, amount, etc.)

## What Needs Redesigning

### Surface Cards
- Overall card layout, spacing, typography
- Card chrome (header, controls, collapse/expand)
- Surface stacking when multiple surfaces are visible

### Metric Tiles
- MetricGrid rendering (currently basic bordered boxes)
- Tone-based coloring (positive/warning/critical)
- Responsive grid layout

### Data Tables
- DataTable styling and responsiveness
- Mobile-friendly table alternatives (card view?)

### Action Buttons
- Button styling, primary/secondary variants
- Button grouping and layout
- Loading/pending states during agent response

### Text Sections
- Body text, draft displays, formatted content
- Heading hierarchy

### Overall Shell
- App shell / layout (header, surface area, input)
- Dark mode (currently dark, needs polish)
- Mobile-first responsive design (it's a PWA)
- Surface transitions / animations

### Missing Components
- No `text-input` section type yet (needed for inline editing)
- No toast/notification system
- No loading indicators while agent processes

## Test Harness

A CLI test harness exists at `scripts/pulse-test-harness.py` for testing the full pipeline without manual interaction.

```bash
# Activate the venv first
cd aura-pulse
source .venv/bin/activate

# One-shot command test
python scripts/pulse-test-harness.py send "How are sales?"

# Run a multi-step flow
python scripts/pulse-test-harness.py run heart-coffee --no-reset

# Playwright visual screenshot (captures chat + Pulse)
python scripts/pulse-test-harness.py visual

# Interactive mode
python scripts/pulse-test-harness.py interactive
```

## Sample Data Shape

The agent produces surfaces like this (from the Heart Coffee flow):

**Step 1 — Status inquiry:**
- Surface ID: `heart-coffee-overdue`
- Title: "Heart Coffee — $620 Overdue"
- Sections: heading + metrics ($620, 14 days) + action button ("Send Payment Reminder")

**Step 2 — Draft:**
- Title: "Heart Coffee — Draft Payment Reminder"
- Sections: heading + text (full email draft) + 2 action buttons ("Looks good — I'll send it", "Edit draft")

**Step 3 — Sent confirmation:**
- Title: "Heart Coffee — Payment Reminder Sent"
- Sections: heading + text (confirmation) + 2 action buttons ("Set 3-day follow-up", "Done")

## Previous Chat Reference

The agent testing work that produced this brief is in the chat history. The relevant conversation covers prompt engineering for `AGENTS.md`, `aura_surface` tool evolution, empty context fixes, state advancement fixes, and the test harness build.
