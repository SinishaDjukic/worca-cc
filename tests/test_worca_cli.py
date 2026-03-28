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


# ---------------------------------------------------------------------------
# Worktree-aware per-pipeline control (task 3.13)
# ---------------------------------------------------------------------------


def _setup_registry_pipeline(tmp_path, run_id, worktree_name="wt-1", pid=12345):
    """Create a registry entry and a worktree .worca/ dir with status.json.

    Returns (base, worktree_path, registry_entry).
    """
    base = str(tmp_path / "base_worca")
    worktree_path = str(tmp_path / worktree_name)

    # Create the registry entry file
    registry_dir = Path(base) / "multi" / "pipelines.d"
    registry_dir.mkdir(parents=True, exist_ok=True)
    entry = {
        "run_id": run_id,
        "worktree_path": worktree_path,
        "title": "test pipeline",
        "pid": pid,
        "status": "running",
        "started_at": "2026-03-28T00:00:00Z",
        "updated_at": "2026-03-28T00:00:00Z",
    }
    (registry_dir / f"{run_id}.json").write_text(json.dumps(entry, indent=2))

    # Create worktree's .worca/runs/{run_id}/status.json
    wt_worca = Path(worktree_path) / ".worca"
    make_status(wt_worca, run_id, pipeline_status="running", stage="implement", iteration=3)

    return base, worktree_path, entry


class TestPauseWorktreePipeline:
    """cmd_pause with registered worktree pipeline."""

    def test_pause_writes_control_to_worktree(self, tmp_path):
        base, worktree_path, _ = _setup_registry_pipeline(tmp_path, "wt-run-1")
        worca_cli.cmd_pause("wt-run-1", base=base)

        control = Path(worktree_path) / ".worca" / "runs" / "wt-run-1" / "control.json"
        assert control.exists()
        data = json.loads(control.read_text())
        assert data["action"] == "pause"
        assert data["source"] == "cli"

    def test_pause_does_not_write_to_local_base(self, tmp_path):
        base, _, _ = _setup_registry_pipeline(tmp_path, "wt-run-1")
        worca_cli.cmd_pause("wt-run-1", base=base)

        # Control should NOT be in the local base
        local_control = Path(base) / "runs" / "wt-run-1" / "control.json"
        assert not local_control.exists()

    def test_pause_falls_back_when_not_registered(self, tmp_path):
        base = str(tmp_path)
        make_status(tmp_path, "local-run")
        worca_cli.cmd_pause("local-run", base=base)

        control = tmp_path / "runs" / "local-run" / "control.json"
        assert control.exists()
        data = json.loads(control.read_text())
        assert data["action"] == "pause"


class TestStopWorktreePipeline:
    """cmd_stop with registered worktree pipeline."""

    def test_stop_writes_control_to_worktree(self, tmp_path):
        base, worktree_path, _ = _setup_registry_pipeline(tmp_path, "wt-run-2")
        with patch("os.kill"):
            worca_cli.cmd_stop("wt-run-2", base=base)

        control = Path(worktree_path) / ".worca" / "runs" / "wt-run-2" / "control.json"
        assert control.exists()
        data = json.loads(control.read_text())
        assert data["action"] == "stop"

    def test_stop_sends_sigterm_using_registry_pid(self, tmp_path):
        base, _, _ = _setup_registry_pipeline(tmp_path, "wt-run-2", pid=54321)
        with patch("os.kill") as mock_kill:
            worca_cli.cmd_stop("wt-run-2", base=base)
            mock_kill.assert_called_once_with(54321, signal.SIGTERM)

    def test_stop_does_not_write_to_local_base(self, tmp_path):
        base, _, _ = _setup_registry_pipeline(tmp_path, "wt-run-2")
        with patch("os.kill"):
            worca_cli.cmd_stop("wt-run-2", base=base)

        local_control = Path(base) / "runs" / "wt-run-2" / "control.json"
        assert not local_control.exists()

    def test_stop_falls_back_to_pid_file_when_not_registered(self, tmp_path):
        base = str(tmp_path)
        make_status(tmp_path, "local-run")
        pid_file = tmp_path / "runs" / "local-run" / "pid"
        pid_file.write_text("77777\n")

        with patch("os.kill") as mock_kill:
            worca_cli.cmd_stop("local-run", base=base)
            mock_kill.assert_called_once_with(77777, signal.SIGTERM)

    def test_stop_handles_dead_registry_process(self, tmp_path):
        base, _, _ = _setup_registry_pipeline(tmp_path, "wt-run-2", pid=99999)
        with patch("os.kill", side_effect=ProcessLookupError):
            # Should not raise
            worca_cli.cmd_stop("wt-run-2", base=base)


