"""Tests for LEARN stage integration in runner.py."""

import json
from unittest.mock import patch, MagicMock

import pytest

from worca.orchestrator.runner import (
    _run_learn_stage,
    _STAGE_PROMPT_PREFIX,
    PipelineError,
    PipelineInterrupted,
)
from worca.orchestrator.stages import Stage


@pytest.fixture(autouse=True)
def _mock_beads_init():
    """Prevent run_pipeline from invoking the real bd binary in tests."""
    with patch("worca.orchestrator.runner._ensure_beads_initialized"):
        yield


# ---------------------------------------------------------------------------
# _STAGE_PROMPT_PREFIX includes LEARN
# ---------------------------------------------------------------------------

def test_stage_prompt_prefix_includes_learn():
    """Stage.LEARN should have an entry in _STAGE_PROMPT_PREFIX."""
    assert Stage.LEARN in _STAGE_PROMPT_PREFIX
    template = _STAGE_PROMPT_PREFIX[Stage.LEARN]
    assert "{prompt}" in template


# ---------------------------------------------------------------------------
# _run_learn_stage — skips when disabled
# ---------------------------------------------------------------------------

def test_run_learn_stage_skips_when_disabled(tmp_path):
    """When learn is disabled, _run_learn_stage should be a no-op."""
    settings = tmp_path / "settings.json"
    settings.write_text(json.dumps({"worca": {"stages": {"learn": {"enabled": False}}}}))

    pb = MagicMock()
    status = {"stages": {}}

    with patch("worca.orchestrator.runner.run_stage") as mock_run:
        _run_learn_stage(
            status=status,
            prompt_builder=pb,
            settings_path=str(settings),
            run_dir=str(tmp_path),
            termination_type="success",
            termination_reason="",
            msize=1,
            logs_dir=str(tmp_path / "logs"),
        )

    mock_run.assert_not_called()
    # Status should be untouched
    assert "learn" not in status["stages"]


# ---------------------------------------------------------------------------
# _run_learn_stage — runs when enabled
# ---------------------------------------------------------------------------

def test_run_learn_stage_runs_when_enabled(tmp_path):
    """When learn is enabled, _run_learn_stage should call run_stage and save learnings."""
    settings = tmp_path / "settings.json"
    settings.write_text(json.dumps({"worca": {"stages": {"learn": {"enabled": True}}}}))
    run_dir = tmp_path / "run"
    run_dir.mkdir()

    pb = MagicMock()
    pb.build.return_value = "rendered learn prompt"
    status = {"stages": {}, "plan_file": None}

    learnings_result = {
        "observations": [],
        "suggestions": [],
        "recurring_patterns": {},
        "run_summary": {"termination": "success", "total_iterations": 3},
    }

    with patch("worca.orchestrator.runner.run_stage", return_value=(learnings_result, {})):
        with patch("worca.orchestrator.runner.save_status"):
            with patch("worca.orchestrator.runner.start_iteration", return_value={"number": 1}):
                with patch("worca.orchestrator.runner.complete_iteration"):
                    with patch("worca.orchestrator.runner.update_stage"):
                        _run_learn_stage(
                            status=status,
                            prompt_builder=pb,
                            settings_path=str(settings),
                            run_dir=str(run_dir),
                            termination_type="success",
                            termination_reason="",
                            msize=1,
                            logs_dir=str(tmp_path / "logs"),
                        )

    # Verify prompt_builder was fed context
    pb.update_context.assert_any_call("full_status", status)
    pb.update_context.assert_any_call("termination_type", "success")
    pb.update_context.assert_any_call("termination_reason", "")

    # Verify learnings.json was written
    learnings_path = run_dir / "learnings.json"
    assert learnings_path.exists()
    saved = json.loads(learnings_path.read_text())
    assert saved["run_summary"]["termination"] == "success"


# ---------------------------------------------------------------------------
# _run_learn_stage — non-fatal on failure
# ---------------------------------------------------------------------------

