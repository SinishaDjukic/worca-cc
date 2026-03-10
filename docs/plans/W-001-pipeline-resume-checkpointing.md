# W-001: Pipeline Resume & Checkpointing


**Goal:** Make interrupted pipeline runs recoverable without re-running completed stages. Today, if a machine restarts, a network call fails, or the user hits Ctrl-C mid-run, all progress is lost. This plan closes four concrete gaps in the existing skeleton: (1) the `PromptBuilder` is not seeded from saved checkpoint data on resume, so agents lose context from completed stages; (2) the git branch is read from status on resume but the working tree is never switched to it; (3) `find_resume_point` treats only `in_progress` and `pending` as resumable -- stages that died with `error` status are silently skipped; (4) there is no divergence guard to detect that the codebase changed since the checkpoint was written. The plan also adds a `--run-id` shortcut to resume without re-supplying the original prompt, and expands test coverage to match the new behaviour.

**Architecture:** All logic lives in the existing `worca-cc` Python package. The checkpoint files themselves are already written by `runner._save_stage_output()` as `{run_dir}/logs/{stage}/iter-N.json`. `resume.py` can already locate and read them via `reconstruct_context()`. What is missing is the bridge that calls `reconstruct_context()` at the start of a resume and feeds the recovered outputs into `PromptBuilder` so that downstream agents receive the same context they would have had in an uninterrupted run. The git divergence guard lives in `worca/utils/git.py` and is called once at the top of `run_pipeline()` when `resume=True`. The `--run-id` shortcut is wired in `run_pipeline.py` and short-circuits the work-request matching logic in `runner.py`. No new files are required for the core fix; the plan touches four existing files and adds one new test file.

**Tech Stack:** Python 3.11+, `subprocess` (git), `json`, `pytest` (unit tests). No new dependencies.

**Depends on:** Nothing. All foundation code (status.py, resume.py, runner.py, prompt_builder.py) is already in place.

---

## 1. Scope and Boundaries

### In scope
- Seed `PromptBuilder` from `reconstruct_context()` output on every resume so downstream agents receive correct inter-stage context
- Switch the git working tree to the checkpoint branch before resuming (call `git checkout <branch>`)
- Add `"error"` to the set of statuses that `find_resume_point` considers as the resume point (previously only `in_progress` / `pending` were handled)
- Add a codebase divergence guard: compare `HEAD` commit SHA at checkpoint time against current `HEAD` on resume; warn (but do not abort) if they differ, and log the delta
- Add `--run-id <id>` flag to `run_pipeline.py` that loads the run directly from `.worca/runs/<id>/status.json` without requiring the original prompt arguments
- Expand `run_pipeline.py` to accept `--resume` without a work-request argument when `--run-id` is supplied
- Expand unit tests in `tests/test_resume.py` and add `tests/test_resume_integration.py`

### Out of scope
- Automatic retry on unhandled exceptions (separate concern from resume)
- Merging partial code changes from a crashed implementer stage (out of scope; the implementer re-runs from clean git state on the branch)
- UI-level "Resume" button (covered by W-009 `POST /api/runs/:id/stages/:stage/restart`)
- Parallel implementer worktree cleanup (W-002)
- Webhook events for resume (W-003)

---

## 2. Checkpoint Data Format

The checkpoint format is already defined and written by the runner. This section documents it explicitly so that resume logic can rely on it.

### Per-run directory layout

```
.worca/
  active_run             # plain text: run_id of the active run
  runs/
    20260310-143012/     # run_id = YYYYMMDD-HHMMSS
      status.json        # full pipeline status (see below)
      agents/            # rendered agent .md templates
      logs/
        plan/
          iter-1.json    # structured_output from the claude CLI envelope
          iter-1.log     # raw streaming log
        coordinate/
          iter-1.json
          iter-1.log
        implement/
          iter-1.json
          iter-1.log
        test/
          iter-1.json
          iter-2.json    # second iteration if test failed and looped back
          iter-1.log
          iter-2.log
        review/
          iter-1.json
          iter-1.log
        pr/
          iter-1.json
          iter-1.log
  results/
    20260310-143012/     # archived after completion (shutil.move from runs/)
```

### `status.json` schema additions for W-001

Two new top-level fields are added to the status dict written by `init_status()` and `save_status()`:

```json
{
  "run_id": "20260310-143012",
  "branch": "worca/add-user-auth-X7k",
  "head_sha": "a1b2c3d4",
  "stage": "implement",
  "work_request": { ... },
  "started_at": "2026-03-10T14:30:12Z",
  "completed_at": null,
  "stages": {
    "plan":       { "status": "completed", ... },
    "coordinate": { "status": "completed", ... },
    "implement":  { "status": "error",     "error": "...", ... },
    "test":       { "status": "pending"  },
    "review":     { "status": "pending"  },
    "pr":         { "status": "pending"  }
  },
  "milestones": { ... }
}
```

`head_sha` is the output of `git rev-parse HEAD` captured at pipeline start (fresh run) or at last successful stage completion (resume). It is compared against the current `HEAD` SHA when `--resume` is invoked to detect divergence.

---

## 3. Gap Analysis

| Gap | Current behaviour | Target behaviour |
|-----|------------------|-----------------|
| PromptBuilder not seeded on resume | Downstream stages get empty context (no plan approach, no test failures) | Call `reconstruct_context()` at resume start; loop over recovered stage outputs and call `prompt_builder.update_context()` for each field |
| Branch not restored on resume | Git working tree stays on whatever branch it was on when user invoked `--resume` | Call `git checkout <branch>` using the branch stored in `status["branch"]` before entering the stage loop |
| `find_resume_point` ignores `error` | A stage that crashed with `status: "error"` is treated as complete; resume skips it and tries to run the next stage with missing outputs | Treat `"error"` the same as `"in_progress"` — return that stage as the resume point |
| No divergence guard | Codebase may have changed since checkpoint; agents act on stale assumptions | Capture `HEAD` SHA into `status["head_sha"]` at start; compare on resume; log warning + diff stat if diverged |
| No `--run-id` shortcut | User must re-supply the full `--prompt` to resume, creating risk of mismatch | `--run-id <id>` loads status directly, extracts work request, and calls `run_pipeline(resume=True)` without prompt matching |

