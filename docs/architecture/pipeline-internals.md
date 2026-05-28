# Pipeline Internals

How the worca pipeline orchestrator executes stages, manages state, and handles failures. All file references are relative to `src/worca/`.

## 1. Overview: stages and ordering

The `Stage` enum (`orchestrator/stages.py:7`) defines 9 pipeline stages:

```
PREFLIGHT → PLAN → PLAN_REVIEW → COORDINATE → IMPLEMENT → TEST → REVIEW → PR → LEARN
```

`STAGE_ORDER` (`orchestrator/stages.py:73`) is the canonical execution order — an 8-element list (LEARN is excluded; it runs as a post-pipeline epilogue). The order is not configurable; stages are skipped via the enabled flag.

`TRANSITIONS` (`orchestrator/stages.py:20`) defines the valid directed edges between stages. The loopback edges are:

- `TEST → IMPLEMENT` (test failures)
- `REVIEW → IMPLEMENT` (request changes)
- `REVIEW → PLAN` (restart planning)
- `PLAN_REVIEW → PLAN` (revise plan)

`get_enabled_stages()` (`orchestrator/stages.py:125`) reads `worca.stages.<stage>.enabled` from settings.json. Stages in `_STAGES_DEFAULT_DISABLED` (`orchestrator/stages.py:76`) — currently `PLAN_REVIEW` and `LEARN` — default to disabled. All other stages default to enabled.

Each stage maps to an agent via `STAGE_AGENT_MAP` (`orchestrator/stages.py:31`): PREFLIGHT has no agent (it runs a Python script directly), PLAN→planner, PLAN_REVIEW→plan_reviewer, COORDINATE→coordinator, IMPLEMENT→implementer, TEST→tester, REVIEW→reviewer, PR→guardian, LEARN→learner.

## 2. Entry points

Three functions form the execution hierarchy:

### `run_pipeline()` (`orchestrator/runner.py:1732`)

The top-level orchestrator. Accepts a `WorkRequest`, optional plan file, resume flag, and configuration paths. Responsibilities:

1. Branch creation or detection (worktree mode detects the existing branch)
2. Status initialization via `init_status()` or loading existing status for resume
3. Signal handler and atexit registration
4. EventContext creation for structured event emission
5. PromptBuilder initialization with overlay resolver
6. The main stage execution loop (see section 3)
7. Terminal status handling (completed/failed/interrupted)
8. Learn stage epilogue

### `run_preflight()` (`orchestrator/runner.py:1494`)

Runs the preflight checks script (default: `.claude/worca/scripts/preflight_checks.py`) as a subprocess. Parses JSON output, logs each check, and appends graphify preflight results. Unlike other stages, PREFLIGHT does not spawn a Claude agent — it executes a Python script directly.

### `run_stage()` (`orchestrator/runner.py:1180`)

Runs a single agent-backed stage. Gets stage config via `get_stage_config()` (`orchestrator/stages.py:89`), resolves the agent path (overlay-merged template or default), and calls `run_agent()` from `utils/claude_cli.py`. Returns a `(structured_output, raw_envelope)` tuple. The structured output conforms to the stage's JSON schema (mapped in `STAGE_SCHEMA_MAP`, `orchestrator/stages.py:54`); the raw envelope is the full Claude CLI response for logging and metrics.

Key parameters: `msize` multiplies max_turns, `prompt_override` injects the resolved block template as the `-p` user message, `agent_override` passes the per-iteration resolved agent `.md` file, `env_overrides` carries `CLAUDE_CODE_EFFORT_LEVEL`, and `graphify_out` exports the `GRAPHIFY_OUT` env var for on-demand graph queries.

## 3. Stage execution loop

The main loop (`orchestrator/runner.py:2198`) is a `while stage_idx < len(stage_order)` loop that advances through the enabled stages. Each iteration:

### 3.1 Control file polling

`_check_control_file()` (`orchestrator/runner.py:190`) reads `.worca/runs/{run_id}/control.json` at the top of each iteration. On `pause`: sets `pipeline_status=paused`, mirrors to registry, exits. On `stop`: SIGTERMs the Claude subprocess, raises `PipelineInterrupted`.

### 3.2 Skip logic

Two skip paths:

- **Pre-marked skipped** (`runner.py:2205`): stages with `skipped=True` (e.g., PLAN when a `plan_file` is provided) advance immediately.
- **Resume skip** (`runner.py:2215`): on resume, stages already `"completed"` are skipped until the actual resume point is reached. Once a non-completed stage is found, `resume_stage` is cleared so subsequent loopbacks don't incorrectly skip stages.

### 3.3 Trigger tracking

