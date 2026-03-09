# W-007: Dry Run Mode

Validate pipeline configuration without executing agents.

---

## 1. Goal and Scope

**Goal:** Add a `--dry-run` flag to `run_pipeline.py` that performs comprehensive validation of the pipeline configuration -- settings, agent definitions, stage transitions, hook files, governance rules, schemas, and work request normalization -- without launching any Claude agents or creating branches. The output is a structured validation report that tells the operator exactly what is misconfigured before committing to an expensive pipeline run.

**Scope boundaries:**

- IN: Validate all static configuration files that the pipeline reads before or during execution.
- IN: Preview the normalized work request that would be produced from the given input.
- IN: Structured report output (JSON and human-readable) with per-check pass/warn/fail status.
- OUT: Does not validate runtime behavior (agent output quality, schema conformance of results).
- OUT: Does not validate external service connectivity (GitHub API, beads CLI) beyond checking that the CLI tools exist on PATH.
- OUT: Does not modify any files.

---

## 2. What to Validate

### 2.1 Settings File Structure

**Source:** `settings_path` argument (default `.claude/settings.json`)

| Check ID | Check | Severity |
|----------|-------|----------|
| `settings.parse` | File exists and is valid JSON | FAIL |
| `settings.worca_ns` | Top-level `worca` key exists | FAIL |
| `settings.stages_ns` | `worca.stages` key exists and is a dict | FAIL |
| `settings.agents_ns` | `worca.agents` key exists and is a dict | FAIL |
| `settings.loops_ns` | `worca.loops` key exists and is a dict | WARN |
| `settings.milestones_ns` | `worca.milestones` key exists and is a dict | WARN |
| `settings.governance_ns` | `worca.governance` key exists and is a dict | WARN |

### 2.2 Agent Configuration

**Source:** `worca.agents` in settings + `.claude/agents/core/{name}.md` files

| Check ID | Check | Severity |
|----------|-------|----------|
| `agent.file_exists.{name}` | Agent `.md` file exists at `_agent_path(name)` for each agent in `worca.agents` | FAIL |
| `agent.file_readable.{name}` | Agent `.md` file is readable and non-empty | FAIL |
| `agent.model_valid.{name}` | `model` value is one of known model identifiers (`opus`, `sonnet`, `haiku`) | WARN |
| `agent.max_turns_range.{name}` | `max_turns` is an integer in range 1..1000 | WARN |
| `agent.referenced.{name}` | Every agent referenced in `worca.stages.*.agent` exists in `worca.agents` | FAIL |
| `agent.orphaned.{name}` | Every agent in `worca.agents` is referenced by at least one stage | WARN |

### 2.3 Stage Transitions

**Source:** `stages.py` constants + `worca.stages` in settings

| Check ID | Check | Severity |
|----------|-------|----------|
| `stage.known.{name}` | Every key in `worca.stages` is a valid `Stage` enum value (`plan`, `coordinate`, `implement`, `test`, `review`, `pr`) | FAIL |
| `stage.agent_assigned.{name}` | Every enabled stage has an agent (explicit or via `STAGE_AGENT_MAP` fallback) | FAIL |
| `stage.schema_exists.{name}` | Schema file at `_schema_path(STAGE_SCHEMA_MAP[stage])` exists for each enabled stage | FAIL |
| `stage.schema_valid.{name}` | Schema file is valid JSON and has a `required` field | WARN |
| `stage.transitions_reachable` | All enabled stages form a reachable path from first to last using `TRANSITIONS` | WARN |
| `stage.plan_enabled` | `plan` stage is enabled (required for milestone gate) | WARN |
| `stage.pr_enabled` | `pr` stage is enabled (required for output) | WARN |
| `stage.enabled_type.{name}` | `enabled` field, if present, is a boolean | FAIL |

### 2.4 Loop Limits

**Source:** `worca.loops` in settings