---

## 4. Component Details

### 4.1 `resume.py` — Fix `find_resume_point`

**File:** `.claude/worca/orchestrator/resume.py`

`find_resume_point` currently checks for `in_progress` and `pending`. Add `"error"` to the same branch:

```python
if stage_status in ("in_progress", "pending", "error"):
    return stage
```

This means a stage that crashed mid-execution (left with `status: "error"`) is the resume point rather than being silently skipped. The runner will re-run it from scratch in the same iteration slot.

### 4.2 `resume.py` — Add `seed_prompt_builder`

**File:** `.claude/worca/orchestrator/resume.py`

New public function that bridges `reconstruct_context()` and `PromptBuilder`:

```python
def seed_prompt_builder(builder: "PromptBuilder", status: dict, logs_dir: str = None) -> None:
    """Populate a PromptBuilder from saved checkpoint outputs.

    Reads completed-stage outputs via reconstruct_context() and calls
    builder.update_context() for every field that runner.py normally populates
    during a live run.  This restores the inter-stage context that downstream
    agents depend on without re-running the completed stages.

    Args:
        builder: The PromptBuilder instance for the current run.
        status:  The loaded pipeline status dict.
        logs_dir: Optional path to the logs directory. Derived from run_id
                  in status if not provided.
    """
```

Internal logic maps stage names to the PromptBuilder context keys the runner sets:

| Stage completed | Keys to restore from stage output |
|----------------|----------------------------------|
| `plan`         | `plan_approach`, `plan_tasks_outline` |
| `coordinate`   | `beads_ids`, `dependency_graph` |
| `implement`    | `files_changed`, `tests_added` |
| `test`         | `test_passed`, `test_coverage`, `proof_artifacts`, `test_failures` (if failed) |
| `review`       | `review_issues` (if `outcome != "approve"`) |

The function calls `reconstruct_context(status, logs_dir)` to get the raw output dicts, then calls `builder.update_context(key, value)` for each field that exists in the output. Missing fields are silently ignored (not all stages populate all fields).

### 4.3 `git.py` — Add divergence detection helpers

**File:** `.claude/worca/utils/git.py`

Two new functions:

```python
def head_sha() -> str:
    """Return the current HEAD commit SHA (short form, 8 chars)."""
    result = _run_git("rev-parse", "--short=8", "HEAD")
    return result.stdout.strip()

def checkout_branch(name: str) -> bool:
    """Switch to an existing branch.

    Runs: git checkout {name}
    Returns True on success, False on failure (e.g., branch doesn't exist).
    """
    result = _run_git("checkout", name)
    return result.returncode == 0
```

### 4.4 `status.py` — Capture `head_sha` in `init_status`

**File:** `.claude/worca/state/status.py`

Modify `init_status()` to capture the current HEAD SHA at pipeline start:

```python
def init_status(work_request: dict, branch: str) -> dict:
    from worca.utils.git import head_sha as _head_sha
    try:
        sha = _head_sha()
    except Exception:
        sha = None
    status = {
        ...existing fields...,
        "head_sha": sha,
        ...
    }
    return status
```

The import is inside the function to avoid circular imports (git.py does not import status.py, but status.py importing git.py at module level would add a dependency).

### 4.5 `runner.py` — Wire resume enhancements

**File:** `.claude/worca/orchestrator/runner.py`

Three changes in `run_pipeline()`:

**Change A — Branch checkout on resume:**
In the resume branch (after `resume_stage = find_resume_point(existing)` returns non-None), call `checkout_branch(branch_name)`:

```python
from worca.utils.git import checkout_branch
...
if resume_stage is not None:
    _log(f"Resuming from {resume_stage.value.upper()}")
    status = existing
    branch_name = status.get("branch", "")
    if branch_name:
        if not checkout_branch(branch_name):
            _log(f"Warning: could not checkout branch {branch_name!r} — proceeding on current branch", "warn")
        else:
            _log(f"Checked out branch: {branch_name}", "ok")
```

**Change B — Divergence guard on resume:**
After the branch checkout, compare the stored `head_sha` against the current one:

```python
from worca.utils.git import head_sha as _head_sha, diff_stat
...
checkpoint_sha = status.get("head_sha")
if checkpoint_sha:
    current_sha = _head_sha()
    if current_sha != checkpoint_sha:
        _log(
            f"Warning: codebase has diverged since checkpoint "
            f"({checkpoint_sha} -> {current_sha}). Diff stat:",
            "warn",
        )
        stat = diff_stat(base=checkpoint_sha)
        if stat.strip():
            for line in stat.strip().splitlines():
                _log(f"  {line}", "warn")
```

This is informational only -- the resume proceeds regardless. The implementer agent can inspect `git diff` itself if it needs to understand the delta.

**Change C — Seed PromptBuilder on resume:**
After the `PromptBuilder` is constructed and before the stage loop, call `seed_prompt_builder` when resuming:

```python
from worca.orchestrator.resume import find_resume_point, seed_prompt_builder
...
prompt_builder = PromptBuilder(
    work_request.title,
    work_request.description,
)

if resume_stage:
    logs_dir_for_seed = os.path.join(run_dir, "logs") if run_dir else os.path.join(worca_dir, "logs")
    seed_prompt_builder(prompt_builder, status, logs_dir=logs_dir_for_seed)
    _log("PromptBuilder seeded from checkpoint", "ok")
```

**Change D — Capture `head_sha` updates after each successful stage:**
After each stage completes (in the `complete_iteration` call block), update `status["head_sha"]` with the current HEAD SHA so that the divergence guard reflects the last-known good state:

```python
try:
    from worca.utils.git import head_sha as _head_sha
    status["head_sha"] = _head_sha()
except Exception:
    pass
save_status(status, actual_status_path)
```

This goes immediately before the `save_status` call that follows each stage completion.

### 4.6 `run_pipeline.py` — Add `--run-id` flag

