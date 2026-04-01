# A2UI Prompt Engineering Reference — Terracotta Coffee Co.

status: archived-reference
date: March 31, 2026
origin: Phase 5 live validation in `.openclaw-docker/workspace/`

---

## What this is

These files are the prompt engineering artifacts from Phase 5 live browser
validation. They used a fictional "Terracotta Coffee Co." scenario with an
owner named Marco to prove that a local model (Ollama qwen3:14b) could
reliably produce correct `aura_surface` JSON shapes when given exhaustive
handholded examples.

**This is not the real reseller agent.** The real agent (Studio Ops / Sheryl)
is built in Phase 5b at `packages/artist-reseller/agents/`.

## What was proven

1. The **communication constraint** pattern works — telling the model the
   owner "CANNOT see your text replies" forces all output through
   `aura_surface` tool calls instead of chat text.

2. **Exhaustive domain-specific examples** with exact JSON shapes are the
   most reliable way to get a small local model to produce valid structured
   output. Generic schema docs alone are insufficient.

3. The **action callback pattern** (action_id → state transition → new
   surface) works when documented with explicit rules and examples for
   every action type.

4. The **editor section type** with `send-revised` callback works for
   inline draft editing when the pattern is demonstrated end-to-end.

5. **Metric tones**, **surface_type**, **priority**, **voice_line**, and
   **icon** are all reliably produced when documented with examples.

## How to use this

When writing AGENTS.md for a new `.aurora` package, use these files as a
structural template:

- Copy the communication constraint verbatim, substituting the owner name
- Copy the section-type reference verbatim (it's universal)
- Copy the action callback rules, translating action_id patterns to the
  new domain
- Write new domain-specific examples following the same format: scenario →
  step 1 (read) → step 2 (aura_surface with exact JSON)

## Files

- `AGENTS.md` — The complete agent instruction file that was live-validated
- `MEMORY.md` — The mock business data the agent read from during testing