def test_run_learn_stage_nonfatal_on_failure(tmp_path):
    """If the learn stage throws, it should not propagate."""
    settings = tmp_path / "settings.json"
    settings.write_text(json.dumps({"worca": {"stages": {"learn": {"enabled": True}}}}))
    run_dir = tmp_path / "run"
    run_dir.mkdir()

    pb = MagicMock()
    pb.build.return_value = "rendered"
    status = {"stages": {}, "plan_file": None}

    with patch("worca.orchestrator.runner.run_stage", side_effect=RuntimeError("agent crash")):
        with patch("worca.orchestrator.runner.save_status"):
            with patch("worca.orchestrator.runner.start_iteration", return_value={"number": 1}):
                with patch("worca.orchestrator.runner.complete_iteration"):
                    with patch("worca.orchestrator.runner.update_stage"):
                        # Should NOT raise
                        _run_learn_stage(
                            status=status,
                            prompt_builder=pb,
                            settings_path=str(settings),
                            run_dir=str(run_dir),
                            termination_type="failure",
                            termination_reason="some error",
                            msize=1,
                            logs_dir=str(tmp_path / "logs"),
                        )


# ---------------------------------------------------------------------------
# _run_learn_stage — reads plan file when available
# ---------------------------------------------------------------------------

def test_run_learn_stage_reads_plan_file(tmp_path):
    """When status has a plan_file that exists, it should be fed to prompt_builder."""
    settings = tmp_path / "settings.json"
    settings.write_text(json.dumps({"worca": {"stages": {"learn": {"enabled": True}}}}))
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    plan = tmp_path / "plan.md"
    plan.write_text("# My Plan\nDo things.")

    pb = MagicMock()
    pb.build.return_value = "rendered"
    status = {"stages": {}, "plan_file": str(plan)}

    with patch("worca.orchestrator.runner.run_stage", return_value=({}, {})):
        with patch("worca.orchestrator.runner.save_status"):
            with patch("worca.orchestrator.runner.start_iteration", return_value={"number": 1}):
                with patch("worca.orchestrator.runner.complete_iteration"):
                    with patch("worca.orchestrator.runner.update_stage"):
                        _run_learn_stage(
                            status=status,
                            prompt_builder=pb,
                            settings_path=str(settings),
                            run_dir=str(run_dir),
                            termination_type="success",
                            termination_reason="",
                            msize=1,
                            logs_dir=str(tmp_path / "logs"),
                        )

    pb.update_context.assert_any_call("plan_file_content", "# My Plan\nDo things.")


# ---------------------------------------------------------------------------
# _run_learn_stage — no run_dir path
# ---------------------------------------------------------------------------

def test_run_learn_stage_without_run_dir(tmp_path):
    """When run_dir is None, learnings.json is not written but stage still runs."""
    settings = tmp_path / "settings.json"
    settings.write_text(json.dumps({"worca": {"stages": {"learn": {"enabled": True}}}}))

    pb = MagicMock()
    pb.build.return_value = "rendered"
    status = {"stages": {}, "plan_file": None}

    with patch("worca.orchestrator.runner.run_stage", return_value=({"obs": []}, {})):
        with patch("worca.orchestrator.runner.save_status"):
            with patch("worca.orchestrator.runner.start_iteration", return_value={"number": 1}):
                with patch("worca.orchestrator.runner.complete_iteration"):
                    with patch("worca.orchestrator.runner.update_stage"):
                        _run_learn_stage(
                            status=status,
                            prompt_builder=pb,
                            settings_path=str(settings),
                            run_dir=None,
                            termination_type="loop_exhausted",
                            termination_reason="too many loops",
                            msize=1,
                            logs_dir=str(tmp_path / "logs"),
                        )

    # No learnings.json should exist anywhere
    assert not (tmp_path / "learnings.json").exists()


# ---------------------------------------------------------------------------
# _run_learn_stage — error recorded in status
# ---------------------------------------------------------------------------

