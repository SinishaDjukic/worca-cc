"""Tests for worca.utils.stats — cumulative stats tracking."""

import json
import os

from worca.utils.stats import update_cumulative_stats, rebuild_from_results


def _make_run_status(run_id="run-001", title="Test run", cost=1.50, input_tokens=10000, output_tokens=2000):
    """Create a minimal run status dict with token_usage."""
    return {
        "run_id": run_id,
        "work_request": {"title": title},
        "started_at": "2026-03-09T10:00:00+00:00",
        "completed_at": "2026-03-09T10:30:00+00:00",
        "stages": {
            "plan": {
                "status": "completed",
                "agent": "planner",
                "iterations": [
                    {
                        "number": 1,
                        "status": "completed",
                        "token_usage": {
                            "input_tokens": input_tokens // 2,
                            "output_tokens": output_tokens // 2,
                            "total_cost_usd": cost / 2,
                            "model": "claude-opus-4-20250514",
                        },
                    }
                ],
                "token_usage": {
                    "input_tokens": input_tokens // 2,
                    "output_tokens": output_tokens // 2,
                    "total_cost_usd": cost / 2,
                    "iteration_count": 1,
                },
            },
            "implement": {
                "status": "completed",
                "agent": "implementer",
                "iterations": [
                    {
                        "number": 1,
                        "status": "completed",
                        "token_usage": {
                            "input_tokens": input_tokens // 2,
                            "output_tokens": output_tokens // 2,
                            "total_cost_usd": cost / 2,
                            "model": "claude-sonnet-4-20250514",
                        },
                    }
                ],
                "token_usage": {
                    "input_tokens": input_tokens // 2,
                    "output_tokens": output_tokens // 2,
                    "total_cost_usd": cost / 2,
                    "iteration_count": 1,
                },
            },
        },
        "token_usage": {
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "total_cost_usd": cost,
            "by_model": {
                "claude-opus-4-20250514": {
                    "input_tokens": input_tokens // 2,
                    "output_tokens": output_tokens // 2,
                    "cost_usd": cost / 2,
                    "invocations": 1,
                },
                "claude-sonnet-4-20250514": {
                    "input_tokens": input_tokens // 2,
                    "output_tokens": output_tokens // 2,
                    "cost_usd": cost / 2,
                    "invocations": 1,
                },
            },
            "by_stage": {
                "plan": {
                    "input_tokens": input_tokens // 2,
                    "output_tokens": output_tokens // 2,
                    "total_cost_usd": cost / 2,
                    "iteration_count": 1,
                },
                "implement": {
                    "input_tokens": input_tokens // 2,
                    "output_tokens": output_tokens // 2,
                    "total_cost_usd": cost / 2,
                    "iteration_count": 1,
                },
            },
        },
    }


# --- update_cumulative_stats ---

def test_update_no_prior_file(tmp_path):
    stats_path = str(tmp_path / "stats" / "cumulative.json")
    run = _make_run_status()
    result = update_cumulative_stats(run, stats_path)

    assert result["total_runs"] == 1
    assert result["total_cost_usd"] == 1.50
    assert result["total_input_tokens"] == 10000
    assert result["total_output_tokens"] == 2000
    assert len(result["runs"]) == 1
    assert result["runs"][0]["run_id"] == "run-001"

    # File should exist
    assert os.path.exists(stats_path)
    with open(stats_path) as f:
        saved = json.load(f)
    assert saved["total_runs"] == 1


def test_update_with_existing_data(tmp_path):
    stats_path = str(tmp_path / "cumulative.json")

    # First run
    run1 = _make_run_status("run-001", "First run", cost=1.00, input_tokens=5000, output_tokens=1000)
    update_cumulative_stats(run1, stats_path)

    # Second run
    run2 = _make_run_status("run-002", "Second run", cost=2.00, input_tokens=8000, output_tokens=1500)
    result = update_cumulative_stats(run2, stats_path)

    assert result["total_runs"] == 2
    assert result["total_cost_usd"] == 3.00
    assert result["total_input_tokens"] == 13000
    assert result["total_output_tokens"] == 2500
    assert len(result["runs"]) == 2