**File:** `.claude/scripts/run_pipeline.py`

Add `--run-id` as an optional argument (not in the mutually-exclusive group with `--prompt`/`--source`/`--spec`). When `--run-id` is supplied, the work-request arguments are optional:

```python
parser.add_argument(
    "--run-id",
    help=(
        "Resume a specific run by ID (e.g. 20260310-143012). "
        "Loads work request from .worca/runs/<id>/status.json. "
        "Implies --resume."
    ),
)
```

Change the mutually-exclusive group to `required=False` and add validation logic after `parse_args()`:

```python
args = parser.parse_args()

# --run-id implies --resume and makes work-request args optional
if args.run_id:
    args.resume = True
    if not (args.prompt or args.source or args.spec):
        # Load work request from the saved status
        run_status_path = os.path.join(
            args.status_dir, "runs", args.run_id, "status.json"
        )
        if not os.path.exists(run_status_path):
            parser.error(
                f"Run {args.run_id!r} not found at {run_status_path}"
            )
        with open(run_status_path) as f:
            saved = json.load(f)
        wr_data = saved.get("work_request", {})
        # Reconstruct a WorkRequest from saved data so normalize() is not needed
        from worca.orchestrator.work_request import WorkRequest
        work_request = WorkRequest(
            source_type=wr_data.get("source_type", "prompt"),
            title=wr_data.get("title", ""),
            description=wr_data.get("description", ""),
            source_ref=wr_data.get("source_ref"),
            priority=wr_data.get("priority"),
        )
else:
    if not (args.prompt or args.source or args.spec):
        parser.error("one of --prompt, --source, --spec, or --run-id is required")
    # Normalize input to WorkRequest (existing logic)
    if args.prompt:
        work_request = normalize("prompt", args.prompt)
    elif args.spec:
        work_request = normalize("spec", args.spec)
    elif args.source:
        work_request = normalize("source", args.source)
```

Also pass `run_id` to `run_pipeline()` for the active_run pointer lookup (see Task 7).

### 4.7 `runner.py` — Accept `run_id` override for resume lookup

**File:** `.claude/worca/orchestrator/runner.py`

Add an optional `run_id: str = None` parameter to `run_pipeline()`. When provided and `resume=True`, skip the `active_run` pointer and go directly to `.worca/runs/<run_id>/status.json`:

```python
def run_pipeline(
    work_request: WorkRequest,
    plan_file: Optional[str] = None,
    resume: bool = False,
    run_id: Optional[str] = None,   # NEW
    settings_path: str = ".claude/settings.json",
    status_path: str = ".worca/status.json",
    msize: int = 1,
    mloops: int = 1,
) -> dict:
```

When `run_id` is supplied, the lookup becomes:

```python
if run_id and resume:
    candidate = os.path.join(worca_dir, "runs", run_id, "status.json")
    existing = load_status(candidate)
    if existing:
        actual_status_path = candidate
        run_dir = os.path.join(worca_dir, "runs", run_id)
```

This replaces the `active_run` pointer lookup when a specific run_id is provided, giving the user surgical control over which run to resume.

---

## 5. Data Flow on Resume

```
run_pipeline.py --run-id 20260310-143012
  |
  v
run_pipeline() [resume=True, run_id="20260310-143012"]
  |
  +-- load .worca/runs/20260310-143012/status.json
  |
  +-- find_resume_point(status)  -->  Stage.IMPLEMENT  (was "error")
  |
  +-- checkout_branch("worca/add-user-auth-X7k")
  |
  +-- divergence_check(checkpoint_sha="a1b2c3d4", current_sha="a1b2c3d4")
  |     --> no divergence; or --> warn + diff stat
  |
  +-- PromptBuilder(title, description)
  |
  +-- seed_prompt_builder(builder, status, logs_dir)
  |     reconstruct_context() reads:
  |       plan/iter-1.json    -> plan_approach, plan_tasks_outline
  |       coordinate/iter-1.json -> beads_ids, dependency_graph
  |     builder.update_context("plan_approach", ...)
  |     builder.update_context("plan_tasks_outline", ...)
  |     builder.update_context("beads_ids", ...)
  |     builder.update_context("dependency_graph", ...)
  |
  +-- stage_idx = stage_order.index(Stage.IMPLEMENT)
  |
  v
  [IMPLEMENT stage runs with full context from checkpoint]
```

---

## 6. Implementation Tasks

### Task 1: Fix `find_resume_point` to handle `"error"` status

**File:** `.claude/worca/orchestrator/resume.py`

In `find_resume_point()`, change the condition on line 38 from:

```python
if stage_status in ("in_progress", "pending"):
    return stage
```

to:

```python
if stage_status in ("in_progress", "pending", "error"):
    return stage
```

This is the smallest functional fix. A stage that exited with `"error"` is now the resume point instead of being silently skipped.

---

### Task 2: Add `seed_prompt_builder` to `resume.py`

**File:** `.claude/worca/orchestrator/resume.py`

Add the following function after `reconstruct_context()`. It must be a standalone function (not a method) following the existing module style.

