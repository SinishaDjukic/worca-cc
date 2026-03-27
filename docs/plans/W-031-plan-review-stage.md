# W-031: Plan Review Stage

## Problem

When the pipeline generates or receives an implementation plan, it proceeds directly to the COORDINATE stage without validation. LLM-generated plans frequently miss important details — incomplete edge cases, incorrect API assumptions, under-specified task decomposition, or misalignment with the existing codebase. Plans provided as files (pre-written) can also be stale or contain errors. There is no mechanism to catch these issues before the pipeline commits to coordination and implementation.

## Proposal

Add a `PLAN_REVIEW` stage between PLAN and COORDINATE that always reviews the plan regardless of source (generated or file-provided). The stage uses a dedicated `plan_reviewer` agent (opus) that validates the plan against the work request, codebase, and external documentation. If the reviewer finds critical/major issues, the plan loops back to the PLAN stage for revision. The loop count is configurable (default 2, integer) so users can allow more revision passes for complex plans.

## Design

### 1. Stage Definition & Ordering

**New enum value:** `Stage.PLAN_REVIEW`

**Updated STAGE_ORDER:**
```
PREFLIGHT -> PLAN -> PLAN_REVIEW -> COORDINATE -> IMPLEMENT -> TEST -> REVIEW -> PR
```

**Updated TRANSITIONS:**
```
PLAN        -> PLAN_REVIEW          (replaces PLAN -> COORDINATE)
PLAN_REVIEW -> COORDINATE           (on approve)
PLAN_REVIEW -> PLAN                 (on revise, loop-back)
```

**New mappings in stages.py:**
- `STAGE_AGENT_MAP[Stage.PLAN_REVIEW]` = `"plan_reviewer"`
- `STAGE_SCHEMA_MAP[Stage.PLAN_REVIEW]` = `"plan_review.json"`

### 2. Loop Mechanics

**Config key:** `worca.loops.plan_review` — set to `2` in `settings.json` (note: `check_loop_limit` code defaults to 5 when no config key is found, so the settings.json entry is required to enforce the intended limit of 2)

Semantics: max number of times the plan can be sent back to PLAN for revision.

With default 2:
1. PLAN produces plan -> PLAN_REVIEW reviews -> finds critical/major issues -> loops back to PLAN (revision 1)
2. PLAN revises -> PLAN_REVIEW reviews again -> finds issues -> loops back to PLAN (revision 2)
3. PLAN revises -> PLAN_REVIEW reviews -> if still issues, loop exhausted -> proceeds to COORDINATE with warning

**Loop counter key:** `loop_counters["plan_review"]`

**New trigger value for PLAN stage:** `"plan_review_revise"` — sent back by plan reviewer with feedback. Added to existing triggers (`"initial"`, `"restart_planning"`).

**mloops multiplier** applies as with all other loops.

**Counter increment timing:** The loop counter increments only on the **revise** path (not on every PLAN_REVIEW entry). An approve-on-first-review does not consume a count.

**Error_classifier interaction:** If the agent produces malformed output and error_classifier retries are exhausted, the fail-closed default (`"revise"`) applies and counts against the plan_review loop counter. When both error_classifier retries and the plan_review loop limit are exhausted, the pipeline proceeds to COORDINATE with a warning.

### 3. Plan Reviewer Agent

**New file:** `.claude/agents/core/plan_reviewer.md`

**Role:** Review the implementation plan for completeness, feasibility, and gaps. Produces structured feedback. Does NOT modify the plan.

**What the reviewer checks:**

1. **Completeness** — Does the plan cover all requirements from the work request? Missing edge cases?
2. **Feasibility** — Are the proposed tasks achievable? Are dependencies realistic?
3. **Test strategy** — Is the testing approach adequate for the scope?
4. **Architecture fit** — Does the approach align with existing codebase patterns (informed by CLAUDE.md)?
5. **Task decomposition quality** — Are tasks atomic enough for single-implementer sessions? Too coarse? Too fine?
6. **Risk identification** — Unaddressed risks, missing rollback strategy, security concerns?
7. **Library/API validation** — Cross-check any library APIs, function signatures, or SDK methods mentioned in the plan against current documentation using available MCP tools:
   - `context7` — resolve library IDs and fetch current docs for referenced libraries
   - `WebSearch` — search for up-to-date API references, breaking changes, deprecations
   - `WebFetch` — fetch specific documentation URLs mentioned in the plan
   - Any other documentation MCP servers available in the session (e.g., deepwiki)

