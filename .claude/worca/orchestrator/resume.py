"""Checkpoint and resume logic.

Provides functions to find where to resume a pipeline, reconstruct context
from saved stage outputs, and check if a status file supports resumption.
"""

import glob
import json
import os
from typing import Optional

from worca.orchestrator.stages import Stage
from worca.state.status import load_status

STAGE_ORDER = [Stage.PLAN, Stage.COORDINATE, Stage.IMPLEMENT, Stage.TEST, Stage.REVIEW, Stage.PR]


def find_resume_point(status: dict) -> Optional[Stage]:
    """Find the stage where the pipeline should resume.

    Scans stages in order. Returns the first stage that is "in_progress" or
    "pending" after a "completed" one. If a milestone gate is pending
    (e.g. plan_approved=None after plan=completed), returns the current stage
    for the gate. If all completed, returns None.
    """
    stages = status.get("stages", {})
    milestones = status.get("milestones", {})

    for stage in STAGE_ORDER:
        stage_status = stages.get(stage.value, {}).get("status", "pending")
        if stage_status == "completed":
            # Check if milestone gate is pending
            if stage == Stage.PLAN and milestones.get("plan_approved") is None:
                return stage
            if stage == Stage.REVIEW and milestones.get("pr_approved") is None:
                return stage
            continue
        if stage_status in ("in_progress", "pending"):
            return stage
    return None  # all completed


def reconstruct_context(status: dict, logs_dir: str = ".worca/logs") -> dict:
    """Reconstruct pipeline context from saved stage output logs.

    Reads saved stage outputs from {logs_dir}/{stage_name}.json for all
    completed stages. Returns a dict of {stage_name: output_data}.
    """
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

    Returns True if status file exists and has at least one completed stage.
    Returns False if no status file or all stages are pending.
    """
    status = load_status(status_path)
    if not status:
        return False
    stages = status.get("stages", {})
    return any(s.get("status") == "completed" for s in stages.values())
