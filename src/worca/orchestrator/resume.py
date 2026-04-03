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
from worca.state.status import load_status
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
        if it.get("status") == "completed":
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


def find_resume_point(status: dict) -> Optional[Stage]:
    """Find the stage where the pipeline should resume.

    Always returns PREFLIGHT to re-validate the environment on every resume,
    regardless of its previous completion status. Circuit breaker state in
    status["circuit_breaker"] is preserved automatically since it lives in the
    status dict.

    Returns None only when all stages are genuinely completed and no milestone
    gates are pending.
    """
    stages = status.get("stages", {})
    milestones = status.get("milestones", {})

    all_stages_done = all(
        stages.get(stage.value, {}).get("status", "pending") == "completed"
        for stage in STAGE_ORDER
    )
    if not all_stages_done:
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
        if stage_status == "completed":
            # Try nested per-iteration log files first
            stage_dir = os.path.join(logs_dir, stage.value)
            if os.path.isdir(stage_dir):
                iter_files = sorted(glob.glob(os.path.join(stage_dir, "iter-*.json")))
                if iter_files:
                    with open(iter_files[-1]) as f:
                        context[stage.value] = json.load(f)
                    continue
            # Fall back to legacy flat file
            log_path = os.path.join(logs_dir, f"{stage.value}.json")
            if os.path.exists(log_path):
                with open(log_path) as f:
                    context[stage.value] = json.load(f)
        elif stage_status == "in_progress":
            # Find last completed iteration and read its specific log file.
            # The last iter file in the directory may be dirty (in_progress),
            # so we look up the exact completed iteration number from status.
            last_completed = find_last_completed_iteration(stage_data)
            if last_completed is not None:
                iter_path = os.path.join(
                    logs_dir, stage.value, f"iter-{last_completed}.json"
                )
                if os.path.exists(iter_path):
                    with open(iter_path) as f:
                        context[stage.value] = json.load(f)
    return context


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


def can_resume(status_path: str = ".worca/status.json") -> bool:
    """Check if a pipeline can be resumed from a status file.

    Checks active_run pointer first for per-run status, then falls back
    to the given status_path.
    Returns True if status file exists and has at least one completed stage.
    Returns False if no status file or all stages are pending.
    """
    # Try active_run pointer first
    worca_dir = os.path.dirname(status_path)
    active_run_path = os.path.join(worca_dir, "active_run")
    status = None
    if os.path.exists(active_run_path):
        try:
            run_id = open(active_run_path).read().strip()
            candidate = os.path.join(worca_dir, "runs", run_id, "status.json")
            status = load_status(candidate)
        except OSError:
            pass
    if not status:
        status = load_status(status_path)
    if not status:
        return False
    stages = status.get("stages", {})
    return any(s.get("status") == "completed" for s in stages.values())