class TestStatusWorktreePipeline:
    """cmd_status with registered worktree pipeline."""

    def test_status_reads_from_worktree(self, tmp_path):
        base, _, _ = _setup_registry_pipeline(tmp_path, "wt-run-3")
        result = worca_cli.cmd_status("wt-run-3", base=base)
        assert result["pipeline_status"] == "running"
        assert result["stage"] == "implement"

    def test_status_does_not_read_from_local_base(self, tmp_path):
        base, worktree_path, _ = _setup_registry_pipeline(tmp_path, "wt-run-3")
        # The local base has no status file — only worktree has one
        # Should succeed because it reads from worktree
        result = worca_cli.cmd_status("wt-run-3", base=base)
        assert result["run_id"] == "wt-run-3"

    def test_status_falls_back_when_not_registered(self, tmp_path):
        base = str(tmp_path)
        make_status(tmp_path, "local-run", pipeline_status="completed")
        result = worca_cli.cmd_status("local-run", base=base)
        assert result["pipeline_status"] == "completed"

    def test_status_nonexistent_run_raises(self, tmp_path):
        base = str(tmp_path)
        with pytest.raises(SystemExit):
            worca_cli.cmd_status("ghost-run", base=base)


class TestResumeWorktreePipeline:
    """cmd_resume with registered worktree pipeline."""

    def test_resume_spawns_in_worktree_cwd(self, tmp_path):
        base, worktree_path, _ = _setup_registry_pipeline(tmp_path, "wt-run-4")
        with patch("subprocess.Popen") as mock_popen:
            mock_popen.return_value = MagicMock()
            worca_cli.cmd_resume("wt-run-4", base=base)

        _, kwargs = mock_popen.call_args
        assert kwargs.get("cwd") == worktree_path

    def test_resume_includes_worktree_flag(self, tmp_path):
        base, _, _ = _setup_registry_pipeline(tmp_path, "wt-run-4")
        with patch("subprocess.Popen") as mock_popen:
            mock_popen.return_value = MagicMock()
            worca_cli.cmd_resume("wt-run-4", base=base)

        cmd = mock_popen.call_args[0][0]
        assert "--worktree" in cmd
        assert "--resume" in cmd

    def test_resume_status_dir_points_to_worktree(self, tmp_path):
        base, worktree_path, _ = _setup_registry_pipeline(tmp_path, "wt-run-4")
        with patch("subprocess.Popen") as mock_popen:
            mock_popen.return_value = MagicMock()
            worca_cli.cmd_resume("wt-run-4", base=base)

        cmd = mock_popen.call_args[0][0]
        status_dir_idx = cmd.index("--status-dir") + 1
        status_dir = cmd[status_dir_idx]
        assert worktree_path in status_dir
        assert "wt-run-4" in status_dir

    def test_resume_falls_back_when_not_registered(self, tmp_path):
        base = str(tmp_path)
        make_status(tmp_path, "local-run", pipeline_status="paused")
        with patch("subprocess.Popen") as mock_popen:
            mock_popen.return_value = MagicMock()
            worca_cli.cmd_resume("local-run", base=base)

        cmd = mock_popen.call_args[0][0]
        assert "--worktree" not in cmd
        _, kwargs = mock_popen.call_args
        assert "cwd" not in kwargs

    def test_resume_no_cwd_for_local_pipeline(self, tmp_path):
        base = str(tmp_path)
        make_status(tmp_path, "local-run", pipeline_status="paused")
        with patch("subprocess.Popen") as mock_popen:
            mock_popen.return_value = MagicMock()
            worca_cli.cmd_resume("local-run", base=base)

        _, kwargs = mock_popen.call_args
        assert "cwd" not in kwargs


