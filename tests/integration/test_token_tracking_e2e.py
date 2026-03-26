"""Integration tests for end-to-end token tracking through the pipeline."""

import json
from unittest.mock import patch

from worca.orchestrator.runner import run_stage
from worca.orchestrator.stages import Stage
from worca.state.status import (
    init_status, start_iteration, complete_iteration, update_stage, get_stage_token_usage, get_run_token_usage,
)
from worca.utils.token_usage import extract_token_usage, aggregate_token_usage


def _make_raw_envelope(
    cost=0.25,
    input_tokens=5000,
    output_tokens=1000,
    cache_creation=500,
    cache_read=200,
    turns=5,
    duration_ms=10000,
    duration_api_ms=8000,
    model="claude-sonnet-4-20250514",
):
    """Create a realistic raw envelope as returned by claude CLI."""
    return {
        "type": "result",
        "subtype": "success",
        "total_cost_usd": cost,
        "num_turns": turns,
        "duration_ms": duration_ms,
        "duration_api_ms": duration_api_ms,
        "_resolved_model": model,
        "usage": {
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "cache_creation_input_tokens": cache_creation,
            "cache_read_input_tokens": cache_read,
        },
        "structured_output": {"approved": True, "approach": "Test approach"},
    }


def test_extract_token_usage_from_envelope():
    """Token usage extraction produces correct structure from raw envelope."""
    envelope = _make_raw_envelope(cost=0.42, input_tokens=28500, output_tokens=4200, duration_api_ms=19500)
    usage = extract_token_usage(envelope)

    assert usage["input_tokens"] == 28500
    assert usage["output_tokens"] == 4200
    assert usage["total_cost_usd"] == 0.42
    assert usage["duration_api_ms"] == 19500
    assert usage["model"] == "claude-sonnet-4-20250514"


def test_token_usage_in_iteration_record():
    """Token usage is correctly stored in iteration records."""
    status = init_status({"title": "Test"}, "test/branch")
    start_iteration(status, "plan", agent="planner", model="opus")

    envelope = _make_raw_envelope()
    usage = extract_token_usage(envelope)

    complete_iteration(
        status, "plan",
        status="completed",
        duration_ms=10000,
        duration_api_ms=8000,
        turns=5,
        cost_usd=0.25,
        token_usage=usage,
    )

    iteration = status["stages"]["plan"]["iterations"][0]
    assert "token_usage" in iteration
    assert iteration["token_usage"]["input_tokens"] == 5000
    assert iteration["token_usage"]["output_tokens"] == 1000
    assert iteration["token_usage"]["model"] == "claude-sonnet-4-20250514"
    assert iteration["duration_api_ms"] == 8000


def test_duration_api_ms_aggregated_across_iterations():
    """duration_api_ms is summed correctly across multiple iterations."""
    status = init_status({"title": "Test"}, "test/branch")

    start_iteration(status, "implement", agent="implementer", model="sonnet")
    usage1 = extract_token_usage(_make_raw_envelope(duration_api_ms=5000))
    complete_iteration(status, "implement", status="completed",
                       duration_api_ms=5000, token_usage=usage1)

    start_iteration(status, "implement", agent="implementer", model="sonnet")
    usage2 = extract_token_usage(_make_raw_envelope(duration_api_ms=7000))
    complete_iteration(status, "implement", status="completed",
                       duration_api_ms=7000, token_usage=usage2)

    stage_usage = get_stage_token_usage(status, "implement")
    assert stage_usage["duration_api_ms"] == 12000


def test_stage_token_aggregation_across_iterations():
    """Stage-level token aggregation sums across multiple iterations."""
    status = init_status({"title": "Test"}, "test/branch")

    # First iteration
    start_iteration(status, "implement", agent="implementer", model="sonnet")
    usage1 = extract_token_usage(_make_raw_envelope(
        cost=0.20, input_tokens=3000, output_tokens=800
    ))
    complete_iteration(status, "implement", status="completed", token_usage=usage1)

    # Second iteration
    start_iteration(status, "implement", agent="implementer", model="sonnet")
    usage2 = extract_token_usage(_make_raw_envelope(
        cost=0.30, input_tokens=4000, output_tokens=1200
    ))
    complete_iteration(status, "implement", status="completed", token_usage=usage2)

    # Aggregate
    stage_usage = get_stage_token_usage(status, "implement")
    assert stage_usage["input_tokens"] == 7000
    assert stage_usage["output_tokens"] == 2000
    assert stage_usage["total_cost_usd"] == 0.50
    assert stage_usage["iteration_count"] == 2


