# W-002: Parallel Implementer Execution


**Goal:** Eliminate the sequential bottleneck in the IMPLEMENT stage by allowing the coordinator's independent task groups to be executed by multiple implementer agents simultaneously, each in its own isolated git worktree. Time-to-completion for multi-task work requests is reduced proportionally to parallelism. Results are merged back into the pipeline branch before the TEST stage proceeds.

**Architecture:** The coordinator already emits a `parallel_groups` field (present but currently unused in `coordinate.json`). The runner detects this field after COORDINATE completes and, when two or more independent groups exist, delegates to a new `ParallelImplementer` class instead of the single-agent `run_stage()` call. `ParallelImplementer` creates one git worktree per group under `.claude/worktrees/`, runs one implementer agent per worktree via `run_agent()` in parallel threads, collects results, then merges each worktree branch back into the pipeline branch using `git merge --no-ff`. Conflicts trigger a dedicated conflict-resolution agent. A semaphore enforces the configurable `max_parallel_implementers` limit. Each agent writes to its own log file, and the orchestrator log receives prefixed progress lines so the UI sees a unified stream.

**Tech Stack:** Python `concurrent.futures.ThreadPoolExecutor`, `threading.Semaphore`, existing `subprocess`-based `git` utilities (`git.py`), existing `run_agent()` and `build_command()` from `claude_cli.py`, existing `ProcessPoolExecutor`-based patterns from `run_parallel.py`, existing `coordinate.json` schema (already has `parallel_groups`).

**Depends on:** None. All required primitives already exist: `create_worktree()` / `remove_worktree()` in `git.py`, `run_agent()` in `claude_cli.py`, `parallel_groups` in `coordinate.json` schema.

---

## 1. Scope and Boundaries

### In scope

- Detect `parallel_groups` in COORDINATE output and branch into parallel execution when groups >= 2
- `ParallelImplementer` class: worktree lifecycle, agent dispatch, result collection
- Thread-based parallelism (not process-based) so log streaming and signal handling stay in the main process
- Per-agent log files under the run's `logs/implement/` directory with a `worker-{n}` prefix
- Merge strategy: sequential `git merge --no-ff` of each worktree branch into the pipeline branch after all workers finish
- Conflict resolution: if merge fails, spawn a resolver agent in the conflicting worktree to fix conflicts, then retry the merge
- Resource limit: `max_parallel_implementers` setting (default 3), enforced via `threading.Semaphore`
- Worktree cleanup: remove worktrees on success; preserve on failure for debugging (configurable)
- Status reporting: aggregate `files_changed` and `tests_added` across all workers into a combined IMPLEMENT result
- Fallback: if `parallel_groups` is missing or has only one group, use the existing `run_stage()` path unchanged
- Settings: `worca.parallel.max_implementers` and `worca.parallel.cleanup_on_failure` keys in `settings.json`

### Out of scope

- UI changes for multi-agent log display (tracked separately as part of W-012 Log Filtering)
- Parallel execution of any stage other than IMPLEMENT
- Dynamic task redistribution if one worker fails mid-run
- Shared inter-worker state or communication during execution
- Cross-worktree dependency resolution during parallel execution (tasks within a group must be independent)

---

## 2. Data Flow

```
COORDINATE result
  └─ parallel_groups: [["bd-001","bd-002"], ["bd-003"], ["bd-004","bd-005"]]

Runner detects len(parallel_groups) >= 2
  └─ ParallelImplementer.run(groups, context, ...)
       ├─ Worker 0: worktree .claude/worktrees/impl-{run_id}-0/
       │    └─ implementer agent, beads bd-001 + bd-002
       ├─ Worker 1: worktree .claude/worktrees/impl-{run_id}-1/
       │    └─ implementer agent, bead bd-003
       └─ Worker 2: worktree .claude/worktrees/impl-{run_id}-2/
            └─ implementer agent, beads bd-004 + bd-005
       (semaphore limits concurrency to max_parallel_implementers)

All workers complete
  └─ Merge phase (sequential, main thread)
       for each worktree branch:
         git merge --no-ff {branch} → success → next
                                     → conflict → resolver agent → retry merge
  └─ Aggregate results → combined ImplementOutput
  └─ Status update: implement stage completed with parallel=true, worker_count=N

TEST stage proceeds on merged pipeline branch
```

---

## 3. New Schema: `parallel_implement.json`

