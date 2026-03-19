"""Tests for worca.orchestrator.resume — checkpoint and resume logic."""

import json
import os

from worca.orchestrator.resume import find_resume_point, reconstruct_context, can_resume
from worca.orchestrator.stages import Stage


def test_finds_in_progress_stage():
    status = {
        "stages": {
            "plan": {"status": "completed"},
            "coordinate": {"status": "completed"},
            "implement": {"status": "in_progress"},
            "test": {"status": "pending"},
            "review": {"status": "pending"},
            "pr": {"status": "pending"},
        },
        "milestones": {"plan_approved": True},
    }
    assert find_resume_point(status) == Stage.PREFLIGHT


def test_finds_pending_after_completed():
    status = {
        "stages": {
            "plan": {"status": "completed"},
            "coordinate": {"status": "completed"},
            "implement": {"status": "pending"},
            "test": {"status": "pending"},
            "review": {"status": "pending"},
            "pr": {"status": "pending"},
        },
        "milestones": {"plan_approved": True},
    }
    assert find_resume_point(status) == Stage.PREFLIGHT


def test_finds_milestone_gate():
    status = {
        "stages": {"plan": {"status": "completed"}},
        "milestones": {"plan_approved": None},
    }
    assert find_resume_point(status) == Stage.PREFLIGHT


def test_finds_review_milestone_gate():
    status = {
        "stages": {
            "plan": {"status": "completed"},
            "coordinate": {"status": "completed"},
            "implement": {"status": "completed"},
            "test": {"status": "completed"},
            "review": {"status": "completed"},
            "pr": {"status": "pending"},
        },
        "milestones": {"plan_approved": True, "pr_approved": None},
    }
    assert find_resume_point(status) == Stage.PREFLIGHT


def test_always_returns_preflight_when_preflight_already_completed():
    """On resume, always returns PREFLIGHT even if it completed in a prior run."""
    status = {
        "stages": {
            "preflight": {"status": "completed"},
            "plan": {"status": "completed"},
            "coordinate": {"status": "completed"},
            "implement": {"status": "in_progress"},
            "test": {"status": "pending"},
            "review": {"status": "pending"},
            "pr": {"status": "pending"},
        },
        "milestones": {"plan_approved": True},
    }
    assert find_resume_point(status) == Stage.PREFLIGHT


def test_all_completed_returns_none():
    status = {
        "stages": {s.value: {"status": "completed"} for s in Stage},
        "milestones": {"plan_approved": True, "pr_approved": True},
    }
    assert find_resume_point(status) is None


def test_all_pending_returns_preflight():
    status = {
        "stages": {s.value: {"status": "pending"} for s in Stage},
        "milestones": {},
    }
    assert find_resume_point(status) == Stage.PREFLIGHT


def test_reconstruct_context_reads_completed_logs(tmp_path):
    logs_dir = str(tmp_path / "logs")
    os.makedirs(logs_dir)

    # Write log files for completed stages
    with open(os.path.join(logs_dir, "plan.json"), "w") as f:
        json.dump({"approach": "modular"}, f)
    with open(os.path.join(logs_dir, "coordinate.json"), "w") as f:
        json.dump({"tasks": ["a", "b"]}, f)

    status = {
        "stages": {
            "plan": {"status": "completed"},
            "coordinate": {"status": "completed"},
            "implement": {"status": "in_progress"},
            "test": {"status": "pending"},
            "review": {"status": "pending"},
            "pr": {"status": "pending"},
        }
    }
    ctx = reconstruct_context(status, logs_dir)
    assert ctx["plan"] == {"approach": "modular"}
    assert ctx["coordinate"] == {"tasks": ["a", "b"]}
    assert "implement" not in ctx


def test_reconstruct_context_skips_missing_logs(tmp_path):
    logs_dir = str(tmp_path / "logs")
    os.makedirs(logs_dir)
    # No log files exist

    status = {
        "stages": {
            "plan": {"status": "completed"},
            "coordinate": {"status": "pending"},
        }
    }
    ctx = reconstruct_context(status, logs_dir)
    # plan is completed but no log file, so not in context
    assert "plan" not in ctx


