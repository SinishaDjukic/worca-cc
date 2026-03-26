"""Tests for control file polling in the runner iteration loop."""

import json
from unittest.mock import patch, MagicMock

import pytest

from worca.orchestrator.control import write_control
from worca.orchestrator.runner import (
    _check_control_file,
    PipelineInterrupted,
)
from worca.events.types import RUN_PAUSED


# --- no control file ---


def test_no_control_file_returns_without_action(tmp_path):
    status = {"run_id": "run-1", "pipeline_status": "running"}
    _check_control_file("run-1", str(tmp_path), status, str(tmp_path / "status.json"), None)
    assert status["pipeline_status"] == "running"


def test_no_run_id_returns_without_action(tmp_path):
    status = {"pipeline_status": "running"}
    # Should not raise even with no run_id
    _check_control_file(None, str(tmp_path), status, str(tmp_path / "status.json"), None)
    assert status["pipeline_status"] == "running"


# --- pause action ---


def test_pause_sets_pipeline_status_paused(tmp_path):
    write_control("run-1", "pause", base=str(tmp_path))
    status = {"run_id": "run-1", "pipeline_status": "running"}
    status_path = str(tmp_path / "status.json")
    with pytest.raises(SystemExit):
        _check_control_file("run-1", str(tmp_path), status, status_path, None)
    assert status["pipeline_status"] == "paused"


def test_pause_calls_sys_exit_0(tmp_path):
    write_control("run-1", "pause", base=str(tmp_path))
    status = {"run_id": "run-1", "pipeline_status": "running"}
    status_path = str(tmp_path / "status.json")
    with pytest.raises(SystemExit) as exc_info:
        _check_control_file("run-1", str(tmp_path), status, status_path, None)
    assert exc_info.value.code == 0


def test_pause_saves_status(tmp_path):
    write_control("run-1", "pause", base=str(tmp_path))
    status = {"run_id": "run-1", "pipeline_status": "running"}
    status_path = str(tmp_path / "status.json")
    with pytest.raises(SystemExit):
        _check_control_file("run-1", str(tmp_path), status, status_path, None)
    with open(status_path) as f:
        saved = json.load(f)
    assert saved["pipeline_status"] == "paused"


def test_pause_deletes_control_file(tmp_path):
    write_control("run-1", "pause", base=str(tmp_path))
    control_file = tmp_path / "runs" / "run-1" / "control.json"
    assert control_file.exists()
    status = {"run_id": "run-1", "pipeline_status": "running"}
    status_path = str(tmp_path / "status.json")
    with pytest.raises(SystemExit):
        _check_control_file("run-1", str(tmp_path), status, status_path, None)
    assert not control_file.exists()


# --- stop action ---


def test_stop_calls_terminate_current(tmp_path):
    write_control("run-1", "stop", base=str(tmp_path))
    status = {"run_id": "run-1", "pipeline_status": "running"}
    status_path = str(tmp_path / "status.json")
    with patch("worca.orchestrator.runner.terminate_current") as mock_term:
        with pytest.raises(PipelineInterrupted):
            _check_control_file("run-1", str(tmp_path), status, status_path, None)
    mock_term.assert_called_once()


def test_stop_sets_pipeline_status_failed(tmp_path):
    write_control("run-1", "stop", base=str(tmp_path))
    status = {"run_id": "run-1", "pipeline_status": "running"}
    status_path = str(tmp_path / "status.json")
    with patch("worca.orchestrator.runner.terminate_current"):
        with pytest.raises(PipelineInterrupted):
            _check_control_file("run-1", str(tmp_path), status, status_path, None)
    assert status["pipeline_status"] == "failed"


def test_stop_sets_stop_reason(tmp_path):
    write_control("run-1", "stop", base=str(tmp_path))
    status = {"run_id": "run-1", "pipeline_status": "running"}
    status_path = str(tmp_path / "status.json")
    with patch("worca.orchestrator.runner.terminate_current"):
        with pytest.raises(PipelineInterrupted):
            _check_control_file("run-1", str(tmp_path), status, status_path, None)
    assert status.get("stop_reason") == "stopped"