The parallel implement result aggregates outputs from all workers. This is the structured output returned by `ParallelImplementer.run()` and stored in the pipeline status identically to a normal implement result.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "ParallelImplementOutput",
  "type": "object",
  "required": ["bead_id", "files_changed"],
  "properties": {
    "bead_id": { "type": "string" },
    "files_changed": {
      "type": "array",
      "items": { "type": "string" }
    },
    "tests_added": {
      "type": "array",
      "items": { "type": "string" }
    },
    "parallel": { "type": "boolean" },
    "worker_count": { "type": "integer" },
    "worker_results": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "worker_id": { "type": "integer" },
          "bead_ids": { "type": "array", "items": { "type": "string" } },
          "branch": { "type": "string" },
          "files_changed": { "type": "array", "items": { "type": "string" } },
          "tests_added": { "type": "array", "items": { "type": "string" } },
          "status": { "type": "string" },
          "conflict_resolved": { "type": "boolean" }
        }
      }
    }
  }
}
```

---

## 4. Settings Keys

New keys added to the `worca.parallel` namespace in `settings.json`:

```json
{
  "worca": {
    "parallel": {
      "max_implementers": 3,
      "cleanup_on_failure": false,
      "worktree_base_dir": ".claude/worktrees",
      "conflict_resolver_agent": "implementer",
      "conflict_resolver_max_turns": 50
    }
  }
}
```

| Key | Default | Description |
|-----|---------|-------------|
| `max_implementers` | `3` | Maximum concurrent implementer agents (1-10) |
| `cleanup_on_failure` | `false` | Remove worktrees even if a worker fails (useful for CI) |
| `worktree_base_dir` | `.claude/worktrees` | Where to create per-worker worktrees |
| `conflict_resolver_agent` | `"implementer"` | Agent used to resolve merge conflicts |
| `conflict_resolver_max_turns` | `50` | Max turns for the resolver agent |

---

## 5. Implementation Tasks

### Task 1: Extend `coordinate.json` Schema to Require `parallel_groups`

**Files:**
- Modify: `.claude/worca/schemas/coordinate.json`

The `parallel_groups` field already exists in the schema but is optional and has no description. Promote it to the `required` array and add a description so the coordinator always emits it. Agents without independent tasks should emit `[[...all_bead_ids...]]` (a single group).

**Change:**

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "CoordinateOutput",
  "type": "object",
  "required": ["beads_ids", "dependency_graph", "parallel_groups"],
  "properties": {
    "beads_ids": {
      "type": "array",
      "items": { "type": "string" }
    },
    "dependency_graph": {
      "type": "object",
      "additionalProperties": {
        "type": "array",
        "items": { "type": "string" }
      }
    },
    "parallel_groups": {
      "description": "Groups of bead IDs that can be implemented in parallel. Each inner array is a group of independent tasks. Single-group means sequential execution.",
      "type": "array",
      "items": {
        "type": "array",
        "items": { "type": "string" }
      }
    }
  }
}
```

---

### Task 2: Create `parallel_implement.json` Schema

**Files:**
- Create: `.claude/worca/schemas/parallel_implement.json`

Write the full JSON Schema as defined in Section 3 above. This schema is used as the `--json-schema` argument when the parallel implement result is stored, and for validation in tests.

The `bead_id` field in the top-level output should be set to `"parallel"` as a sentinel value (the field exists for schema compatibility with the normal implement path).

---

### Task 3: Extend `git.py` with Merge and Conflict Detection Utilities

**Files:**
- Modify: `.claude/worca/utils/git.py`

Add three new functions below the existing `diff_stat()`:

**`merge_branch(branch: str, message: str = "") -> tuple[bool, str]`**
- Runs: `git merge --no-ff {branch} -m "{message}"`
- Returns `(True, "")` on success
- Returns `(False, conflict_output)` on failure, where `conflict_output` is the raw stderr/stdout for logging
- Does NOT abort the merge on failure (leaves repo in conflicted state for the resolver)

**`abort_merge() -> bool`**
- Runs: `git merge --abort`
- Returns True on success
- Used as cleanup when conflict resolution itself fails

**`list_conflict_files() -> list[str]`**
- Runs: `git diff --name-only --diff-filter=U`
- Returns list of file paths that have unresolved conflicts
- Used to build the resolver agent's prompt

**`worktree_branch(worktree_path: str) -> str`**
- Runs: `git -C {worktree_path} rev-parse --abbrev-ref HEAD`
- Returns the branch name of a worktree given its path
- Used during cleanup to know which branch to delete after worktree removal

Full implementation of all four functions in the same subprocess-based style as existing functions, using `_run_git()`.

---

