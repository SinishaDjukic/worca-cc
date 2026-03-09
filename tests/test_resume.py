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
    assert find_resume_point(status) == Stage.IMPLEMENT


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
    assert find_resume_point(status) == Stage.IMPLEMENT


def test_finds_milestone_gate():
    status = {
        "stages": {"plan": {"status": "completed"}},
        "milestones": {"plan_approved": None},
    }
    assert find_resume_point(status) == Stage.PLAN


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
    assert find_resume_point(status) == Stage.REVIEW


def test_all_completed_returns_none():
    status = {
        "stages": {s.value: {"status": "completed"} for s in Stage},
        "milestones": {"plan_approved": True, "pr_approved": True},
    }
    assert find_resume_point(status) is None


def test_all_pending_returns_first_stage():
    status = {
        "stages": {s.value: {"status": "pending"} for s in Stage},
        "milestones": {},
    }
    assert find_resume_point(status) == Stage.PLAN


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