| Check ID | Check | Severity |
|----------|-------|----------|
| `loop.known.{name}` | Every key in `worca.loops` is a recognized loop name (`implement_test`, `code_review`, `pr_changes`, `restart_planning`) | WARN |
| `loop.range.{name}` | Each loop limit is an integer in range 1..100 | WARN |
| `loop.excessive.{name}` | Warn if any loop limit exceeds 20 (likely misconfiguration) | WARN |
| `loop.zero.{name}` | Fail if any loop limit is 0 or negative (would prevent any retries) | FAIL |
| `loop.missing_defaults` | Warn if recognized loop names are absent (will use hardcoded default of 10) | WARN |

### 2.5 Hook Files

**Source:** `hooks` section of settings.json + `.claude/hooks/` directory + `.claude/worca/hooks/` directory

| Check ID | Check | Severity |
|----------|-------|----------|
| `hook.file_exists.{event}.{idx}` | Each hook command's script file exists on disk | FAIL |
| `hook.file_executable.{event}.{idx}` | Hook script has appropriate interpreter (checks `python3` is on PATH for `.py` hooks) | WARN |
| `hook.matcher_valid.{event}.{idx}` | Hook matcher pattern is a valid regex or pipe-delimited tool name list | WARN |
| `hook.event_known.{event}` | Hook event name is one of `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop`, `PreCompact`, `SubagentStart`, `SubagentStop`, `SessionStart`, `SessionEnd` | WARN |

### 2.6 Governance Rules

**Source:** `worca.governance` in settings

| Check ID | Check | Severity |
|----------|-------|----------|
| `gov.guards_type` | `governance.guards` is a dict of string keys to boolean values | FAIL |
| `gov.guard_known.{name}` | Each guard name is one of the recognized guards (`block_rm_rf`, `block_env_write`, `block_force_push`, `restrict_git_commit`) | WARN |
| `gov.test_gate_strikes_range` | `test_gate_strikes` is an integer in range 1..10 | WARN |
| `gov.dispatch_type` | `governance.dispatch` is a dict mapping agent names to arrays of agent names | FAIL |
| `gov.dispatch_agents_exist.{name}` | Every agent referenced in `dispatch` (keys and values) exists in `worca.agents` | WARN |

### 2.7 Work Request Normalization Preview

**Source:** the `--prompt`, `--source`, or `--spec` argument

| Check ID | Check | Severity |
|----------|-------|----------|
| `wr.normalize` | Work request normalizes without error | FAIL |
| `wr.title_nonempty` | Resulting `title` is non-empty | FAIL |
| `wr.spec_file_exists` | If `--spec`, the spec file exists | FAIL |
| `wr.source_format` | If `--source`, the format matches `gh:issue:N` or `bd:bd-XXXX` | FAIL |
| `wr.preview` | Display the normalized work request fields as informational output | INFO |

For `--source` inputs, dry run only validates the format of the reference string. It does not call `gh` or `bd` CLIs (those are external service calls).

---

## 3. CLI Interface

### 3.1 Flag Addition

Add `--dry-run` to the existing argument parser in `run_pipeline.py`:

```
parser.add_argument("--dry-run", action="store_true",
                    help="Validate configuration without running pipeline")
```

`--dry-run` is compatible with all existing input flags (`--prompt`, `--source`, `--spec`) and `--settings`. The `--msize` and `--mloops` flags are accepted but only used for report output (showing effective values after multiplication).

### 3.2 Behavior

When `--dry-run` is set:

1. Do NOT call `run_pipeline()`.
2. Do NOT create a git branch.
3. Do NOT write to `--status-dir`.
4. Do NOT call external services (GitHub API, beads CLI).
5. DO validate all static configuration.
6. DO normalize the work request (for `--prompt` and `--spec` only; `--source` validates format only).
7. DO print the validation report to stdout.
8. DO exit with the appropriate exit code (see section 7).

### 3.3 Output Format

