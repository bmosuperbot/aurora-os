# Aura Pulse UI — Phase 5 Implementation Reference

status: complete  
date: March 31, 2026  
follows: `UI-REDESIGN-BRIEF.md`

---

## Overview

This document records what was built during the Phase 5 Pulse PWA UI redesign. The brief (`docs/UI-REDESIGN-BRIEF.md`) described the problems; this document describes the solutions. Future agents working on Phase 6+ should read this before touching any Pulse PWA files.

---

## Design Language

The redesign adopted a **"Sentient Architect / Luminous HUD"** aesthetic:

- **Foundation**: obsidian backgrounds (`--surface-bg`, `--card-bg`) with depth via radial gradients
- **Accent**: electric cyan (`--accent: #2dd4bf`) used sparingly for borders, glows, and active states
- **Typography**: `Inter` for UI, `Michroma` for brand marks, monospace for data
- **Materials**: glassmorphism everywhere — `backdrop-filter: blur()` with 1px luminous borders
- **Motion**: `surface-enter` scale-up + fade-in on card arrival; `surface-exit` on dismissal
- **Hover**: `box-shadow` glow micro-interactions on cards and buttons

CSS design tokens live in `packages/pulse-pwa/src/theme/aura.css` under `:root`.

---

## Architecture Changes

### State Persistence

- **Workspace layout** (panel positions, sizes, z-order, collapsed/dismissed state) persists to `localStorage` via a custom read/write in `WorkspaceSurface.tsx`.
- **Chat timeline entries** persist to `sessionStorage` in `CommandDock.tsx`. Stale `pending` entries are cleared on restore.
- **Store state** (`agentBusy`, `ttsEnabled`, surfaces) uses Zustand `persist` middleware with `sessionStorage`.

### Zustand Store additions (`surface-store.ts`)

| Field | Purpose |
|---|---|
| `agentBusy: boolean` | Set `true` on command submit, `false` when `kernel_surface` arrives |
| `ttsEnabled: boolean` | Whether the agent's `voice_line` is spoken aloud via Web Speech API |
| `setAgentBusy` | Action to toggle busy state |
| `setTtsEnabled` | Action to toggle TTS |

---

## Key Files

| File | What Changed |
|---|---|
| `packages/pulse-pwa/src/theme/aura.css` | Complete visual overhaul — all design tokens, card styles, topbar, tray pills, command pill, metric cards, data tables, buttons, draft editor, toast |
| `packages/pulse-pwa/src/surface/WorkspaceSurface.tsx` | Full rewrite — auto-tiling, drag-and-drop, multi-tier dismissal, topbar, tray, persistence |
| `packages/pulse-pwa/src/surface/CommandDock.tsx` | Full rewrite — floating pill, chat timeline, voice input, TTS, slash commands |
| `packages/pulse-pwa/src/a2ui/aura-catalog.tsx` | New components: `DraftEditor`; updated `DataTable` (grid layout), `ActionButton` (sent state) |
| `packages/pulse-pwa/src/assets/aurora-bars.tsx` | SVG animation components: `AuroraBarsStill`, `AuroraBarsLoading`, `AuroraBarsListen`, `AuroraBarsTalk` |
| `packages/pulse-pwa/src/surface/Toast.tsx` | Auto-dismissing toast notification component |
| `packages/openclaw-plugin/src/tools/aura-surface.js` | Added `negative` and `info` to `MetricItemSchema` tone union |
| `.openclaw-docker/workspace/AGENTS.md` | Updated with `voice_line`, `icon`, `editor` section type, metric tones, error handling instructions |

---

## WorkspaceSurface — Panel System

### Layout

Panels are `position: absolute` inside `.workspace-board { position: relative }`. Each panel stores `{ x, y, width, z, collapsed, dismissed, maximized }` in layout state.

**Auto-tiling**: `findOpenSlot()` scans a grid of column/row positions and places new panels in the first non-overlapping slot.