### Task 4: Create `ParallelImplementer` Class

**Files:**
- Create: `.claude/worca/orchestrator/parallel_implementer.py`

This is the core of W-002. The class manages the full lifecycle of parallel implementation.

**Class signature:**

```python
class ParallelImplementer:
    def __init__(
        self,
        run_id: str,
        pipeline_branch: str,
        run_dir: str,
        logs_dir: str,
        settings_path: str = ".claude/settings.json",
    ):
        ...

    def run(
        self,
        parallel_groups: list[list[str]],
        context: dict,
        agent_path: str,
        json_schema: str,
        max_turns: int,
    ) -> dict:
        """Execute all groups in parallel. Returns aggregated ImplementOutput."""
        ...
```

**Internal methods to implement:**

`_read_parallel_settings() -> dict`
- Read `worca.parallel` from `settings_path`, return defaults if missing
- Defaults: `max_implementers=3`, `cleanup_on_failure=False`, `worktree_base_dir=".claude/worktrees"`, `conflict_resolver_agent="implementer"`, `conflict_resolver_max_turns=50`

`_create_worker_worktree(worker_id: int) -> tuple[str, str]`
- Generates `worktree_path = {worktree_base_dir}/impl-{run_id}-{worker_id}`
- Generates `branch = worca/impl-{run_id}-{worker_id}`
- Calls `create_worktree(worktree_path, branch)` from `git.py`
- Returns `(worktree_path, branch)`
- Raises `RuntimeError` if worktree creation fails

`_build_worker_prompt(bead_ids: list[str], context: dict) -> str`
- Builds the implementer prompt for a specific group of bead IDs
- Base prompt from `context["prompt"]`
- Appends: "Your assigned tasks are Beads: {', '.join(bead_ids)}. Implement each in sequence using `bd ready` to check status, `bd update {id} status in_progress` to claim, then implement."
- Appends any test_failures or review_issues from context (for retry iterations)

`_run_worker(worker_id: int, bead_ids: list[str], worktree_path: str, agent_path: str, json_schema: str, max_turns: int, context: dict, semaphore: threading.Semaphore) -> dict`
- Acquires semaphore, runs agent, releases semaphore
- Sets `cwd` for the agent by setting `WORCA_WORKTREE_PATH` env var (the agent reads files relative to the worktree)
- Log path: `{logs_dir}/implement/worker-{worker_id}-iter-{iteration}.log`
- Calls `run_agent()` with `log_path` set to the per-worker log path
- Returns dict: `{"worker_id": worker_id, "bead_ids": bead_ids, "branch": branch, "result": structured_output, "raw": raw_envelope, "status": "ok"|"error", "error": str}`
- On any exception: returns `{"worker_id": worker_id, "status": "error", "error": str(e), ...}`

`_merge_worker(branch: str, worker_id: int, worktree_path: str, conflict_resolver_agent: str, conflict_resolver_max_turns: int) -> tuple[bool, bool]`
- Called sequentially after all workers complete (NOT threaded — git merges must be serial)
- Calls `merge_branch(branch, message=f"Merge parallel implementer {worker_id}")`
- On success: returns `(True, False)` (merged=True, conflict_resolved=False)
- On failure: logs conflict files, calls `_resolve_conflicts(worktree_path, branch, ...)`, returns `(True, True)` if resolved or `(False, False)` if resolution failed

`_resolve_conflicts(worktree_path: str, branch: str, conflict_files: list[str], agent_path: str, max_turns: int) -> bool`
- Builds a prompt: "Resolve git merge conflicts in the following files: {conflict_files}. Open each file, find and fix conflict markers (<<<<<<<, =======, >>>>>>>). Then run `git add {files}` and `git commit -m 'resolve: merge conflicts in parallel implementation'`."
- Calls `run_agent()` with `cwd=worktree_path` — IMPORTANT: the resolver runs in the worktree, not the main repo
- After the agent finishes, checks that conflicts are resolved with `list_conflict_files()` from the main repo
- If still conflicted: calls `abort_merge()`, returns False
- Returns True if all conflicts resolved

`_cleanup_worktrees(worktrees: list[tuple[str, str]], success: bool, cleanup_on_failure: bool) -> None`
- Iterates `(worktree_path, branch)` pairs
- Removes worktree if: success=True, OR (success=False AND cleanup_on_failure=True)
- Calls `remove_worktree(worktree_path)` then `git branch -D {branch}` (subprocess)
- Logs each removal with the orchestrator `_log()` pattern