```python
def seed_prompt_builder(builder, status: dict, logs_dir: str = None) -> None:
    """Populate a PromptBuilder from saved checkpoint outputs.

    Reads completed-stage JSON outputs from the logs directory and calls
    builder.update_context() for each field that runner.py populates during
    a live run, restoring inter-stage context without re-running those stages.
    """
    context = reconstruct_context(status, logs_dir)

    # PLAN outputs
    plan_out = context.get("plan", {})
    if plan_out:
        if "approach" in plan_out:
            builder.update_context("plan_approach", plan_out["approach"])
        if "tasks_outline" in plan_out:
            builder.update_context("plan_tasks_outline", plan_out["tasks_outline"])

    # COORDINATE outputs
    coord_out = context.get("coordinate", {})
    if coord_out:
        if "beads_ids" in coord_out:
            builder.update_context("beads_ids", coord_out["beads_ids"])
        if "dependency_graph" in coord_out:
            builder.update_context("dependency_graph", coord_out["dependency_graph"])

    # IMPLEMENT outputs
    impl_out = context.get("implement", {})
    if impl_out:
        if "files_changed" in impl_out:
            builder.update_context("files_changed", impl_out["files_changed"])
        if "tests_added" in impl_out:
            builder.update_context("tests_added", impl_out["tests_added"])

    # TEST outputs — restore both pass state and any failures
    test_out = context.get("test", {})
    if test_out:
        if "passed" in test_out:
            builder.update_context("test_passed", test_out["passed"])
        if "coverage_pct" in test_out:
            builder.update_context("test_coverage", test_out["coverage_pct"])
        if "proof_artifacts" in test_out:
            builder.update_context("proof_artifacts", test_out["proof_artifacts"])
        if "failures" in test_out:
            builder.update_context("test_failures", test_out["failures"])

    # REVIEW outputs — restore review issues if changes were requested
    review_out = context.get("review", {})
    if review_out:
        if "issues" in review_out:
            builder.update_context("review_issues", review_out["issues"])
```

Note: `builder` is typed as `Any` rather than `PromptBuilder` to avoid a circular import (`resume.py` -> `prompt_builder.py` is fine, but add the import at the top of the file):

```python
from worca.orchestrator.prompt_builder import PromptBuilder
```

And update the function signature:

```python
def seed_prompt_builder(builder: PromptBuilder, status: dict, logs_dir: str = None) -> None:
```

---

### Task 3: Add `head_sha` and `checkout_branch` to `git.py`

**File:** `.claude/worca/utils/git.py`

Append two functions to the end of the file:

```python
def head_sha() -> str:
    """Return the current HEAD commit SHA (short, 8 hex chars).

    Runs: git rev-parse --short=8 HEAD
    Returns empty string if git command fails (e.g., no commits yet).
    """
    result = _run_git("rev-parse", "--short=8", "HEAD")
    if result.returncode != 0:
        return ""
    return result.stdout.strip()


def checkout_branch(name: str) -> bool:
    """Switch to an existing local branch.

    Runs: git checkout {name}
    Returns True on success, False on failure (e.g., branch doesn't exist,
    uncommitted changes would be overwritten, or git not available).
    """
    result = _run_git("checkout", name)
    return result.returncode == 0
```

---

### Task 4: Capture `head_sha` in `init_status`

**File:** `.claude/worca/state/status.py`

Modify `init_status()` to capture the git HEAD SHA at pipeline start. The import is placed inside the function to keep the module dependency graph clean:

```python
def init_status(work_request: dict, branch: str) -> dict:
    """Create a fresh status dict with all stages set to 'pending'."""
    try:
        from worca.utils.git import head_sha as _head_sha
        sha = _head_sha()
    except Exception:
        sha = None

    status = {
        "work_request": work_request,
        "stage": "plan",
        "run_id": None,
        "branch": branch,
        "head_sha": sha,          # NEW
        "worktree": None,
        "plan_file": None,
        "started_at": datetime.now(timezone.utc).isoformat(),
        "completed_at": None,
        "stages": {stage: {"status": "pending"} for stage in PIPELINE_STAGES},
        "milestones": {
            "plan_approved": None,
            "pr_approved": None,
            "deploy_approved": None,
        },
        "pr_review_outcome": None,
    }
    return status
```

---

### Task 5: Wire `checkout_branch`, divergence guard, and `seed_prompt_builder` into `runner.py`

**File:** `.claude/worca/orchestrator/runner.py`

**5a — Update imports at top of file:**

Add to the existing import from `worca.orchestrator.resume`:

```python
from worca.orchestrator.resume import find_resume_point, seed_prompt_builder
```

Add to the existing import from `worca.utils.git`:

```python
from worca.utils.git import create_branch, head_sha as _head_sha, checkout_branch, diff_stat
```

**5b — Branch checkout and divergence guard on resume:**

In the resume branch of `run_pipeline()` (the `if resume and existing and _is_same_work_request(...)` block), immediately after `_log(f"Resuming from {resume_stage.value.upper()}")`, add:

```python
# Switch to the checkpoint branch
branch_name = status.get("branch", "")
if branch_name:
    if not checkout_branch(branch_name):
        _log(f"Warning: could not checkout branch {branch_name!r} — continuing on current branch", "warn")
    else:
        _log(f"Branch: {branch_name}", "ok")

# Divergence guard: warn if codebase changed since checkpoint
checkpoint_sha = status.get("head_sha")
if checkpoint_sha:
    try:
        current_sha = _head_sha()
        if current_sha and current_sha != checkpoint_sha:
            _log(
                f"Warning: codebase diverged since checkpoint "
                f"({checkpoint_sha} -> {current_sha})",
                "warn",
            )
            stat = diff_stat(base=checkpoint_sha)
            if stat.strip():
                for line in stat.strip().splitlines()[:10]:
                    _log(f"  {line}", "warn")
    except Exception:
        pass  # git not available or no commits -- silently skip
```

Remove the existing `branch_name = status.get("branch", "")` line that follows, since it is now set above.

**5c — Seed PromptBuilder on resume:**

After `prompt_builder = PromptBuilder(work_request.title, work_request.description)` (line ~624), add:

```python
if resume_stage:
    _seed_logs_dir = os.path.join(run_dir, "logs") if run_dir else os.path.join(worca_dir, "logs")
    seed_prompt_builder(prompt_builder, status, logs_dir=_seed_logs_dir)
    _log("PromptBuilder seeded from checkpoint", "ok")
```

**5d — Update `head_sha` after each successful stage:**

Inside the stage loop, after each block that calls `save_status(status, actual_status_path)` for a successfully completed stage (i.e., for PLAN, COORDINATE, IMPLEMENT, TEST passed, REVIEW approved, and PR), add the SHA update before the `save_status` call:

```python
# Update head_sha to reflect current state of codebase
try:
    status["head_sha"] = _head_sha()
except Exception:
    pass
```

This belongs immediately before each `save_status(status, actual_status_path)` call that marks a stage as completed. There are six such save points (one per stage). To avoid duplication, add it as a helper call inside a small wrapper:

```python
def _checkpoint(status: dict, status_path: str) -> None:
    """Update head_sha and write status to disk."""
    try:
        status["head_sha"] = _head_sha()
    except Exception:
        pass
    save_status(status, status_path)
```

Replace all `save_status(status, actual_status_path)` calls that occur after a stage's `complete_iteration` / `update_stage` block (the final save per stage) with `_checkpoint(status, actual_status_path)`. Intermediate saves (e.g., saving the prompt before the stage runs) keep using `save_status` directly since the stage has not yet completed.

**5e — Accept `run_id` parameter:**

Add `run_id: Optional[str] = None` to the `run_pipeline()` signature. Early in the function body, after `worca_dir` is set and before the `active_run` pointer check, insert:

```python
if run_id and resume:
    candidate = os.path.join(worca_dir, "runs", run_id, "status.json")
    loaded = load_status(candidate)
    if loaded:
        existing = loaded
        actual_status_path = candidate
        run_dir = os.path.join(worca_dir, "runs", run_id)
```

---

### Task 6: Update `run_pipeline.py` to add `--run-id`

**File:** `.claude/scripts/run_pipeline.py`

Replace the argument-parsing section. The mutually-exclusive group becomes `required=False` and validation is done manually so that `--run-id` alone is valid:

```python
def main():
    parser = argparse.ArgumentParser(description="Run worca-cc pipeline")
    group = parser.add_mutually_exclusive_group(required=False)
    group.add_argument("--prompt", help="Text prompt for work request")
    group.add_argument("--source", help="Source reference (gh:issue:42, bd:bd-abc)")
    group.add_argument("--spec", help="Path to spec file")
    parser.add_argument("--run-id",
                        help="Resume a specific run by ID (e.g. 20260310-143012). "
                             "Loads work request from .worca/runs/<id>/status.json. "
                             "Implies --resume.")
    parser.add_argument("--settings", default=".claude/settings.json")
    parser.add_argument("--status-dir", default=".worca")
    parser.add_argument("--msize", type=int, default=1, choices=range(1, 11),
                        metavar="[1-10]")
    parser.add_argument("--mloops", type=int, default=1, choices=range(1, 11),
                        metavar="[1-10]")
    parser.add_argument("--plan", help="Path to pre-made plan file (skips PLAN stage)")
    parser.add_argument("--resume", action="store_true",
                        help="Resume previous run instead of starting fresh")

    args = parser.parse_args()

    # --run-id implies --resume
    if args.run_id:
        args.resume = True

    # Resolve work request
    if args.run_id and not (args.prompt or args.source or args.spec):
        # Load from saved run
        run_status_path = os.path.join(
            args.status_dir, "runs", args.run_id, "status.json"
        )
        if not os.path.exists(run_status_path):
            parser.error(
                f"Run {args.run_id!r} not found at {run_status_path}"
            )
        with open(run_status_path) as f:
            saved = json.load(f)
        wr_data = saved.get("work_request", {})
        from worca.orchestrator.work_request import WorkRequest
        work_request = WorkRequest(
            source_type=wr_data.get("source_type", "prompt"),
            title=wr_data.get("title", ""),
            description=wr_data.get("description", ""),
            source_ref=wr_data.get("source_ref"),
            priority=wr_data.get("priority"),
        )
    elif args.prompt or args.source or args.spec:
        if args.prompt:
            work_request = normalize("prompt", args.prompt)
        elif args.spec:
            work_request = normalize("spec", args.spec)
        elif args.source:
            work_request = normalize("source", args.source)
    else:
        parser.error("one of --prompt, --source, --spec, or --run-id is required")

    print(f"Starting pipeline: {work_request.title}")
    if args.resume:
        print(f"  Resuming run" + (f": {args.run_id}" if args.run_id else ""))
    if args.plan:
        print(f"  Pre-made plan: {args.plan} (skipping PLAN stage)")
    if args.msize > 1:
        print(f"  Size multiplier: {args.msize}x turns")
    if args.mloops > 1:
        print(f"  Loop multiplier: {args.mloops}x loops")

    try:
        status = run_pipeline(
            work_request,
            plan_file=args.plan,
            resume=args.resume,
            run_id=args.run_id,      # NEW
            settings_path=args.settings,
            status_path=os.path.join(args.status_dir, "status.json"),
            msize=args.msize,
            mloops=args.mloops,
        )
        print(json.dumps(status, indent=2))
    except LoopExhaustedError as e:
        print(f"Loop exhausted: {e}", file=sys.stderr)
        sys.exit(1)
    except PipelineError as e:
        print(f"Pipeline error: {e}", file=sys.stderr)
        sys.exit(2)
```

---

### Task 7: Unit tests for `find_resume_point` error-status fix

**File:** `tests/test_resume.py`

Add the following test cases to the existing file:

```python
def test_finds_error_stage():
    """A stage with status 'error' is the resume point, not skipped."""
    status = {
        "stages": {
            "plan": {"status": "completed"},
            "coordinate": {"status": "completed"},
            "implement": {"status": "error", "error": "agent crashed"},
            "test": {"status": "pending"},
            "review": {"status": "pending"},
            "pr": {"status": "pending"},
        },
        "milestones": {"plan_approved": True},
    }
    assert find_resume_point(status) == Stage.IMPLEMENT


def test_error_stage_before_pending():
    """Error stage takes priority over subsequent pending stages."""
    status = {
        "stages": {
            "plan": {"status": "completed"},
            "coordinate": {"status": "error"},
            "implement": {"status": "pending"},
            "test": {"status": "pending"},
            "review": {"status": "pending"},
            "pr": {"status": "pending"},
        },
        "milestones": {"plan_approved": True},
    }
    assert find_resume_point(status) == Stage.COORDINATE
```

---

### Task 8: Unit tests for `seed_prompt_builder`

**File:** `tests/test_resume.py`

Add the following test cases. They use a minimal `FakePromptBuilder` to avoid the CLAUDE.md filesystem read:

```python
class FakeBuilder:
    def __init__(self):
        self.context = {}
    def update_context(self, key, value):
        self.context[key] = value


def test_seed_prompt_builder_plan(tmp_path):
    """seed_prompt_builder restores plan outputs into the builder."""
    logs_dir = str(tmp_path / "logs")
    plan_dir = os.path.join(logs_dir, "plan")
    os.makedirs(plan_dir)
    with open(os.path.join(plan_dir, "iter-1.json"), "w") as f:
        json.dump({"approach": "modular", "tasks_outline": [{"title": "step1"}]}, f)

    status = {
        "stages": {
            "plan": {"status": "completed"},
            "coordinate": {"status": "pending"},
        }
    }
    builder = FakeBuilder()
    seed_prompt_builder(builder, status, logs_dir)
    assert builder.context["plan_approach"] == "modular"
    assert builder.context["plan_tasks_outline"] == [{"title": "step1"}]
    assert "beads_ids" not in builder.context


def test_seed_prompt_builder_all_stages(tmp_path):
    """seed_prompt_builder restores context from all completed stages."""
    logs_dir = str(tmp_path / "logs")
    for stage, data in [
        ("plan", {"approach": "TDD", "tasks_outline": []}),
        ("coordinate", {"beads_ids": ["bd-001"], "dependency_graph": {}}),
        ("implement", {"files_changed": ["src/foo.py"], "tests_added": ["tests/test_foo.py"]}),
        ("test", {"passed": True, "coverage_pct": 87.5, "proof_artifacts": ["coverage.html"], "failures": []}),
        ("review", {"issues": [{"file": "src/foo.py", "line": 10, "severity": "minor", "description": "unused var"}]}),
    ]:
        d = os.path.join(logs_dir, stage)
        os.makedirs(d)
        with open(os.path.join(d, "iter-1.json"), "w") as f:
            json.dump(data, f)

    status = {
        "stages": {s: {"status": "completed"} for s in ["plan", "coordinate", "implement", "test", "review"]},
    }
    builder = FakeBuilder()
    seed_prompt_builder(builder, status, logs_dir)
    assert builder.context["plan_approach"] == "TDD"
    assert builder.context["beads_ids"] == ["bd-001"]
    assert builder.context["files_changed"] == ["src/foo.py"]
    assert builder.context["test_passed"] is True
    assert builder.context["test_coverage"] == 87.5
    assert builder.context["review_issues"][0]["severity"] == "minor"


def test_seed_prompt_builder_empty_logs(tmp_path):
    """seed_prompt_builder does not crash when no log files exist."""
    logs_dir = str(tmp_path / "logs")
    os.makedirs(logs_dir)
    status = {"stages": {"plan": {"status": "completed"}}}
    builder = FakeBuilder()
    seed_prompt_builder(builder, status, logs_dir)  # no exception
    assert builder.context == {}


def test_seed_prompt_builder_partial(tmp_path):
    """seed_prompt_builder handles missing fields in partial outputs."""
    logs_dir = str(tmp_path / "logs")
    plan_dir = os.path.join(logs_dir, "plan")
    os.makedirs(plan_dir)
    # plan output missing tasks_outline
    with open(os.path.join(plan_dir, "iter-1.json"), "w") as f:
        json.dump({"approach": "iterative"}, f)

    status = {"stages": {"plan": {"status": "completed"}}}
    builder = FakeBuilder()
    seed_prompt_builder(builder, status, logs_dir)
    assert builder.context["plan_approach"] == "iterative"
    assert "plan_tasks_outline" not in builder.context
```

Import `seed_prompt_builder` at the top of `tests/test_resume.py`:

```python
from worca.orchestrator.resume import find_resume_point, reconstruct_context, can_resume, seed_prompt_builder
```

---

### Task 9: Unit tests for `git.py` new functions

**File:** `tests/test_git.py`

Add tests for `head_sha` and `checkout_branch`. The existing test file uses `monkeypatch` and `tmp_path`:

```python
from worca.utils.git import head_sha, checkout_branch


def test_head_sha_returns_string(tmp_path, monkeypatch):
    """head_sha returns a non-empty string in a git repo with commits."""
    monkeypatch.chdir(tmp_path)
    import subprocess
    subprocess.run(["git", "init"], cwd=str(tmp_path), capture_output=True)
    subprocess.run(["git", "config", "user.email", "test@test.com"], cwd=str(tmp_path), capture_output=True)
    subprocess.run(["git", "config", "user.name", "Test"], cwd=str(tmp_path), capture_output=True)
    (tmp_path / "f.txt").write_text("hello")
    subprocess.run(["git", "add", "."], cwd=str(tmp_path), capture_output=True)
    subprocess.run(["git", "commit", "-m", "init"], cwd=str(tmp_path), capture_output=True)
    sha = head_sha()
    assert isinstance(sha, str)
    assert len(sha) == 8
    assert all(c in "0123456789abcdef" for c in sha)


def test_head_sha_empty_on_no_commits(tmp_path, monkeypatch):
    """head_sha returns empty string in a repo with no commits."""
    monkeypatch.chdir(tmp_path)
    import subprocess
    subprocess.run(["git", "init"], cwd=str(tmp_path), capture_output=True)
    sha = head_sha()
    assert sha == ""


def test_checkout_branch_success(tmp_path, monkeypatch):
    """checkout_branch returns True for an existing branch."""
    monkeypatch.chdir(tmp_path)
    import subprocess
    subprocess.run(["git", "init"], cwd=str(tmp_path), capture_output=True)
    subprocess.run(["git", "config", "user.email", "test@test.com"], cwd=str(tmp_path), capture_output=True)
    subprocess.run(["git", "config", "user.name", "Test"], cwd=str(tmp_path), capture_output=True)
    (tmp_path / "f.txt").write_text("x")
    subprocess.run(["git", "add", "."], cwd=str(tmp_path), capture_output=True)
    subprocess.run(["git", "commit", "-m", "init"], cwd=str(tmp_path), capture_output=True)
    subprocess.run(["git", "checkout", "-b", "feature-x"], cwd=str(tmp_path), capture_output=True)
    subprocess.run(["git", "checkout", "main"], cwd=str(tmp_path), capture_output=True)
    assert checkout_branch("feature-x") is True


def test_checkout_branch_failure_nonexistent(tmp_path, monkeypatch):
    """checkout_branch returns False for a branch that does not exist."""
    monkeypatch.chdir(tmp_path)
    import subprocess
    subprocess.run(["git", "init"], cwd=str(tmp_path), capture_output=True)
    subprocess.run(["git", "config", "user.email", "test@test.com"], cwd=str(tmp_path), capture_output=True)
    subprocess.run(["git", "config", "user.name", "Test"], cwd=str(tmp_path), capture_output=True)
    (tmp_path / "f.txt").write_text("x")
    subprocess.run(["git", "add", "."], cwd=str(tmp_path), capture_output=True)
    subprocess.run(["git", "commit", "-m", "init"], cwd=str(tmp_path), capture_output=True)
    assert checkout_branch("nonexistent-branch") is False
```