**Column calculation**:
```js
getColumns(boardWidth)  = floor((boardWidth - 12) / 392)
getPanelWidth(boardWidth) = min(380, floor((boardWidth - 24 - 12*(cols-1)) / cols))
```

**Width normalization**: whenever `bounds` changes (ResizeObserver), all visible non-maximized panels are normalized to `getPanelWidth(bounds.width)`. This prevents panels from having different widths if they were created at different viewport sizes or restored from a previous session.

**Compact mode**: `bounds.width < 760` switches to flex-column stacked layout (no absolute positioning, no drag).

### Drag System

Pointer events on the panel header initiate drag. The Y position is clamped to prevent panels from going off-screen:

```
maxY = window.innerHeight - TOPBAR_H(44) - BOTTOM_CLEARANCE(88) - panelHeight
```

### Maximize

When a panel is maximized:
- Becomes `position: fixed` via `.workspace-panel--maximized`
- `inset: 50px 6px 6px 6px` (below topbar, breathing room on sides and bottom)
- `z-index` is set to `panel.z` (which is `nextZ` at the time of maximize — always the highest value)
- Restore saves the previous `{ x, y, width }` as `restoreRect`

**Important**: never hardcode z-index for maximized panels. Always use `panel.z` so it beats all other panels regardless of session length.

### Multi-tier Dismissal

| Action | State | Visible? | Recoverable? |
|---|---|---|---|
| Click X on card | `collapsed: true` | In tray | Yes — click pill |
| Clear workspace button | `dismissed: true` | In tray (faded) | Yes — click pill |
| Delete (trash icon on pill) | Removed from store | Gone | No |
| Delete all docked | All collapsed+dismissed removed | Gone | No |

### Auto-dock

When the board reaches `getMaxVisible(boardWidth)` panels (`cols × 3`), the oldest visible panel is auto-collapsed before placing a new one.

### Arrange

`arrangePanels()` reassigns all visible panel positions in row-major grid order using current `getPanelWidth()` and `getColumns()`. Triggered by the grid icon button in the topbar (disabled when `< 2` visible panels).

---

## Topbar

Fixed at top (`z-index: 30`). Three regions:

1. **Brand** (left, `flex-shrink: 0`): `AuroraBarsListen` normally, `AuroraBarsLoading` when `agentBusy`
2. **Tray** (center, `flex: 1`): scrollable pill list for collapsed/dismissed surfaces
3. **Actions** (right, `flex-shrink: 0`): delete-all-docked, arrange, restore-all, clear-workspace, WsBadge

### Tray Pills

- All docked surfaces always rendered (no cap)
- Tray is drag-scrollable: `onPointerDown` / `onPointerMove` on the tray div scrolls `scrollLeft`
- Pills have `onPointerDown={(e) => e.stopPropagation()}` so clicking a pill doesn't start a tray drag
- CSS `mask-image` fades both edges to signal hidden content
- Labels truncated with `max-width: 7rem; text-overflow: ellipsis`
- On narrow viewports (`@media (max-width: 760px)`): labels hidden, icon-only mode

---

## CommandDock

A floating pill at the bottom center of the viewport.

### Sizing (no breakpoint jumps)

```css
left: max(0.75rem, calc(50% - 410px));
right: max(0.75rem, calc(50% - 410px));
width: auto;
```

This is continuous — the pill grows edge-to-edge on narrow screens and centers at max 820px on wide screens with no breakpoint snap.

### States

| State | CSS class | Appearance |
|---|---|---|
| Default | (none) | Single input row, centered, collapsed |
| Expanded | `--expanded` | Timeline appears above input |
| Hidden | `--hidden` | Dot summon button only |

### Chat Timeline

- Entries: `user` (right-aligned), `system` (muted), `agent` (teal, from `voice_line`)
- `agentBusy` shows a persistent "Aurora + dots" entry at the bottom while the agent processes
- Timeline auto-scrolls on new entries and on `agentBusy` changes
- Persisted to `sessionStorage`; stale pending entries cleared on restore