def test_run_learn_stage_records_error_in_status(tmp_path):
    """When learn stage fails, error should be recorded via update_stage and complete_iteration."""
    settings = tmp_path / "settings.json"
    settings.write_text(json.dumps({"worca": {"stages": {"learn": {"enabled": True}}}}))
    run_dir = tmp_path / "run"
    run_dir.mkdir()

    pb = MagicMock()
    pb.build.return_value = "rendered"
    status = {"stages": {}, "plan_file": None}

    with patch("worca.orchestrator.runner.run_stage", side_effect=RuntimeError("boom")):
        with patch("worca.orchestrator.runner.save_status") as mock_save:
            with patch("worca.orchestrator.runner.start_iteration", return_value={"number": 1}):
                with patch("worca.orchestrator.runner.complete_iteration") as mock_complete:
                    with patch("worca.orchestrator.runner.update_stage") as mock_update:
                        _run_learn_stage(
                            status=status,
                            prompt_builder=pb,
                            settings_path=str(settings),
                            run_dir=str(run_dir),
                            termination_type="failure",
                            termination_reason="test error",
                            msize=1,
                            logs_dir=str(tmp_path / "logs"),
                        )

    # complete_iteration should be called with error status
    mock_complete.assert_called_once()
    call_kwargs = mock_complete.call_args
    assert call_kwargs.kwargs.get("status") == "error"
    assert "boom" in call_kwargs.kwargs.get("error", "")

    # update_stage should be called with error status
    mock_update.assert_called_once()
    update_kwargs = mock_update.call_args
    assert update_kwargs.kwargs.get("status") == "error"
    assert "boom" in update_kwargs.kwargs.get("error", "")

    # save_status should still be called
    mock_save.assert_called()


# ---------------------------------------------------------------------------
# _run_learn_stage — calls run_stage with correct args
# ---------------------------------------------------------------------------

def test_run_learn_stage_calls_run_stage_with_learn(tmp_path):
    """run_stage should be called with Stage.LEARN and the rendered prompt."""
    settings = tmp_path / "settings.json"
    settings.write_text(json.dumps({"worca": {"stages": {"learn": {"enabled": True}}}}))
    run_dir = tmp_path / "run"
    run_dir.mkdir()

    pb = MagicMock()
    pb.build.return_value = "learn prompt content"
    status = {"stages": {}, "plan_file": None}

    with patch("worca.orchestrator.runner.run_stage", return_value=({}, {})) as mock_run:
        with patch("worca.orchestrator.runner.save_status"):
            with patch("worca.orchestrator.runner.start_iteration", return_value={"number": 1}):
                with patch("worca.orchestrator.runner.complete_iteration"):
                    with patch("worca.orchestrator.runner.update_stage"):
                        _run_learn_stage(
                            status=status,
                            prompt_builder=pb,
                            settings_path=str(settings),
                            run_dir=str(run_dir),
                            termination_type="success",
                            termination_reason="",
                            msize=2,
                            logs_dir=str(tmp_path / "logs"),
                        )

    mock_run.assert_called_once()
    args, kwargs = mock_run.call_args
    assert args[0] == Stage.LEARN
    assert kwargs.get("msize") == 2
    assert kwargs.get("prompt_override") == "learn prompt content"

    # prompt_builder.build should have been called with "learn", 0
    pb.build.assert_called_once_with("learn", 0)


# ---------------------------------------------------------------------------
# run_pipeline wiring — learn runs on success
# ---------------------------------------------------------------------------

import pytest  # noqa: E402
from worca.orchestrator.runner import run_pipeline  # noqa: E402
from worca.orchestrator.work_request import WorkRequest  # noqa: E402


def _make_work_request():
    """Create a minimal WorkRequest for testing."""
    return WorkRequest(
        source_type="inline",
        title="Test task",
        description="Do something",
    )


def _setup_pipeline_mocks(tmp_path, learn_enabled=True):
    """Create settings and directories needed for run_pipeline tests."""
    settings = tmp_path / "settings.json"
    settings.write_text(json.dumps({
        "worca": {
            "stages": {
                "learn": {"enabled": learn_enabled},
                # Disable everything except plan for simplicity
                "plan": {"agent": "planner", "enabled": True},
                "coordinate": {"agent": "coordinator", "enabled": False},
                "implement": {"agent": "implementer", "enabled": False},
                "test": {"agent": "tester", "enabled": False},
                "review": {"agent": "guardian", "enabled": False},
                "pr": {"agent": "guardian", "enabled": False},
            },
            "agents": {"planner": {"model": "sonnet", "max_turns": 10}},
        }
    }))
    worca_dir = tmp_path / "worca"
    worca_dir.mkdir()
    status_path = worca_dir / "status.json"
    return str(settings), str(status_path)


