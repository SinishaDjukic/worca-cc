# W-028: LEARN Stage — Post-Run Retrospective + UI

## Context

The worca-cc pipeline runs stages (Plan → Coordinate → Implement → Test → Review → PR) with feedback loops, but each run starts from scratch. This adds a LEARN stage that analyzes a completed (or failed) run, records factual observations with importance ratings, and suggests improvements to prompts, configuration, plan files, and specs. It does NOT auto-apply changes.

Additionally, a UI view is added so learnings are visible in the worca-ui run detail page — as a collapsible section placed after the Beads section. When the learn stage is disabled (default), a "Run Learning Analysis" button allows manual execution.

## Design Decisions

- **LEARN is out-of-band**: not part of `STAGE_ORDER` or main loop. Called separately after pipeline termination.
- **Runs on success and failure**, NOT on user interruption (`PipelineInterrupted`).
- **Disabled by default** via `worca.stages.learn.enabled: false`.
- **Uses Sonnet** (analytical, cost-effective). Configurable.
- **Read-only agent** — may only read, not modify anything.
- **Output** saved as `learnings.json` in the run directory + recorded in `status.json` under `stages.learn`.
- **UI**: LEARN appears in the stage timeline (after PR). When disabled and not yet run, its icon shows a distinct "disabled/skipped" state. After manual analysis completes, it shows as "completed".

---

## Part 1: Backend — LEARN Stage

