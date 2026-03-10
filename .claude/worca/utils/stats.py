"""Cumulative stats tracking across pipeline runs.

Maintains a cumulative.json file that aggregates token usage and cost
data across all completed pipeline runs.
"""

import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path


def update_cumulative_stats(
    run_status: dict,
    stats_path: str = ".worca/stats/cumulative.json",
) -> dict:
    """Update cumulative stats with data from a completed run.

    Reads the existing cumulative file (or creates empty), adds
    the run's aggregate data, recomputes totals, and writes back atomically.

    Args:
        run_status: The completed run's status dict (must have token_usage and run_id).
        stats_path: Path to the cumulative stats file.

    Returns:
        The updated cumulative stats dict.
    """
    stats = _load_cumulative(stats_path)
    run_id = run_status.get("run_id", "")

    # Idempotency: skip if this run is already recorded
    existing_ids = {r.get("run_id") for r in stats.get("runs", [])}
    if run_id and run_id in existing_ids:
        return stats

    run_token_usage = run_status.get("token_usage", {})

    # Update totals
    stats["total_runs"] = stats.get("total_runs", 0) + 1
    stats["total_cost_usd"] = (
        stats.get("total_cost_usd", 0) + run_token_usage.get("total_cost_usd", 0)
    )
    stats["total_input_tokens"] = (
        stats.get("total_input_tokens", 0) + run_token_usage.get("input_tokens", 0)
    )
    stats["total_output_tokens"] = (
        stats.get("total_output_tokens", 0) + run_token_usage.get("output_tokens", 0)
    )

    # Merge by_model
    run_by_model = run_token_usage.get("by_model", {})
    stats_by_model = stats.get("by_model", {})
    for model, model_data in run_by_model.items():
        if model not in stats_by_model:
            stats_by_model[model] = {
                "input_tokens": 0,
                "output_tokens": 0,
                "cost_usd": 0,
                "invocations": 0,
            }
        entry = stats_by_model[model]
        entry["input_tokens"] += model_data.get("input_tokens", 0)
        entry["output_tokens"] += model_data.get("output_tokens", 0)
        entry["cost_usd"] += model_data.get("cost_usd", 0)
        entry["invocations"] += model_data.get("invocations", 0)
    stats["by_model"] = stats_by_model

    # Merge by_agent from by_stage data
    run_by_stage = run_token_usage.get("by_stage", {})
    stats_by_agent = stats.get("by_agent", {})
    stages_data = run_status.get("stages", {})
    for stage_name, stage_usage in run_by_stage.items():
        agent_name = stages_data.get(stage_name, {}).get("agent", stage_name)
        if agent_name not in stats_by_agent:
            stats_by_agent[agent_name] = {
                "invocations": 0,
                "cost_usd": 0,
                "input_tokens": 0,
                "output_tokens": 0,
            }
        entry = stats_by_agent[agent_name]
        entry["invocations"] += stage_usage.get("iteration_count", 1)
        entry["cost_usd"] += stage_usage.get("total_cost_usd", 0)
        entry["input_tokens"] += stage_usage.get("input_tokens", 0)
        entry["output_tokens"] += stage_usage.get("output_tokens", 0)
    stats["by_agent"] = stats_by_agent

    # Count iterations across all stages
    total_iterations = 0
    for stage_data in stages_data.values():
        iters = stage_data.get("iterations", [])
        total_iterations += len(iters)

    # Append run summary
    total_tokens = run_token_usage.get("input_tokens", 0) + run_token_usage.get("output_tokens", 0)
    run_summary = {
        "run_id": run_id,
        "title": run_status.get("work_request", {}).get("title", ""),
        "started_at": run_status.get("started_at", ""),
        "completed_at": run_status.get("completed_at", ""),
        "total_cost_usd": run_token_usage.get("total_cost_usd", 0),
        "total_tokens": total_tokens,
        "stages_run": len([s for s in stages_data.values() if s.get("status") == "completed"]),
        "iterations_total": total_iterations,
    }
    if "runs" not in stats:
        stats["runs"] = []
    stats["runs"].append(run_summary)

    stats["updated_at"] = datetime.now(timezone.utc).isoformat()

    _save_cumulative(stats, stats_path)
    return stats


