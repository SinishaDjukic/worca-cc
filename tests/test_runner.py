"""Tests for worca.orchestrator.runner — pipeline runner."""

import json
import os
from unittest.mock import patch, MagicMock

from worca.orchestrator.runner import (
    run_stage,
    check_loop_limit,
    handle_pr_review,
    _ensure_beads_initialized,
    LoopExhaustedError,
    PipelineError,
)
from worca.orchestrator.stages import Stage


def test_run_stage_calls_agent():
    mock_config = {"agent": "planner", "model": "opus", "max_turns": 40, "schema": "plan.json"}
    with patch("worca.orchestrator.runner.get_stage_config", return_value=mock_config):
        with patch("worca.orchestrator.runner.run_agent", return_value={"approach": "test"}) as mock_run:
            result, raw = run_stage(Stage.PLAN, {"prompt": "build auth"})
    mock_run.assert_called_once()
    assert result == {"approach": "test"}


def test_run_stage_extracts_structured_output():
    mock_config = {"agent": "planner", "model": "opus", "max_turns": 40, "schema": "plan.json"}
    envelope = {"type": "result", "structured_output": {"approach": "test"}, "total_cost_usd": 1.0}
    with patch("worca.orchestrator.runner.get_stage_config", return_value=mock_config):
        with patch("worca.orchestrator.runner.run_agent", return_value=envelope):
            result, raw = run_stage(Stage.PLAN, {"prompt": "build auth"})
    assert result == {"approach": "test"}
    assert raw == envelope


def test_run_stage_passes_correct_args():
    mock_config = {"agent": "tester", "model": "sonnet", "max_turns": 20, "schema": "test.json"}
    with patch("worca.orchestrator.runner.get_stage_config", return_value=mock_config):
        with patch("worca.orchestrator.runner.run_agent", return_value={"passed": True}) as mock_run:
            result, raw = run_stage(Stage.TEST, {"prompt": "run tests"})
    call_kwargs = mock_run.call_args
    # Agent path should contain the agent name
    assert ".claude/agents/core/tester.md" in str(call_kwargs)
    # Schema path should be resolved
    assert ".claude/worca/schemas/test.json" in str(call_kwargs)


def test_check_loop_limit_within_limit(tmp_path):
    settings = tmp_path / "settings.json"
    settings.write_text(json.dumps({"worca": {"loops": {"implement_test": 10}}}))
    assert check_loop_limit("implement_test", 3, str(settings)) is True


def test_check_loop_limit_at_boundary(tmp_path):
    settings = tmp_path / "settings.json"
    settings.write_text(json.dumps({"worca": {"loops": {"implement_test": 10}}}))
    assert check_loop_limit("implement_test", 9, str(settings)) is True


def test_check_loop_limit_exceeded(tmp_path):
    settings = tmp_path / "settings.json"
    settings.write_text(json.dumps({"worca": {"loops": {"implement_test": 10}}}))
    assert check_loop_limit("implement_test", 10, str(settings)) is False


def test_check_loop_limit_exceeded_over(tmp_path):
    settings = tmp_path / "settings.json"
    settings.write_text(json.dumps({"worca": {"loops": {"implement_test": 5}}}))
    assert check_loop_limit("implement_test", 7, str(settings)) is False


def test_check_loop_limit_default_when_missing(tmp_path):
    settings = tmp_path / "settings.json"
    settings.write_text(json.dumps({"worca": {}}))
    # No loops configured, default to 10
    assert check_loop_limit("implement_test", 9, str(settings)) is True
    assert check_loop_limit("implement_test", 10, str(settings)) is False


def test_check_loop_limit_default_when_no_file(tmp_path):
    missing = tmp_path / "nonexistent.json"
    # Default to 10 when file doesn't exist
    assert check_loop_limit("implement_test", 5, str(missing)) is True
    assert check_loop_limit("implement_test", 10, str(missing)) is False