`run()` method implementation:
1. Read parallel settings
2. Create one worktree per group: `_create_worker_worktree(i)` for i in range(len(parallel_groups))
3. Build `threading.Semaphore(max_implementers)`
4. Submit all workers to `ThreadPoolExecutor(max_workers=len(parallel_groups))`
5. Collect results as futures complete (using `as_completed`)
6. Log progress for each completed worker
7. After all futures done: iterate worktrees sequentially, call `_merge_worker()` for each
8. Aggregate: union of all `files_changed` lists, union of all `tests_added` lists, deduped
9. Build and return the combined output dict matching `ImplementOutput` schema plus `parallel=True`, `worker_count=N`, `worker_results=[...]`
10. Call `_cleanup_worktrees()` in a `finally` block

**Signal handling note:** The `run_agent()` calls inside worker threads use the `_proc_lock` from `claude_cli.py`, which is a single lock. The parallel implementer must NOT call `terminate_current()` directly — instead it sets a module-level `_parallel_shutdown` flag that each worker checks before starting work (after acquiring the semaphore). When the main process receives SIGTERM via `runner.py`'s existing handler, `terminate_current()` will kill only the currently active subprocess. Remaining workers fail fast when the shutdown flag is set.

---

### Task 5: Add `_run_agent_in_worktree()` Helper to `claude_cli.py`

**Files:**
- Modify: `.claude/worca/utils/claude_cli.py`

The existing `run_agent()` always runs in the current working directory. Parallel workers need to run agents rooted in their worktree directory so file reads and writes go to the right place.

Add a thin wrapper:

```python
def run_agent_in_worktree(
    prompt: str,
    agent: str,
    worktree_path: str,
    max_turns: int = 0,
    output_format: str = "stream-json",
    json_schema: Optional[str] = None,
    log_path: Optional[str] = None,
    on_event: Optional[Callable[[dict], None]] = None,
) -> dict:
    """Run a claude agent with its working directory set to worktree_path.

    Identical to run_agent() but passes cwd=worktree_path to Popen.
    The agent path must be absolute or relative to the main repo root,
    NOT relative to the worktree.
    """
```

Implementation: copy `run_agent()` exactly, but add `cwd=worktree_path` to the `subprocess.Popen()` call. The agent `.md` file path is resolved from the calling context (main repo) and passed as an absolute path so it works regardless of cwd.

Also update `build_command()` to accept an optional `cwd: str` parameter (unused in command building, carried through for documentation clarity).

**Important:** The `_current_proc` global is shared across threads. The `_proc_lock` in `claude_cli.py` must be extended to support multiple concurrent processes for the parallel case. Replace the single `_current_proc` with a `_current_procs: set` (a set of active processes), protected by `_proc_lock`. Update `terminate_current()` to terminate all processes in the set. This is a breaking-compatible change since `terminate_current()` was previously a no-op when no process was running.

Changes to `claude_cli.py`:

```python
# Replace:
_current_proc = None
_proc_lock = threading.Lock()

def terminate_current():
    with _proc_lock:
        proc = _current_proc
    if proc is None:
        return
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
    except (ProcessLookupError, OSError):
        pass

# With:
_current_procs: set = set()
_proc_lock = threading.Lock()

def terminate_current():
    with _proc_lock:
        procs = list(_current_procs)
    for proc in procs:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
        except (ProcessLookupError, OSError):
            pass
```

Update `run_agent()` and `run_agent_in_worktree()` to use `_current_procs.add(proc)` / `_current_procs.discard(proc)` instead of assignment.

---

### Task 6: Integrate `ParallelImplementer` into `runner.py`

**Files:**
- Modify: `.claude/worca/orchestrator/runner.py`

This is the integration point. The runner's IMPLEMENT stage handling (around line 738 in the current file) is extended to detect `parallel_groups`.

**Add import at top of `runner.py`:**

```python
from worca.orchestrator.parallel_implementer import ParallelImplementer
```

**Add helper function `_should_run_parallel()`:**

```python
def _should_run_parallel(coordinate_result: dict, settings_path: str) -> bool:
    """Return True if parallel execution is warranted.

    Conditions:
    - coordinate_result has 'parallel_groups' key
    - parallel_groups has >= 2 non-empty groups
    - worca.parallel.max_implementers setting is >= 2 (or absent/defaulting to 3)
    """
    groups = coordinate_result.get("parallel_groups", [])
    non_empty = [g for g in groups if g]
    if len(non_empty) < 2:
        return False
    try:
        with open(settings_path) as f:
            settings = json.load(f)
        max_impl = settings.get("worca", {}).get("parallel", {}).get("max_implementers", 3)
        return max_impl >= 2
    except (FileNotFoundError, json.JSONDecodeError):
        return True
```

