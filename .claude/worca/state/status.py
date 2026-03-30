"""Pipeline status tracking. Reads/writes status JSON."""

import json
import os
from datetime import datetime, timezone
from pathlib import Path


PIPELINE_STAGES = ["preflight", "plan", "coordinate", "implement", "test", "review", "pr"]


def load_status(path: str = ".worca/status.json") -> dict:
    """Read and parse the status JSON file.

    Returns empty dict if file doesn't exist.
    """
    if not os.path.exists(path):
        return {}
    with open(path, "r") as f:
        return json.load(f)


def save_status(status: dict, path: str = ".worca/status.json") -> None:
    """Write status dict as formatted JSON using atomic temp+rename.

    Writes to a temp file in the same directory, then os.rename to
    atomically replace the target. Prevents corruption if the pipeline
    crashes mid-write. Creates parent directory if needed.
    """
    import tempfile

    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)

    fd, tmp_path = tempfile.mkstemp(dir=p.parent, prefix=".tmp_", suffix=".json")
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(status, f, indent=2)
            f.write("\n")
        os.rename(tmp_path, path)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


def update_stage(pipeline_status: dict, stage: str, **kwargs) -> dict:
    """Update pipeline_status['stages'][stage] with kwargs.

    Creates the 'stages' key if it doesn't exist.
    Returns the updated status dict (mutated in place).
    """
    if "stages" not in pipeline_status:
        pipeline_status["stages"] = {}
    if stage not in pipeline_status["stages"]:
        pipeline_status["stages"][stage] = {}
    pipeline_status["stages"][stage].update(kwargs)
    return pipeline_status


def set_milestone(status: dict, milestone: str, value: bool) -> dict:
    """Set status['milestones'][milestone] = value.

    Creates the 'milestones' key if it doesn't exist.
    Returns the updated status dict (mutated in place).
    """
    if "milestones" not in status:
        status["milestones"] = {}
    status["milestones"][milestone] = value
    return status


def start_iteration(pipeline_status: dict, stage: str, **kwargs) -> dict:
    """Start a new iteration for a stage.

    Appends a new entry to pipeline_status['stages'][stage]['iterations'].
    Creates the 'iterations' list if absent. Sets number, status, started_at,
    and any extra kwargs (agent, model, trigger).

    Returns the new iteration dict.
    """
    if "stages" not in pipeline_status:
        pipeline_status["stages"] = {}
    if stage not in pipeline_status["stages"]:
        pipeline_status["stages"][stage] = {}

    stage_data = pipeline_status["stages"][stage]
    if "iterations" not in stage_data:
        stage_data["iterations"] = []

    # Mark any stale in_progress iterations as interrupted (crash/stop residue)
    for it in stage_data["iterations"]:
        if it.get("status") == "in_progress":
            it["status"] = "interrupted"
            if "completed_at" not in it:
                it["completed_at"] = datetime.now(timezone.utc).isoformat()

    iteration_num = len(stage_data["iterations"]) + 1
    iteration = {
        "number": iteration_num,
        "status": "in_progress",
        "started_at": datetime.now(timezone.utc).isoformat(),
        **kwargs,
    }
    stage_data["iterations"].append(iteration)
    stage_data["iteration"] = iteration_num
    return iteration


def complete_iteration(pipeline_status: dict, stage: str, **kwargs) -> dict:
    """Complete the current (last) iteration for a stage.

    Merges kwargs into the last entry of the iterations list.
    Typical kwargs: status, completed_at, duration_ms, turns, cost_usd,
    trigger, outcome, output.

    Returns the updated iteration dict.
    Raises ValueError if no iterations exist for the stage.
    """
    iterations = (pipeline_status
                  .get("stages", {})
                  .get(stage, {})
                  .get("iterations"))
    if not iterations:
        raise ValueError(f"No iterations to complete for stage '{stage}'")

    current = iterations[-1]
    current.update(kwargs)
    return current


def get_stage_token_usage(status: dict, stage: str) -> dict:
    """Get aggregate token_usage for a stage by summing its iterations.

    Args:
        status: Pipeline status dict.
        stage: Stage name (e.g. "plan", "implement").

    Returns:
        Aggregate token_usage dict. Returns empty dict if no data available.
    """
    from worca.utils.token_usage import aggregate_token_usage

    stage_data = status.get("stages", {}).get(stage, {})

    # If stage already has a computed token_usage, return it
    if "token_usage" in stage_data:
        return stage_data["token_usage"]

    # Otherwise, compute from iterations
    iterations = stage_data.get("iterations", [])
    usages = [it.get("token_usage", {}) for it in iterations if it.get("token_usage")]
    if not usages:
        return {}
    return aggregate_token_usage(usages)


def get_run_token_usage(status: dict) -> dict:
    """Get aggregate token_usage for the entire run by summing across stages.

    Args:
        status: Pipeline status dict.

    Returns:
        Aggregate token_usage dict with by_model and by_stage breakdowns.
        Returns empty dict if no data available.
    """
    from worca.utils.token_usage import aggregate_token_usage, aggregate_by_model

    # If run already has a computed token_usage, return it
    if "token_usage" in status:
        return status["token_usage"]

    all_usages = []
    by_stage = {}
    stages = status.get("stages", {})

    for stage_name, stage_data in stages.items():
        stage_usage = get_stage_token_usage(status, stage_name)
        if stage_usage:
            by_stage[stage_name] = stage_usage

        # Collect per-iteration usages for by_model aggregation
        iterations = stage_data.get("iterations", [])
        for it in iterations:
            usage = it.get("token_usage")
            if usage:
                all_usages.append(usage)

    if not all_usages:
        return {}

    result = aggregate_token_usage(all_usages)
    result["by_model"] = aggregate_by_model(all_usages)
    result["by_stage"] = by_stage
    return result


_LEGACY_STATUS_MAP = {
    "in_progress": "running",
    "error": "failed",
    "interrupted": "paused",
}


def resolve_status(status: str) -> str:
    """Normalize legacy status values to canonical pipeline_status values.

    Mappings: in_progress→running, error→failed, interrupted→paused.
    All other values pass through unchanged.
    """
    return _LEGACY_STATUS_MAP.get(status, status)


def init_status(work_request: dict, branch: str, git_head: str = None) -> dict:
    """Create a fresh status dict with all stages set to 'pending'.

    Populates work_request and branch per the design doc schema.
    Includes pipeline_status, loop_counters, and git_head fields.
    """
    status = {
        "schema_version": 1,
        "work_request": work_request,
        "pipeline_status": "pending",
        "stage": "plan",
        "run_id": None,
        "branch": branch,
        "worktree": None,
        "plan_file": None,
        "git_head": git_head,
        "loop_counters": {},
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
