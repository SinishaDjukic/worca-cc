"""Tests for .claude/scripts/worca.py CLI entry point."""

import json
import signal
from pathlib import Path
from unittest.mock import MagicMock, patch

import importlib.util

import pytest

# Load worca.py by file path to avoid shadowing by the worca/ package
SCRIPTS_DIR = Path(__file__).parent.parent / ".claude" / "scripts"
WORCA_PY = SCRIPTS_DIR / "worca.py"

_spec = importlib.util.spec_from_file_location("worca_cli", WORCA_PY)
worca_cli = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(worca_cli)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def make_status(tmp_path, run_id, pipeline_status="running", stage="implement", iteration=2):
    run_dir = tmp_path / "runs" / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    status = {
        "run_id": run_id,
        "pipeline_status": pipeline_status,
        "stage": stage,
        "stages": {
            stage: {"iteration": iteration, "status": "in_progress"},
        },
        "branch": "worca/test-branch",
        "started_at": "2026-03-21T00:00:00+00:00",
        "completed_at": None,
    }
    (run_dir / "status.json").write_text(json.dumps(status, indent=2))
    return run_dir, status


def make_active_run(tmp_path, run_id):
    (tmp_path / "active_run").write_text(run_id)


# ---------------------------------------------------------------------------
# resolve_run_id
# ---------------------------------------------------------------------------


def test_resolve_run_id_explicit():
    assert worca_cli.resolve_run_id("my-run", base=".worca") == "my-run"


def test_resolve_run_id_from_active_run(tmp_path):
    make_active_run(tmp_path, "20260321-212836")
    result = worca_cli.resolve_run_id(None, base=str(tmp_path))
    assert result == "20260321-212836"


def test_resolve_run_id_missing_active_run_raises(tmp_path):
    with pytest.raises(SystemExit):
        worca_cli.resolve_run_id(None, base=str(tmp_path))


# ---------------------------------------------------------------------------
# cmd_pause
# ---------------------------------------------------------------------------


def test_pause_writes_control_file(tmp_path):
    make_status(tmp_path, "run-1")
    worca_cli.cmd_pause("run-1", base=str(tmp_path))
    control = tmp_path / "runs" / "run-1" / "control.json"
    assert control.exists()
    data = json.loads(control.read_text())
    assert data["action"] == "pause"
    assert data["source"] == "cli"


def test_pause_uses_active_run_when_no_run_id(tmp_path):
    make_active_run(tmp_path, "run-x")
    make_status(tmp_path, "run-x")
    worca_cli.cmd_pause(None, base=str(tmp_path))
    control = tmp_path / "runs" / "run-x" / "control.json"
    assert control.exists()


def test_pause_returns_run_id(tmp_path):
    make_status(tmp_path, "run-1")
    result = worca_cli.cmd_pause("run-1", base=str(tmp_path))
    assert result == "run-1"


# ---------------------------------------------------------------------------
# cmd_stop
# ---------------------------------------------------------------------------


def test_stop_writes_control_file(tmp_path):
    make_status(tmp_path, "run-2")
    worca_cli.cmd_stop("run-2", base=str(tmp_path))
    control = tmp_path / "runs" / "run-2" / "control.json"
    data = json.loads(control.read_text())
    assert data["action"] == "stop"


def test_stop_sends_sigterm_when_pid_file_exists(tmp_path):
    make_status(tmp_path, "run-2")
    pid_file = tmp_path / "runs" / "run-2" / "pid"
    pid_file.write_text("99999\n")

    with patch("os.kill") as mock_kill:
        worca_cli.cmd_stop("run-2", base=str(tmp_path))
        mock_kill.assert_called_once_with(99999, signal.SIGTERM)


def test_stop_no_error_when_pid_file_missing(tmp_path):
    make_status(tmp_path, "run-3")
    # No pid file — should not raise
    worca_cli.cmd_stop("run-3", base=str(tmp_path))


def test_stop_no_error_when_process_already_dead(tmp_path):
    make_status(tmp_path, "run-4")
    pid_file = tmp_path / "runs" / "run-4" / "pid"
    pid_file.write_text("99999\n")

    with patch("os.kill", side_effect=ProcessLookupError):
        # Should not raise
        worca_cli.cmd_stop("run-4", base=str(tmp_path))


def test_stop_uses_active_run_when_no_run_id(tmp_path):
    make_active_run(tmp_path, "run-y")
    make_status(tmp_path, "run-y")
    worca_cli.cmd_stop(None, base=str(tmp_path))
    control = tmp_path / "runs" / "run-y" / "control.json"
    assert control.exists()


# ---------------------------------------------------------------------------
# cmd_resume
# ---------------------------------------------------------------------------