class TestResolveWorktreeBase:
    """Unit tests for _resolve_worktree_base helper."""

    def test_returns_original_base_when_run_id_is_none(self, tmp_path):
        effective, entry = worca_cli._resolve_worktree_base(None, str(tmp_path))
        assert effective == str(tmp_path)
        assert entry is None

    def test_returns_worktree_base_when_registered(self, tmp_path):
        base, worktree_path, expected_entry = _setup_registry_pipeline(
            tmp_path, "reg-run"
        )
        effective, entry = worca_cli._resolve_worktree_base("reg-run", base)
        assert effective == str(Path(worktree_path) / ".worca")
        assert entry is not None
        assert entry["run_id"] == "reg-run"

    def test_returns_original_base_when_not_registered(self, tmp_path):
        base = str(tmp_path)
        effective, entry = worca_cli._resolve_worktree_base("unknown-run", base)
        assert effective == base
        assert entry is None


# ---------------------------------------------------------------------------
# cmd_multi_status
# ---------------------------------------------------------------------------


class TestMultiStatus:
    """Tests for cmd_multi_status."""

    def test_no_pipelines_prints_message(self, tmp_path, capsys):
        """When no pipelines are registered, prints informational message."""
        base = str(tmp_path)
        # Create the registry dir so list_pipelines doesn't fail
        (tmp_path / "multi" / "pipelines.d").mkdir(parents=True, exist_ok=True)

        result = worca_cli.cmd_multi_status(base=base)

        assert result == []
        captured = capsys.readouterr()
        assert "No parallel pipelines registered." in captured.out

    def test_with_registered_pipelines_prints_table(self, tmp_path, capsys):
        """Registered pipelines produce a formatted table."""
        base = str(tmp_path)
        registry_dir = tmp_path / "multi" / "pipelines.d"
        registry_dir.mkdir(parents=True, exist_ok=True)

        entry = {
            "run_id": "run-abc",
            "worktree_path": "/tmp/nonexistent-wt",
            "title": "Feature X",
            "pid": 12345,
            "status": "running",
            "started_at": "2026-03-28T00:00:00Z",
            "updated_at": "2026-03-28T00:00:00Z",
        }
        (registry_dir / "run-abc.json").write_text(json.dumps(entry))

        # Mock reconcile_stale so it doesn't mark the fake PID as stale
        with patch.object(worca_cli, "reconcile_stale"):
            result = worca_cli.cmd_multi_status(base=base)

        assert len(result) == 1
        assert result[0]["run_id"] == "run-abc"
        captured = capsys.readouterr()
        assert "RUN_ID" in captured.out
        assert "STATUS" in captured.out
        assert "STAGE" in captured.out
        assert "TITLE" in captured.out
        assert "WORKTREE" in captured.out
        assert "run-abc" in captured.out
        assert "Feature X" in captured.out
        assert "running" in captured.out

    def test_calls_reconcile_stale(self, tmp_path):
        """Verifies reconcile_stale is called before listing."""
        base = str(tmp_path)
        (tmp_path / "multi" / "pipelines.d").mkdir(parents=True, exist_ok=True)

        with patch.object(worca_cli, "reconcile_stale") as mock_reconcile, \
             patch.object(worca_cli, "list_pipelines", return_value=[]):
            worca_cli.cmd_multi_status(base=base)
            mock_reconcile.assert_called_once_with(base)

    def test_enriches_with_stage_from_status_json(self, tmp_path, capsys):
        """Stage data is read from each worktree's status.json."""
        base = str(tmp_path)
        registry_dir = tmp_path / "multi" / "pipelines.d"
        registry_dir.mkdir(parents=True, exist_ok=True)

        worktree_path = str(tmp_path / "worktree-1")
        run_id = "run-enrich"

        entry = {
            "run_id": run_id,
            "worktree_path": worktree_path,
            "title": "Enrich Test",
            "pid": 11111,
            "status": "running",
            "started_at": "2026-03-28T00:00:00Z",
            "updated_at": "2026-03-28T00:00:00Z",
        }
        (registry_dir / f"{run_id}.json").write_text(json.dumps(entry))

        # Create the worktree status.json
        wt_status_dir = Path(worktree_path) / ".worca" / "runs" / run_id
        wt_status_dir.mkdir(parents=True, exist_ok=True)
        status_data = {
            "run_id": run_id,
            "pipeline_status": "running",
            "stage": "test",
            "stages": {"test": {"iteration": 2}},
        }
        (wt_status_dir / "status.json").write_text(json.dumps(status_data))

        # Mock reconcile_stale so it doesn't mark the fake PID as stale
        with patch.object(worca_cli, "reconcile_stale"):
            result = worca_cli.cmd_multi_status(base=base)

        assert len(result) == 1
        assert result[0]["stage"] == "test"
        captured = capsys.readouterr()
        assert "test" in captured.out

    def test_stage_defaults_when_status_json_missing(self, tmp_path, capsys):
        """When status.json is missing, stage defaults to dash."""
        base = str(tmp_path)
        registry_dir = tmp_path / "multi" / "pipelines.d"
        registry_dir.mkdir(parents=True, exist_ok=True)

        entry = {
            "run_id": "run-no-status",
            "worktree_path": "/tmp/no-such-worktree",
            "title": "Missing Status",
            "pid": 22222,
            "status": "running",
        }
        (registry_dir / "run-no-status.json").write_text(json.dumps(entry))

        # Mock reconcile_stale so it doesn't mark the fake PID as stale
        with patch.object(worca_cli, "reconcile_stale"):
            result = worca_cli.cmd_multi_status(base=base)

        # load_status returns {} for missing file, so stage comes from
        # status.get("stage", "—") which is "—"
        assert len(result) == 1

    def test_returns_enriched_pipeline_dicts(self, tmp_path):
        """Return value is the list of enriched pipeline dicts."""
        base = str(tmp_path)
        registry_dir = tmp_path / "multi" / "pipelines.d"
        registry_dir.mkdir(parents=True, exist_ok=True)

        for i, run_id in enumerate(["run-a", "run-b"]):
            entry = {
                "run_id": run_id,
                "worktree_path": f"/tmp/wt-{i}",
                "title": f"Pipeline {i}",
                "pid": 10000 + i,
                "status": "running",
            }
            (registry_dir / f"{run_id}.json").write_text(json.dumps(entry))

        # Mock reconcile_stale so it doesn't mark the fake PIDs as stale
        with patch.object(worca_cli, "reconcile_stale"):
            result = worca_cli.cmd_multi_status(base=base)

        assert len(result) == 2
        run_ids = [r["run_id"] for r in result]
        assert "run-a" in run_ids
        assert "run-b" in run_ids


class TestMultiStatusCLIParsing:
    """Tests for multi-status CLI argument parsing."""

    def test_cli_parses_multi_status_command(self):
        """multi-status is recognized as a valid subcommand."""
        parser = worca_cli.create_parser()
        args = parser.parse_args(["multi-status"])
        assert args.command == "multi-status"

    def test_cli_multi_status_with_base_flag(self):
        """--base flag is accepted before multi-status."""
        parser = worca_cli.create_parser()
        args = parser.parse_args(["--base", "/custom/path", "multi-status"])
        assert args.command == "multi-status"
        assert args.base == "/custom/path"

    def test_main_multi_status_calls_cmd_multi_status(self, tmp_path):
        """main() dispatches multi-status to cmd_multi_status."""
        with patch.object(worca_cli, "cmd_multi_status", return_value=[]) as mock_ms:
            worca_cli.main(["--base", str(tmp_path), "multi-status"])
        mock_ms.assert_called_once_with(base=str(tmp_path))