---

### Task 10: Unit tests for `init_status` `head_sha` field

**File:** `tests/test_status.py`

Add to the existing test file:

```python
def test_init_status_captures_head_sha(monkeypatch):
    """init_status includes head_sha field (may be None if git unavailable)."""
    from worca.state.status import init_status
    wr = {"source_type": "prompt", "title": "test", "description": "test"}
    status = init_status(wr, "main")
    # head_sha key must exist; value is a string or None
    assert "head_sha" in status
    assert status["head_sha"] is None or isinstance(status["head_sha"], str)
```

---

### Task 11: Integration test — full resume cycle

**File:** `tests/test_resume_integration.py` (new file)

A medium-weight test that exercises the full resume path using mocked `run_agent` and a real filesystem temp directory:

```python
"""Integration test: pipeline resume from checkpoint."""

import json
import os
from unittest.mock import patch, MagicMock

import pytest

from worca.orchestrator.runner import run_pipeline, PipelineError
from worca.orchestrator.stages import Stage
from worca.orchestrator.work_request import WorkRequest


def _make_work_request():
    return WorkRequest(
        source_type="prompt",
        title="Add logging",
        description="Add structured logging to the service",
        source_ref=None,
        priority=None,
    )


def _plan_envelope():
    return {
        "structured_output": {
            "approved": True,
            "approach": "Use structlog",
            "tasks_outline": [{"title": "Add structlog", "description": "install and wire up"}],
        },
        "num_turns": 3,
        "total_cost_usd": 0.10,
        "usage": {"input_tokens": 100, "output_tokens": 50},
    }


def _error_envelope():
    """Simulate an agent crash partway through."""
    raise RuntimeError("simulated agent crash")


@pytest.fixture()
def worca_dir(tmp_path):
    d = tmp_path / ".worca"
    d.mkdir()
    return d


def test_resume_seeds_prompt_builder(tmp_path, worca_dir):
    """After a crash in COORDINATE, resuming correctly seeds plan context."""
    wr = _make_work_request()
    settings_path = str(tmp_path / "settings.json")
    (tmp_path / "settings.json").write_text(json.dumps({
        "worca": {
            "stages": {
                "plan": {"enabled": True, "agent": "planner"},
                "coordinate": {"enabled": True, "agent": "coordinator"},
                "implement": {"enabled": False},
                "test": {"enabled": False},
                "review": {"enabled": False},
                "pr": {"enabled": False},
            },
            "agents": {
                "planner": {"model": "opus", "max_turns": 5},
                "coordinator": {"model": "opus", "max_turns": 5},
            },
        }
    }))
    status_path = str(worca_dir / "status.json")

    captured_prompts = []

    def fake_run_agent(prompt, **kwargs):
        captured_prompts.append(prompt)
        return _plan_envelope()

    def fake_run_agent_crash(prompt, **kwargs):
        captured_prompts.append(prompt)
        raise RuntimeError("coordinate crash")

    # Run plan stage successfully, crash on coordinate
    call_count = {"n": 0}
    def fake_agent(prompt, **kwargs):
        call_count["n"] += 1
        captured_prompts.append(prompt)
        if call_count["n"] == 1:
            return _plan_envelope()
        raise RuntimeError("coordinate crash")

    with patch("worca.orchestrator.runner.run_agent", side_effect=fake_agent):
        with patch("worca.orchestrator.runner.create_branch", return_value=True):
            with patch("worca.utils.git.head_sha", return_value="aabbccdd"):
                try:
                    run_pipeline(wr, settings_path=settings_path, status_path=status_path)
                except RuntimeError:
                    pass  # expected crash

    # Verify status was saved with plan=completed, coordinate=error
    active_id = (worca_dir / "active_run").read_text().strip()
    run_status = json.loads((worca_dir / "runs" / active_id / "status.json").read_text())
    assert run_status["stages"]["plan"]["status"] == "completed"
    assert run_status["stages"]["coordinate"]["status"] == "error"

    # Resume from the crash
    captured_prompts.clear()
    call_count["n"] = 0

    def fake_agent_resume(prompt, **kwargs):
        captured_prompts.append(prompt)
        return {"beads_ids": [], "dependency_graph": {}}

    with patch("worca.orchestrator.runner.run_agent", side_effect=fake_agent_resume):
        with patch("worca.orchestrator.runner.checkout_branch", return_value=True):
            with patch("worca.utils.git.head_sha", return_value="aabbccdd"):
                run_pipeline(
                    wr,
                    resume=True,
                    run_id=active_id,
                    settings_path=settings_path,
                    status_path=status_path,
                )

    # The coordinate prompt on resume should include plan context
    assert len(captured_prompts) == 1
    resume_prompt = captured_prompts[0]
    assert "Use structlog" in resume_prompt  # plan_approach was seeded


def test_resume_find_error_stage(tmp_path, worca_dir):
    """find_resume_point returns the error stage, not a later pending stage."""
    from worca.orchestrator.resume import find_resume_point

    status = {
        "stages": {
            "plan": {"status": "completed"},
            "coordinate": {"status": "error", "error": "crash"},
            "implement": {"status": "pending"},
            "test": {"status": "pending"},
            "review": {"status": "pending"},
            "pr": {"status": "pending"},
        },
        "milestones": {"plan_approved": True},
    }
    assert find_resume_point(status) == Stage.COORDINATE
```