### 1.1 Create schema: `.claude/worca/schemas/learn.json`

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "LearnOutput",
  "type": "object",
  "required": ["observations", "suggestions", "recurring_patterns", "run_summary"],
  "properties": {
    "observations": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["category", "importance", "description", "evidence"],
        "properties": {
          "category": { "type": "string", "enum": ["test_loop", "review_loop", "implementation", "planning", "coordination", "configuration"] },
          "importance": { "type": "string", "enum": ["critical", "high", "medium", "low"] },
          "description": { "type": "string" },
          "evidence": { "type": "string" },
          "occurrences": { "type": "integer", "minimum": 1 }
        }
      }
    },
    "suggestions": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["target", "description", "rationale"],
        "properties": {
          "target": { "type": "string", "enum": [
            "prompt:planner", "prompt:coordinator", "prompt:implementer",
            "prompt:tester", "prompt:guardian",
            "config:loops", "config:agents", "config:governance",
            "plan_template", "spec_template"
          ]},
          "description": { "type": "string" },
          "rationale": { "type": "string" },
          "based_on_observations": { "type": "array", "items": { "type": "integer" } }
        }
      }
    },
    "recurring_patterns": {
      "type": "object",
      "properties": {
        "cross_bead": { "type": "array", "items": { "type": "object", "properties": {
          "pattern": { "type": "string" },
          "affected_beads": { "type": "array", "items": { "type": "string" } },
          "frequency": { "type": "integer" }
        }}},
        "test_fix_loops": { "type": "array", "items": { "type": "object", "properties": {
          "pattern": { "type": "string" },
          "loop_iterations": { "type": "integer" },
          "resolved": { "type": "boolean" }
        }}},
        "review_fix_loops": { "type": "array", "items": { "type": "object", "properties": {
          "pattern": { "type": "string" },
          "loop_iterations": { "type": "integer" },
          "resolved": { "type": "boolean" }
        }}}
      }
    },
    "run_summary": {
      "type": "object",
      "required": ["termination", "total_iterations"],
      "properties": {
        "termination": { "type": "string", "enum": ["success", "failure", "loop_exhausted", "rejected"] },
        "termination_reason": { "type": "string" },
        "total_iterations": { "type": "integer" },
        "test_fix_loops": { "type": "integer" },
        "review_fix_loops": { "type": "integer" },
        "plan_restarts": { "type": "integer" }
      }
    }
  }
}
```

### 1.2 Create agent: `.claude/agents/core/learner.md`

Role: Retrospective analyst. Read-only. Analyze the full pipeline run status for patterns and improvement opportunities.

Instructions to include:
1. Analyze implement iterations — find recurring issues across different beads (same error types, missing patterns, same test categories failing)
2. Analyze test-fix loops — what triggered each failure, did fixes address root causes or just symptoms, did same failure types recur
3. Analyze review-fix loops — what severity/category of issues were raised, were they systemic
4. Evaluate plan quality — did it anticipate actual challenges? Were task decompositions appropriate?
5. Evaluate configuration — were loop limits hit? Turn limits adequate? Disproportionate cost?
6. Rate each observation by importance (critical/high/medium/low) based on impact and recurrence
7. Formulate targeted suggestions linking to specific artifacts

Rules: Do NOT modify any files. Do NOT run tests. Only analyze and report.

### 1.3 Modify `stages.py` — `.claude/worca/orchestrator/stages.py`

- Add `LEARN = "learn"` to `Stage` enum (line 14, after PR)
- Add to `STAGE_AGENT_MAP`: `Stage.LEARN: "learner"` (line 33)
- Add to `STAGE_SCHEMA_MAP`: `Stage.LEARN: "learn.json"` (line 42)
- Do **NOT** add to `STAGE_ORDER` or `TRANSITIONS`
- Add helper function:
  ```python
  def is_learn_enabled(settings_path=".claude/settings.json"):
      """Check if learn stage is enabled. Defaults to False (opposite of other stages)."""
      settings = _read_settings(settings_path)
      return settings.get("worca", {}).get("stages", {}).get("learn", {}).get("enabled", False)
  ```

### 1.4 Modify `prompt_builder.py` — `.claude/worca/orchestrator/prompt_builder.py`

Add `_build_learn(self, iteration)` method that reads from context keys:
- `full_status` — the complete status dict (all stages, all iterations with outputs)
- `termination_type` — "success", "failure", "loop_exhausted", "rejected"
- `termination_reason` — error message if applicable
- `plan_file_content` — the plan file text if available

Renders a structured prompt with:
- Work request summary
- Plan file content
- Full iteration data as JSON (truncated if too large — focus on outputs, triggers, outcomes, errors)
- Explicit analysis instructions for each category

### 1.5 Modify `runner.py` — `.claude/worca/orchestrator/runner.py`

**Add import** (line 18): `is_learn_enabled` from stages

**Add `_STAGE_PROMPT_PREFIX` entry** (line 364):
```python
Stage.LEARN: (
    "Analyze the completed pipeline run and produce a retrospective report. "
    "Identify patterns, recurring issues, and improvement suggestions.\n\n"
    "Run data: {prompt}"
),
```

**Add `_run_learn_stage()` function** (new, after `_build_stage_prompt`):
```python
def _run_learn_stage(status, prompt_builder, settings_path, run_dir,
                     termination_type, termination_reason, msize, logs_dir):
    """Run the LEARN stage if enabled. Called after pipeline termination."""
    if not is_learn_enabled(settings_path):
        return
    _log("Running learn stage...", "info")
    try:
        # Feed context
        prompt_builder.update_context("full_status", status)
        prompt_builder.update_context("termination_type", termination_type)
        prompt_builder.update_context("termination_reason", termination_reason or "")
        plan_path = status.get("plan_file")
        if plan_path and os.path.exists(plan_path):
            with open(plan_path) as f:
                prompt_builder.update_context("plan_file_content", f.read())

        # Initialize learn stage in status
        actual_status_path = os.path.join(run_dir, "status.json") if run_dir else ".worca/status.json"
        status["stages"]["learn"] = {"status": "pending"}
        iter_record = start_iteration(status, "learn", agent="learner",
                                      model="sonnet", trigger="initial")

        rendered = prompt_builder.build("learn", 0)
        result, raw = run_stage(Stage.LEARN, {}, settings_path, msize=msize,
                                prompt_override=rendered)

        # Complete iteration
        complete_iteration(status, "learn", status="completed", outcome="success",
                          completed_at=datetime.now(timezone.utc).isoformat(),
                          output=result)
        update_stage(status, "learn", status="completed")

        # Save standalone learnings file
        if run_dir:
            learnings_path = os.path.join(run_dir, "learnings.json")
            with open(learnings_path, "w") as f:
                json.dump(result, f, indent=2)
        save_status(status, actual_status_path)
        _log("Learnings saved", "ok")
    except Exception as e:
        _log(f"Learn stage failed (non-fatal): {e}", "warn")
        try:
            complete_iteration(status, "learn", status="error", error=str(e),
                              completed_at=datetime.now(timezone.utc).isoformat())
            update_stage(status, "learn", status="error", error=str(e))
            save_status(status, actual_status_path)
        except Exception:
            pass
