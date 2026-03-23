# W-030: Parallel Pipeline Execution

**Goal:** Enable running multiple independent worca pipelines simultaneously against the same repository, each processing a different work request in full isolation. The solution uses git worktrees as the isolation boundary — each pipeline gets its own working tree, its own `.worca/` state directory, and its own branch. A unified monitoring layer provides live observability across all running pipelines.

**Architecture:** A new `run_multi.py` entry point accepts multiple work requests and orchestrates them in parallel. Each request gets a git worktree via `git worktree add`, and a subprocess running `run_pipeline.py` with `cwd` set to the worktree path. This provides OS-level process isolation (separate PID, separate `os.environ`, separate module globals) and filesystem isolation (separate `.worca/`, separate `HEAD`, separate working tree). A registry file at `.worca/multi/registry.json` in the main working tree tracks all active pipelines across worktrees for the UI to discover. The worca-ui server is extended with a multi-pipeline dashboard that watches the registry and subscribes to each worktree's status independently.

**Tech Stack:** Python `concurrent.futures.ProcessPoolExecutor`, `subprocess.Popen`, existing `git worktree` primitives in `git.py`, existing `run_pipeline.py` as the per-worktree entry point, Node.js `fs.watch` for multi-directory monitoring, existing WebSocket protocol extended with multi-run awareness.

**Depends on:** None. All core primitives exist. W-002 (parallel implementers) is complementary but independent — W-002 parallelizes within a single pipeline's IMPLEMENT stage; W-030 parallelizes entire pipelines.

---

## 1. Scope and Boundaries

### In scope

- `run_multi.py` CLI entry point: accepts multiple `--request` arguments (prompts, issue refs, spec files), creates worktrees, dispatches pipelines
- Git worktree lifecycle: create before pipeline start, archive or cleanup after completion
- Pipeline registry: `.worca/multi/registry.json` tracks all active/completed parallel runs with worktree paths
- Beads isolation: per-worktree beads initialization so pipelines don't share `.beads/beads.db`
- UI multi-pipeline dashboard: list all running pipelines, drill into any one, live status for all
- CLI multi-pipeline monitoring: `worca.py multi-status` showing all active pipelines
- Control: per-pipeline pause/stop/resume via existing control file mechanism (scoped to each worktree)
- Cleanup: configurable worktree retention policy (remove on success, keep on failure, keep all)
- Run ID collision prevention: add sub-second uniqueness to run IDs
- Base branch selection: `--base-branch` flag (default `main`) controls the starting point for worktree branches; UI launch panel with branch selector dropdown
- API rate limit awareness: configurable max concurrent pipelines, backoff documentation

### Out of scope

- Cross-pipeline dependency resolution (pipelines are fully independent)
- Shared branch merging (each pipeline creates and pushes its own PR)
- Dynamic pipeline scheduling or queuing (use W-004 work request queue for that)
- Distributed execution across multiple machines
- Shared cost budget enforcement across pipelines (each pipeline has its own budget)

---

## 2. Obstacle Analysis

This section catalogs every obstacle identified during deep codebase analysis, classified by severity, and specifies the exact resolution for each.

### BLOCKER 1: Git Working Tree HEAD Contention

**Location:** `.claude/worca/utils/git.py:13-18`
**Problem:** `create_branch()` calls `git checkout -b`, which mutates the shared `HEAD`. Two pipelines in the same working tree race on which branch is active. The Guardian agent's `git commit` commits to whichever branch HEAD currently points to.
**Resolution:** Each pipeline runs in its own git worktree. Worktrees have independent `HEAD`, independent index, and independent working tree. `git worktree add -b {branch} {path}` creates both the worktree and the branch atomically. The `create_branch()` call inside `run_pipeline.py` is skipped when `--worktree` mode is detected (the branch already exists from worktree creation).

**Branching base:** Worktrees support two modes controlled by `--base-branch`:

- **`--base-branch main`** (default for `run_multi.py`): each pipeline branches from `main`/`master`, ensuring independent features start from a clean baseline with no ordering dependency between parallel pipelines.
- **`--base-branch HEAD`** or `--base-branch {any-branch}`: each pipeline branches from the specified ref, useful for iterative work where pipelines should build on recent changes.