### Voice

- `SpeechRecognition` for voice input (microphone button)
- `SpeechSynthesis` for TTS playback of `voice_line` when `ttsEnabled`
- Aurora logo shows `AuroraBarsTalk` animation while speaking
- TTS toggle (speaker icon button in pill)

### Slash Commands

Any command starting with `/` (e.g. `/new`, `/reset`, `/clear`) is sent to the agent as raw text (no preamble wrapper) AND locally clears the chat timeline, `sessionStorage`, and resets `agentBusy`. Handled in both `CommandDock.tsx` (local clear) and `pulse-command-relay.js` (raw send).

---

## A2UI Component Catalog (`aura-catalog.tsx`)

### ActionButton

- Tracks `sent` state by node object reference (`sentNode === node as object`), not a boolean
- When the agent updates the surface, A2UI creates new node objects → `sentNode !== node` → button auto-resets
- This prevents ghost "already clicked" states after surface updates

### DataTable

- Renders as CSS grid with `gridTemplateColumns: repeat(N, 1fr)` driven by column count
- Separate header row (`.aura-data-table__row--header`) for aligned column labels
- Rows have hover highlight with teal inset glow
- "Show N more..." / "Show less" toggle (default: 3 visible rows)

### DraftEditor (new)

- Self-contained textarea + submit button
- Agent uses section type `{"type":"editor","defaultValue":"...","submitLabel":"...","action_id":"...","context":{...}}`
- On submit, sends `action_id` with edited text in `context.draftText`
- Agent's `send-revised` callback receives `context.draftText` as the final draft
- Same node-reference `sent` tracking as ActionButton

### MetricGrid

- Tones: `default`, `positive`, `negative`, `warning`, `info`, `critical`
- `info` uses blue border; `negative` uses red; `critical` uses bright red with glow

---

## AGENTS.md — Key Instructions Added

The agent's instruction file at `.openclaw-docker/workspace/AGENTS.md` was updated with:

1. **`voice_line`**: always include — short conversational sentence for chat + TTS
2. **`icon`**: always include — 2-letter abbreviation for tray chip
3. **`surface_type`**: `workspace` (default), `plan`, `attention`, `monitor`, `brief`
4. **`priority`**: `low`, `normal`, `high`
5. **Metric tones**: full list with guidance on when to use each
6. **Error handling**: retry once on validation failure
7. **`editor` section type**: for inline draft editing — agent must show this when `edit-draft` fires, include current draft as `defaultValue`, and handle `send-revised` action by reading `context.draftText`

---

## `aura-surface.js` — Schema Fixes

Added `negative` and `info` to `MetricItemSchema` tone union. These were valid agent outputs that the schema was incorrectly rejecting, causing validation errors and requiring retries.

---

## Test Harness

A Python script exists at `/tmp/aura-mock-surfaces.py` for injecting test commands via the proper `submit_command` WebSocket flow:

```bash
python3 /tmp/aura-mock-surfaces.py
```

Connects to `ws://127.0.0.1:28790/aura/surface`, sends 8 `submit_command` messages (2s apart). The server routes each to the agent, which responds with `aura_surface` tool calls. **Requires the agent to be running and responsive** — with a slow local model (Ollama qwen3:14b) commands queue serially and may take several minutes each.

---

## Known Issues / Left for Phase 6

- `.openclaw-docker/` is fully gitignored. The `AGENTS.md` inside it is not versioned. Future work should establish a clean versioning strategy (e.g. a tracked `agents/` seed directory synced on container start).
- The `+8 test` button was deliberately removed from production code. Use the Python script above for load testing.
- The agent's Ollama model is slow (~3 min per run). Multiple queued commands compound the wait. Consider a faster provider or a dedicated test profile.
- The `workspace/` directory inside `.openclaw-docker/` contains a nested `.git` repo (OpenClaw's internal workspace tracking). This is why the directory is gitignored — git detects it as an uninitialized submodule.