**Agent rules:**
- Read-only — do NOT modify the plan file, source code, or any files
- CAN use MCP tools (context7, WebSearch, WebFetch) for documentation cross-checks
- CAN read codebase files to validate plan assumptions against actual code
- Do NOT run tests or execute commands beyond reading/searching
- Do NOT invoke skills
- Must read CLAUDE.md and explore codebase to validate plan claims
- Produce `plan_review.json` with outcome and structured issues
- Spend at most 10 turns on external MCP lookups (context7, WebSearch, WebFetch). If MCP tools fail or are unavailable, proceed with codebase-only validation and note which external checks were skipped in the `evidence` field.

**Governance enforcement (required changes):**
- Add `"plan_reviewer"` to `read_only_agents` tuple in `guard.py` to enforce read-only at the hook level
- Add `"plan_reviewer"` entry to `DISPATCH_RULES` in `tracking.py` (empty set — no subagent dispatch allowed)
- Add `"plan_reviewer"` to the test-execution block list in `guard.py` — this is a **separate tuple** from `read_only_agents` (the test block at `guard.py:213` checks `agent in ("planner", "coordinator")` independently); both must be updated
- Audit `pre_tool_use.py` to confirm MCP tools (context7, WebSearch, WebFetch) are permitted for the `plan_reviewer` agent; add to allowed tools if blocked

**Issue categories:** `completeness`, `feasibility`, `test_strategy`, `architecture`, `decomposition`, `risk`, `api_assumption`

**Severity gating:** Only `critical` and `major` issues trigger `revise` outcome. `minor` and `suggestion` issues are logged but treated as `approve` (same pattern as REVIEW stage code review).

### 4. Schema