The single-pipeline `run_pipeline.py` retains its current behavior (branch from `HEAD`) for backward compatibility.

```python
# In run_multi.py — worktree creation with base branch
branch = f"worca/{slug}-{run_id}"
worktree_path = os.path.join(project_root, ".worktrees", f"pipeline-{run_id}")
# Default base_branch="main"; user can override with --base-branch
subprocess.run(
    ["git", "worktree", "add", "-b", branch, worktree_path, base_branch],
    check=True,
)
```

```python
# In runner.py — skip branch creation when in worktree
if status.get("worktree"):
    _log("Branch already exists from worktree creation, skipping checkout")
else:
    create_branch(branch_name)
```

### BLOCKER 2: PID File Singleton Lock

**Location:** `.claude/worca/orchestrator/runner.py:316-342`
**Problem:** `.worca/pipeline.pid` prevents a second pipeline in the same `.worca/` directory. `_write_pid()` checks if the old PID is alive and raises `PipelineError` if so.
**Resolution:** Each worktree has its own `.worca/` directory (because the working directory differs and `.worca/` is a relative path). The PID file at `{worktree}/.worca/pipeline.pid` is unique per worktree. No code change needed — the existing mechanism works correctly when `cwd` differs.

**Verification:** The `_pid_path()` function derives the PID path from `os.path.dirname(status_path)`. When `status_path` is `{worktree}/.worca/runs/{id}/status.json`, the PID file lands at `{worktree}/.worca/pipeline.pid`. Confirmed isolated.

### BLOCKER 3: `active_run` Pointer Clobbering

**Location:** `.claude/worca/orchestrator/runner.py:1008-1093`
**Problem:** `.worca/active_run` is a single-entry file. Pipeline B overwrites Pipeline A's run ID, making A invisible to the UI and CLI.
**Resolution:** Same as Blocker 2 — each worktree's `.worca/active_run` is independent because the path is relative to `cwd`. Each pipeline writes its own `active_run` in its own `.worca/` directory. No code change to the pointer mechanism.

**New requirement:** The multi-pipeline registry (`.worca/multi/registry.json` in the **main** working tree) tracks all active worktree pipelines so the UI can discover them without relying on any single `active_run`.

### BLOCKER 4: Beads Database Contention

**Location:** `.beads/beads.db` at project root; `.claude/worca/utils/beads.py` wraps the `bd` CLI
**Problem:** Even with git worktrees, `.beads/` sits at the repo root and is shared. Two Coordinators creating tasks race on the same SQLite database. Two Implementers calling `bd ready` may claim cross-pipeline tasks.
**Resolution:** Initialize a **per-worktree beads database** during worktree setup. After `git worktree add`, run `bd init` inside the worktree to create `{worktree}/.beads/`. The `bd` CLI respects the working directory for database location.

```python
# In run_multi.py — after worktree creation
subprocess.run(["bd", "init"], cwd=worktree_path, check=True)
```

**Post-pipeline merge:** When a pipeline completes, its beads are already closed (the Coordinator closes them via `bd close`). The main tree's beads database does not need to be updated — each pipeline's beads are local to its worktree and serve only as in-flight coordination state.

**Alternative considered:** Using `run:{run_id}` label filtering on a shared database. Rejected because SQLite write contention under parallel `bd create` / `bd update` calls causes `SQLITE_BUSY` errors and requires retry logic. Clean isolation is simpler and more reliable.

### BLOCKER 5: UI Server Single-Pipeline Architecture

**Location:** `.claude/worca-ui/server/` — `process-manager.js`, `watcher.js`, `ws.js`
**Problem:** The Express/WebSocket UI monitors one `worcaDir`, one `active_run`, one `pipeline.pid`. Cannot track multiple simultaneous pipelines.
**Resolution:** Extend the UI with multi-pipeline awareness in three layers:

1. **Registry watcher** — new `multi-watcher.js` module that watches `.worca/multi/registry.json` in the main working tree. When a pipeline is registered/deregistered, it creates/destroys per-worktree watchers.