```

**Wire into termination paths** in `run_pipeline()`:

After the success path (before `return status`):
```python
_run_learn_stage(status, prompt_builder, settings_path, run_dir,
                 "success", "", msize, logs_dir)
```

Wrap the main try block's exception handling — add before the existing `finally:` block:
```python
except PipelineInterrupted:
    raise  # Do NOT run learn on user interruption
except LoopExhaustedError as e:
    _run_learn_stage(status, prompt_builder, settings_path, run_dir,
                     "loop_exhausted", str(e), msize, logs_dir)
    raise
except PipelineError as e:
    _run_learn_stage(status, prompt_builder, settings_path, run_dir,
                     "failure", str(e), msize, logs_dir)
    raise
except Exception as e:
    _run_learn_stage(status, prompt_builder, settings_path, run_dir,
                     "failure", str(e), msize, logs_dir)
    raise
```

Note: These `except` blocks must be placed at the outer try level (line 622's try), catching exceptions that bubble up from the stage loop. The existing per-stage exception handling catches and re-raises, so the outer handlers will catch them.

### 1.6 Modify `settings.json` — `.claude/settings.json`

Add under `worca.stages`:
```json
"learn": { "agent": "learner", "enabled": false }
```

Add under `worca.agents`:
```json
"learner": { "model": "sonnet", "max_turns": 50 }
```

---

## Part 2: UI — Learnings View

### 2.1 Stage Timeline — show LEARN stage icon

**File**: `.claude/worca-ui/app/views/stage-timeline.js`

The timeline renders from `Object.entries(stages)`. Since the learn stage will be in `status.stages.learn` when it runs (or when the UI adds it), it will appear in the timeline automatically.

For the **disabled/not-yet-run** case: the UI needs to inject a synthetic `learn` entry into the stages object when it's absent. This happens in `run-detail.js` before passing stages to `stageTimelineView()`.

Icon states:
- **Disabled & not run**: Use a new status `"skipped"` — render with a muted/dashed circle icon
- **Running**: Standard `in_progress` spinner
- **Completed**: Standard `completed` green checkmark

**Modifications to `status-badge.js`**:
- Add `skipped: 'status-skipped'` to `CLASS_MAP`
- Add `skipped` icon mapping — reuse `Circle` but with a different class (`status-skipped` styled as muted/dashed)

**Modifications to `stage-timeline.js`**:
- Add `skipped: Circle` to `STAGE_ICON` map (same circle icon, styled differently via CSS)

### 2.2 Create learnings section view: `.claude/worca-ui/app/views/learnings-panel.js`

New file. Export `learningsSectionView(learnings, options)`.

**Structure**:
```html
<div class="learnings-section">
  <sl-details class="learnings-panel">
    <div slot="summary" class="learnings-header">
      <span class="learnings-icon">{Lightbulb icon}</span>
      <span class="learnings-title">Learnings</span>
      <span class="learnings-count">{N observations}</span>
    </div>

    <!-- If no learnings data and learn stage disabled/not run -->
    <div class="learnings-empty">
      <p>Learning analysis has not been run for this pipeline execution.</p>
      <sl-button variant="primary" size="small" @click=${options.onRunLearn}
        ?disabled=${options.learnRunning}>
        ${options.learnRunning ? 'Analyzing...' : 'Run Learning Analysis'}
      </sl-button>
    </div>

    <!-- If learnings data exists -->
    <!-- Run Summary strip -->
    <div class="learnings-summary-strip">
      <span>Termination: {type}</span>
      <span>Iterations: {N}</span>
      <span>Test-fix loops: {N}</span>
      <span>Review-fix loops: {N}</span>
    </div>

    <!-- Observations table -->
    <h4 class="learnings-table-title">Observations</h4>
    <div class="learnings-table">
      <div class="learnings-table-header">
        <span>Importance</span>
        <span>Category</span>
        <span>Description</span>
        <span>Evidence</span>
        <span>Count</span>
      </div>
      ${observations.map(obs => html`
        <div class="learnings-table-row">
          <sl-badge variant="${importanceBadge(obs.importance)}" pill>
            ${obs.importance}
          </sl-badge>
          <span class="learnings-category">${obs.category}</span>
          <span>${obs.description}</span>
          <span class="learnings-evidence">${obs.evidence}</span>
          <span>${obs.occurrences || 1}</span>
        </div>
      `)}
    </div>

    <!-- Suggestions table -->
    <h4 class="learnings-table-title">Suggestions</h4>
    <div class="learnings-table">
      <div class="learnings-table-header">
        <span>Target</span>
        <span>Suggestion</span>
        <span>Rationale</span>
      </div>
      ${suggestions.map(s => ...)}
    </div>

    <!-- Recurring Patterns (if any) -->
    <!-- Similar table sections for cross_bead, test_fix_loops, review_fix_loops -->
  </sl-details>