**New file:** `.claude/worca/schemas/plan_review.json`

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "plan_review",
  "type": "object",
  "required": ["outcome", "issues", "summary"],
  "additionalProperties": false,
  "properties": {
    "outcome": {
      "type": "string",
      "enum": ["approve", "revise"]
    },
    "issues": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["category", "severity", "description"],
        "additionalProperties": false,
        "properties": {
          "category": {
            "type": "string",
            "enum": ["completeness", "feasibility", "test_strategy", "architecture", "decomposition", "risk", "api_assumption"]
          },
          "severity": {
            "type": "string",
            "enum": ["critical", "major", "minor", "suggestion"]
          },
          "description": {
            "type": "string"
          },
          "suggestion": {
            "type": "string"
          },
          "evidence": {
            "type": "string"
          }
        }
      }
    },
    "summary": {
      "type": "string"
    }
  }
}
```

Note: This schema adds `$schema`, `title`, `additionalProperties: false`, and the `suggestion` severity level to align with the existing `review.json` conventions. The `required` fields on issue items are an intentional improvement over `review.json` (which has no required fields on items) to catch malformed agent output early.

### 5. Prompt Builder

**New method: `_build_plan_review(iteration)`**

Content:
- The full plan file content — read directly from `MASTER_PLAN.md` on disk (not from the `plan_approach` context key, which only stores a short summary). This is a deliberate deviation from the context-key-only pattern used by other `_build_*` methods, since plan content can be large and should not bloat the persisted context.
- The original work request for cross-reference
- Instructions to use MCP tools for external API/library validation
- On iteration > 0: includes `plan_review_history` showing previous review attempts so the reviewer checks whether prior issues were addressed

**Amended method: `_build_plan(iteration)` — revision mode**

The trigger value `"plan_review_revise"` is passed to `_build_plan` via a context key (e.g., `plan_revision_mode=True`), since `_build_plan(iteration)` only takes an iteration parameter. The method checks this context key to switch between initial and revision prompts, consistent with how `_build_implement` uses context keys (`test_failures`, `review_issues`) to distinguish modes.

When `plan_revision_mode` context key is set, `_build_plan` **concretely** does the following:
- Switches to a revision prompt header: "The plan reviewer has identified issues that must be addressed. Revise the existing plan — do NOT start from scratch."
- Injects `plan_review_issues` as a numbered list of critical/major issues, each with category, description, suggestion, and evidence fields
- Includes `plan_review_history` as context showing prior revision attempts and their outcomes
- Re-reads `MASTER_PLAN.md` to include the current plan text as the baseline for revision
- Closes with: "Address each issue above. Preserve all parts of the plan that were not flagged."

**New context keys:**

| Key | Set By | Used By |
|-----|--------|---------|
| `plan_review_issues` | PLAN_REVIEW | PLAN (revision prompt) |
| `plan_review_history` | PLAN_REVIEW | PLAN (revision), PLAN_REVIEW (subsequent reviews) |
| `plan_revision_mode` | PLAN_REVIEW (set to `True` on revise) | PLAN (`_build_plan` checks this to switch to revision prompt) |

**Context lifecycle:**
- On **revise**: set `plan_review_issues`, `plan_review_history`, `plan_revision_mode=True`, then call `prompt_builder.save_context()` before looping back (required for crash/resume support)
- On **approve**: **delete** (pop) `plan_review_issues`, `plan_revision_mode`, and `plan_review_history` from context to prevent leaking into later PLAN re-runs (e.g., if REVIEW loops back to PLAN later). Use `pop`/`del` — do NOT set to `None`, as `None` serializes to `null` in `prompt_context.json` and persists. Then call `prompt_builder.save_context()`.

### 6. Runner Integration

**New PLAN_REVIEW handler block in runner.py stage loop:**

Must also add `Stage.PLAN_REVIEW` entry to `_STAGE_PROMPT_PREFIX` dict.

```python
elif current_stage == Stage.PLAN_REVIEW:
    # Validate structured output against schema before acting on it.
    # On schema validation failure, treat as agent error (retry via error_classifier).
    # If error_classifier retries also exhausted, default to "revise" (fail-closed),
    # which counts against the plan_review loop counter. When both are exhausted,
    # proceed to COORDINATE with warning (consistent with loop-exhaustion behavior).
    outcome = result.get("outcome", "revise")  # fail-closed default
    issues = result.get("issues", [])
    critical_issues = [i for i in issues if i.get("severity") in ("critical", "major")]

    # Record iteration (required for status.json, UI, and resume)
    # NOTE: use .value for string keys — update_stage/complete_iteration expect strings
    stage_key = current_stage.value  # "plan_review"
    complete_iteration(status, stage_key, result, iteration=pb_iteration)
    update_stage(status, stage_key, "completed")
    save_status(status, status_path)
    if ctx:
        emit_event(ctx, STAGE_COMPLETED, stage_completed_payload(stage_key, result))

    # Revise gate: outcome == "revise" OR fail-closed (missing outcome).
    # Important: check outcome independently of critical_issues to maintain
    # fail-closed semantics. If outcome == "revise" but issues list is empty/missing,
    # still treat as revise (not silent approve).
    should_revise = (outcome == "revise") and (critical_issues or not issues)

    if should_revise:
        # Thread review feedback — only critical/major issues to limit context growth
        prev_history = prompt_builder.get_context("plan_review_history") or []
        prev_history.append({"attempt": len(prev_history) + 1, "issues": critical_issues})
        prompt_builder.update_context("plan_review_history", prev_history)
        prompt_builder.update_context("plan_review_issues", critical_issues)
        prompt_builder.update_context("plan_revision_mode", True)

        # Update ALL counters before saving — single save to avoid inconsistent state
        loop_counters["plan_review"] = loop_counters.get("plan_review", 0) + 1
        loop_counters[f"{Stage.PLAN_REVIEW.value}_iteration"] = \
            loop_counters.get(f"{Stage.PLAN_REVIEW.value}_iteration", 0) + 1
        status["loop_counters"] = dict(loop_counters)

        if check_loop_limit("plan_review", loop_counters["plan_review"],
                            settings_path, mloops=mloops):
            if ctx:
                emit_event(ctx, LOOP_TRIGGERED,
                           loop_triggered_payload("plan_review", loop_counters["plan_review"]))

            # --- Atomic loop-back sequence (all state persisted before in-memory jumps) ---
            # 1. Reset PLAN stage status, clear skipped flag, and plan_approved milestone
            update_stage(status, Stage.PLAN.value, "pending", skipped=False)
            status.get("milestones", {}).pop("plan_approved", None)
            # 2. Persist context + status in one batch before any in-memory transitions
            prompt_builder.save_context()
            save_status(status, status_path)
            # 3. In-memory transitions (lost on crash, but context keys drive behavior on resume)
            _next_trigger[Stage.PLAN.value] = "plan_review_revise"
            stage_idx = stage_order.index(Stage.PLAN)
            continue  # Loop back to PLAN
        else:
            prompt_builder.save_context()
            save_status(status, status_path)
            if ctx:
                emit_event(ctx, LOOP_EXHAUSTED, ...)
            _log("Plan review loop exhausted -- proceeding to COORDINATE", "warn")
            # Advance stage_idx to COORDINATE (fall-through)
            stage_idx = stage_order.index(Stage.PLAN_REVIEW) + 1
            continue
    else:
        # Approve path — delete (pop) cross-context keys to prevent leaking
        prompt_builder.pop_context("plan_review_issues")
        prompt_builder.pop_context("plan_revision_mode")
        prompt_builder.pop_context("plan_review_history")
        prompt_builder.save_context()

        if outcome == "revise" and not critical_issues and issues:
            # outcome was "revise" but only minor/suggestion issues — treat as approve
            _log(f"Plan approved with {len(issues)} minor issues (logged)", "ok")
        elif issues:
            _log(f"Plan approved with {len(issues)} minor issues (logged)", "ok")
        else:
            _log("Plan approved by reviewer", "ok")
