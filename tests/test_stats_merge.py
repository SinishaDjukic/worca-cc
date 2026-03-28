"""Tests for stats merge functions — merge_run_stats and merge_multi_stats."""

import json
import os

from worca.utils.stats import merge_run_stats, merge_multi_stats


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


def _write_status(path, run_status):
    """Write a run status dict to a JSON file, creating parent dirs."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(run_status, f)


# --- merge_run_stats ---


def test_merge_run_stats_valid_status(tmp_path):
    """merge_run_stats returns True and updates cumulative for a valid status file."""
    status_path = str(tmp_path / "worktree" / ".worca" / "status.json")
    cumulative_path = str(tmp_path / "stats" / "cumulative.json")

    run = _make_run_status("run-100", "Valid run", cost=2.00)
    _write_status(status_path, run)

    result = merge_run_stats(status_path, cumulative_path)
    assert result is True

    # Verify cumulative was written
    with open(cumulative_path) as f:
        cumulative = json.load(f)
    assert cumulative["total_runs"] == 1
    assert cumulative["total_cost_usd"] == 2.00
    assert cumulative["runs"][0]["run_id"] == "run-100"


def test_merge_run_stats_missing_file(tmp_path):
    """merge_run_stats returns False when the status file doesn't exist."""
    cumulative_path = str(tmp_path / "stats" / "cumulative.json")
    result = merge_run_stats("/nonexistent/path/status.json", cumulative_path)
    assert result is False


def test_merge_run_stats_no_token_usage(tmp_path):
    """merge_run_stats returns False when status has no token_usage."""
    status_path = str(tmp_path / "worktree" / "status.json")
    run = {
        "run_id": "run-empty",
        "work_request": {"title": "No tokens"},
        "started_at": "2026-03-09T10:00:00+00:00",
        "stages": {},
    }
    _write_status(status_path, run)

    cumulative_path = str(tmp_path / "stats" / "cumulative.json")
    result = merge_run_stats(status_path, cumulative_path)
    assert result is False


def test_merge_run_stats_malformed_json(tmp_path):
    """merge_run_stats returns False when status file contains malformed JSON."""
    status_path = str(tmp_path / "worktree" / "status.json")
    os.makedirs(os.path.dirname(status_path), exist_ok=True)
    with open(status_path, "w") as f:
        f.write("{invalid json!!!")

    cumulative_path = str(tmp_path / "stats" / "cumulative.json")
    result = merge_run_stats(status_path, cumulative_path)
    assert result is False


def test_merge_run_stats_empty_token_usage(tmp_path):
    """merge_run_stats returns False when token_usage is an empty dict."""
    status_path = str(tmp_path / "worktree" / "status.json")
    run = {
        "run_id": "run-empty-usage",
        "work_request": {"title": "Empty usage"},
        "started_at": "2026-03-09T10:00:00+00:00",
        "stages": {},
        "token_usage": {},
    }
    _write_status(status_path, run)

    cumulative_path = str(tmp_path / "stats" / "cumulative.json")
    result = merge_run_stats(status_path, cumulative_path)
    assert result is False


def test_merge_run_stats_default_cumulative_path(tmp_path, monkeypatch):
    """merge_run_stats uses default cumulative path when None is passed."""
    monkeypatch.chdir(tmp_path)

    status_path = str(tmp_path / "worktree" / "status.json")
    run = _make_run_status("run-default", "Default path", cost=1.00)
    _write_status(status_path, run)

    result = merge_run_stats(status_path)
    assert result is True

    # Check that the default path was used
    default_path = tmp_path / ".worca" / "stats" / "cumulative.json"
    assert default_path.exists()


# --- merge_multi_stats ---


def test_merge_multi_stats_multiple_worktrees(tmp_path):
    """merge_multi_stats merges from multiple worktrees correctly."""
    cumulative_path = str(tmp_path / "stats" / "cumulative.json")

    # Create two worktrees with runs
    for i, run_id in enumerate(["run-201", "run-202"]):
        wt = tmp_path / f"worktree-{i}"
        run_dir = wt / ".worca" / "runs" / run_id
        status_path = str(run_dir / "status.json")
        run = _make_run_status(run_id, f"Run {i}", cost=1.00 + i)
        _write_status(status_path, run)

    worktree_paths = [
        str(tmp_path / "worktree-0"),
        str(tmp_path / "worktree-1"),
    ]
    count = merge_multi_stats(worktree_paths, cumulative_path)
    assert count == 2