</div>
```

**Icon**: Import `Lightbulb` from lucide (add to `icons.js`).

### 2.3 Modify `run-detail.js` — inject learn stage into timeline

In `runDetailView()`, before passing `stages` to `stageTimelineView()`:
- If `stages.learn` doesn't exist, inject `{ learn: { status: "skipped" } }` so the timeline shows the learn node
- This ensures LEARN always appears in the timeline after PR

### 2.4 Modify `main.js` — wire learnings into run detail

**Import** `learningsSectionView` from `./views/learnings-panel.js`

**Add state variables** near other state vars:
```javascript
let learnRunning = false;
```

**Add handler**:
```javascript
async function handleRunLearn() {
  learnRunning = true;
  rerender();
  try {
    const activeRun = Object.values(store.getState().runs)
      .find(r => r.id === route.runId);
    const runId = activeRun?.id || route.runId;
    const res = await fetch(`/api/runs/${runId}/learn`, { method: 'POST' });
    const data = await res.json();
    if (!data.ok) {
      showActionError(data.error || 'Failed to run learning analysis');
    }
    // Status file watcher will update the UI when learnings are ready
  } catch (err) {
    showActionError(err?.message || 'Failed to run learning analysis');
  } finally {
    learnRunning = false;
    rerender();
  }
}
```

**Render** in the run detail layout (after `runBeadsSectionView`):
```javascript
${learningsSectionView(
  run?.stages?.learn?.iterations?.[0]?.output,
  { onRunLearn: handleRunLearn, learnRunning }
)}
```

### 2.5 Add API endpoint: `server/app.js`

**New endpoint**: `POST /api/runs/:id/learn`

```javascript
app.post('/api/runs/:id/learn', async (req, res) => {
  // Similar to restartStage but runs learn stage specifically
  // 1. Find status.json for the run
  // 2. Verify pipeline is not currently running
  // 3. Spawn: python .claude/scripts/run_learn.py --run-id <id>
  // 4. Return { ok: true }
});
```

### 2.6 Create script: `.claude/scripts/run_learn.py`

Standalone script that:
1. Loads status.json for the given run
2. Initializes a PromptBuilder with the work request
3. Calls `_run_learn_stage()` (extracted as importable function)
4. Saves results

This reuses the same `_run_learn_stage` logic from runner.py but can be invoked independently.

### 2.7 Add CSS to `.claude/worca-ui/app/styles.css`

Following existing patterns (`.run-beads-*`):

```css
/* Learnings section */
.learnings-section { /* same margin as .run-beads-section */ }
.learnings-panel::part(base) { /* same as .run-beads-panel */ }
.learnings-header { /* flex, gap, icon, title, count — same pattern */ }

/* Skipped status for timeline */
.status-skipped { color: var(--muted); opacity: 0.5; }
.stage-node.status-skipped .stage-icon { border-style: dashed; }