**Modify the IMPLEMENT stage block** (in the `while stage_idx < len(stage_order)` loop, inside `current_stage == Stage.IMPLEMENT`):

Replace the existing single `run_stage(current_stage, ...)` call with branching logic:

```python
# Check if parallel execution is warranted
coordinate_result = status.get("stages", {}).get("coordinate", {}).get("output", {})
# coordinate output is stored in iter_extras["output"] which flows into status
# Alternative: read from prompt_builder context
parallel_groups = prompt_builder.get_context("parallel_groups", [])

if _should_run_parallel({"parallel_groups": parallel_groups}, settings_path):
    _log(f"IMPLEMENT: {len([g for g in parallel_groups if g])} parallel groups detected")
    config = get_stage_config(Stage.IMPLEMENT, settings_path=settings_path)
    agent_path = _agent_path(config["agent"], run_dir=run_dir)
    # Resolve agent path to absolute so it works from any worktree cwd
    agent_abs = os.path.abspath(agent_path)
    schema_path = _schema_path(config["schema"])
    schema_abs = os.path.abspath(schema_path)
    parallel_impl = ParallelImplementer(
        run_id=status["run_id"],
        pipeline_branch=branch_name,
        run_dir=run_dir,
        logs_dir=logs_dir,
        settings_path=settings_path,
    )
    result = parallel_impl.run(
        parallel_groups=parallel_groups,
        context=context,
        agent_path=agent_abs,
        json_schema=schema_abs,
        max_turns=config["max_turns"] * msize,
    )
    raw_envelope = {"parallel": True, "structured_output": result}
else:
    # Existing sequential path (unchanged)
    result, raw_envelope = run_stage(
        current_stage, context, settings_path,
        msize=msize, iteration=iter_num,
    )
```

**Store `parallel_groups` in PromptBuilder context** after COORDINATE completes (already done for `beads_ids` and `dependency_graph`; add one more line in the existing COORDINATE handler):

```python
prompt_builder.update_context("parallel_groups", result.get("parallel_groups", []))
```

---

### Task 7: Update Coordinator Agent Prompt to Emit `parallel_groups`

**Files:**
- Modify: `.claude/agents/core/coordinator.md`

The coordinator agent must understand that it needs to emit `parallel_groups` in its structured output. Read the existing coordinator agent prompt and add a section explaining:

1. What `parallel_groups` means: groups of bead IDs that have no dependencies between them and can be implemented simultaneously.
2. How to compute it: topological sort of the dependency graph, group tasks with no inter-group dependencies.
3. The single-group fallback: if all tasks depend on each other, emit `[[ all_bead_ids ]]`.
4. The format: a JSON array of arrays of bead ID strings.

Add to the coordinator's output instructions section (after the existing task creation instructions):

```markdown
## Parallel Groups Output

After creating all tasks with `bd create` and setting dependencies with `bd dep add`, compute which tasks can run in parallel:

1. Build the dependency graph from the tasks you created.
2. Identify groups of tasks where no task in group A depends on any task in group B (and vice versa).
3. Emit these groups as `parallel_groups` in your structured output.

**Example:** If you created tasks A, B, C, D where C depends on A:
- Group 1 (independent): [A, B, D]  — no cross-dependencies
- Actually: A and C are coupled (C depends on A), so group them with C's dependents
- Correct grouping: [[A, C], [B], [D]] or [[A, C], [B, D]]

If you are unsure, emit a single group with all task IDs: `[[id1, id2, id3, ...]]`.
This triggers sequential execution (safe fallback).
```

---

### Task 8: Add Parallel Implementation Status to `status.py`

**Files:**
- Modify: `.claude/worca/state/status.py`

Read the file first to understand current structure, then add a helper function used by the runner to record parallel-specific metadata on the implement stage entry in status.json.

Add function:

```python
def record_parallel_implement(status: dict, worker_results: list, worker_count: int) -> None:
    """Record parallel implementation metadata on the implement stage status entry.

    Adds 'parallel', 'worker_count', and 'worker_results' to the implement stage dict.
    Safe to call even if implement stage does not exist (no-op in that case).
    """
    impl = status.get("stages", {}).get("implement")
    if impl is None:
        return
    impl["parallel"] = True
    impl["worker_count"] = worker_count
    impl["worker_results"] = worker_results
```

---

