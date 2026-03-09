# Pipeline Stage Editor — Full Configuration via UI

**Date:** 2026-03-09
**Status:** Draft — awaiting review

## Goal

Make every pipeline configuration parameter in `settings.json` editable through the worca-ui Settings page. Add per-stage enable/disable toggles that control workflow shape without adding/removing stages.

## Current State

**settings.json `worca` namespace:**
```json
{
  "agents": {
    "planner":      { "model": "opus",   "max_turns": 40 },
    "coordinator":  { "model": "opus",   "max_turns": 30 },
    "implementer":  { "model": "sonnet", "max_turns": 85 },
    "tester":       { "model": "sonnet", "max_turns": 40 },
    "guardian":     { "model": "opus",   "max_turns": 30 }
  },
  "loops": {
    "implement_test": 10,
    "code_review": 5,
    "pr_changes": 3,
    "restart_planning": 2
  },
  "governance": {
    "guards": { ... },
    "test_gate_strikes": 2,
    "dispatch": { ... }
  }
}
```

**Hardcoded in `stages.py`:**
- `STAGE_AGENT_MAP` — which agent runs which stage
- `STAGE_SCHEMA_MAP` — output schema per stage
- `TRANSITIONS` — valid stage transitions (loop targets)
- Stage order: `[plan, coordinate, implement, test, review, pr]`

**Hardcoded in `runner.py`:**
- `stage_order` list (line 415)
- Stage-specific logic: plan approval check, test loop-back, review loop-back

**Hardcoded in `settings.js` (UI):**
- `STAGE_AGENT_MAP`, `STAGE_ORDER`, `AGENT_NAMES`, `MODEL_OPTIONS`

## Design

### 1. New `worca.stages` config in settings.json

Add a `stages` key that makes stage configuration data-driven:

```json
{
  "worca": {
    "stages": {
      "plan":       { "agent": "planner",     "enabled": true },
      "coordinate": { "agent": "coordinator", "enabled": true },
      "implement":  { "agent": "implementer", "enabled": true },
      "test":       { "agent": "tester",      "enabled": true },
      "review":     { "agent": "guardian",     "enabled": true },
      "pr":         { "agent": "guardian",     "enabled": true }
    },
    "agents": { ... },
    "loops": { ... },
    "governance": { ... }
  }
}
```

Each stage entry:
- `agent` — which agent runs this stage (dropdown in UI)
- `enabled` — whether the stage runs in the pipeline (toggle in UI)

The `agents` section remains as-is (model + max_turns per agent name). The stage-to-agent mapping in `stages` links them.

**Why not merge agents into stages?** Because agents are reusable — `guardian` runs both `review` and `pr`. Keeping them separate avoids duplicating model/turns config.

### 2. Backend: `stages.py` reads from settings

`get_stage_config()` already reads `settings.json`. Extend it to:
1. Read `worca.stages.{stage}` for the agent mapping (fall back to hardcoded `STAGE_AGENT_MAP`)
2. Read `worca.stages.{stage}.enabled` (default `true`)
3. Export a `get_enabled_stages()` function that returns only enabled stages in order

`STAGE_AGENT_MAP` becomes the default, overridable by config.

### 3. Backend: `runner.py` skips disabled stages

In `run_pipeline()`, replace:
```python
stage_order = [Stage.PLAN, Stage.COORDINATE, Stage.IMPLEMENT, Stage.TEST, Stage.REVIEW, Stage.PR]
```

With:
```python
from worca.orchestrator.stages import get_enabled_stages
stage_order = get_enabled_stages(settings_path)
```

Loop-back targets (test->implement, review->implement, review->plan) must validate that the target stage is enabled. If a loop target is disabled, skip the loop (treat as pass/approve).

### 4. UI: Redesigned Pipeline tab in Settings

The current Pipeline tab has: Stage Order (read-only flow) + Loop Limits.

**New layout:**

#### Stage Configuration (replaces read-only Stage Order)

Each stage rendered as a card with:
- **Enable/disable toggle** (sl-switch) — prominent, top-right of card
- **Stage name** — e.g. "PLAN"
- **Agent dropdown** (sl-select) — choose from available agents
- **Visual state** — enabled cards have vibrant styling, disabled cards are muted/strikethrough

Cards arranged in pipeline flow order with arrows between them. Disabled stages show muted with strikethrough text and dimmed arrows.

#### Agent Configuration (existing, unchanged)

Per-agent model + max_turns. Already works.

#### Loop Limits (existing, unchanged)

The four loop limit inputs. Already works.

### 5. UI: Visual treatment for enabled/disabled stages

**Pipeline flow in Stage Configuration:**
```
[PLAN] --> [COORDINATE] --> [IMPLEMENT] --> [TEST] --> [REVIEW] --> [PR]
  on          on              on            off          on         on
```

Enabled stages:
- Vibrant background (primary color tint)
- Normal text
- Solid arrows between enabled stages

Disabled stages:
- Muted/gray background
- Strikethrough stage name
- Dimmed arrow connectors
- Toggle clearly shows "off" state

CSS classes: `.pipeline-stage-node--enabled`, `.pipeline-stage-node--disabled`

### 6. UI: Stage cards with agent assignment

Each stage in the pipeline flow becomes interactive:

```
+-----------------------------------+
| PLAN                    [toggle]  |
| Agent: [planner v]               |
+-----------------------------------+
       |
       v
+-----------------------------------+
| COORDINATE              [toggle]  |
| Agent: [coordinator v]            |
+-----------------------------------+
```

The agent dropdown lists all agents defined in `worca.agents`. This lets you reassign which agent runs which stage (e.g., run `review` with `tester` instead of `guardian`).

### 7. Save flow

When "Save Pipeline" is clicked:
1. Read all stage toggles and agent assignments from DOM
2. Build `worca.stages` object
3. Merge with existing `worca.agents` and `worca.loops`
4. POST to `/api/settings`

### 8. Validation rules

- `plan` and `pr` should warn (not block) when disabled — plan is the entry point, pr is the final output
- At least one stage must be enabled
- Loop targets must reference enabled stages — the UI should show a warning if e.g. `implement_test` loop limit > 0 but `implement` is disabled
- These are soft warnings displayed in the UI, not hard blocks

## Files to modify

| File | Change |
|------|--------|
| `settings.json` | Add `worca.stages` section with defaults |
| `stages.py` | `get_stage_config()` reads agent from `worca.stages`; add `get_enabled_stages()` |
| `runner.py` | Use `get_enabled_stages()` for stage_order; handle disabled loop targets |
| `settings.js` (UI) | Redesign Pipeline tab: interactive stage cards with toggles + agent dropdowns |
| `styles.css` | Add `.pipeline-stage-node--enabled/--disabled` visual styles |
| `settings-reader.js` | Include `stages` in the settings payload |
| `app.js` | No changes (already passes full `worca` namespace) |

## Out of scope

- Reordering stages via drag-and-drop (fixed order for now)
- Adding/removing stages (enable/disable covers this)
- Editing agent `.md` definition files through UI
- Editing schemas through UI
- Editing hooks or permissions through UI (governance tab handles guards)

## Risks

- **Disabling `plan` + `implement`** — pipeline would skip planning and go straight to... test? This is allowed but may produce garbage. Soft warning is sufficient.
- **Agent reassignment** — assigning `tester` to run `plan` stage would work mechanically (agent runs with plan schema) but may produce poor results. This is the user's choice.
- **Loop target disabled** — if `implement` is disabled but `implement_test` loop limit > 0, the loop-back from test failure has nowhere to go. Runner should treat test failure as terminal in this case.