```

**Note on `prompt_builder.pop_context(key)`:** If no `pop_context` method exists, add one (delegates to `self._context.pop(key, None)`) — this avoids the `None`-serialization issue of `update_context(key, None)`.

**Note on PLAN handler and `plan_approved` milestone:** When PLAN runs in revision mode (triggered by `plan_review_revise`), the PLAN handler's `plan_approved` milestone gate must be aware of this. Options: (a) the planner agent always emits `"approved": true` in its JSON (revision prompt should instruct this), or (b) the PLAN handler skips the milestone gate when `plan_revision_mode` context key is set. Option (a) is simpler — add to the revision prompt instructions.

**Resume support:** The atomic loop-back sequence above persists all context keys and status to disk before any in-memory transitions (`_next_trigger`, `stage_idx`). On crash and resume, `_next_trigger` is lost (in-memory only), but `plan_revision_mode` context key (persisted via `save_context`) is the actual behavioral driver — `_build_plan` checks this key, not the trigger value. The trigger value only affects the iteration record label, which will log as `"initial"` instead of `"plan_review_revise"` after a crash — this is a minor inaccuracy, not a behavioral bug.

**Event emissions:** Standard `STAGE_STARTED`, `STAGE_COMPLETED`, `LOOP_TRIGGERED`, `LOOP_EXHAUSTED` events. No new event types needed.

### 7. Settings Configuration

**Additions to `.claude/settings.json` under `worca`:**

```json
{
  "worca": {
    "stages": {
      "plan_review": {
        "agent": "plan_reviewer",
        "enabled": false
      }
    },
    "agents": {
      "plan_reviewer": {
        "model": "opus",
        "max_turns": 50
      }
    },
    "loops": {
      "plan_review": 2
    }
  }
}
```

**Default: disabled.** The stage is off for new installations. Users opt-in by setting `"stages.plan_review.enabled": true`.

**Code-level default:** `get_enabled_stages()` must treat `PLAN_REVIEW` the same as `LEARN` — default to `False` when the stage entry is missing from settings.json. This prevents older installations (whose settings.json lacks a `plan_review` entry) from getting the stage enabled unexpectedly. Implementation: add `PLAN_REVIEW` to a `_STAGES_DEFAULT_DISABLED` set checked by `get_enabled_stages()`.

Users can:
- Enable: `"stages.plan_review.enabled": true`
- Change model: `"agents.plan_reviewer.model": "sonnet"`
- Adjust turns: `"agents.plan_reviewer.max_turns": 75`
- Adjust loop count: `"loops.plan_review": 5` (for complex plans)
- Override agent instructions: via the `worca-agent-override` mechanism (project-level `.claude/agents/overrides/plan_reviewer.md`)

## Files Changed

| File | Change |
|------|--------|
| `.claude/worca/orchestrator/stages.py` | Add `PLAN_REVIEW` to enum, `STAGE_ORDER`, `TRANSITIONS`, `STAGE_AGENT_MAP`, `STAGE_SCHEMA_MAP`; add `_STAGES_DEFAULT_DISABLED` set containing `Stage.PLAN_REVIEW` and `Stage.LEARN`; update `get_enabled_stages()` to check this set (default `False` for these stages instead of `True`) |
| `.claude/worca/orchestrator/runner.py` | Add PLAN_REVIEW handler block in stage loop, thread context to prompt builder, add `Stage.PLAN_REVIEW` to `_STAGE_PROMPT_PREFIX` dict |
| `.claude/worca/orchestrator/prompt_builder.py` | Add `_build_plan_review()`, amend `_build_plan()` for revision mode, add `pop_context(key)` method (delegates to `self._context.pop(key, None)`) |
| `.claude/settings.json` | Add `stages.plan_review`, `agents.plan_reviewer`, `loops.plan_review: 2` |
| `.claude/agents/core/plan_reviewer.md` | New agent template |
| `.claude/worca/schemas/plan_review.json` | New output schema |
| `.claude/worca-ui/app/views/settings.js` | Add `PLAN_REVIEW` to hardcoded `STAGE_ORDER` array, `STAGE_AGENT_MAP` dict, and `AGENT_NAMES` array so the settings page shows the new stage's toggles and agent dropdown |
| `.claude/worca-ui/server/log-tailer.js` | Add `plan_review` to `STAGE_ORDER` array (line 5-14) so logs for the new stage sort correctly instead of falling to position 999 |
| `.claude/worca/hooks/guard.py` | Add `"plan_reviewer"` to `read_only_agents` tuple and test-execution block list (separate tuple) |
| `.claude/worca/hooks/tracking.py` | Add `"plan_reviewer"` entry to `DISPATCH_RULES` (empty set) |
| `tests/` | New tests for plan_review stage, loop mechanics, prompt builder methods (see test scenarios below) |

## Files NOT Changed

- `resume.py` — works automatically with new stage in STAGE_ORDER. `find_resume_point()` always resumes from PREFLIGHT and skips completed stages. The loop-back handler uses an atomic persist sequence (save context keys + status to disk before in-memory transitions) so that on crash: (a) `plan_revision_mode` context key drives PLAN's prompt builder to use revision mode, and (b) PLAN stage status + `skipped=False` reset ensures PLAN re-runs. The only minor inaccuracy after crash-resume is that the iteration record logs trigger as `"initial"` instead of `"plan_review_revise"` (since `_next_trigger` is in-memory only), which is cosmetic.
- `error_classifier.py` — generic, no stage-specific logic
- Other agent templates — no changes needed

## Considerations

- **Loop exhaustion behavior:** When plan_review loop is exhausted, the pipeline proceeds to COORDINATE with the current plan and a warning. This matches the TEST loop exhaustion pattern (proceeds to REVIEW). An alternative would be to halt the pipeline, but that would block automated runs unnecessarily.
- **Human-in-the-loop (future):** A milestone gate (`plan_review_approval`) can be added later between PLAN_REVIEW approve and COORDINATE, requiring human sign-off on critical plans. This is out of scope for this change.
- **Plan file source:** The reviewer receives the same plan content regardless of whether it was generated by the PLAN stage or provided as a pre-existing file. The prompt builder reads MASTER_PLAN.md in both cases.
- **MCP tool availability:** The reviewer should gracefully handle cases where context7, WebSearch, or other MCP tools are not available — it still performs all codebase-based checks and notes that external validation was skipped.
- **MCP turn budget:** The agent prompt limits external MCP lookups to 10 turns max to prevent runaway cost. If tools fail or are unavailable, the agent proceeds with codebase-only validation.

## Test Scenarios

**Existing tests requiring updates:**
- `test_stages.py`: Update `len(Stage)` assertion (currently 8 → 9), update `TRANSITIONS[Stage.PLAN]` assertion (currently `{Stage.COORDINATE}` → `{Stage.PLAN_REVIEW}`), update `STAGE_ORDER` position assertions, update `get_enabled_stages` count
- `test_resume.py`: Add `plan_review` entries to hardcoded stage status dicts

**New test scenarios (by module):**

*stages.py:*
- `PLAN_REVIEW` is in `Stage` enum and `STAGE_ORDER` at correct position (between PLAN and COORDINATE)
- `TRANSITIONS[Stage.PLAN]` includes `Stage.PLAN_REVIEW`
- `TRANSITIONS[Stage.PLAN_REVIEW]` includes `{Stage.COORDINATE, Stage.PLAN}`
- `STAGE_AGENT_MAP[Stage.PLAN_REVIEW]` == `"plan_reviewer"`
- `STAGE_SCHEMA_MAP[Stage.PLAN_REVIEW]` == `"plan_review.json"`

*runner.py — PLAN_REVIEW handler:*
- **Approve path**: outcome=approve → advances to COORDINATE, **deletes** (pops) `plan_review_issues`, `plan_revision_mode`, and `plan_review_history` from context
- **Revise path**: outcome=revise with critical issues → loops back to PLAN, sets context, increments counter, resets PLAN stage status (with `skipped=False`) and `plan_approved` milestone
- **Revise with minor only**: outcome=revise but only minor/suggestion issues → treated as approve (no loop-back)
- **Revise with empty issues**: outcome=revise but issues list empty/missing → still treated as revise (fail-closed), not silent approve
- **Loop exhaustion**: loop counter exceeds limit → proceeds to COORDINATE with warning, emits `LOOP_EXHAUSTED`, sets `stage_idx` to advance
- **Schema validation failure**: malformed agent output → treated as agent error (retry via error_classifier); if retries also exhausted, counts as revise against loop counter
- **Fail-closed default**: missing `outcome` field → defaults to `"revise"`
- **Context accumulation**: history stores only critical/major issues (not all issues)
- **Event emissions**: `STAGE_COMPLETED` emitted on both approve and revise paths; `LOOP_TRIGGERED` emitted on successful loop-back; all `emit_event` calls guarded with `if ctx:`
- **`complete_iteration`/`update_stage`/`save_status`** called before loop-back; all counters updated in single batch before `save_status`
- **Atomic loop-back**: all state persisted to disk before in-memory transitions (`_next_trigger`, `stage_idx`)

*prompt_builder.py:*
- `_build_plan_review(iteration=0)`: includes plan content and work request
- `_build_plan_review(iteration>0)`: includes `plan_review_history`
- `_build_plan` with `plan_revision_mode=True` context: switches to revision prompt, includes `plan_review_issues` and `plan_review_history`
- `_build_plan` without `plan_revision_mode`: produces normal initial prompt (no regression)

*Disabled stage (default):*
- Default (no config entry or `enabled: false`) → PLAN transitions directly to COORDINATE, PLAN_REVIEW is skipped in `get_enabled_stages()`
- `_STAGES_DEFAULT_DISABLED` set contains `Stage.PLAN_REVIEW` and `Stage.LEARN` — both default to disabled when not in settings.json
- `stages.plan_review.enabled: true` → PLAN_REVIEW appears in `get_enabled_stages()` at correct position

*Resume:*
- Crash during PLAN_REVIEW → resumes from PREFLIGHT, skips completed stages, re-enters PLAN_REVIEW
- Crash during loop-back (PLAN_REVIEW→PLAN) → PLAN stage status was reset (with `skipped=False`), context keys persisted, so PLAN re-runs correctly in revision mode
- Loop counter persisted in status.json before loop-back → counter survives crash and resume

*Governance:*
- Write operations blocked for plan_reviewer via `read_only_agents` in guard.py
- Test execution blocked for plan_reviewer via separate test-block tuple in guard.py
- Subagent dispatch blocked via empty set in `DISPATCH_RULES` in tracking.py
- MCP tools (context7, WebSearch, WebFetch) permitted for plan_reviewer in pre_tool_use.py

*Settings propagation:*
- Custom model/max_turns settings correctly propagated to plan_reviewer agent invocation
- `stages.plan_review.enabled: false` prevents stage from appearing in `get_enabled_stages()`

*MCP tool failure:*
- context7/WebSearch/WebFetch timeout or error → agent proceeds with codebase-only validation
- All MCP tools unavailable → review still produces valid output based on codebase analysis

*Integration (round-trip):*
- Full PLAN → PLAN_REVIEW (revise) → PLAN (revision) → PLAN_REVIEW (approve) → COORDINATE path
- Full PLAN → PLAN_REVIEW (revise) → PLAN → PLAN_REVIEW (revise) → PLAN → PLAN_REVIEW (exhausted) → COORDINATE path

*Edge cases:*
- `_build_plan_review` when MASTER_PLAN.md is missing or empty → agent should report as critical issue
- Revise with empty revision feedback (empty issues array) → still triggers revise path (fail-closed)
- STAGE_AGENT_MAP/STAGE_SCHEMA_MAP point to files that exist on disk and schema is valid JSON Schema
