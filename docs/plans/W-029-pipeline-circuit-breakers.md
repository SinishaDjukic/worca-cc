# W-029: Pipeline Circuit Breakers — Preflight Stage + Error Classification

## Context

The worca-cc pipeline currently has minimal pre-validation and no runtime circuit breaking. If `claude` CLI isn't authenticated, `bd` isn't installed, or the venv isn't active, the pipeline only discovers this mid-run — after burning API tokens. Similarly, persistent errors (API outages, agents stuck in loops) cause the pipeline to either crash immediately with no retry, or exhaust all loop iterations before stopping.

This plan adds two complementary systems:
1. **PREFLIGHT stage** — a script-based stage (no Claude agent) that validates the environment before any tokens are spent
2. **Error Classifier + Circuit Breaker** — uses Claude haiku to classify errors at runtime, then applies intelligent retry/halt policies

Together: preflight catches setup issues cheaply; the circuit breaker catches runtime issues intelligently.

## Design Decisions

- **PREFLIGHT is a real stage** in the pipeline (in `STAGE_ORDER`, tracked in `status.json`), but runs a Python script instead of `claude -p`. This reuses all existing status tracking, logging, and resume machinery.
- **Always re-runs on `--resume`** — environment state may have changed since last run.
- **Skippable with `--skip-preflight`** for fast iteration when you know your env is fine.
- **Error classification uses haiku** — cheap and fast. If the classifier call itself fails, that's just another consecutive failure for the counter.
- **`CircuitBreakerTripped` extends `PipelineError`** so existing catch blocks in `main()` handle it without changes.
- **Circuit breaker state persists in `status.json`** under `circuit_breaker` key, surviving `--resume`.

---

## Part 1: PREFLIGHT Stage

### 1.1 Modify `stages.py`

**File:** `.claude/worca/orchestrator/stages.py`

Add `PREFLIGHT = "preflight"` as first member of `Stage` enum (before PLAN).

Update maps:
- `TRANSITIONS`: add `Stage.PREFLIGHT: {Stage.PLAN}`
- `STAGE_ORDER`: prepend `Stage.PREFLIGHT`
- `STAGE_AGENT_MAP`: add `Stage.PREFLIGHT: None` (script-based, no agent)
- `STAGE_SCHEMA_MAP`: add `Stage.PREFLIGHT: None`

Guard `get_stage_config()` for `agent_name is None` — return early with a null config dict. Use `.get()` instead of `[]` for the map access.

### 1.2 Modify `status.py`

**File:** `.claude/worca/state/status.py`

Add `"preflight"` to the `PIPELINE_STAGES` constant so `init_status()` creates the entry.

### 1.3 Create preflight script

**File:** `.claude/scripts/preflight_checks.py` (NEW)

Standalone script, no worca imports. Runs checks sequentially, outputs JSON on stdout.

Since worca-cc is portable (`cp -R .claude/` into any project), the default checks must be **language-agnostic**. Language/tool-specific checks default to `"warn"` and can be promoted to `"fail"` per-project via `worca.preflight.require` in settings.json.

**Checks — always fail (universal, required by pipeline):**

| Check | What it validates |
|---|---|
| `claude_cli` | `shutil.which("claude")` + `claude --version` |
| `git_repo` | `git rev-parse --is-inside-work-tree` |
| `bd_cli` | `shutil.which("bd")` |
| `settings_json` | exists, valid JSON, has `worca` key |
| `agent_templates` | all 5 core `.md` files present in `.claude/agents/core/` |
| `disk_space` | at least 1GB free |

**Checks — warn by default (language/tool-specific, opt-in to require):**

| Check | What it validates | Promote via |
|---|---|---|
| `gh_cli` | `shutil.which("gh")` | `"require": ["gh_cli"]` |
| `python_available` | `shutil.which("python3")` or `python` | `"require": ["python_available"]` |
| `pytest` | `shutil.which("pytest")` | `"require": ["pytest"]` |
| `node_available` | `shutil.which("node")` | `"require": ["node_available"]` |

