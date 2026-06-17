from __future__ import annotations

from pathlib import Path

from worca_bench import RESULTS_SCHEMA_VERSION
from worca_bench.harvest import Telemetry
from worca_bench.normalize import append_row, build_row, read_rows
from worca_bench.stats import aggregate, aggregate_by_profile


def _row(**over):
    t = Telemetry(pipeline_status="completed", cost_usd=0.1, wall_time_s=10.0,
                  loop_counters={"implement_test": 1})
    kw = dict(
        profile_name="p", benchmark="swe-bench-verified", instance_id="a__b-1",
        worca_ref="local", template="builtin:feature", rep=1, run_id="rid",
        status="graded", resolved=True, score=1.0, telemetry=t, diff="+x\n",
        leaked=False, error=None, started_at="t0", completed_at="t1",
        artifacts_dir="runs/p/a__b-1/rep1",
    )
    kw.update(over)
    return build_row(**kw)


def test_build_row_schema_keys():
    row = _row()
    assert row["schema_version"] == RESULTS_SCHEMA_VERSION
    for key in ("profile", "benchmark", "instance_id", "worca_ref", "worca_version",
                "template", "grade_mode", "rep",
                "run_id", "status", "resolved", "score", "cost_usd", "tokens",
                "wall_time_s", "api_time_s", "pipeline_status", "loop_counters",
                "stage_outcomes", "api_retries", "diff_lines", "leaked", "error",
                "artifacts_dir"):
        assert key in row, key
    assert row["diff_lines"] == 1


def test_build_row_carries_config_metadata():
    row = _row(
        worca_version="0.58.0", grade_mode="local-docker",
        graphify="full", code_review_graph="structural",
    )
    assert row["worca_version"] == "0.58.0"
    assert row["grade_mode"] == "local-docker"
    assert row["graphify"] == "full"
    assert row["code_review_graph"] == "structural"
    # Defaults are None when not supplied (back-compat for older rows).
    base = _row()
    for k in ("worca_version", "grade_mode", "graphify", "code_review_graph"):
        assert base[k] is None


def test_build_row_carries_test_counts():
    # Commit0-style fine-grained counts ride alongside the numeric score.
    row = _row(tests_passed=38, tests_total=38)
    assert row["tests_passed"] == 38
    assert row["tests_total"] == 38
    # None for pass/fail-only graders (SWE-bench / stub).
    base = _row()
    assert base["tests_passed"] is None
    assert base["tests_total"] is None


def test_append_and_read_roundtrip(tmp_path: Path):
    append_row(tmp_path, _row(rep=1))
    append_row(tmp_path, _row(rep=2, resolved=False, score=0.0))
    rows = read_rows(tmp_path)
    assert len(rows) == 2
    assert {r["rep"] for r in rows} == {1, 2}


def test_aggregate_resolved_rate_and_cost():
    rows = [
        _row(rep=1, resolved=True, score=1.0),
        _row(rep=2, resolved=False, score=0.0, telemetry=Telemetry(cost_usd=0.3, wall_time_s=20.0)),
        _row(rep=3, status="error", resolved=None, score=None),
    ]
    agg = aggregate(rows)
    assert agg["n"] == 3
    assert agg["graded"] == 2
    assert agg["errors"] == 1
    assert agg["resolved_rate"] == 0.5     # 1 of 2 graded
    assert abs(agg["mean_cost_usd"] - (0.1 + 0.3 + 0.1) / 3) < 1e-9


def test_aggregate_by_profile_groups():
    rows = [_row(profile_name="A"), _row(profile_name="B"), _row(profile_name="A")]
    by = aggregate_by_profile(rows)
    assert set(by) == {"A", "B"}
    assert by["A"]["n"] == 2


def test_aggregate_empty():
    agg = aggregate([])
    assert agg["n"] == 0
    assert agg["resolved_rate"] is None