Default output is human-readable. Add `--dry-run-format json` for machine-readable output.

```
parser.add_argument("--dry-run-format", choices=["text", "json"],
                    default="text",
                    help="Output format for --dry-run report (default: text)")
```

---

## 4. Validation Report Format

### 4.1 Internal Data Structure

Each check produces a `CheckResult`:

- `check_id` (str): Unique identifier like `agent.file_exists.planner`
- `status` (str): One of `pass`, `warn`, `fail`, `info`
- `message` (str): Human-readable explanation
- `category` (str): Grouping key (`settings`, `agents`, `stages`, `loops`, `hooks`, `governance`, `work_request`)

The full report is a `ValidationReport`:

- `timestamp` (str): ISO 8601 timestamp
- `settings_path` (str): Path that was validated
- `checks` (list of CheckResult dicts)
- `summary` (dict): `{"pass": N, "warn": N, "fail": N, "info": N}`
- `exit_code` (int): See section 7

### 4.2 Human-Readable Output (text)

```
Pipeline Dry Run Validation
============================
Settings: .claude/settings.json
Timestamp: 2026-03-09T14:30:00Z

[PASS] settings.parse - Settings file is valid JSON
[PASS] settings.worca_ns - worca namespace found
[FAIL] agent.file_exists.planner - Agent file missing: .claude/agents/core/planner.md
[WARN] loop.excessive.implement_test - Loop limit 50 exceeds recommended maximum of 20

--- Work Request Preview ---
  Source type: prompt
  Title: Add user authentication
  Description: (from prompt)

--- Summary ---
  Pass: 18   Warn: 2   Fail: 1   Info: 1
  Exit code: 2 (errors found)
```

### 4.3 JSON Output

```json
{
  "timestamp": "2026-03-09T14:30:00Z",
  "settings_path": ".claude/settings.json",
  "checks": [
    {"check_id": "settings.parse", "status": "pass", "message": "Settings file is valid JSON", "category": "settings"},
    {"check_id": "agent.file_exists.planner", "status": "fail", "message": "Agent file missing: .claude/agents/core/planner.md", "category": "agents"}
  ],
  "summary": {"pass": 18, "warn": 2, "fail": 1, "info": 1},
  "exit_code": 2
}
```

---

## 5. Implementation Tasks

### Task 1: Create the Validator Module

**File to create:** `.claude/worca/orchestrator/validator.py`

- Define `CheckResult` as a dataclass with fields: `check_id`, `status`, `message`, `category`.
- Define `ValidationReport` as a dataclass with fields: `timestamp`, `settings_path`, `checks`, `summary`, `exit_code`.
- Implement `validate_settings(settings_path) -> list[CheckResult]` covering checks 2.1.
- Implement `validate_agents(settings, settings_path) -> list[CheckResult]` covering checks 2.2. Use `_agent_path()` from `runner.py` (extract to shared location or import).
- Implement `validate_stages(settings, settings_path) -> list[CheckResult]` covering checks 2.3. Import `Stage`, `TRANSITIONS`, `STAGE_AGENT_MAP`, `STAGE_SCHEMA_MAP` from `stages.py`.
- Implement `validate_loops(settings) -> list[CheckResult]` covering checks 2.4. Recognized loop names: `implement_test`, `code_review`, `pr_changes`, `restart_planning`.
- Implement `validate_hooks(settings) -> list[CheckResult]` covering checks 2.5. Parse `hooks` from the top-level settings (not under `worca`). Extract script path from command strings.
- Implement `validate_governance(settings) -> list[CheckResult]` covering checks 2.6. Recognized guard names from `guard.py`.
- Implement `validate_work_request(source_type, source_value) -> list[CheckResult]` covering checks 2.7. For `--source`, validate format only without calling external CLIs.
- Implement `run_validation(settings_path, source_type, source_value, msize, mloops) -> ValidationReport` that orchestrates all validators and computes summary/exit_code.

