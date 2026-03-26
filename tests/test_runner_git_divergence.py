"""Tests for git divergence guard on pipeline resume."""

import json
from unittest.mock import patch


from worca.orchestrator.runner import run_pipeline
from worca.orchestrator.work_request import WorkRequest
from worca.state.status import save_status


SHA_OLD = "aaa0000000000000000000000000000000000001"
SHA_NEW = "bbb0000000000000000000000000000000000002"


def _make_settings(tmp_path):
    """Write minimal settings.json and return its path."""
    settings = tmp_path / "settings.json"
    settings.write_text(json.dumps({
        "worca": {
            "stages": {
                "preflight": {"enabled": True},
                "plan": {"agent": "planner", "enabled": False},
                "coordinate": {"agent": "coordinator", "enabled": False},
                "implement": {"agent": "implementer", "enabled": False},
                "test": {"agent": "tester", "enabled": False},
                "review": {"agent": "guardian", "enabled": False},
                "pr": {"agent": "guardian", "enabled": False},
            },
            "agents": {},
            "loops": {},
        }
    }))
    return str(settings)


def _make_resumable_status(tmp_path, git_head, run_id="20260101-120000"):
    """Create a .worca run directory with status.json and active_run pointer."""
    worca_dir = tmp_path / ".worca"
    run_dir = worca_dir / "runs" / run_id
    (run_dir / "agents").mkdir(parents=True)
    (run_dir / "logs").mkdir(parents=True)

    status = {
        "run_id": run_id,
        "pipeline_status": "paused",
        "branch": "feat/test-branch",
        "plan_file": "",
        "git_head": git_head,
        "loop_counters": {},
        "started_at": "2026-01-01T12:00:00+00:00",
        "completed_at": None,
        "work_request": {
            "source_type": "prompt",
            "title": "Test divergence",
            "description": "",
            "source_ref": None,
            "priority": None,
        },
        "stages": {
            "preflight": {"status": "completed"},
            "plan": {"status": "completed"},
            "coordinate": {"status": "pending"},
            "implement": {"status": "pending"},
            "test": {"status": "pending"},
            "review": {"status": "pending"},
            "pr": {"status": "pending"},
        },
        "milestones": {"plan_approved": True, "pr_approved": None},
    }
    status_path = str(run_dir / "status.json")
    save_status(status, status_path)

    with open(str(worca_dir / "active_run"), "w") as f:
        f.write(run_id)

    return str(worca_dir / "status.json"), status


def test_runner_stores_git_head_on_fresh_start(tmp_path, monkeypatch):
    """run_pipeline records git_head in status.json on a fresh pipeline start."""
    monkeypatch.chdir(tmp_path)
    settings = _make_settings(tmp_path)
    worca_dir = tmp_path / ".worca"
    worca_dir.mkdir()
    status_path = str(worca_dir / "status.json")

    wr = WorkRequest(source_type="prompt", title="Test git head storage")

    def mock_run_stage(stage, context, settings_path, msize=1, iteration=1, **kwargs):
        return {}, {"type": "result"}

    with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
        with patch("worca.orchestrator.runner.create_branch"):
            with patch("worca.orchestrator.runner._write_pid"):
                with patch("worca.orchestrator.runner._remove_pid"):
                    with patch("worca.orchestrator.runner.get_current_git_head", return_value=SHA_OLD) as mock_git:
                        result = run_pipeline(wr, settings_path=settings, status_path=status_path)

    mock_git.assert_called()
    assert result.get("git_head") == SHA_OLD


def test_runner_calls_divergence_handler_when_head_changed(tmp_path, monkeypatch):
    """On resume, on_git_divergence is called when current HEAD differs from stored."""
    monkeypatch.chdir(tmp_path)
    settings = _make_settings(tmp_path)
    status_path, _ = _make_resumable_status(tmp_path, git_head=SHA_OLD)

    wr = WorkRequest(source_type="prompt", title="Test divergence")

    handler_calls = []

    def divergence_handler(stored, current):
        handler_calls.append({"stored": stored, "current": current})
        return False  # abort

    with patch("worca.orchestrator.runner._write_pid"):
        with patch("worca.orchestrator.runner._remove_pid"):
            with patch("worca.orchestrator.resume.get_current_git_head", return_value=SHA_NEW):
                _result = run_pipeline(
                    wr,
                    resume=True,
                    settings_path=settings,
                    status_path=status_path,
                    on_git_divergence=divergence_handler,
                )

    assert len(handler_calls) == 1
    assert handler_calls[0]["stored"] == SHA_OLD
    assert handler_calls[0]["current"] == SHA_NEW


def test_runner_proceeds_silently_when_head_unchanged(tmp_path, monkeypatch):
    """On resume, on_git_divergence is NOT called when HEAD matches stored."""
    monkeypatch.chdir(tmp_path)
    settings = _make_settings(tmp_path)
    status_path, _ = _make_resumable_status(tmp_path, git_head=SHA_OLD)

    wr = WorkRequest(source_type="prompt", title="Test divergence")

    handler_calls = []

    def mock_run_stage(stage, context, settings_path, msize=1, iteration=1, **kwargs):
        return {}, {"type": "result"}

    with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
        with patch("worca.orchestrator.runner._write_pid"):
            with patch("worca.orchestrator.runner._remove_pid"):
                with patch("worca.orchestrator.resume.get_current_git_head", return_value=SHA_OLD):
                    run_pipeline(
                        wr,
                        resume=True,
                        settings_path=settings,
                        status_path=status_path,
                        on_git_divergence=lambda s, c: handler_calls.append(1) or True,
                    )

    assert len(handler_calls) == 0


def test_runner_aborts_resume_when_handler_returns_false(tmp_path, monkeypatch):
    """When on_git_divergence returns False, run_pipeline returns without running stages."""
    monkeypatch.chdir(tmp_path)
    settings = _make_settings(tmp_path)
    status_path, _ = _make_resumable_status(tmp_path, git_head=SHA_OLD)

    wr = WorkRequest(source_type="prompt", title="Test divergence")

    stages_run = []

    def mock_run_stage(stage, context, settings_path, msize=1, iteration=1, **kwargs):
        stages_run.append(stage.value)
        return {}, {"type": "result"}

    with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
        with patch("worca.orchestrator.runner._write_pid"):
            with patch("worca.orchestrator.runner._remove_pid"):
                with patch("worca.orchestrator.resume.get_current_git_head", return_value=SHA_NEW):
                    run_pipeline(
                        wr,
                        resume=True,
                        settings_path=settings,
                        status_path=status_path,
                        on_git_divergence=lambda s, c: False,
                    )

    assert stages_run == []


def test_runner_proceeds_when_no_git_head_stored(tmp_path, monkeypatch):
    """When status has no git_head, resume proceeds without calling divergence handler."""
    monkeypatch.chdir(tmp_path)
    settings = _make_settings(tmp_path)
    # No git_head stored
    status_path, _ = _make_resumable_status(tmp_path, git_head=None)

    wr = WorkRequest(source_type="prompt", title="Test divergence")

    handler_calls = []

    def mock_run_stage(stage, context, settings_path, msize=1, iteration=1, **kwargs):
        return {}, {"type": "result"}

    with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
        with patch("worca.orchestrator.runner._write_pid"):
            with patch("worca.orchestrator.runner._remove_pid"):
                with patch("worca.orchestrator.resume.get_current_git_head", return_value=SHA_NEW):
                    run_pipeline(
                        wr,
                        resume=True,
                        settings_path=settings,
                        status_path=status_path,
                        on_git_divergence=lambda s, c: handler_calls.append(1) or False,
                    )

    assert handler_calls == []
