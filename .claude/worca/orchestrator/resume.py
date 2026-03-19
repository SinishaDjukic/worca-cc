"""Checkpoint and resume logic.

Provides functions to find where to resume a pipeline, reconstruct context
from saved stage outputs, and check if a status file supports resumption.
"""

import glob
import json
import os
from typing import Optional

from worca.orchestrator.stages import Stage, STAGE_ORDER
from worca.state.status import load_status


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
        stage_status = stages.get(stage.value, {}).get("status", "pending")
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
    return context


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