`_next_trigger` (`runner.py:2196`) is a dict mapping `{stage_value: trigger_reason}`. Loopback code sets the trigger before rewinding `stage_idx`. At the top of each iteration, the trigger is popped (`runner.py:2227`) — defaulting to `"initial"`. Possible triggers: `initial`, `next_bead`, `test_failure`, `review_changes`, `plan_review_revise`, `restart_planning`.

### 3.4 Effort resolution

For non-PREFLIGHT stages with an agent (`runner.py:2248`), effort is resolved via `resolve_effort()` (`orchestrator/effort.py`). The resolution considers:

- Per-agent configured effort (`worca.agents.<agent>.effort`)
- Auto mode (`disabled`/`reactive`/`adaptive`)
- Bead-classified effort labels (in adaptive mode)
- Escalation depth on loopbacks via `escalation_iter_num()` (`orchestrator/effort.py`)
- Model-aware ladders (`MODEL_EFFORT_LADDERS`, `orchestrator/effort.py:21`) — Opus 4.6 and Sonnet 4.6 use a 4-rung ladder (low/medium/high/max)
- Auto cap (default `xhigh`)

The resolved level passes to the agent subprocess via `CLAUDE_CODE_EFFORT_LEVEL` in `env_overrides`.

### 3.5 Iteration records

`start_iteration()` (`state/status.py:134`) appends a new entry to `stages[stage].iterations[]` with number, status (`in_progress`), started_at, agent, model, trigger, and effort dict. Any previous `in_progress` iteration is marked `interrupted`. The iteration number is `len(iterations) + 1`.

`complete_iteration()` (`state/status.py:177`) merges completion kwargs (status, completed_at, duration_ms, turns, cost_usd, token_usage, prompt, output) into the last iteration entry.

### 3.6 Agent template resolution

For non-PREFLIGHT stages (`runner.py:2372`), the runner:

1. Calls `prompt_builder.build_context()` to assemble the context dict
2. Reads the overlay-merged agent `.md` template from `{run_dir}/agents/{agent}.md`
3. Calls `resolve_agent()` (`orchestrator/overlay.py`) to substitute `{{placeholder}}` tokens and resolve `{{block:name}}` references
4. Writes the resolved template to `{run_dir}/agents/resolved/{stage}-{agent}-iter-{N}.md`
5. Resolves the stage's `.block.md` (mapped in `_STAGE_BLOCK_MAP`, `runner.py:94`) via the overlay resolver and passes it as the `-p` user message (prompt_override)

## 4. status.json lifecycle

### Initialization

`init_status()` (`state/status.py:281`) creates a fresh status dict with:
- `schema_version: 1`
- `pipeline_status: "pending"`
- `stage: "plan"`
- All stages in `PIPELINE_STAGES` set to `{status: "pending"}`
- Milestones: `plan_approved`, `pr_approved`, `deploy_approved`, `pr_verified` (all null)
- `loop_counters: {}`, `git_head`, `started_at`, `run_id`

### Per-stage updates

Each stage transition follows this sequence:
1. `update_stage(status, stage, status="in_progress", ...)` — sets stage-level metadata (agent, model, started_at)
2. `start_iteration(status, stage, ...)` — appends iteration record
3. `save_status(status, path)` — atomic write to disk
4. *(stage executes)*
5. `complete_iteration(status, stage, ...)` — merges completion data into iteration
6. `update_stage(status, stage, status="completed", ...)` — marks stage done
7. `save_status(status, path)` — atomic write

### Atomic writes

`save_status()` (`state/status.py:82`) writes to a temp file in the same directory via `tempfile.mkstemp()`, then `os.replace()` for atomic replacement. This prevents corruption if the pipeline crashes mid-write. The same pattern is used by `PromptBuilder.save_context()` (`orchestrator/prompt_builder.py:109`).

### Terminal states

`PipelineStatus` (`state/status.py:10`) defines 10 states. Terminal states are grouped in frozen sets:
- `PIPELINE_TERMINAL` (`state/status.py:44`): `COMPLETED`, `INTERRUPTED`
- `PIPELINE_FAILURE` (`state/status.py:45`): `FAILED`, `SETUP_FAILED`, `UNRECOVERABLE`
- `PIPELINE_ALL_TERMINAL` (`state/status.py:48`): union of the above plus `CANCELLED`

### Milestones

`set_milestone()` (`state/status.py:122`) sets `status['milestones'][milestone] = value`. Key milestones:
- `plan_approved` — set after PLAN stage, default true (webhook can override to reject)
- `pr_approved` — opt-in gate before PR creation (`worca.milestones.pr_approval`)
- `pr_verified` — set after post-condition verification of the guardian's PR

## 5. Loopback mechanisms

Four loopback paths exist, each gated by configurable loop limits (`worca.loops.<key>` in settings.json, default 5, multiplied by `mloops`):