def test_update_idempotent(tmp_path):
    stats_path = str(tmp_path / "cumulative.json")
    run = _make_run_status("run-001")

    update_cumulative_stats(run, stats_path)
    result = update_cumulative_stats(run, stats_path)  # same run again

    assert result["total_runs"] == 1  # not double-counted
    assert len(result["runs"]) == 1


def test_update_by_model_aggregation(tmp_path):
    stats_path = str(tmp_path / "cumulative.json")
    run = _make_run_status()
    result = update_cumulative_stats(run, stats_path)

    by_model = result.get("by_model", {})
    assert "claude-opus-4-20250514" in by_model
    assert "claude-sonnet-4-20250514" in by_model


def test_update_by_agent_aggregation(tmp_path):
    stats_path = str(tmp_path / "cumulative.json")
    run = _make_run_status()
    result = update_cumulative_stats(run, stats_path)

    by_agent = result.get("by_agent", {})
    assert "planner" in by_agent
    assert "implementer" in by_agent


def test_update_run_without_token_usage(tmp_path):
    stats_path = str(tmp_path / "cumulative.json")
    run = {
        "run_id": "run-empty",
        "work_request": {"title": "No tokens"},
        "started_at": "2026-03-09T10:00:00+00:00",
        "stages": {},
    }
    result = update_cumulative_stats(run, stats_path)
    assert result["total_runs"] == 1
    assert result["total_cost_usd"] == 0


# --- rebuild_from_results ---

def test_rebuild_empty_results(tmp_path):
    results_dir = str(tmp_path / "results")
    os.makedirs(results_dir)
    stats_path = str(tmp_path / "stats" / "cumulative.json")

    result = rebuild_from_results(results_dir, stats_path)
    assert result["total_runs"] == 0


def test_rebuild_from_directory_format(tmp_path):
    results_dir = str(tmp_path / "results")
    stats_path = str(tmp_path / "stats" / "cumulative.json")

    # Create a run in directory format
    run_dir = os.path.join(results_dir, "20260309-100000")
    os.makedirs(run_dir)
    run_status = _make_run_status("20260309-100000", "Dir run", 2.50)
    with open(os.path.join(run_dir, "status.json"), "w") as f:
        json.dump(run_status, f)

    result = rebuild_from_results(results_dir, stats_path)
    assert result["total_runs"] == 1
    assert result["total_cost_usd"] == 2.50


def test_rebuild_from_legacy_format(tmp_path):
    results_dir = str(tmp_path / "results")
    stats_path = str(tmp_path / "stats" / "cumulative.json")
    os.makedirs(results_dir)

    # Create a legacy .json result
    run_status = _make_run_status("legacy-001", "Legacy run", 1.00)
    with open(os.path.join(results_dir, "abc123.json"), "w") as f:
        json.dump(run_status, f)

    result = rebuild_from_results(results_dir, stats_path)
    assert result["total_runs"] == 1
    assert result["total_cost_usd"] == 1.00


def test_rebuild_backfills_missing_token_usage(tmp_path):
    results_dir = str(tmp_path / "results")
    stats_path = str(tmp_path / "stats" / "cumulative.json")
    os.makedirs(results_dir)

    # Create a run without token_usage but with cost_usd in iterations
    run_status = {
        "run_id": "old-run",
        "work_request": {"title": "Old run"},
        "started_at": "2026-03-08T10:00:00+00:00",
        "stages": {
            "plan": {
                "status": "completed",
                "iterations": [
                    {"number": 1, "status": "completed", "cost_usd": 0.50, "turns": 5, "model": "opus"}
                ],
            }
        },
    }
    with open(os.path.join(results_dir, "old-run.json"), "w") as f:
        json.dump(run_status, f)

    result = rebuild_from_results(results_dir, stats_path)
    assert result["total_runs"] == 1
    assert result["total_cost_usd"] == 0.50


def test_rebuild_nonexistent_results_dir(tmp_path):
    stats_path = str(tmp_path / "stats" / "cumulative.json")
    result = rebuild_from_results("/nonexistent/results", stats_path)
    assert result["total_runs"] == 0