def _load_cumulative(stats_path: str) -> dict:
    """Load existing cumulative stats or return empty structure."""
    try:
        with open(stats_path) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {
            "updated_at": "",
            "total_runs": 0,
            "total_cost_usd": 0,
            "total_input_tokens": 0,
            "total_output_tokens": 0,
            "by_model": {},
            "by_agent": {},
            "runs": [],
        }


def _save_cumulative(stats: dict, stats_path: str) -> None:
    """Write cumulative stats atomically (write temp, then rename)."""
    parent = Path(stats_path).parent
    parent.mkdir(parents=True, exist_ok=True)

    fd, tmp_path = tempfile.mkstemp(dir=str(parent), suffix=".json.tmp")
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(stats, f, indent=2)
            f.write("\n")
        os.replace(tmp_path, stats_path)
    except Exception:
        # Clean up temp file on failure
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


def rebuild_from_results(
    results_dir: str = ".worca/results",
    stats_path: str = ".worca/stats/cumulative.json",
) -> dict:
    """Rebuild cumulative stats from all archived run results.

    Scans results_dir for archived runs and rebuilds the cumulative
    stats file from scratch.

    Args:
        results_dir: Path to the results directory.
        stats_path: Path to write the cumulative stats file.

    Returns:
        The rebuilt cumulative stats dict.
    """
    # Start fresh
    stats = _load_cumulative("/dev/null")  # empty structure

    if not os.path.isdir(results_dir):
        _save_cumulative(stats, stats_path)
        return stats

    # Scan for archived runs
    for entry in sorted(os.listdir(results_dir)):
        entry_path = os.path.join(results_dir, entry)
        run_status = None

        if os.path.isdir(entry_path):
            # Per-run directory format: results/{run_id}/status.json
            status_file = os.path.join(entry_path, "status.json")
            if os.path.exists(status_file):
                try:
                    with open(status_file) as f:
                        run_status = json.load(f)
                except (json.JSONDecodeError, OSError):
                    continue
        elif entry.endswith(".json"):
            # Legacy format: results/{hash}.json
            try:
                with open(entry_path) as f:
                    run_status = json.load(f)
            except (json.JSONDecodeError, OSError):
                continue

        if run_status:
            # If run lacks token_usage, try to reconstruct from iterations
            if "token_usage" not in run_status:
                _backfill_token_usage(run_status, results_dir, entry)
            stats = update_cumulative_stats(run_status, stats_path)

    return stats


def _backfill_token_usage(run_status: dict, results_dir: str, entry_name: str) -> None:
    """Attempt to reconstruct token_usage for a run from existing data.

    Falls back to cost_usd and turns fields already present in iterations.
    """
    from worca.utils.token_usage import aggregate_token_usage

    all_usages = []
    stages = run_status.get("stages", {})

    for stage_name, stage_data in stages.items():
        iterations = stage_data.get("iterations", [])
        for iteration in iterations:
            usage = iteration.get("token_usage")
            if usage:
                all_usages.append(usage)
            else:
                # Reconstruct minimal usage from existing fields
                all_usages.append({
                    "input_tokens": 0,
                    "output_tokens": 0,
                    "cache_creation_input_tokens": 0,
                    "cache_read_input_tokens": 0,
                    "total_cost_usd": iteration.get("cost_usd", 0) or 0,
                    "duration_ms": iteration.get("duration_ms", 0) or 0,
                    "num_turns": iteration.get("turns", 0) or 0,
                    "model": iteration.get("model", ""),
                })

    if all_usages:
        run_status["token_usage"] = aggregate_token_usage(all_usages)