def test_can_resume_true(tmp_path):
    status_path = str(tmp_path / "status.json")
    status = {
        "stages": {
            "plan": {"status": "completed"},
            "coordinate": {"status": "pending"},
        }
    }
    with open(status_path, "w") as f:
        json.dump(status, f)
    assert can_resume(status_path) is True


def test_can_resume_false_no_file(tmp_path):
    missing = str(tmp_path / "nonexistent.json")
    assert can_resume(missing) is False


def test_can_resume_false_all_pending(tmp_path):
    status_path = str(tmp_path / "status.json")
    status = {
        "stages": {
            "plan": {"status": "pending"},
            "coordinate": {"status": "pending"},
        }
    }
    with open(status_path, "w") as f:
        json.dump(status, f)
    assert can_resume(status_path) is False


def test_reconstruct_context_reads_nested_logs(tmp_path):
    logs_dir = str(tmp_path / "logs")
    os.makedirs(os.path.join(logs_dir, "plan"))
    os.makedirs(os.path.join(logs_dir, "coordinate"))

    with open(os.path.join(logs_dir, "plan", "iter-1.json"), "w") as f:
        json.dump({"approach": "modular"}, f)
    with open(os.path.join(logs_dir, "coordinate", "iter-1.json"), "w") as f:
        json.dump({"tasks": ["a", "b"]}, f)

    status = {
        "stages": {
            "plan": {"status": "completed"},
            "coordinate": {"status": "completed"},
            "implement": {"status": "in_progress"},
        }
    }
    ctx = reconstruct_context(status, logs_dir)
    assert ctx["plan"] == {"approach": "modular"}
    assert ctx["coordinate"] == {"tasks": ["a", "b"]}
    assert "implement" not in ctx


def test_reconstruct_context_picks_latest_iteration(tmp_path):
    logs_dir = str(tmp_path / "logs")
    os.makedirs(os.path.join(logs_dir, "implement"))

    with open(os.path.join(logs_dir, "implement", "iter-1.json"), "w") as f:
        json.dump({"files_changed": 2}, f)
    with open(os.path.join(logs_dir, "implement", "iter-2.json"), "w") as f:
        json.dump({"files_changed": 1}, f)

    status = {
        "stages": {
            "implement": {"status": "completed"},
        }
    }
    ctx = reconstruct_context(status, logs_dir)
    assert ctx["implement"] == {"files_changed": 1}


def test_can_resume_via_active_run_pointer(tmp_path):
    """can_resume finds status via active_run pointer."""
    worca_dir = tmp_path / ".worca"
    run_id = "20260309-171545"
    run_dir = worca_dir / "runs" / run_id
    run_dir.mkdir(parents=True)

    status = {
        "run_id": run_id,
        "stages": {
            "plan": {"status": "completed"},
            "coordinate": {"status": "pending"},
        },
    }
    with open(str(run_dir / "status.json"), "w") as f:
        json.dump(status, f)

    # Write active_run pointer
    with open(str(worca_dir / "active_run"), "w") as f:
        f.write(run_id)

    # The flat status.json doesn't exist
    assert not (worca_dir / "status.json").exists()
    # But can_resume should find it via active_run
    assert can_resume(str(worca_dir / "status.json")) is True


def test_reconstruct_context_uses_run_id(tmp_path, monkeypatch):
    """reconstruct_context derives logs_dir from run_id when no explicit logs_dir given."""
    monkeypatch.chdir(tmp_path)
    worca_dir = tmp_path / ".worca"
    run_id = "20260309-180000"
    logs_dir = worca_dir / "runs" / run_id / "logs"
    plan_dir = logs_dir / "plan"
    plan_dir.mkdir(parents=True)

    with open(str(plan_dir / "iter-1.json"), "w") as f:
        json.dump({"approach": "per-run"}, f)

    status = {
        "run_id": run_id,
        "stages": {
            "plan": {"status": "completed"},
            "coordinate": {"status": "pending"},
        },
    }
    ctx = reconstruct_context(status)  # No explicit logs_dir
    assert ctx["plan"] == {"approach": "per-run"}