### Task 2: Extract Shared Path Helpers

**File to modify:** `.claude/worca/orchestrator/runner.py`

- Move `_agent_path()` and `_schema_path()` from `runner.py` to `stages.py` (or a new `paths.py` utility).
- These are private functions today but the validator needs them. Make them module-level public functions: `agent_path()`, `schema_path()`.
- Update `runner.py` imports to use the new location.

### Task 3: Add Report Formatting

**File to create:** `.claude/worca/orchestrator/report.py`

- Implement `format_text(report: ValidationReport) -> str` that produces the human-readable output described in section 4.2. Use `[PASS]`/`[WARN]`/`[FAIL]`/`[INFO]` prefixes with check ID and message. Group checks by category. Append summary and exit code explanation.
- Implement `format_json(report: ValidationReport) -> str` that serializes the report to indented JSON as described in section 4.3.
- Implement `format_report(report: ValidationReport, fmt: str) -> str` dispatch function.

### Task 4: Wire `--dry-run` into the Entry Point

**File to modify:** `.claude/scripts/run_pipeline.py`

- Add `--dry-run` flag to argparse (boolean, `store_true`).
- Add `--dry-run-format` flag to argparse (choices `text`/`json`, default `text`).
- After argument parsing, if `args.dry_run` is set:
  - Determine `source_type` and `source_value` from args (same logic as existing prompt/spec/source dispatch).
  - Call `run_validation(args.settings, source_type, source_value, args.msize, args.mloops)` from the validator module.
  - Format using `format_report(report, args.dry_run_format)` and print to stdout.
  - Exit with `report.exit_code`.
- If `--dry-run-format` is given without `--dry-run`, print a warning and ignore it.

### Task 5: Add Multiplier Preview to Report

**File to modify:** `.claude/worca/orchestrator/validator.py`

- In `run_validation`, after agent/stage checks, compute and add `info`-level checks showing effective values:
  - For each enabled stage: `info.effective_turns.{stage}` showing `max_turns * msize`.
  - For each configured loop: `info.effective_loops.{loop}` showing `limit * mloops`.
- These are purely informational and help operators verify multiplier effects.

### Task 6: Write Unit Tests

**File to create:** `tests/test_validator.py`

Tests to write (each as a separate test function):

- `test_valid_settings_all_pass` -- Load the project's actual `settings.json` and verify zero failures.
- `test_missing_settings_file` -- Pass a nonexistent path; verify `settings.parse` check fails.
- `test_invalid_json` -- Write a file with `{broken` content; verify `settings.parse` check fails.
- `test_missing_worca_namespace` -- Valid JSON but no `worca` key; verify `settings.worca_ns` fails.
- `test_missing_agent_file` -- Settings referencing an agent whose `.md` file does not exist; verify `agent.file_exists.*` fails.
- `test_unknown_stage_name` -- Settings with `worca.stages.foobar`; verify `stage.known.foobar` fails.
- `test_loop_limit_zero` -- `worca.loops.implement_test: 0`; verify `loop.zero.*` fails.
- `test_loop_limit_excessive` -- `worca.loops.implement_test: 50`; verify `loop.excessive.*` warns.
- `test_hook_missing_file` -- Hook command referencing a nonexistent script; verify `hook.file_exists.*` fails.
- `test_governance_guards_type` -- `governance.guards` set to a string instead of dict; verify `gov.guards_type` fails.
- `test_work_request_prompt` -- `--prompt "hello"`; verify normalization preview passes and shows title.
- `test_work_request_bad_source` -- `--source "unknown:format"`; verify `wr.source_format` fails.
- `test_report_exit_code_0` -- All checks pass; verify `exit_code` is 0.
- `test_report_exit_code_1` -- Only warnings; verify `exit_code` is 1.
- `test_report_exit_code_2` -- At least one failure; verify `exit_code` is 2.
- `test_text_format_output` -- Verify text report contains `[PASS]`, `[FAIL]`, summary line.
- `test_json_format_output` -- Verify JSON report is valid JSON with required keys.
- `test_multiplier_preview` -- Pass `msize=3, mloops=2`; verify info checks show multiplied values.