2. **Per-pipeline watchers** — for each active worktree pipeline, instantiate the existing `watcher.js` logic (status watching, log tailing, event streaming) scoped to `{worktree}/.worca/`. Each watcher emits events prefixed with the pipeline's `run_id`.

3. **WebSocket protocol extension** — new message types:
   - `list-pipelines` → returns all active + recently completed pipelines from registry
   - `subscribe-pipeline {runId}` → subscribe to a specific pipeline's events (delegates to existing per-run subscription)
   - `pipeline-status-changed` → broadcast when any pipeline's status changes

4. **Dashboard view** — new `multi-dashboard.js` lit-html view showing a card grid of all running pipelines with live status, stage progress, and quick actions (pause/stop). Clicking a card navigates to the existing `run-detail.js` view.

### BLOCKER 6: Module-Level Globals (In-Process Parallelism)

**Location:** `.claude/worca/orchestrator/runner.py:96-100` (`_shutdown_requested`, `_signal_status`, `_signal_status_path`); `.claude/worca/utils/claude_cli.py:19-20` (`_current_proc`, `_proc_lock`)
**Problem:** These module-level singletons would be clobbered if `run_pipeline()` were called concurrently within the same Python process.
**Resolution:** The worktree strategy uses **subprocess isolation** — each pipeline is a separate `python run_pipeline.py` OS process. Each process has its own Python interpreter, its own module namespace, and its own copy of these globals. No code change needed.

**Future-proofing note:** If in-process parallelism is ever desired (e.g., for a library API), these globals must be refactored into a `PipelineContext` class. This is explicitly out of scope for W-008.

### BLOCKER 7: `os.environ` Mutations (In-Process Parallelism)

**Location:** `.claude/worca/orchestrator/runner.py:1124,1206-1208` — sets `WORCA_EVENTS_PATH`, `WORCA_RUN_ID`, `WORCA_PLAN_FILE` on `os.environ`
**Problem:** In a threaded scenario, Pipeline B's env vars overwrite Pipeline A's, causing hooks to emit events to the wrong JSONL file.
**Resolution:** Same as Blocker 6 — subprocess isolation means each pipeline process has its own `os.environ`. No code change needed.

**Additionally:** The `get_env()` function in `env.py` already constructs a fresh env dict for each `run_agent()` call by copying `os.environ` and adding agent-specific variables. This pattern is correct and works with subprocess isolation.

### FRICTION 8: Cumulative Stats Race Condition

**Location:** `.claude/worca/utils/stats.py:30` — read-modify-write on `cumulative.json` with no file lock
**Problem:** Two pipelines completing simultaneously: last writer wins, one run's stats are silently lost.
**Resolution:** Add file-locking around the read-modify-write cycle using `fcntl.flock()`:

```python
import fcntl

def update_cumulative_stats(status: dict, stats_path: str) -> None:
    os.makedirs(os.path.dirname(stats_path), exist_ok=True)
    lock_path = stats_path + ".lock"
    with open(lock_path, "w") as lock_fd:
        fcntl.flock(lock_fd, fcntl.LOCK_EX)
        try:
            stats = _load_cumulative(stats_path)
            # ... mutate stats ...
            _save_cumulative(stats, stats_path)
        finally:
            fcntl.flock(lock_fd, fcntl.LOCK_UN)
```

The stats file lives at `{project_root}/stats/cumulative.json` (shared across worktrees since they share the repo root). File locking is the correct solution here.

### FRICTION 9: Run ID Collision Window

**Location:** `.claude/worca/orchestrator/runner.py:197` — `_generate_run_id()` uses `YYYYMMDD-HHMMSS` format
**Problem:** Two pipelines started within the same second get identical run IDs. Their per-run directories collide.
**Resolution:** Add millisecond precision and a random suffix:

```python
def _generate_run_id(started_at: str) -> str:
    dt = datetime.fromisoformat(started_at)
    base = dt.strftime("%Y%m%d-%H%M%S")
    ms = f"{dt.microsecond // 1000:03d}"
    suffix = secrets.token_hex(2)  # 4 hex chars
    return f"{base}-{ms}-{suffix}"
```

This produces IDs like `20260323-143052-847-a1b2`, eliminating collision risk even for automated batch triggering with sub-second intervals.