def test_resume_spawns_run_pipeline(tmp_path):
    make_status(tmp_path, "run-5", pipeline_status="paused")

    with patch("subprocess.Popen") as mock_popen:
        mock_proc = MagicMock()
        mock_popen.return_value = mock_proc
        worca_cli.cmd_resume("run-5", base=str(tmp_path))

    mock_popen.assert_called_once()
    cmd = mock_popen.call_args[0][0]
    assert "--resume" in cmd


def test_resume_passes_run_id_via_status_dir(tmp_path):
    make_status(tmp_path, "run-5", pipeline_status="paused")

    with patch("subprocess.Popen") as mock_popen:
        mock_proc = MagicMock()
        mock_popen.return_value = mock_proc
        worca_cli.cmd_resume("run-5", base=str(tmp_path))

    cmd = mock_popen.call_args[0][0]
    # status-dir should point to the run's directory
    assert any("run-5" in part for part in cmd)


def test_resume_uses_active_run_when_no_run_id(tmp_path):
    make_active_run(tmp_path, "run-z")
    make_status(tmp_path, "run-z", pipeline_status="paused")

    with patch("subprocess.Popen") as mock_popen:
        mock_proc = MagicMock()
        mock_popen.return_value = mock_proc
        worca_cli.cmd_resume(None, base=str(tmp_path))

    mock_popen.assert_called_once()


def test_resume_returns_popen_process(tmp_path):
    make_status(tmp_path, "run-6", pipeline_status="paused")
    mock_proc = MagicMock()

    with patch("subprocess.Popen", return_value=mock_proc):
        result = worca_cli.cmd_resume("run-6", base=str(tmp_path))

    assert result is mock_proc


# ---------------------------------------------------------------------------
# cmd_status
# ---------------------------------------------------------------------------


def test_status_returns_status_dict(tmp_path):
    make_status(tmp_path, "run-7", pipeline_status="running", stage="implement", iteration=3)
    result = worca_cli.cmd_status("run-7", base=str(tmp_path))
    assert isinstance(result, dict)
    assert result["pipeline_status"] == "running"
    assert result["stage"] == "implement"


def test_status_missing_run_raises(tmp_path):
    with pytest.raises(SystemExit):
        worca_cli.cmd_status("no-such-run", base=str(tmp_path))


def test_status_uses_active_run_when_no_run_id(tmp_path):
    make_active_run(tmp_path, "run-8")
    make_status(tmp_path, "run-8", pipeline_status="completed")
    result = worca_cli.cmd_status(None, base=str(tmp_path))
    assert result["pipeline_status"] == "completed"


def test_status_includes_iteration(tmp_path):
    make_status(tmp_path, "run-9", stage="test", iteration=5)
    result = worca_cli.cmd_status("run-9", base=str(tmp_path))
    assert result["stages"]["test"]["iteration"] == 5


# ---------------------------------------------------------------------------
# CLI main() argument parsing
# ---------------------------------------------------------------------------


def test_main_pause_calls_cmd_pause(tmp_path):
    make_status(tmp_path, "run-p")
    with patch.object(worca_cli, "cmd_pause", return_value="run-p") as mock_pause:
        worca_cli.main(["pause", "run-p", "--base", str(tmp_path)])
    mock_pause.assert_called_once_with("run-p", base=str(tmp_path))


def test_main_stop_calls_cmd_stop(tmp_path):
    make_status(tmp_path, "run-s")
    with patch.object(worca_cli, "cmd_stop", return_value="run-s") as mock_stop:
        worca_cli.main(["stop", "run-s", "--base", str(tmp_path)])
    mock_stop.assert_called_once_with("run-s", base=str(tmp_path))


def test_main_resume_calls_cmd_resume(tmp_path):
    make_status(tmp_path, "run-r")
    mock_proc = MagicMock()
    with patch.object(worca_cli, "cmd_resume", return_value=mock_proc) as mock_resume:
        worca_cli.main(["resume", "run-r", "--base", str(tmp_path)])
    mock_resume.assert_called_once_with("run-r", base=str(tmp_path))


def test_main_status_calls_cmd_status(tmp_path):
    make_status(tmp_path, "run-t", pipeline_status="running", stage="plan")
    with patch.object(worca_cli, "cmd_status") as mock_status:
        mock_status.return_value = {"pipeline_status": "running", "stage": "plan", "stages": {}}
        worca_cli.main(["status", "run-t", "--base", str(tmp_path)])
    mock_status.assert_called_once_with("run-t", base=str(tmp_path))


def test_main_no_command_exits_nonzero():
    with pytest.raises(SystemExit) as exc:
        worca_cli.main([])
    assert exc.value.code != 0


def test_main_unknown_command_exits_nonzero():
    with pytest.raises(SystemExit) as exc:
        worca_cli.main(["explode"])
    assert exc.value.code != 0