### 5.1 Test → Implement (`runner.py:3229`)

When the tester reports `passed=false`:
1. Test failures are threaded into PromptBuilder context (`test_failures`, `test_failure_history`)
2. `loop_counters["implement_test"]` increments
3. `bead_prompt_iteration` increments (drives `is_retry` in implement context)
4. If within loop limit: sets `_next_trigger["implement"] = "test_failure"`, rewinds `stage_idx` to IMPLEMENT
5. If exhausted: logs warning, emits `LOOP_EXHAUSTED`, falls through to REVIEW

### 5.2 Review → Implement (`runner.py:3340`)

When the reviewer returns `outcome="request_changes"` with critical/major issues:
1. Review issues are threaded into PromptBuilder context (`review_issues`, `review_history`)
2. `loop_counters["pr_changes"]` increments
3. If within loop limit: sets `_next_trigger["implement"] = "review_changes"`, rewinds to IMPLEMENT
4. If exhausted: logs warning, emits `LOOP_EXHAUSTED`, falls through

Minor/suggestion-only issues are treated as approve (severity gate at `runner.py:3344`).

### 5.3 Review → Plan (`runner.py:3400`)

When the reviewer returns `outcome="restart_planning"`:
1. `loop_counters["restart_planning"]` increments
2. If within loop limit: sets `_next_trigger["plan"] = "restart_planning"`, rewinds to PLAN
3. If exhausted: raises `LoopExhaustedError`

### 5.4 Plan Review → Plan (`runner.py:2927`)

When the plan reviewer returns `outcome="revise"` with critical/major issues:
1. Review feedback threaded into context (`plan_review_issues`, `plan_review_history`, `plan_revision_mode=True`)
2. `loop_counters["plan_review"]` increments
3. Atomic loop-back sequence: resets PLAN stage status to `pending`, clears `plan_approved` milestone, persists context + status, re-renders agent templates, then rewinds to PLAN
4. If exhausted: unresolved critical issues are carried forward to COORDINATE via `unresolved_plan_issues` context key

## 6. Bead iteration (Phase 1 fan-out)

The coordinator decomposes work into beads (tracked via the `bd` CLI). The implementer processes them sequentially in a fan-out loop (`runner.py:2347`).

### Cycle

1. **Query**: `_query_ready_bead()` (`runner.py:1656`) calls `bd ready` filtered by `run:{run_id}` label and allowed bead IDs
2. **Claim**: `_claim_bead()` (`runner.py:1681`) sets the bead to `in_progress` via `bd update`
3. **Context**: bead ID, title, and description are loaded into PromptBuilder (`assigned_bead_id`, `assigned_bead_title`, `assigned_bead_description`)
4. **Implement**: the implementer runs with the bead's task as the assigned task
5. **Close**: on success, `bd_close(bead_id, reason="implemented")` (`runner.py:3106`)
6. **Accumulate**: files changed and tests added are accumulated across all beads (`all_files_changed`, `all_tests_added`)
7. **Next**: `_query_ready_bead()` checks for more beads. If found and `bead_iteration < max_beads`: sets `_next_trigger["implement"] = "next_bead"`, rewinds to IMPLEMENT (`runner.py:3144`)

The IMPLEMENT stage is not marked `"completed"` until all beads are processed — this ensures resume re-enters IMPLEMENT to handle remaining beads.

Design notes from each bead are accumulated via `_accumulate_design_note()` (`runner.py:1632`) and surfaced to subsequent beads as `accumulated_design_notes` in the prompt context.

## 7. Context threading via PromptBuilder

`PromptBuilder` (`orchestrator/prompt_builder.py:27`) is the context assembler that threads inter-stage outputs through the pipeline.

### Accumulation

Each stage's handler in the main loop stores outputs into PromptBuilder via `update_context()`:
- **PLAN**: `plan_approach`, `plan_tasks_outline`, `plan_file_content`
- **PLAN_REVIEW**: `plan_review_issues`, `plan_review_history`, `plan_revision_mode`
- **COORDINATE**: `beads_ids`, `dependency_graph`
- **IMPLEMENT**: `files_changed`, `tests_added`, `all_files_changed`, `all_tests_added`, `assigned_bead_id`
- **TEST**: `test_passed`, `test_coverage`, `proof_artifacts`, `test_failures`, `test_failure_history`
- **REVIEW**: `review_issues`, `review_history`

### `build_context()` (`orchestrator/prompt_builder.py:162`)

Assembles the context dict for a given stage and iteration:
1. Copies all accumulated `_context` keys
2. Adds computed values: `work_request`, `assigned_task`, `guide_content`, `has_guide`, `has_graphify`, `accumulated_design_notes`
3. Delegates to `_apply_stage_context()` (`orchestrator/prompt_builder.py:194`) for stage-specific key population (mode routing like `plan_revision_mode`, `is_retry`, pre-formatting of test failures and review issues into Markdown)