### FRICTION 10: No Real-Time Monitoring of Parallel Runs

**Location:** `.claude/worktrees/agent-*/scripts/run_parallel.py:80-86` — `ProcessPoolExecutor` with `capture_output=True`, truncated output
**Problem:** During parallel execution, only `[OK]` or `[FAILED]` feedback per pipeline. No live progress, no per-pipeline stage tracking.
**Resolution:** The pipeline registry + UI multi-dashboard (Blocker 5 resolution) provides full live observability. Additionally, `run_multi.py` will print periodic status summaries to stdout:

```
[14:30:52] Pipeline 1/3: IMPLEMENT (iter 2/5) | Pipeline 2/3: TEST (iter 1/3) | Pipeline 3/3: PLAN (iter 1/1)
```

The CLI `worca.py multi-status` command reads the registry and each worktree's `status.json` to produce a live table.

### FRICTION 11: Test Gate State Reset

**Location:** `.claude/worca/hooks/test_gate.py:9` — `_state = {"strikes": 0}` resets per hook subprocess
**Problem:** The 2-strike test gate never accumulates across consecutive pytest failures because each hook invocation is a fresh Python process. Not a parallel-specific issue, but compounds in parallel where test failures are harder to track.
**Resolution:** Move strike state to a file inside the run directory:

```python
def _get_strike_path(run_dir: str) -> str:
    return os.path.join(run_dir, "test_gate_strikes.json")

def check_test_gate(run_dir: str, test_passed: bool) -> dict:
    strike_path = _get_strike_path(run_dir)
    state = json.loads(open(strike_path).read()) if os.path.exists(strike_path) else {"strikes": 0}
    if not test_passed:
        state["strikes"] += 1
    else:
        state["strikes"] = 0
    with open(strike_path, "w") as f:
        json.dump(state, f)
    if state["strikes"] >= 2:
        return {"blocked": True, "reason": f"{state['strikes']} consecutive test failures"}
    return {"blocked": False}
```

Since each worktree has its own run directory, the strike file is naturally isolated per pipeline.

---

## 3. Data Flow

```
User invokes:
  python .claude/scripts/run_multi.py \
    --request "Add user auth" \
    --request "gh:issue:42" \
    --request "docs/specs/caching.md" \
    --base-branch main \
    --max-parallel 3

run_multi.py:
  ├─ Read registry, check for stale entries
  ├─ For each request:
  │    ├─ Generate run_id (with ms + random suffix)
  │    ├─ git worktree add -b worca/{slug}-{run_id} .worktrees/pipeline-{run_id} {base_branch}
  │    ├─ bd init (in worktree, creates isolated .beads/)
  │    ├─ Register in .worca/multi/registry.json
  │    └─ Submit to ProcessPoolExecutor
  ├─ Each worker:
  │    └─ subprocess.run(["python", "run_pipeline.py", ...], cwd=worktree_path)
  │         └─ Full pipeline: preflight → plan → coordinate → implement → test → review → pr
  │              (all state in {worktree}/.worca/, all git ops on worktree branch)
  ├─ On worker completion:
  │    ├─ Update registry entry (status, duration, PR URL)
  │    ├─ Optionally cleanup worktree (configurable)
  │    └─ Print result line
  └─ Print summary table

Registry file (.worca/multi/registry.json):
  {
    "pipelines": [
      {
        "run_id": "20260323-143052-847-a1b2",
        "request": "Add user auth",
        "worktree_path": "/abs/path/.worktrees/pipeline-20260323-143052-847-a1b2",
        "branch": "worca/add-user-auth-20260323-143052-847-a1b2",
        "base_branch": "main",
        "status": "running",        // running | completed | failed | stopped
        "pid": 12345,
        "started_at": "2026-03-23T14:30:52Z",
        "completed_at": null,
        "pr_url": null
      },
      ...
    ]
  }

UI server:
  ├─ Watches .worca/multi/registry.json
  ├─ For each "running" pipeline:
  │    └─ Creates a scoped watcher for {worktree}/.worca/
  │         ├─ Watches status.json (stage progress)
  │         ├─ Tails active log file (agent output)
  │         └─ Tails events.jsonl (structured events)
  └─ Broadcasts to WebSocket clients:
       ├─ pipeline-list-changed (registry mutation)
       ├─ pipeline-status {run_id, stage, iteration, ...}
       ├─ log-line {run_id, line}
       └─ event {run_id, event}
```