def test_handle_pr_approve():
    stage, status = handle_pr_review("approve", {"stage": "review"})
    assert stage is None  # pipeline done


def test_handle_pr_request_changes():
    stage, status = handle_pr_review("request_changes", {"stage": "review"})
    assert stage == Stage.IMPLEMENT


def test_handle_pr_reject():
    stage, status = handle_pr_review("reject", {"stage": "review"})
    assert stage is None


def test_handle_pr_restart():
    stage, status = handle_pr_review("restart_planning", {"stage": "review"})
    assert stage == Stage.PLAN


# --- msize multiplier ---

def test_run_stage_msize_multiplies_max_turns():
    mock_config = {"agent": "planner", "model": "opus", "max_turns": 40, "schema": "plan.json"}
    with patch("worca.orchestrator.runner.get_stage_config", return_value=mock_config):
        with patch("worca.orchestrator.runner.run_agent", return_value={"ok": True}) as mock_run:
            run_stage(Stage.PLAN, {"prompt": "test"}, msize=3)
    call_kwargs = mock_run.call_args
    assert call_kwargs.kwargs.get("max_turns") == 120  # 40 * 3


def test_run_stage_msize_default_is_1():
    mock_config = {"agent": "planner", "model": "opus", "max_turns": 40, "schema": "plan.json"}
    with patch("worca.orchestrator.runner.get_stage_config", return_value=mock_config):
        with patch("worca.orchestrator.runner.run_agent", return_value={"ok": True}) as mock_run:
            run_stage(Stage.PLAN, {"prompt": "test"})
    call_kwargs = mock_run.call_args
    assert call_kwargs.kwargs.get("max_turns") == 40


# --- mloops multiplier ---

def test_check_loop_limit_mloops_multiplies(tmp_path):
    settings = tmp_path / "settings.json"
    settings.write_text(json.dumps({"worca": {"loops": {"implement_test": 5}}}))
    # Without multiplier: 5 is at limit
    assert check_loop_limit("implement_test", 5, str(settings)) is False
    # With mloops=2: limit becomes 10
    assert check_loop_limit("implement_test", 5, str(settings), mloops=2) is True
    assert check_loop_limit("implement_test", 10, str(settings), mloops=2) is False


def test_check_loop_limit_mloops_default_is_1(tmp_path):
    settings = tmp_path / "settings.json"
    settings.write_text(json.dumps({"worca": {"loops": {"implement_test": 5}}}))
    assert check_loop_limit("implement_test", 4, str(settings)) is True
    assert check_loop_limit("implement_test", 5, str(settings)) is False


# --- _ensure_beads_initialized ---

def test_ensure_beads_initialized_already_init():
    mock_result = MagicMock()
    mock_result.returncode = 0
    with patch("worca.orchestrator.runner.subprocess.run", return_value=mock_result) as mock_run:
        _ensure_beads_initialized()
    # Should only call bd stats, not bd init
    mock_run.assert_called_once()
    assert mock_run.call_args[0][0] == ["bd", "stats"]


def test_ensure_beads_initialized_runs_init():
    stats_fail = MagicMock(returncode=1)
    init_ok = MagicMock(returncode=0)
    with patch("worca.orchestrator.runner.subprocess.run", side_effect=[stats_fail, init_ok]) as mock_run:
        _ensure_beads_initialized()
    assert mock_run.call_count == 2
    assert mock_run.call_args_list[0][0][0] == ["bd", "stats"]
    assert mock_run.call_args_list[1][0][0] == ["bd", "init"]


def test_ensure_beads_initialized_raises_on_init_failure():
    stats_fail = MagicMock(returncode=1)
    init_fail = MagicMock(returncode=1, stderr="no git repo")
    with patch("worca.orchestrator.runner.subprocess.run", side_effect=[stats_fail, init_fail]):
        try:
            _ensure_beads_initialized()
            assert False, "Should have raised"
        except PipelineError as e:
            assert "beads" in str(e).lower()