### Task 9: Update `run_stage()` Logging to Handle Parallel Envelope

**Files:**
- Modify: `.claude/worca/orchestrator/runner.py`

The existing `_log_stage_metrics()` function (line 273) reads fields like `duration_ms`, `num_turns`, and `total_cost_usd` from the raw envelope. For parallel runs, the "envelope" is the synthetic dict `{"parallel": True, "structured_output": result}` — it has none of these fields, so the metrics logger would log nothing.

Extend `_log_stage_metrics()` to handle parallel envelopes:

```python
def _log_stage_metrics(stage_label: str, result: dict, raw_envelope: dict) -> None:
    # Existing single-agent metric logging...
    # ... existing code ...

    # NEW: parallel-specific metrics
    if raw_envelope.get("parallel") and isinstance(result, dict):
        worker_count = result.get("worker_count", 0)
        worker_results = result.get("worker_results", [])
        if worker_count:
            _log(f"{stage_label} parallel: {worker_count} workers")
        conflicts = sum(1 for w in worker_results if w.get("conflict_resolved"))
        if conflicts:
            _log(f"{stage_label} conflicts resolved: {conflicts}", "warn")
        failed = sum(1 for w in worker_results if w.get("status") == "error")
        if failed:
            _log(f"{stage_label} workers failed: {failed}", "err")
```

---

### Task 10: Write Unit Tests for `ParallelImplementer`

**Files:**
- Create: `tests/test_parallel_implementer.py`

Tests use `unittest.mock` to mock git operations and `run_agent_in_worktree()`. No real git repo or Claude CLI calls are made.

**Test cases to implement:**

`test_should_run_parallel_two_groups()` — `_should_run_parallel()` returns True for two non-empty groups with default settings.

`test_should_run_parallel_single_group()` — returns False for a single-group `parallel_groups`.

`test_should_run_parallel_empty_groups()` — returns False when `parallel_groups` is absent.

`test_should_run_parallel_max_one()` — returns False when `max_implementers=1` in settings.

`test_parallel_implementer_aggregates_files()` — mock two workers returning `files_changed=["a.py"]` and `files_changed=["b.py"]`; verify the aggregate result has both files with no duplicates.

`test_parallel_implementer_deduplicates_files()` — two workers both change `"shared.py"`; verify it appears once in the aggregate.

`test_parallel_implementer_worker_failure_propagates()` — one worker raises RuntimeError; verify the run raises `PipelineError` (not silently swallowed).

`test_parallel_implementer_semaphore_limits_concurrency()` — start 5 workers with `max_implementers=2`; use a threading.Event to verify at most 2 are active simultaneously.

`test_merge_conflict_triggers_resolver()` — mock `merge_branch()` to return `(False, "conflict")` on first call; verify `_resolve_conflicts()` is called and then merge is retried.

`test_cleanup_worktrees_on_success()` — verify `remove_worktree()` is called for each worktree when `success=True`.

`test_cleanup_worktrees_skipped_on_failure_by_default()` — verify `remove_worktree()` is NOT called when `success=False` and `cleanup_on_failure=False`.

---

### Task 11: Write Unit Tests for New `git.py` Functions

**Files:**
- Modify: `tests/test_git.py` (create if it does not exist)

**Test cases:**

`test_merge_branch_success()` — mock `subprocess.run` returning returncode 0; verify `merge_branch()` returns `(True, "")`.

`test_merge_branch_conflict()` — mock `subprocess.run` returning returncode 1 with stderr "CONFLICT"; verify returns `(False, "CONFLICT")`.

`test_abort_merge()` — mock subprocess returning returncode 0; verify `abort_merge()` returns True.

`test_list_conflict_files()` — mock subprocess stdout "foo.py\nbar.py\n"; verify returns `["foo.py", "bar.py"]`.

`test_list_conflict_files_none()` — mock subprocess stdout ""; verify returns `[]`.

`test_worktree_branch()` — mock subprocess stdout "worca/impl-20260310-001"; verify returns that string.

---

### Task 12: Write Unit Tests for Updated `claude_cli.py` Multi-Proc Tracking

**Files:**
- Modify: `tests/test_claude_cli.py` (create if it does not exist)

**Test cases:**

`test_terminate_current_kills_all_procs()` — add two mock procs to `_current_procs`; call `terminate_current()`; verify `os.killpg` called twice.

`test_terminate_current_no_procs()` — `_current_procs` is empty; verify `terminate_current()` is a no-op (no exception).

`test_run_agent_registers_proc()` — mock `subprocess.Popen`; verify the process is added to `_current_procs` while running, then removed after.