---

## 4. Implementation Tasks

### Phase 1: Core Isolation (worktree lifecycle + run_multi.py)

**Task 1: Run ID uniqueness** — Modify `_generate_run_id()` in `runner.py` to include milliseconds and a random suffix. Update any code that parses run IDs (the regex in `discoverRuns()` in `watcher.js`, the `_archive_run()` glob pattern).

**Task 2: Worktree lifecycle helpers** — Extend `git.py` with:
- `create_pipeline_worktree(run_id, slug) -> str` — creates `.worktrees/pipeline-{run_id}`, returns absolute path
- `remove_pipeline_worktree(worktree_path)` — `git worktree remove --force`
- `list_pipeline_worktrees() -> list[dict]` — parses `git worktree list --porcelain`

**Task 3: Per-worktree beads init** — After worktree creation, run `bd init` in the worktree directory. Verify that `bd` CLI respects `cwd` for database location. Add a test.

**Task 4: Pipeline registry** — New module `.claude/worca/orchestrator/registry.py`:
- `register_pipeline(run_id, request, worktree_path, branch, pid)`
- `update_pipeline(run_id, **fields)`
- `deregister_pipeline(run_id)`
- `list_pipelines(status=None) -> list[dict]`
- Uses file locking (`fcntl.flock`) for safe concurrent access
- Registry stored at `{project_root}/.worca/multi/registry.json`

**Task 5: `run_multi.py` entry point** — New script in `.claude/scripts/`:
- Accepts `--request` (repeatable), `--max-parallel` (default 3), `--cleanup` (default `on-success`), `--base-branch` (default `main`), `--msize`, `--mloops`, `--settings`
- `--base-branch` controls the git ref each worktree branches from: `main` (default) for independent features, `HEAD` for iterative work, or any branch/tag/SHA
- Creates worktrees (passing `base_branch` to `git worktree add`), initializes beads, registers pipelines
- Dispatches via `ProcessPoolExecutor(max_workers=max_parallel)`
- Each worker calls `subprocess.run(["python", ".claude/scripts/run_pipeline.py", "--worktree", ...], cwd=worktree_path)`
- Handles SIGINT/SIGTERM: writes control files to all active worktrees, waits for graceful shutdown
- Prints summary table on completion

**Task 6: `run_pipeline.py` worktree awareness** — Add `--worktree` flag. When set:
- Skip `create_branch()` (branch already exists from worktree creation)
- Set `status["worktree"] = worktree_path`
- On completion, do not archive to main tree's `.worca/results/` — leave in worktree's `.worca/`
- Register completion in the multi-pipeline registry if registry exists

### Phase 2: State Safety

**Task 7: Cumulative stats file locking** — Add `fcntl.flock()` around the read-modify-write cycle in `stats.py`. The lock file is `{stats_path}.lock`. Both the main tree and worktree pipelines write to the same `stats/cumulative.json` (at the repo root), so locking is essential.

**Task 8: Test gate persistence** — Move strike state from in-memory `_state` dict to `{run_dir}/test_gate_strikes.json`. The `post_tool_use.py` hook reads `WORCA_RUN_ID` to locate the correct run directory. Each pipeline (each worktree) has its own strike file.

### Phase 3: Monitoring

**Task 9: CLI multi-status command** — Add `multi-status` subcommand to `worca.py`:
- Reads `.worca/multi/registry.json`
- For each active pipeline, reads `{worktree}/.worca/runs/{run_id}/status.json`
- Prints a table: `run_id | request (truncated) | stage | iteration | duration | status`
- Auto-refreshes every 2s when `--watch` is passed

**Task 10: CLI per-pipeline control** — Extend `worca.py pause/stop/resume` to accept `--run-id` for targeting a specific pipeline in the registry. Locates the worktree path from the registry and writes the control file to the correct `.worca/runs/{run_id}/control.json`.