def test_run_level_token_aggregation():
    """Run-level aggregation sums across all stages."""
    status = init_status({"title": "Test"}, "test/branch")

    # Plan stage
    start_iteration(status, "plan", agent="planner", model="opus")
    usage_plan = extract_token_usage(_make_raw_envelope(
        cost=0.50, input_tokens=10000, output_tokens=2000,
        model="claude-opus-4-20250514",
    ))
    complete_iteration(status, "plan", status="completed", token_usage=usage_plan)
    update_stage(status, "plan", status="completed",
                 token_usage=aggregate_token_usage([usage_plan]))

    # Implement stage
    start_iteration(status, "implement", agent="implementer", model="sonnet")
    usage_impl = extract_token_usage(_make_raw_envelope(
        cost=0.30, input_tokens=6000, output_tokens=1500,
        model="claude-sonnet-4-20250514",
    ))
    complete_iteration(status, "implement", status="completed", token_usage=usage_impl)
    update_stage(status, "implement", status="completed",
                 token_usage=aggregate_token_usage([usage_impl]))

    # Get run-level aggregate
    run_usage = get_run_token_usage(status)
    assert run_usage["input_tokens"] == 16000
    assert run_usage["output_tokens"] == 3500
    assert run_usage["total_cost_usd"] == 0.80
    assert run_usage["iteration_count"] == 2

    # Check by_model breakdown
    assert "claude-opus-4-20250514" in run_usage["by_model"]
    assert "claude-sonnet-4-20250514" in run_usage["by_model"]
    assert run_usage["by_model"]["claude-opus-4-20250514"]["cost_usd"] == 0.50
    assert run_usage["by_model"]["claude-sonnet-4-20250514"]["cost_usd"] == 0.30

    # Check by_stage breakdown
    assert "plan" in run_usage["by_stage"]
    assert "implement" in run_usage["by_stage"]


def test_status_without_token_usage_loads_gracefully():
    """Existing status files without token_usage don't cause errors."""
    status = {
        "work_request": {"title": "Old run"},
        "stage": "completed",
        "stages": {
            "plan": {
                "status": "completed",
                "iterations": [
                    {"number": 1, "status": "completed", "turns": 3, "cost_usd": 0.1}
                ],
            }
        },
    }
    # Should not raise
    stage_usage = get_stage_token_usage(status, "plan")
    assert stage_usage == {}

    run_usage = get_run_token_usage(status)
    assert run_usage == {}


def test_run_stage_returns_usable_envelope():
    """run_stage returns a raw_envelope from which token_usage can be extracted."""
    mock_config = {"agent": "planner", "model": "opus", "max_turns": 40, "schema": "plan.json"}
    envelope = _make_raw_envelope()

    with patch("worca.orchestrator.runner.get_stage_config", return_value=mock_config):
        with patch("worca.orchestrator.runner.run_agent", return_value=envelope):
            result, raw = run_stage(Stage.PLAN, {"prompt": "test"})

    usage = extract_token_usage(raw)
    assert usage["input_tokens"] == 5000
    assert usage["output_tokens"] == 1000
    assert usage["total_cost_usd"] == 0.25


def test_cumulative_stats_integration(tmp_path):
    """End-to-end: completed run updates cumulative stats file."""
    from worca.utils.stats import update_cumulative_stats

    stats_path = str(tmp_path / "stats" / "cumulative.json")

    # Simulate a completed run
    status = init_status({"title": "E2E Test"}, "test/branch")
    status["run_id"] = "20260309-120000"
    status["completed_at"] = "2026-03-09T12:30:00+00:00"

    # Add iteration with token_usage
    start_iteration(status, "plan", agent="planner", model="opus")
    usage = extract_token_usage(_make_raw_envelope(
        cost=1.00, input_tokens=20000, output_tokens=5000,
        model="claude-opus-4-20250514",
    ))
    complete_iteration(status, "plan", status="completed", token_usage=usage)
    update_stage(status, "plan", status="completed",
                 token_usage=aggregate_token_usage([usage]))

    # Compute run-level aggregate
    run_usage = get_run_token_usage(status)
    status["token_usage"] = run_usage

    # Update cumulative
    cumulative = update_cumulative_stats(status, stats_path)

    assert cumulative["total_runs"] == 1
    assert cumulative["total_cost_usd"] == 1.00
    assert cumulative["total_input_tokens"] == 20000
    assert len(cumulative["runs"]) == 1
    assert cumulative["runs"][0]["run_id"] == "20260309-120000"

    # Verify file was written
    with open(stats_path) as f:
        saved = json.load(f)
    assert saved["total_runs"] == 1
