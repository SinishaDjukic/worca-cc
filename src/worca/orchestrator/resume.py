"""Checkpoint and resume logic.

Provides functions to find where to resume a pipeline, reconstruct context
from saved stage outputs, and check if a status file supports resumption.

New in W-001 (iteration-level resume):
  - find_last_completed_iteration: last completed iter number within a stage
  - get_resume_iteration: iter N+1 to resume from
  - restore_loop_counters: recover persisted loop_counters from status
  - reconstruct_context: extended to include in_progress stages with
    completed iterations
"""

import glob
import json
import os
from typing import Optional

from worca.orchestrator.stages import Stage, STAGE_ORDER
from worca.state.status import load_status, PipelineStatus, PIPELINE_TERMINAL
from worca.utils.git import get_current_git_head


def find_last_completed_iteration(stage_data: dict) -> Optional[int]:
    """Find the last completed iteration number within a stage.

    Iterates through the stage's iterations list and returns the highest
    number whose status is 'completed'. Ignores any in_progress entries
    (dirty state from crash/stop).

    Returns None if no completed iterations exist.
    """
    iterations = stage_data.get("iterations") or []
    last_completed = None
    for it in iterations:
        if it.get("status") == PipelineStatus.COMPLETED:
            last_completed = it.get("number")
    return last_completed


def get_resume_iteration(stage_data: dict) -> int:
    """Get the iteration number to resume from within a stage.

    Returns last_completed + 1, or 1 if no completed iterations exist.
    The returned value is the *next* iteration to run, not the last completed.
    """
    last = find_last_completed_iteration(stage_data)
    return 1 if last is None else last + 1


def restore_loop_counters(status: dict) -> dict:
    """Restore persisted loop counters from a status dict.

    Returns a copy of status['loop_counters'], or an empty dict if absent
    or None. Loop counters track how many retries each loop has consumed
    (e.g. implement_test, pr_changes).
    """
    counters = status.get("loop_counters") or {}
    return dict(counters)


def find_resume_point(status: dict, flow_stage_names: list | None = None) -> Optional[Stage]:
    """Find the stage where the pipeline should resume.

    Always returns PREFLIGHT to re-validate the environment on every resume,
    regardless of its previous completion status. Circuit breaker state in
    status["circuit_breaker"] is preserved automatically since it lives in the
    status dict.

    flow_stage_names (W-071): the effective flow's stage keys. Custom
    (non-builtin) stages are invisible to the STAGE_ORDER walk below; any
    custom stage that is not completed counts as resumable work. Without the
    list, custom names recorded in status["stages"] are still checked — only
    a custom stage that never started AND sits after every builtin stage
    would be missed.

    Returns None only when all stages are genuinely completed and no milestone
    gates are pending.
    """
    stages = status.get("stages", {})
    milestones = status.get("milestones", {})

    all_stages_done = all(
        stages.get(stage.value, {}).get("status", "pending") == PipelineStatus.COMPLETED
        for stage in STAGE_ORDER
    )
    if not all_stages_done:
        return Stage.PREFLIGHT

    # W-071: custom stages. Builtin names (learn included — post stages run
    # outside the main walk and must not retrigger a resume) are excluded.
    _builtin_names = {s.value for s in Stage}
    _candidate_names = flow_stage_names if flow_stage_names is not None else list(stages)
    for name in _candidate_names:
        if name in _builtin_names:
            continue
        if stages.get(name, {}).get("status", "pending") != PipelineStatus.COMPLETED:
            return Stage.PREFLIGHT

    # All stages completed — check milestone gates
    if milestones.get("plan_approved") is None:
        return Stage.PREFLIGHT
    if milestones.get("pr_approved") is None:
        return Stage.PREFLIGHT

    return None  # all completed