@patch("worca.orchestrator.runner._run_learn_stage")
@patch("worca.orchestrator.runner.update_cumulative_stats")
@patch("worca.orchestrator.runner.gh_issue_complete")
@patch("worca.orchestrator.runner.gh_issue_start")
@patch("worca.orchestrator.runner.create_branch")
@patch("worca.orchestrator.runner.run_stage")
def test_pipeline_calls_learn_on_success(
    mock_run_stage, mock_branch, mock_gh_start, mock_gh_complete,
    mock_stats, mock_learn, tmp_path,
):
    """On successful pipeline completion, _run_learn_stage should be called with 'success'."""
    settings_path, status_path = _setup_pipeline_mocks(tmp_path)
    # Plan stage returns approved result
    mock_run_stage.return_value = ({"approved": True, "approach": "test"}, {})

    run_pipeline(
        _make_work_request(),
        settings_path=settings_path,
        status_path=status_path,
        branch="test-branch",
    )

    mock_learn.assert_called_once()
    call_args = mock_learn.call_args
    assert call_args[1].get("termination_type") or call_args[0][4] == "success"


@patch("worca.orchestrator.runner._run_learn_stage")
@patch("worca.orchestrator.runner.update_cumulative_stats")
@patch("worca.orchestrator.runner.gh_issue_complete")
@patch("worca.orchestrator.runner.gh_issue_start")
@patch("worca.orchestrator.runner.create_branch")
@patch("worca.orchestrator.runner.run_stage")
def test_pipeline_calls_learn_on_pipeline_error(
    mock_run_stage, mock_branch, mock_gh_start, mock_gh_complete,
    mock_stats, mock_learn, tmp_path,
):
    """On PipelineError, _run_learn_stage should be called with 'failure'."""
    settings_path, status_path = _setup_pipeline_mocks(tmp_path)
    # Plan stage returns rejected → PipelineError("Plan not approved")
    mock_run_stage.return_value = ({"approved": False}, {})

    with pytest.raises(PipelineError):
        run_pipeline(
            _make_work_request(),
            settings_path=settings_path,
            status_path=status_path,
            branch="test-branch",
        )

    mock_learn.assert_called_once()
    call_args = mock_learn.call_args
    assert call_args[0][4] == "failure"  # termination_type positional arg


@patch("worca.orchestrator.runner._run_learn_stage")
@patch("worca.orchestrator.runner.update_cumulative_stats")
@patch("worca.orchestrator.runner.gh_issue_complete")
@patch("worca.orchestrator.runner.gh_issue_start")
@patch("worca.orchestrator.runner.create_branch")
@patch("worca.orchestrator.runner.run_stage")
def test_pipeline_calls_learn_on_stage_exception(
    mock_run_stage, mock_branch, mock_gh_start, mock_gh_complete,
    mock_stats, mock_learn, tmp_path,
):
    """On unexpected Exception, _run_learn_stage should be called with 'failure'."""
    settings_path, status_path = _setup_pipeline_mocks(tmp_path)
    mock_run_stage.side_effect = RuntimeError("unexpected crash")

    with pytest.raises(RuntimeError):
        run_pipeline(
            _make_work_request(),
            settings_path=settings_path,
            status_path=status_path,
            branch="test-branch",
        )

    mock_learn.assert_called_once()
    call_args = mock_learn.call_args
    assert call_args[0][4] == "failure"


@patch("worca.orchestrator.runner._run_learn_stage")
@patch("worca.orchestrator.runner.gh_issue_start")
@patch("worca.orchestrator.runner.create_branch")
@patch("worca.orchestrator.runner.run_stage")
def test_pipeline_does_not_call_learn_on_interrupted(
    mock_run_stage, mock_branch, mock_gh_start, mock_learn, tmp_path,
):
    """On PipelineInterrupted, _run_learn_stage should NOT be called."""
    settings_path, status_path = _setup_pipeline_mocks(tmp_path)
    # Simulate InterruptedError during stage execution → PipelineInterrupted
    mock_run_stage.side_effect = InterruptedError("signal")

    with pytest.raises(PipelineInterrupted):
        run_pipeline(
            _make_work_request(),
            settings_path=settings_path,
            status_path=status_path,
            branch="test-branch",
        )

    mock_learn.assert_not_called()