`test_run_agent_in_worktree_uses_cwd()` — verify `subprocess.Popen` is called with `cwd=worktree_path`.

---

### Task 13: Update `settings.json` with Parallel Defaults

**Files:**
- Modify: `.claude/settings.json`

Add the `parallel` block to the `worca` namespace. This makes the defaults explicit and visible to users:

```json
{
  "worca": {
    ...existing keys...,
    "parallel": {
      "max_implementers": 3,
      "cleanup_on_failure": false,
      "worktree_base_dir": ".claude/worktrees",
      "conflict_resolver_agent": "implementer",
      "conflict_resolver_max_turns": 50
    }
  }
}
```

---

### Task 14: Integration Test with Mock Agents

**Files:**
- Create: `tests/test_parallel_integration.py`

A higher-level integration test that exercises the full parallel flow with mocked `run_agent_in_worktree()` calls but real `threading` and result aggregation. Uses a temporary directory as a fake git repo (initialized with `git init`).

**Test cases:**

`test_full_parallel_flow_two_groups()`:
1. `git init` a temp dir, create an initial commit
2. Create a `ParallelImplementer` with `max_implementers=2`
3. Mock `create_worktree()` to create actual subdirectories (not real git worktrees)
4. Mock `run_agent_in_worktree()` to return a valid `ImplementOutput` after a short sleep
5. Mock `merge_branch()` to return `(True, "")`
6. Call `parallel_impl.run(parallel_groups=[["bd-001"], ["bd-002"]], ...)`
7. Assert the result has `parallel=True`, `worker_count=2`, and the correct aggregated files

`test_full_parallel_flow_conflict_resolved()`:
- Same as above but `merge_branch()` returns `(False, "conflict")` on first call
- `_resolve_conflicts()` is mocked to return True (success)
- Second call to `merge_branch()` returns `(True, "")`
- Verify `conflict_resolved=True` in the worker result

---

## 6. Rollout Order

Tasks must be implemented in this order due to dependencies:

1. **Task 3** (`git.py` merge utilities) — foundation for merge and conflict work; no dependencies
2. **Task 5** (`claude_cli.py` multi-proc tracking) — foundation for parallel agent invocation; no dependencies
3. **Task 1** (`coordinate.json` schema) — makes `parallel_groups` required; coordinator must emit it
4. **Task 2** (`parallel_implement.json` schema) — new schema for aggregate output
5. **Task 7** (coordinator agent prompt) — teaches coordinator to emit `parallel_groups`
6. **Task 4** (`ParallelImplementer` class) — depends on Tasks 3, 5
7. **Task 8** (`status.py` parallel recording helper) — small, can go any time after Task 4 is planned
8. **Task 9** (runner logging for parallel envelope) — depends on Task 4's envelope shape being defined
9. **Task 6** (runner integration) — depends on Tasks 4, 8, 9
10. **Task 13** (settings.json defaults) — applies any time; safe to do here
11. **Task 11** (git.py unit tests) — depends on Task 3
12. **Task 12** (claude_cli.py unit tests) — depends on Task 5
13. **Task 10** (`ParallelImplementer` unit tests) — depends on Task 4
14. **Task 14** (integration tests) — depends on Tasks 4, 6

---

## 7. Testing Strategy

### Unit Tests

- `tests/test_parallel_implementer.py` (Task 10) — mocked git + agent calls, full class coverage
- `tests/test_git.py` (Task 11) — new merge/conflict functions
- `tests/test_claude_cli.py` (Task 12) — multi-proc tracking
- `tests/test_run_parallel.py` (existing) — already tests `_slugify()`; extend with new cases if slug format changes

### Integration Tests

- `tests/test_parallel_integration.py` (Task 14) — real threading, mocked I/O; verifies aggregate result structure and conflict-resolution path

### Manual Smoke Test Checklist

- Run a pipeline with a work request that has clearly independent tasks (e.g., "Add logging to module A and add a health check endpoint to module B")
- Verify the coordinator emits `parallel_groups` with 2+ groups
- Verify two worktrees appear under `.claude/worktrees/`
- Verify two separate log files appear under `.worca/runs/{run_id}/logs/implement/`
- Verify the merge completes cleanly and the TEST stage sees all changes
- Verify worktrees are cleaned up after a successful run
- Run with `max_implementers=1`; verify it falls back to sequential execution
- Introduce an intentional conflict (two workers touch the same file differently); verify the resolver agent is invoked and the conflict is resolved