def reconstruct_context(status: dict, logs_dir: str = None) -> dict:
    """Reconstruct pipeline context from saved stage output logs.

    Derives logs_dir from status run_id if not provided.
    Reads saved stage outputs from {logs_dir}/{stage_name}.json for all
    completed stages. Returns a dict of {stage_name: output_data}.
    """
    if logs_dir is None:
        run_id = status.get("run_id")
        if run_id:
            logs_dir = os.path.join(".worca", "runs", run_id, "logs")
        else:
            logs_dir = ".worca/logs"
    context = {}
    stages = status.get("stages", {})
    for stage in STAGE_ORDER:
        stage_data = stages.get(stage.value, {})
        stage_status = stage_data.get("status", "pending")
        if stage_status == PipelineStatus.COMPLETED:
            # Try nested per-iteration log files first
            stage_dir = os.path.join(logs_dir, stage.value)
            if os.path.isdir(stage_dir):
                iter_files = sorted(glob.glob(os.path.join(stage_dir, "iter-*.json")))
                if iter_files:
                    with open(iter_files[-1], encoding="utf-8") as f:
                        context[stage.value] = json.load(f)
                    continue
            # Fall back to legacy flat file
            log_path = os.path.join(logs_dir, f"{stage.value}.json")
            if os.path.exists(log_path):
                with open(log_path, encoding="utf-8") as f:
                    context[stage.value] = json.load(f)
        elif stage_status == "in_progress":  # legacy iteration status
            # Find last completed iteration and read its specific log file.
            # The last iter file in the directory may be dirty (in_progress),
            # so we look up the exact completed iteration number from status.
            last_completed = find_last_completed_iteration(stage_data)
            if last_completed is not None:
                iter_path = os.path.join(
                    logs_dir, stage.value, f"iter-{last_completed}.json"
                )
                if os.path.exists(iter_path):
                    with open(iter_path, encoding="utf-8") as f:
                        context[stage.value] = json.load(f)
    return context


_STAGE_CONTEXT_MAP: dict[str, list[tuple[str, str]]] = {
    "coordinate": [
        ("beads_ids", "beads_ids"),
        ("dependency_graph", "dependency_graph"),
    ],
    "implement": [
        ("files_changed", "files_changed"),
        ("tests_added", "tests_added"),
        ("bead_id", "assigned_bead_id"),
    ],
    "test": [
        ("passed", "test_passed"),
        ("coverage_pct", "test_coverage"),
        ("proof_artifacts", "proof_artifacts"),
        ("failures", "test_failures"),
    ],
    "review": [
        ("issues", "review_issues"),
    ],
    "plan": [
        ("approach", "plan_approach"),
        ("tasks_outline", "plan_tasks_outline"),
    ],
}


_ABSENT = object()


def backfill_prompt_context(prompt_builder, status: dict, logs_dir: str = None) -> list[str]:
    """Populate missing PromptBuilder context keys from saved stage output logs.

    Calls reconstruct_context() to read stage log files, then for each stage
    in _STAGE_CONTEXT_MAP, maps output fields to context keys using
    write-only-if-absent semantics (never overwrites keys already present).

    Returns a list of the context key names that were actually set.
    """
    stage_outputs = reconstruct_context(status, logs_dir)
    filled: list[str] = []
    for stage_name, field_mappings in _STAGE_CONTEXT_MAP.items():
        output = stage_outputs.get(stage_name)
        if not output:
            continue
        if "structured_output" in output:
            output = output["structured_output"]
        for output_field, context_key in field_mappings:
            if prompt_builder.get_context(context_key, _ABSENT) is not _ABSENT:
                continue
            if output_field not in output:
                continue
            prompt_builder.update_context(context_key, output[output_field])
            filled.append(context_key)
    return filled


def check_git_divergence(status: dict, current_head: str = None) -> dict:
    """Check if git HEAD has diverged from the stored git_head in status.

    Compares status['git_head'] (recorded at pipeline start) with the
    current HEAD SHA. If current_head is not provided, calls
    get_current_git_head() to fetch it.

    Returns a dict:
        {
            'diverged': bool,
            'stored': str | None,   # git_head from status
            'current': str | None,  # current HEAD SHA
        }

    Returns diverged=False when no git_head is stored (can't compare).
    """
    stored = status.get("git_head") or None
    if current_head is None:
        current_head = get_current_git_head()

    if not stored:
        return {"diverged": False, "stored": stored, "current": current_head}

    diverged = stored != current_head
    return {"diverged": diverged, "stored": stored, "current": current_head}


_TERMINAL_STATUSES = PIPELINE_TERMINAL


def can_resume(status_path: str = ".worca/status.json", run_id: str | None = None) -> bool:
    """Check if a pipeline can be resumed.

    If run_id is given, checks that specific run directly.
    Otherwise scans runs/ for a non-terminal run, then falls back to status_path.
    Returns True if a status file with at least one completed stage is found.
    """
    worca_dir = os.path.dirname(status_path)
    status = None

    if run_id is not None:
        candidate = os.path.join(worca_dir, "runs", run_id, "status.json")
        status = load_status(candidate)
    else:
        runs_dir = os.path.join(worca_dir, "runs")
        if os.path.isdir(runs_dir):
            for entry in sorted(os.listdir(runs_dir)):
                candidate = os.path.join(runs_dir, entry, "status.json")
                s = load_status(candidate)
                if s and s.get("pipeline_status") not in _TERMINAL_STATUSES:
                    status = s
                    break

    if not status:
        status = load_status(status_path)
    if not status:
        return False
    stages = status.get("stages", {})
    return any(s.get("status") == PipelineStatus.COMPLETED for s in stages.values())