/* Table styling */
.learnings-table {
  display: grid;
  gap: 1px;
  background: var(--border-subtle);
  border-radius: var(--radius);
  overflow: hidden;
}
.learnings-table-header {
  display: grid;
  grid-template-columns: 80px 100px 1fr 1fr 50px;
  gap: 12px;
  padding: 8px 12px;
  background: var(--bg-tertiary);
  font-weight: 600;
  font-size: 12px;
}
.learnings-table-row {
  display: grid;
  grid-template-columns: 80px 100px 1fr 1fr 50px;
  gap: 12px;
  padding: 8px 12px;
  background: var(--bg-secondary);
  font-size: 13px;
}
```

### 2.8 Modify `settings-reader.js` — expose learn enabled status

Add to returned settings object:
```javascript
learnEnabled: worca.stages?.learn?.enabled || false
```

So the UI knows whether learn is enabled and can show the manual run button accordingly.

---

## Implementation Order

1. Create `learn.json` schema
2. Create `learner.md` agent
3. Modify `stages.py` — add LEARN to enum + maps + `is_learn_enabled()`
4. Modify `prompt_builder.py` — add `_build_learn()`
5. Modify `runner.py` — add `_STAGE_PROMPT_PREFIX`, `_run_learn_stage()`, wire into termination paths
6. Update `settings.json` — add stage + agent config
7. Create `run_learn.py` script
8. Add `Lightbulb` icon to `icons.js`
9. Add `skipped` status to `status-badge.js` and `stage-timeline.js`
10. Create `learnings-panel.js` view
11. Modify `run-detail.js` — inject synthetic learn stage for timeline
12. Modify `main.js` — import, handler, render
13. Add `POST /api/runs/:id/learn` to `server/app.js`
14. Modify `settings-reader.js` — expose learnEnabled
15. Add CSS for learnings + skipped status to `styles.css`
16. Rebuild UI: `cd .claude/worca-ui && npm run build`

---

## Key Files

| File | Action |
|------|--------|
| `.claude/worca/schemas/learn.json` | Create |
| `.claude/agents/core/learner.md` | Create |
| `.claude/scripts/run_learn.py` | Create |
| `.claude/worca-ui/app/views/learnings-panel.js` | Create |
| `.claude/worca/orchestrator/stages.py` | Modify (enum, maps, helper) |
| `.claude/worca/orchestrator/prompt_builder.py` | Modify (add `_build_learn`) |
| `.claude/worca/orchestrator/runner.py` | Modify (prefix, function, wiring) |
| `.claude/settings.json` | Modify (add learn stage+agent config) |
| `.claude/worca-ui/app/utils/icons.js` | Modify (add Lightbulb) |
| `.claude/worca-ui/app/utils/status-badge.js` | Modify (add skipped) |
| `.claude/worca-ui/app/views/stage-timeline.js` | Modify (add skipped icon) |
| `.claude/worca-ui/app/views/run-detail.js` | Modify (inject learn stage) |
| `.claude/worca-ui/app/main.js` | Modify (import, handler, render) |
| `.claude/worca-ui/server/app.js` | Modify (add POST endpoint) |
| `.claude/worca-ui/server/settings-reader.js` | Modify (expose learnEnabled) |
| `.claude/worca-ui/app/styles.css` | Modify (learnings + skipped CSS) |

## Verification

1. **Backend disabled (default)**: Run pipeline → confirm no learn stage runs, `status.json` has no `learn` key
2. **Backend enabled**: Set `worca.stages.learn.enabled: true`, run pipeline → confirm `learnings.json` appears in run dir with valid schema output
3. **Failure path**: Force a test failure → confirm learn runs before error propagates
4. **Interruption**: SIGINT during run → confirm learn does NOT run
5. **UI timeline**: Open a completed run → verify LEARN appears after PR in timeline with "skipped" styling (muted/dashed)
6. **UI manual run**: Click "Run Learning Analysis" button → confirm it triggers the API, shows loading state, then renders results in table
7. **UI learnings display**: After learn completes, verify observations and suggestions tables render correctly with proper importance badges
8. **Build**: `cd .claude/worca-ui && npm run build` succeeds without errors