The returned dict is used by `resolve_agent()` to substitute `{{placeholder}}` tokens in agent templates.

### Persistence

`save_context()` (`orchestrator/prompt_builder.py:109`) persists the context dict to `{run_dir}/prompt_context.json` using atomic temp+rename. Capped at 100KB by dropping oldest-inserted keys. Called after each completed stage and before loopbacks. `load_context()` (`orchestrator/prompt_builder.py:144`) restores context on resume.

## 8. Error handling and circuit breaker

### Exception hierarchy

- `PipelineError` (`runner.py:138`) — unrecoverable errors (plan rejected, PR rejected)
- `CircuitBreakerTripped(PipelineError)` (`runner.py:143`) — circuit breaker halted the pipeline
- `LoopExhaustedError` (`runner.py:133`) — loop limit exceeded
- `PipelineInterrupted` (`runner.py:148`) — signal, control file, or control webhook interruption; carries `stop_reason`

### Error classification (`orchestrator/error_classifier.py`)

When a stage raises an exception and the circuit breaker is enabled (`worca.circuit_breaker.enabled`), the error flows through:

1. **`classify_error()`** (`error_classifier.py:80`) — calls Claude Haiku to classify the error into one of 5 categories:
   - `infra_transient` — temporary (API rate limit, network timeout); retriable
   - `infra_permanent` — permanent (auth failure, invalid model ID); not retriable
   - `logic_stuck` — agent logic loop; not retriable
   - `env_missing` — missing tool/environment; not retriable
   - `unknown` — cannot determine; not retriable
   
   Results are cached by `(stage_name, error_message)` for 5 minutes.

2. **`record_failure()`** (`error_classifier.py:189`) — increments `consecutive_failures` (pipeline-global, not per-stage) and appends to `failure_history` (capped at 20 entries).

3. **`should_halt()`** (`error_classifier.py:210`) — returns `(True, reason)` when:
   - Category is `infra_permanent`, `env_missing`, or `logic_stuck` (immediate halt)
   - `consecutive_failures >= max_consecutive_failures` (default 3)

4. **Transient retry** (`runner.py:2614`) — when retriable and category is `infra_transient`:
   - `get_retry_delay()` (`error_classifier.py:239`) returns backoff from `transient_retry_backoff_seconds` (default `[10, 30, 90]`)
   - Sleeps for the delay, kills tracked process groups, then `continue` to retry the same stage

5. **`record_success()`** (`error_classifier.py:204`) — resets `consecutive_failures` to 0 on any successful stage.

## 9. Signal handling and crash safety

A 4-layer model ensures status.json never gets stuck in `"running"` after the pipeline stops:

### Layer 1: Signal handler (`runner.py:625`)

`_install_signal_handlers()` registers a `SIGTERM`/`SIGINT` handler that:
1. Sets `_shutdown_requested = True`
2. Calls `terminate_current()` to kill the active Claude subprocess
3. Immediately persists `pipeline_status = "interrupted"` to status.json via the `_signal_status` reference
4. Emits an interrupted event (signal-safe: writes to events.jsonl only, no network I/O)
5. Removes PID files

### Layer 2: In-loop shutdown checks

Two check points in the stage loop:
- Before context building (`runner.py:2334`): if `_shutdown_requested`, marks iteration interrupted and raises `PipelineInterrupted`
- Before subprocess spawn (`runner.py:2496`): second check for signals arriving during the ~160-line context building gap

### Layer 3: Exception routing (`runner.py:2529`)

The exception handler in the stage execution `try/except` checks both `_shutdown_requested` and `_is_signal_kill_exception()` (`runner.py:170`). The latter detects when a subprocess was killed by signal (negative returncode) before Python's signal handler has run — a race condition where the C-level exception reaches the except block while `_shutdown_requested` is still False.

### Layer 4: atexit cleanup (`runner.py:665`)

`_atexit_cleanup()` fires on normal Python exit (covers `os._exit` cases where the `finally` block doesn't run):
- If status is still `"running"`: flips to `INTERRUPTED` (if event context exists) or `FAILED`
- Sets `stop_reason = "unexpected_exit"`
- Dispatches any stashed signal events to webhooks/integrations
- Mirrors terminal status into the multi-pipeline registry
- Cleans up PID files

The exception handlers in `run_pipeline()` (`runner.py:3705`) route terminal states: `PipelineInterrupted` → `INTERRUPTED`, `LoopExhaustedError` → `FAILED`, other exceptions → `FAILED`. The learn stage runs on all terminal paths except user interruption. The `finally` block (`runner.py:3776`) kills any tracked process groups, dispatches signal-stashed events, and closes the event context.