The script reads `worca.preflight.require` (a list of check names) from settings.json. Any check listed there is promoted from `"warn"` to `"fail"`. Example for a Python project:

```json
"preflight": {
  "enabled": true,
  "script": ".claude/scripts/preflight_checks.py",
  "require": ["python_available", "pytest"]
}
```

**Output format:**
```json
{
  "status": "pass | fail",
  "checks": [
    {"name": "claude_cli", "status": "pass", "message": "claude CLI 1.0.40"},
    {"name": "node_available", "status": "warn", "message": "node not found (optional)"}
  ],
  "summary": "6/10 checks passed, 0 failed, 4 warnings"
}
```

**Exit codes:** 0 = all pass (warnings OK), 1 = one or more failures, 2 = script crashed.

Each check returns `"pass"`, `"fail"`, or `"warn"`. Only `"fail"` counts toward failure. Warnings are logged but do not block the pipeline.

### 1.4 Create `run_preflight()` in runner.py

**File:** `.claude/worca/orchestrator/runner.py`

New function near `run_stage()` (~line 486). Resolves script path from `worca.stages.preflight.script` setting (default: `.claude/scripts/preflight_checks.py`). If the script does not exist, **skip preflight with a warning** (log "Preflight script not found, skipping", mark stage as completed+skipped, return) — do not block the pipeline. When the script exists: runs via `subprocess.Popen()` with `sys.executable`. Captures stdout/stderr, writes to log file at `.worca/runs/{run_id}/logs/preflight/iter-{n}.log`. Parses JSON, logs each check result. Raises `PipelineError` on non-zero exit.

A default preflight script ships with worca-cc at `.claude/scripts/preflight_checks.py` (see 1.3). Users can replace or extend it via the `worca.stages.preflight.script` setting.

**Important:** When preflight fails, the LEARN stage must be **skipped**. Preflight failure means the environment is broken (e.g., `claude` CLI not found), so LEARN (which calls `claude -p`) would also fail. In the `except PipelineError` block in `run_pipeline()`, check `status["stage"] == "preflight"` and skip `_run_learn_stage()` if so.

### 1.5 Integrate into stage loop

In the main `while` loop, add a branch before `run_stage()`:

```python
if current_stage == Stage.PREFLIGHT:
    result = run_preflight(context, settings_path, iteration=iter_num)
    raw_envelope = {"type": "preflight", "checks": result.get("checks", [])}
else:
    result, raw_envelope = run_stage(...)
```

Guard prompt building, prompt storage, and token extraction to skip for PREFLIGHT (no prompts, no tokens).

Add PREFLIGHT completion handling before the existing PLAN case:
```python
if current_stage == Stage.PREFLIGHT:
    # log summary, mark complete, advance
```

### 1.6 Add `--skip-preflight` CLI flag

**File:** `.claude/scripts/run_pipeline.py`

Add `--skip-preflight` argument. Pass through to `run_pipeline()`. In the stage loop, when preflight is current and flag is set, mark as completed+skipped and advance.

### 1.7 Settings

Add to `.claude/settings.json` under `worca.stages`:
```json
"preflight": {
  "enabled": true,
  "script": ".claude/scripts/preflight_checks.py",
  "require": []
}
```

The `require` array is empty by default (language-agnostic). Projects add check names to promote them from warn to fail, e.g. `["python_available", "pytest"]` for Python projects or `["node_available"]` for Node projects.

---

## Part 2: Error Classification + Circuit Breaker

### 2.1 Create error_classifier.py

**File:** `.claude/worca/orchestrator/error_classifier.py` (NEW)

**Constants:** `CATEGORY_TRANSIENT`, `CATEGORY_PERMANENT`, `CATEGORY_LOGIC_STUCK`, `CATEGORY_ENV_MISSING`, `CATEGORY_UNKNOWN`

**`classify_error(error_message, stage_name, failure_history, settings_path)`**
- Builds a prompt with the error, stage context, and last 5 failure history entries
- Calls `claude -p` with haiku model, `--output-format json`, and a JSON schema
- Schema requires: `category` (enum), `retriable` (bool), `remediation` (string), `similar_to_previous` (bool), optional `confidence` (number)
- On any failure (subprocess error, bad JSON, timeout): returns fallback `{"category": "unknown", "retriable": false, "classifier_error": true}`