def test_merge_multi_stats_returns_correct_count(tmp_path):
    """merge_multi_stats returns the exact number of successfully merged runs."""
    cumulative_path = str(tmp_path / "stats" / "cumulative.json")

    # Create 3 worktrees: 2 valid, 1 with no token_usage
    for i, run_id in enumerate(["run-301", "run-302"]):
        wt = tmp_path / f"wt-{i}"
        run_dir = wt / ".worca" / "runs" / run_id
        status_path = str(run_dir / "status.json")
        run = _make_run_status(run_id, f"Run {i}", cost=1.50)
        _write_status(status_path, run)

    # Third worktree: no token_usage
    wt_bad = tmp_path / "wt-bad"
    run_dir_bad = wt_bad / ".worca" / "runs" / "run-bad"
    bad_status_path = str(run_dir_bad / "status.json")
    _write_status(bad_status_path, {
        "run_id": "run-bad",
        "work_request": {"title": "Bad"},
        "stages": {},
    })

    worktree_paths = [
        str(tmp_path / "wt-0"),
        str(tmp_path / "wt-1"),
        str(tmp_path / "wt-bad"),
    ]
    count = merge_multi_stats(worktree_paths, cumulative_path)
    assert count == 2


def test_merge_multi_stats_empty_list(tmp_path):
    """merge_multi_stats with empty list returns 0."""
    cumulative_path = str(tmp_path / "stats" / "cumulative.json")
    count = merge_multi_stats([], cumulative_path)
    assert count == 0


def test_merge_multi_stats_nonexistent_worktrees(tmp_path):
    """merge_multi_stats returns 0 when worktree paths don't exist."""
    cumulative_path = str(tmp_path / "stats" / "cumulative.json")
    count = merge_multi_stats(["/nonexistent/wt1", "/nonexistent/wt2"], cumulative_path)
    assert count == 0


def test_merge_multi_stats_fallback_to_direct_status(tmp_path):
    """merge_multi_stats falls back to .worca/status.json when no runs/ dir exists."""
    cumulative_path = str(tmp_path / "stats" / "cumulative.json")

    wt = tmp_path / "worktree-direct"
    status_path = str(wt / ".worca" / "status.json")
    run = _make_run_status("run-direct", "Direct status", cost=3.00)
    _write_status(status_path, run)

    count = merge_multi_stats([str(wt)], cumulative_path)
    assert count == 1

    with open(cumulative_path) as f:
        cumulative = json.load(f)
    assert cumulative["total_cost_usd"] == 3.00


def test_merge_multi_stats_multiple_runs_per_worktree(tmp_path):
    """merge_multi_stats handles multiple runs within a single worktree."""
    cumulative_path = str(tmp_path / "stats" / "cumulative.json")

    wt = tmp_path / "worktree-multi"
    for run_id in ["run-401", "run-402", "run-403"]:
        run_dir = wt / ".worca" / "runs" / run_id
        status_path = str(run_dir / "status.json")
        run = _make_run_status(run_id, f"Multi {run_id}", cost=1.00)
        _write_status(status_path, run)

    count = merge_multi_stats([str(wt)], cumulative_path)
    assert count == 3


# --- Cumulative totals correctness ---


def test_cumulative_totals_after_two_runs(tmp_path):
    """After merging 2 runs, cumulative totals are the sum of both."""
    cumulative_path = str(tmp_path / "stats" / "cumulative.json")

    # Run 1: cost=2.00, input=8000, output=1500
    wt1 = tmp_path / "wt-1"
    s1 = str(wt1 / ".worca" / "runs" / "run-501" / "status.json")
    _write_status(s1, _make_run_status("run-501", "First", cost=2.00, input_tokens=8000, output_tokens=1500))

    # Run 2: cost=3.50, input=12000, output=2500
    wt2 = tmp_path / "wt-2"
    s2 = str(wt2 / ".worca" / "runs" / "run-502" / "status.json")
    _write_status(s2, _make_run_status("run-502", "Second", cost=3.50, input_tokens=12000, output_tokens=2500))

    count = merge_multi_stats([str(wt1), str(wt2)], cumulative_path)
    assert count == 2

    with open(cumulative_path) as f:
        cumulative = json.load(f)

    assert cumulative["total_runs"] == 2
    assert cumulative["total_cost_usd"] == 5.50
    assert cumulative["total_input_tokens"] == 20000
    assert cumulative["total_output_tokens"] == 4000
    assert len(cumulative["runs"]) == 2

    # Verify by_model is aggregated correctly
    by_model = cumulative["by_model"]
    assert "claude-opus-4-20250514" in by_model
    assert "claude-sonnet-4-20250514" in by_model
    # Opus tokens: run1 4000+6000=10000 input across both runs
    assert by_model["claude-opus-4-20250514"]["input_tokens"] == 10000
    assert by_model["claude-opus-4-20250514"]["invocations"] == 2