**Task 11: UI registry watcher** — New `multi-watcher.js` module:
- Watches `.worca/multi/registry.json` with `fs.watch()`
- On change, diffs the pipeline list and creates/destroys per-worktree watchers
- Each per-worktree watcher is an instance of the existing watcher logic, scoped to `{worktree}/.worca/`
- Emits `pipeline-registered` and `pipeline-deregistered` events

**Task 12: UI WebSocket protocol extension** — Extend `ws.js`:
- `list-pipelines` request → returns full registry
- `subscribe-pipeline {runId}` → creates a per-worktree subscription using existing status/log/event watching
- `pipeline-status-changed {runId, status, stage}` → broadcast on any pipeline state change

**Task 13: UI multi-pipeline dashboard view** — New `multi-dashboard.js` view:
- Card grid showing all registered pipelines
- Each card: title (truncated request), base branch badge, status badge, stage progress bar, elapsed time, quick actions
- Click navigates to `run-detail.js` (existing view, already works with any `status.json` path)
- Auto-updates via WebSocket events
- Build with `npm run build` after changes

**Task 13b: UI launch panel for parallel pipelines** — Extend the existing UI to support launching parallel pipelines:
- "Launch Parallel" button on the dashboard opens a panel/dialog
- Panel allows adding multiple work requests (prompt text, issue ref, or spec file path)
- **Base branch selector**: dropdown populated from `git branch --list` via a new REST endpoint (`GET /api/branches`), defaulting to `main`. User can select any local branch as the base for all pipelines in the batch.
- Max parallel slider (1-5, default from settings)
- Cleanup policy selector (on-success / always / never)
- Submit calls a new REST endpoint (`POST /api/multi-pipeline`) that spawns `run_multi.py` as a subprocess with the selected options
- The panel shows validation: warns if base branch has uncommitted changes, confirms the number of pipelines to launch

### Phase 4: Cleanup and Polish

**Task 14: Worktree cleanup policy** — Implement configurable cleanup in `run_multi.py`:
- `--cleanup on-success` (default): remove worktree when pipeline completes successfully; keep on failure
- `--cleanup always`: remove worktree after pipeline finishes regardless of outcome
- `--cleanup never`: keep all worktrees for debugging
- Cleanup runs `git worktree remove --force` followed by `git branch -d` for the worktree branch
- Registry entries for cleaned-up pipelines move to a `"completed_pipelines"` array with `cleaned_up: true`

**Task 15: Stale registry reconciliation** — On `run_multi.py` startup:
- Check all "running" entries in the registry
- For each, verify PID is alive (`os.kill(pid, 0)`)
- If dead: update status to "failed (stale)", optionally clean up worktree
- Prevent stale entries from accumulating across crashes

**Task 16: API rate limit documentation and configuration** — Add `worca.parallel.max_concurrent_pipelines` to `settings.json` schema (default 3). Document in `CLAUDE.md` that parallel pipelines multiply API usage proportionally and that Anthropic rate limits are per-account.

---

## 5. Settings Schema

New keys under `worca.parallel` in `.claude/settings.json`:

```json
{
  "worca": {
    "parallel": {
      "max_concurrent_pipelines": 3,
      "default_base_branch": "main",
      "cleanup_policy": "on-success",
      "worktree_base_dir": ".worktrees",
      "registry_path": ".worca/multi/registry.json",
      "status_poll_interval_seconds": 5
    }
  }
}
```

- `default_base_branch`: The git ref each worktree branches from. `"main"` for independent features (each pipeline starts from a clean baseline), `"HEAD"` for iterative work (pipelines build on current state), or any branch name/tag/SHA. Overridable per invocation via `--base-branch` CLI flag or the UI launch panel's branch selector.

---

## 6. File Changes Summary

### New files

| File | Purpose |
|---|---|
| `.claude/scripts/run_multi.py` | Multi-pipeline entry point |
| `.claude/worca/orchestrator/registry.py` | Pipeline registry (CRUD + file locking) |
| `.claude/worca-ui/server/multi-watcher.js` | Registry watcher, per-worktree watcher factory |
| `.claude/worca-ui/app/views/multi-dashboard.js` | Multi-pipeline dashboard view with launch panel |

### Modified files