**Circuit breaker state management:**
- `init_circuit_breaker_state()` → `{consecutive_failures: 0, failure_history: [], tripped: false}`
- `get_circuit_breaker_state(status)` — get or init from status dict
- `record_failure(status, stage, error, classification)` — increment counter, append to history (capped at 20)
- `record_success(status)` — reset consecutive counter to 0
- `should_halt(status, classification, settings_path)` → `(bool, reason)`:
  - `infra_permanent` → halt immediately
  - `env_missing` → halt immediately
  - `logic_stuck` → halt immediately
  - `infra_transient` / `unknown` → halt if consecutive count >= threshold
- `get_retry_delay(attempt, settings_path)` → seconds or None if exhausted

### 2.2 New exception class

**File:** `.claude/worca/orchestrator/runner.py`

```python
class CircuitBreakerTripped(PipelineError):
    """Raised when the circuit breaker halts the pipeline."""
    pass
```

Extends `PipelineError` so existing `except PipelineError` in `main()` catches it.

### 2.3 Integrate into stage loop error handling

Replace the current `except Exception` block (runner.py ~lines 878-893):

1. Existing behavior preserved: mark iteration as error, update stage, save status
2. **New:** if circuit breaker enabled and stage is not PREFLIGHT:
   - Call `classify_error()` with error + failure history
   - Call `record_failure()` to update state
   - Store classification in the iteration record
   - Log the classification
   - Call `should_halt()` — if true, raise `CircuitBreakerTripped(reason)`
   - If transient + retriable: get delay, sleep, `continue` (re-run same stage)
   - Otherwise: `raise` (propagate as before)
3. If circuit breaker disabled: `raise` (existing behavior)

### 2.4 Reset on success

After successful stage completion, call `record_success(status)` to reset the consecutive failure counter.

### 2.5 Settings

Add to `.claude/settings.json` under `worca`:
```json
"circuit_breaker": {
  "enabled": true,
  "max_consecutive_failures": 3,
  "transient_retry_count": 3,
  "transient_retry_backoff_seconds": [10, 30, 90],
  "classifier_model": "haiku"
}
```

---

## Part 3: Resume Handling

**File:** `.claude/worca/orchestrator/resume.py`

- `find_resume_point()` must handle PREFLIGHT: always return PREFLIGHT as resume point (re-validate env on every resume), regardless of its previous completion status
- Circuit breaker state in `status["circuit_breaker"]` is automatically preserved through resume since it's part of the status dict

---

## Part 4: UI Rendering

The worca-ui already renders stages in a timeline with expandable iterations. PREFLIGHT will appear automatically since it's in `STAGE_ORDER`. However, the default rendering shows raw JSON — both preflight checks and error classifications deserve proper visual treatment.

### 4.1 Preflight checks view in iteration detail

**File:** `.claude/worca-ui/app/views/run-detail.js`

When the expanded stage is `preflight`, render the iteration output as a **checklist table** instead of raw JSON. Reuse the table pattern from `learnings-panel.js` (observations table).

Each check becomes a row:

| Status | Check | Message |
|---|---|---|
| `pass` (green checkmark) | `claude_cli` | claude CLI 1.0.40 |
| `warn` (yellow warning) | `node_available` | node not found (optional) |
| `fail` (red X) | `bd_cli` | bd command not found in PATH |

- Use `sl-badge` with variant `success`/`warning`/`danger` for the status column
- Show the summary line (`"6/10 checks passed, 0 failed, 4 warnings"`) above the table
- If the stage was skipped (`skipped: true`), show a neutral badge "Skipped" instead of the table

### 4.2 Error classification badge in iteration detail

**File:** `.claude/worca-ui/app/views/run-detail.js`

When an iteration has a `classification` field (set by the circuit breaker), render it as a **classification strip** below the existing error message. This is an addition to `_iterationDetailView()`.