### Edge Cases to Verify

- `parallel_groups` is `[]` (empty): falls through to sequential
- `parallel_groups` is `[[all_tasks]]` (single group): falls through to sequential
- One worker times out (no result event from stream-json): the future raises RuntimeError; the entire parallel run fails; worktrees are preserved for debugging
- SIGTERM during parallel execution: `terminate_current()` kills all active procs; shutdown flag prevents remaining workers from starting
- Worktree creation fails (disk full, branch name collision): RuntimeError is raised before any agents start
- All workers fail: `PipelineError` is raised; status is updated to `error`
- Conflict resolver fails to fix conflicts: merge is aborted, the pipeline fails with a clear error message naming the conflicting files

---

## 8. File Summary

### New files

| File | Purpose |
|------|---------|
| `.claude/worca/schemas/parallel_implement.json` | Aggregate output schema for parallel implement stage |
| `.claude/worca/orchestrator/parallel_implementer.py` | `ParallelImplementer` class: worktree lifecycle, agent dispatch, merge, conflict resolution |
| `tests/test_parallel_implementer.py` | Unit tests for `ParallelImplementer` |
| `tests/test_git.py` | Unit tests for new git merge/conflict utilities |
| `tests/test_claude_cli.py` | Unit tests for multi-proc `terminate_current()` and `run_agent_in_worktree()` |
| `tests/test_parallel_integration.py` | Integration tests for full parallel flow with real threading |

### Modified files

| File | Changes |
|------|---------|
| `.claude/worca/schemas/coordinate.json` | Add `parallel_groups` to `required` array; add description |
| `.claude/worca/utils/git.py` | Add `merge_branch()`, `abort_merge()`, `list_conflict_files()`, `worktree_branch()` |
| `.claude/worca/utils/claude_cli.py` | Replace `_current_proc` with `_current_procs` set; add `run_agent_in_worktree()`; update `terminate_current()` |
| `.claude/worca/orchestrator/runner.py` | Import `ParallelImplementer`; add `_should_run_parallel()`; branch IMPLEMENT stage on `parallel_groups`; store `parallel_groups` in PromptBuilder context; extend `_log_stage_metrics()` for parallel envelope |
| `.claude/worca/state/status.py` | Add `record_parallel_implement()` helper |
| `.claude/agents/core/coordinator.md` | Add `parallel_groups` computation instructions to output section |
| `.claude/settings.json` | Add `worca.parallel` configuration block with defaults |

---

## 9. Acceptance Criteria

All of the following must be true for W-002 to be considered complete:

1. **Schema:** `coordinate.json` requires `parallel_groups`; the coordinator agent always emits it; validation passes with `jsonschema`.

2. **Parallel detection:** `_should_run_parallel()` returns True for a real COORDINATE result with 2+ non-empty groups, and False for single-group results or when `max_implementers=1`.

3. **Worker isolation:** Each worker's changes are committed only to its own worktree branch; the main pipeline branch is not touched until the merge phase.

4. **Merge correctness:** After all workers complete and merge, `git log --oneline` on the pipeline branch shows one merge commit per worker; all worker files are present.

5. **Conflict resolution:** When two workers write conflicting changes to the same file, the resolver agent is invoked; if it succeeds, the pipeline continues; if it fails, the pipeline fails with a `PipelineError` naming the conflict files.

6. **Resource limit:** With `max_implementers=2` and 4 workers, at most 2 agents run concurrently at any point (verified by the semaphore test in Task 10).

7. **Log separation:** Each worker writes to its own log file (`worker-0-iter-1.log`, `worker-1-iter-1.log`, etc.); the orchestrator log contains prefixed progress lines for each worker.

8. **Status completeness:** After a parallel IMPLEMENT stage, `status.json` contains `parallel: true`, `worker_count: N`, and a `worker_results` array with one entry per worker, each showing its bead IDs, branch, files changed, and status.

9. **Sequential fallback:** A pipeline with a single-group `parallel_groups` (or no `parallel_groups`) runs identically to before this change; all existing tests pass unchanged.

10. **Signal handling:** Sending SIGTERM during parallel execution kills all active implementer subprocesses within 1 second; the pipeline status is updated to `interrupted`; no orphan `claude` processes remain.

11. **Test suite:** `pytest tests/ -v` passes with no failures or errors after all tasks are implemented.

12. **Worktree cleanup:** After a successful pipeline run, no directories under `.claude/worktrees/impl-{run_id}-*` remain; after a failed run with `cleanup_on_failure=false`, they are preserved.