| File | Change |
|---|---|
| `.claude/worca/orchestrator/runner.py` | Run ID format change (`_generate_run_id`); `--worktree` flag handling (skip `create_branch`); registry integration on completion |
| `.claude/worca/utils/git.py` | New `create_pipeline_worktree()`, `remove_pipeline_worktree()`, `list_pipeline_worktrees()` |
| `.claude/worca/utils/stats.py` | Add `fcntl.flock()` around read-modify-write |
| `.claude/worca/hooks/test_gate.py` | Move strikes to file-backed state in run directory |
| `.claude/worca/hooks/post_tool_use.py` | Pass run directory to `check_test_gate()` |
| `.claude/scripts/run_pipeline.py` | Add `--worktree` CLI flag, pass to `run_pipeline()` |
| `.claude/scripts/worca.py` | Add `multi-status` command; extend `pause/stop/resume` with `--run-id` |
| `.claude/worca-ui/server/ws.js` | New message types: `list-pipelines`, `subscribe-pipeline`, `pipeline-status-changed` |
| `.claude/worca-ui/server/watcher.js` | `discoverRuns()` updated for new run ID format regex |
| `.claude/worca-ui/server/index.js` | Mount multi-watcher, serve multi-dashboard, new REST endpoints (`GET /api/branches`, `POST /api/multi-pipeline`) |
| `.claude/worca-ui/app/main.js` | Route for multi-dashboard view |
| `.claude/settings.json` | New `worca.parallel` section |

---

## 7. Testing Strategy

### Unit tests

| Test file | What it covers |
|---|---|
| `tests/test_registry.py` | Registry CRUD, file locking under concurrent access, stale entry reconciliation |
| `tests/test_run_id.py` | New run ID format, uniqueness across rapid sequential generation |
| `tests/test_git_worktree.py` | Worktree create/remove/list helpers |
| `tests/test_stats_locking.py` | Concurrent stats updates don't lose data |
| `tests/test_test_gate_persistence.py` | Strike state survives across subprocess invocations |

### Integration tests

| Test | What it covers |
|---|---|
| `tests/test_multi_pipeline.py` | End-to-end: launch 2 pipelines with `--dry-run`, verify worktree creation, registry population, isolation of `.worca/` state, cleanup |
| `tests/test_multi_ui.py` | Playwright: multi-dashboard renders cards for 2 mock pipelines, clicking navigates to detail |

### Manual verification checklist

- [ ] Launch 2 pipelines in parallel via `run_multi.py` with `--base-branch main`; verify both branch from main
- [ ] Launch 2 pipelines with `--base-branch HEAD`; verify both branch from current HEAD
- [ ] Launch pipelines from UI launch panel; verify branch selector works and selected base is used
- [ ] Verify each worktree has its own `.beads/beads.db`
- [ ] Verify `git log --all --oneline` shows both pipeline branches
- [ ] Verify `worca.py multi-status` shows both pipelines with correct stages
- [ ] Verify UI multi-dashboard shows both pipelines with live updates
- [ ] Kill one pipeline mid-run; verify the other continues unaffected
- [ ] Verify cleanup removes worktree on success but preserves on failure
- [ ] Verify `cumulative.json` contains stats from both completed pipelines (no data loss)

---

## 8. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| API rate limits hit with multiple concurrent pipelines | Pipelines stall or fail with 429 errors | Circuit breaker already handles retries with backoff; document rate limit impact; keep `max_concurrent_pipelines` default at 3 |
| Disk space from multiple worktrees | Large repos × N worktrees = significant disk usage | Git worktrees share the object store (only working tree files are duplicated); cleanup policy removes completed worktrees |
| Merge conflicts between parallel pipeline branches | PRs can't be merged cleanly | Out of scope — each pipeline targets a separate feature; conflicts are resolved at PR review time, same as any parallel development |
| Registry file corruption on crash | Stale entries prevent new pipelines from launching cleanly | Reconciliation on startup checks PID liveness; atomic writes via temp+rename |
| Beads CLI doesn't respect `cwd` for database location | Pipelines share beads despite worktree isolation | Verify during Task 3; fallback: set `BEADS_DB` env var per subprocess |