```
[error message in red, existing behavior]
[classification strip — new]
  Category: sl-badge "infra_transient" (warning variant)
  Retriable: yes/no
  Remediation: "API rate limited. Wait 60s before retry."
  Similar to previous: yes/no
```

Badge variant mapping:
- `infra_transient` → `warning` (yellow)
- `infra_permanent` → `danger` (red)
- `logic_stuck` → `danger` (red)
- `env_missing` → `danger` (red)
- `unknown` → `neutral` (gray)

### 4.3 Circuit breaker status in run header

**File:** `.claude/worca-ui/app/views/run-detail.js`

When `status.circuit_breaker.tripped` is true, show a banner/badge in the run header area:

```
Circuit breaker tripped: "3 consecutive failures (threshold: 3)"
```

Use `sl-alert` with `variant="danger"` and the `tripped_reason` from the circuit breaker state.

Also show the consecutive failure count as a small indicator when > 0 but not yet tripped (e.g., `"2/3 failures"` in `warning` variant).

### 4.4 Build step

After modifying UI source files, run `npm run build` in `.claude/worca-ui/` to regenerate `app/main.bundle.js`.

### Key UI files

| File | Action | Purpose |
|---|---|---|
| `.claude/worca-ui/app/views/run-detail.js` | Modify | Preflight checklist, classification strip, CB banner |
| `.claude/worca-ui/app/styles.css` | Modify | Styles for checklist table, classification strip |

---

## Implementation Order

```
Steps 1-3 can be parallelized:
  Step 1: stages.py + status.py changes          [Part 1.1, 1.2]
  Step 2: preflight_checks.py script              [Part 1.3]
  Step 3: error_classifier.py module              [Part 2.1]

Then sequential:
  Step 4: settings.json additions                 [Part 1.7, 2.5]
  Step 5: runner.py integration (both features)   [Part 1.4, 1.5, 2.2, 2.3, 2.4]
  Step 6: run_pipeline.py CLI flag                [Part 1.6]
  Step 7: resume.py updates                       [Part 3]
  Step 8: UI rendering                            [Part 4.1, 4.2, 4.3, 4.4]
  Step 9: Tests
```

## Key Files

| File | Action | Purpose |
|---|---|---|
| `.claude/worca/orchestrator/stages.py` | Modify | Add PREFLIGHT to enum, maps, order |
| `.claude/worca/state/status.py` | Modify | Add "preflight" to PIPELINE_STAGES |
| `.claude/scripts/preflight_checks.py` | Create | Standalone env validation script |
| `.claude/worca/orchestrator/error_classifier.py` | Create | LLM classifier + circuit breaker state |
| `.claude/worca/orchestrator/runner.py` | Modify | Integrate both features into stage loop |
| `.claude/scripts/run_pipeline.py` | Modify | Add --skip-preflight flag |
| `.claude/worca/orchestrator/resume.py` | Modify | Handle PREFLIGHT on resume |
| `.claude/settings.json` | Modify | Add preflight + circuit_breaker config |
| `.claude/worca-ui/app/views/run-detail.js` | Modify | Preflight checklist, classification strip, CB banner |
| `.claude/worca-ui/app/styles.css` | Modify | Styles for new UI components |

## Verification

1. **Preflight pass:** Run pipeline normally — preflight should pass all checks and advance to PLAN
2. **Preflight fail:** Temporarily rename `claude` binary or break settings.json — preflight should fail with clear error, pipeline should not start any agent
3. **Skip preflight:** Run with `--skip-preflight` — should skip and proceed directly to PLAN
4. **Circuit breaker transient:** Simulate API failure (e.g., invalid model ID) — should classify as transient, retry with backoff, then trip after threshold
5. **Circuit breaker permanent:** Simulate auth failure — should classify as permanent, halt immediately
6. **Resume with preflight:** Run, interrupt mid-implement, resume — preflight should re-run
7. **Unit tests:** Test `preflight_checks.py` standalone, test `error_classifier.py` with mocked subprocess, test circuit breaker state management