---

## 7. Edge Cases

| Scenario | Handling |
|----------|----------|
| `--run-id` points to a results/ archive | `run_pipeline.py` checks `.worca/runs/<id>/status.json`; if not found, prints an error. Results are in `.worca/results/<id>/` which the user should re-activate manually if needed. |
| Branch was deleted since checkpoint | `checkout_branch()` returns False; runner logs warning and continues on current branch. |
| Codebase is ahead of checkpoint by many commits | Divergence guard logs the first 10 lines of diff stat and continues. The implementer agent sees the current codebase and can adapt. |
| Checkpoint log files are missing for a completed stage | `reconstruct_context()` silently skips missing files; `seed_prompt_builder` skips the missing stage. The downstream agent receives a less-informed prompt but does not crash. |
| Resume requested but all stages completed | `find_resume_point()` returns `None`; runner logs "Pipeline already completed" and returns the existing status dict without re-running anything. |
| Resume requested but no stages completed | `find_resume_point()` returns `Stage.PLAN`; the pipeline effectively re-runs from the beginning, which is identical to a fresh run. |
| `--run-id` and `--prompt` both supplied | The `--prompt` value is used for the work request; `--run-id` still resolves the run directory for direct lookup. The work-request match check in `run_pipeline()` still applies. |
| `head_sha` is None in saved status (old checkpoint) | Divergence guard is skipped; the `if checkpoint_sha:` guard handles this. |
| `_head_sha()` fails (no git) | Wrapped in `try/except`; `head_sha` returns `""` and the divergence guard is skipped. |
| Stage exits with `"error"` and then the user retries without `--resume` | Normal fresh start: the `else` branch in `run_pipeline()` archives the old run and starts fresh. |

---

## 8. Acceptance Criteria

1. `find_resume_point` returns a stage with `status: "error"` as the resume point, not the next pending stage. Existing tests in `test_resume.py` continue to pass; new `test_finds_error_stage` and `test_error_stage_before_pending` pass.

2. After a crash mid-COORDINATE with a completed PLAN, running `run_pipeline.py --resume` causes the coordinate agent's prompt to contain the `plan_approach` string from the saved `plan/iter-1.json` checkpoint. Verified by `test_resume_seeds_prompt_builder`.

3. `init_status()` always produces a dict with a `"head_sha"` key. Its value is either an 8-character hex string or `None`. Verified by `test_init_status_captures_head_sha`.

4. `run_pipeline.py --run-id 20260310-143012` without `--prompt`/`--source`/`--spec` loads the work request from `.worca/runs/20260310-143012/status.json` and calls `run_pipeline(resume=True, run_id="20260310-143012")`.

5. `run_pipeline.py --run-id <nonexistent>` prints a clear error message and exits non-zero without touching any status files.

6. When resuming and the stored branch name is valid, `git checkout <branch>` is called and logged as `"Branch: <name>"`. When checkout fails, a `"warn"` log line is emitted and the run continues.

7. When `HEAD` SHA on resume differs from `status["head_sha"]`, the runner emits a warning log with the old and new SHAs and up to 10 lines of `git diff --stat`. The pipeline does not abort.

8. `pytest tests/ -v` passes with no regressions. New tests in `test_resume.py` and `test_resume_integration.py` and `test_git.py` and `test_status.py` all pass.

---

## 9. File Summary

### Modified files

| File | Changes |
|------|---------|
| `.claude/worca/orchestrator/resume.py` | Fix `find_resume_point` to handle `"error"` status; add `seed_prompt_builder()` function |
| `.claude/worca/utils/git.py` | Add `head_sha()` and `checkout_branch()` functions |
| `.claude/worca/state/status.py` | Add `head_sha` capture in `init_status()` |
| `.claude/worca/orchestrator/runner.py` | Add `run_id` parameter; call `checkout_branch` on resume; add divergence guard; call `seed_prompt_builder` on resume; add `_checkpoint()` helper; update `head_sha` after each stage completion |
| `.claude/scripts/run_pipeline.py` | Add `--run-id` flag; make work-request args optional when `--run-id` supplied; pass `run_id` to `run_pipeline()` |

### New files

| File | Purpose |
|------|---------|
| `tests/test_resume_integration.py` | Integration tests for the full resume cycle end-to-end |

### Modified test files

| File | Changes |
|------|---------|
| `tests/test_resume.py` | Add `test_finds_error_stage`, `test_error_stage_before_pending`, `test_seed_prompt_builder_*` (4 cases); update import to include `seed_prompt_builder` |
| `tests/test_git.py` | Add `test_head_sha_*` and `test_checkout_branch_*` (4 cases) |
| `tests/test_status.py` | Add `test_init_status_captures_head_sha` |

---

## 10. Rollout Order

Tasks should be implemented in this order due to dependencies:

1. **Task 1** — Fix `find_resume_point` (standalone, no dependencies)
2. **Task 3** — Add `head_sha()` and `checkout_branch()` to `git.py` (standalone)
3. **Task 4** — Add `head_sha` to `init_status()` (depends on Task 3)
4. **Task 2** — Add `seed_prompt_builder` to `resume.py` (depends on Task 1 implicitly; standalone otherwise)
5. **Task 5** — Wire everything into `runner.py` (depends on Tasks 2, 3, 4)
6. **Task 6** — Update `run_pipeline.py` (depends on Task 5)
7. **Task 7** — Unit tests for `find_resume_point` error fix (depends on Task 1)
8. **Task 8** — Unit tests for `seed_prompt_builder` (depends on Task 2)
9. **Task 9** — Unit tests for `git.py` additions (depends on Task 3)
10. **Task 10** — Unit test for `init_status` `head_sha` (depends on Task 4)
11. **Task 11** — Integration test (depends on Tasks 1-6 all complete)