def test_stop_raises_pipeline_interrupted(tmp_path):
    write_control("run-1", "stop", base=str(tmp_path))
    status = {"run_id": "run-1", "pipeline_status": "running"}
    status_path = str(tmp_path / "status.json")
    with patch("worca.orchestrator.runner.terminate_current"):
        with pytest.raises(PipelineInterrupted):
            _check_control_file("run-1", str(tmp_path), status, status_path, None)


def test_stop_saves_status(tmp_path):
    write_control("run-1", "stop", base=str(tmp_path))
    status = {"run_id": "run-1", "pipeline_status": "running"}
    status_path = str(tmp_path / "status.json")
    with patch("worca.orchestrator.runner.terminate_current"):
        with pytest.raises(PipelineInterrupted):
            _check_control_file("run-1", str(tmp_path), status, status_path, None)
    with open(status_path) as f:
        saved = json.load(f)
    assert saved["pipeline_status"] == "failed"
    assert saved["stop_reason"] == "stopped"


def test_stop_deletes_control_file(tmp_path):
    write_control("run-1", "stop", base=str(tmp_path))
    control_file = tmp_path / "runs" / "run-1" / "control.json"
    assert control_file.exists()
    status = {"run_id": "run-1", "pipeline_status": "running"}
    status_path = str(tmp_path / "status.json")
    with patch("worca.orchestrator.runner.terminate_current"):
        with pytest.raises(PipelineInterrupted):
            _check_control_file("run-1", str(tmp_path), status, status_path, None)
    assert not control_file.exists()


# --- event emission with ctx ---


def test_pause_with_ctx_emits_run_paused_event(tmp_path):
    """_check_control_file emits RUN_PAUSED event via ctx when action is pause."""
    write_control("run-1", "pause", base=str(tmp_path))
    status = {"run_id": "run-1", "pipeline_status": "running"}
    status_path = str(tmp_path / "status.json")
    mock_ctx = MagicMock()

    with patch("worca.orchestrator.runner.emit_event") as mock_emit:
        with pytest.raises(SystemExit):
            _check_control_file("run-1", str(tmp_path), status, status_path, mock_ctx)

    emitted_types = [c.args[1] for c in mock_emit.call_args_list]
    assert RUN_PAUSED in emitted_types, f"RUN_PAUSED not emitted; got: {emitted_types}"


def test_pause_with_ctx_none_does_not_call_emit(tmp_path):
    """_check_control_file does not attempt event emission when ctx is None."""
    write_control("run-1", "pause", base=str(tmp_path))
    status = {"run_id": "run-1", "pipeline_status": "running"}
    status_path = str(tmp_path / "status.json")

    with patch("worca.orchestrator.runner.emit_event") as mock_emit:
        with pytest.raises(SystemExit):
            _check_control_file("run-1", str(tmp_path), status, status_path, None)

    mock_emit.assert_not_called()


def test_pause_event_payload_contains_reason(tmp_path):
    """RUN_PAUSED event payload includes a reason field."""
    write_control("run-1", "pause", base=str(tmp_path))
    status = {"run_id": "run-1", "pipeline_status": "running"}
    status_path = str(tmp_path / "status.json")
    mock_ctx = MagicMock()

    with patch("worca.orchestrator.runner.emit_event") as mock_emit:
        with pytest.raises(SystemExit):
            _check_control_file("run-1", str(tmp_path), status, status_path, mock_ctx)

    pause_calls = [c for c in mock_emit.call_args_list if c.args[1] == RUN_PAUSED]
    assert pause_calls, "No RUN_PAUSED call found"
    payload = pause_calls[0].args[2]
    assert "reason" in payload