Use `tmp_path` fixture for temporary settings files. Mock file system for agent/hook existence checks where needed.

### Task 7: Integration Test via CLI

**File to create:** `tests/test_dry_run_cli.py`

- `test_dry_run_text_output` -- Run `python .claude/scripts/run_pipeline.py --prompt "test" --dry-run` via `subprocess.run`; verify exit code and output contains `Pipeline Dry Run Validation`.
- `test_dry_run_json_output` -- Run with `--dry-run-format json`; verify output is valid JSON.
- `test_dry_run_bad_settings` -- Run with `--settings /nonexistent`; verify exit code 2.
- `test_dry_run_no_prompt` -- Run with `--dry-run` but no prompt/source/spec; verify argparse error (the existing mutually exclusive group still applies).

---

## 6. Testing Strategy

### Unit Tests

All validation logic in `validator.py` is tested in isolation via `test_validator.py`. Each validator function is tested independently with controlled input (temporary settings files, mocked file paths). No Claude CLI calls, no git operations, no network access.

### Integration Tests

CLI-level tests in `test_dry_run_cli.py` exercise the full path from argument parsing through validation to formatted output. They run the actual `run_pipeline.py` script as a subprocess and verify stdout/stderr and exit codes.

### Manual Verification

Run against the project's own configuration to verify a clean pass:

```bash
python .claude/scripts/run_pipeline.py --prompt "test task" --dry-run
python .claude/scripts/run_pipeline.py --prompt "test task" --dry-run --dry-run-format json
```

Deliberately break settings.json (e.g., remove an agent entry) and verify the correct failures appear.

### Test Coverage Targets

- Every check ID in section 2 has at least one test that triggers its `pass` path and one that triggers its `fail`/`warn` path.
- Both output formats (text, JSON) are tested for structure.
- All three exit codes (0, 1, 2) are tested.

---

## 7. Exit Codes

| Code | Meaning | Condition |
|------|---------|-----------|
| `0` | All checks passed | Zero `fail` checks AND zero `warn` checks |
| `1` | Warnings only | Zero `fail` checks AND one or more `warn` checks |
| `2` | Errors found | One or more `fail` checks (regardless of warnings) |

The exit code is computed from the `summary` counts in the `ValidationReport`. The `info` status does not affect the exit code.

---

## 8. File Inventory

### Files to Create

| File | Purpose |
|------|---------|
| `.claude/worca/orchestrator/validator.py` | Core validation logic -- all check functions and report builder |
| `.claude/worca/orchestrator/report.py` | Text and JSON formatting of validation reports |
| `tests/test_validator.py` | Unit tests for all validation checks |
| `tests/test_dry_run_cli.py` | Integration tests for CLI `--dry-run` flag |

### Files to Modify

| File | Change |
|------|--------|
| `.claude/scripts/run_pipeline.py` | Add `--dry-run` and `--dry-run-format` args; dispatch to validator when set |
| `.claude/worca/orchestrator/runner.py` | Move `_agent_path()` and `_schema_path()` to shared location; update imports |
| `.claude/worca/orchestrator/stages.py` | Receive `agent_path()` and `schema_path()` as public functions (or create `paths.py`) |

### Files Read-Only (referenced but not modified)

| File | Why Referenced |
|------|----------------|
| `.claude/settings.json` | Validated by the dry run |
| `.claude/agents/core/*.md` | Existence/readability checked |
| `.claude/worca/schemas/*.json` | Existence/validity checked |
| `.claude/hooks/*.py` | Existence checked |
| `.claude/worca/hooks/guard.py` | Guard names extracted for governance validation |
