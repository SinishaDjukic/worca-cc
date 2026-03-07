"""Pipeline status tracking. Reads/writes status JSON."""

import json
import os
from pathlib import Path


PIPELINE_STAGES = ["plan", "coordinate", "implement", "test", "review"]


def load_status(path: str = ".worca/status.json") -> dict:
    """Read and parse the status JSON file.

    Returns empty dict if file doesn't exist.
    """
    if not os.path.exists(path):
        return {}
    with open(path, "r") as f:
        return json.load(f)


def save_status(status: dict, path: str = ".worca/status.json") -> None:
    """Write status dict as formatted JSON.

    Creates parent directory if needed.
    """
    parent = Path(path).parent
    parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump(status, f, indent=2)
        f.write("\n")


def update_stage(status: dict, stage: str, **kwargs) -> dict:
    """Update status['stages'][stage] with kwargs.

    Creates the 'stages' key if it doesn't exist.
    Returns the updated status dict (mutated in place).
    """
    if "stages" not in status:
        status["stages"] = {}
    if stage not in status["stages"]:
        status["stages"][stage] = {}
    status["stages"][stage].update(kwargs)
    return status


def set_milestone(status: dict, milestone: str, value: bool) -> dict:
    """Set status['milestones'][milestone] = value.

    Creates the 'milestones' key if it doesn't exist.
    Returns the updated status dict (mutated in place).
    """
    if "milestones" not in status:
        status["milestones"] = {}
    status["milestones"][milestone] = value
    return status


def init_status(work_request: dict, branch: str) -> dict:
    """Create a fresh status dict with all stages set to 'pending'.

    Populates work_request and branch.
    """
    status = {
        "work_request": work_request,
        "branch": branch,
        "stages": {stage: {"status": "pending"} for stage in PIPELINE_STAGES},
        "milestones": {},
    }
    return status
