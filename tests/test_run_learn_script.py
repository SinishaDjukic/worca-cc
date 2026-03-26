"""Tests for .claude/scripts/run_learn.py — standalone learn stage script."""

import json
import os
import sys
from unittest.mock import patch, MagicMock

import pytest

# Ensure the scripts dir is importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".claude", "scripts"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".claude"))


# ---------------------------------------------------------------------------
# Import helpers — module lives at .claude/scripts/run_learn.py
# ---------------------------------------------------------------------------

def _import_run_learn():
    """Import the run_learn module."""
    import importlib
    spec = importlib.util.spec_from_file_location(
        "run_learn",
        os.path.join(os.path.dirname(__file__), "..", ".claude", "scripts", "run_learn.py"),
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# ---------------------------------------------------------------------------
# CLI argument parsing
# ---------------------------------------------------------------------------

class TestCreateParser:
    def test_run_id_required(self):
        mod = _import_run_learn()
        parser = mod.create_parser()
        with pytest.raises(SystemExit):
            parser.parse_args([])

    def test_run_id_accepted(self):
        mod = _import_run_learn()
        parser = mod.create_parser()
        args = parser.parse_args(["--run-id", "20260318-222430"])
        assert args.run_id == "20260318-222430"

    def test_custom_settings_path(self):
        mod = _import_run_learn()
        parser = mod.create_parser()
        args = parser.parse_args(["--run-id", "abc", "--settings", "/tmp/s.json"])
        assert args.settings == "/tmp/s.json"

    def test_custom_status_dir(self):
        mod = _import_run_learn()
        parser = mod.create_parser()
        args = parser.parse_args(["--run-id", "abc", "--status-dir", "/tmp/worca"])
        assert args.status_dir == "/tmp/worca"

    def test_msize_default(self):
        mod = _import_run_learn()
        parser = mod.create_parser()
        args = parser.parse_args(["--run-id", "abc"])
        assert args.msize == 1

    def test_msize_custom(self):
        mod = _import_run_learn()
        parser = mod.create_parser()
        args = parser.parse_args(["--run-id", "abc", "--msize", "3"])
        assert args.msize == 3


# ---------------------------------------------------------------------------
# run_learn() — the main logic
# ---------------------------------------------------------------------------

class TestRunLearn:
    def _setup_run_dir(self, tmp_path, status_dict):
        """Create a run dir with status.json."""
        run_dir = tmp_path / "runs" / "test-run"
        run_dir.mkdir(parents=True)
        status_path = run_dir / "status.json"
        status_path.write_text(json.dumps(status_dict))
        return run_dir

    def test_loads_status_and_calls_run_learn_stage(self, tmp_path):
        """run_learn should load status, init PromptBuilder, call _run_learn_stage."""
        mod = _import_run_learn()

        status = {
            "work_request": {"title": "Add auth", "description": "Add user auth"},
            "stages": {"implement": {"status": "completed"}},
            "plan_file": None,
            "run_id": "test-run",
            "result": "success",
        }
        _run_dir = self._setup_run_dir(tmp_path, status)

        with patch.object(mod, "_run_learn_stage_standalone") as mock_learn:
            mock_learn.return_value = None
            mod.run_learn(
                run_id="test-run",
                status_dir=str(tmp_path),
                settings_path=str(tmp_path / "settings.json"),
                msize=1,
            )

        mock_learn.assert_called_once()
        call_kwargs = mock_learn.call_args
        # Check status was loaded
        assert call_kwargs[1]["status"]["work_request"]["title"] == "Add auth"
        # Check prompt_builder was created
        assert call_kwargs[1]["prompt_builder"] is not None

    def test_raises_on_missing_status(self, tmp_path):
        """run_learn should raise if status.json doesn't exist for run_id."""
        mod = _import_run_learn()

        with pytest.raises(FileNotFoundError):
            mod.run_learn(
                run_id="nonexistent",
                status_dir=str(tmp_path),
                settings_path=str(tmp_path / "settings.json"),
                msize=1,
            )

    def test_determines_termination_type_from_status(self, tmp_path):
        """run_learn should detect termination type from status result field."""
        mod = _import_run_learn()

        status = {
            "work_request": {"title": "Fix bug", "description": "Fix a bug"},
            "stages": {},
            "plan_file": None,
            "run_id": "test-run",
            "result": "failure",
            "error": "tests failed",
        }
        _run_dir = self._setup_run_dir(tmp_path, status)

        with patch.object(mod, "_run_learn_stage_standalone") as mock_learn:
            mock_learn.return_value = None
            mod.run_learn(
                run_id="test-run",
                status_dir=str(tmp_path),
                settings_path=str(tmp_path / "settings.json"),
                msize=1,
            )

        call_kwargs = mock_learn.call_args[1]
        assert call_kwargs["termination_type"] == "failure"
        assert call_kwargs["termination_reason"] == "tests failed"

    def test_success_termination_type(self, tmp_path):
        """When result is 'success', termination_type should be 'success'."""
        mod = _import_run_learn()

        status = {
            "work_request": {"title": "Add feature", "description": "New feature"},
            "stages": {},
            "plan_file": None,
            "run_id": "test-run",
            "result": "success",
        }
        _run_dir = self._setup_run_dir(tmp_path, status)

        with patch.object(mod, "_run_learn_stage_standalone") as mock_learn:
            mock_learn.return_value = None
            mod.run_learn(
                run_id="test-run",
                status_dir=str(tmp_path),
                settings_path=str(tmp_path / "settings.json"),
                msize=1,
            )

        call_kwargs = mock_learn.call_args[1]
        assert call_kwargs["termination_type"] == "success"


# ---------------------------------------------------------------------------
# _run_learn_stage_standalone — delegates to runner._run_learn_stage
# ---------------------------------------------------------------------------

class TestRunLearnStageStandalone:
    def test_calls_runner_run_learn_stage(self, tmp_path):
        """_run_learn_stage_standalone should call runner._run_learn_stage."""
        mod = _import_run_learn()

        status = {"stages": {}, "plan_file": None}
        pb = MagicMock()

        # Patch the imported reference on the module itself
        mock_rls = MagicMock()
        original = mod._run_learn_stage
        mod._run_learn_stage = mock_rls
        try:
            mod._run_learn_stage_standalone(
                status=status,
                prompt_builder=pb,
                settings_path=str(tmp_path / "settings.json"),
                run_dir=str(tmp_path),
                run_id="test-run",
                termination_type="success",
                termination_reason="",
                msize=1,
            )

            mock_rls.assert_called_once()
            call_kwargs = mock_rls.call_args
            # Verify positional args (status, pb, settings, run_dir, term_type, term_reason, msize, logs_dir)
            assert call_kwargs[0][0] is status
            assert call_kwargs[0][1] is pb
            assert call_kwargs[1]["force"] is True
            assert call_kwargs[1]["ctx"] is not None
        finally:
            mod._run_learn_stage = original

    def test_creates_logs_dir(self, tmp_path):
        """_run_learn_stage_standalone should create the logs directory."""
        mod = _import_run_learn()

        run_dir = tmp_path / "run"
        run_dir.mkdir()
        logs_dir = run_dir / "logs"

        status = {"stages": {}, "plan_file": None}
        pb = MagicMock()

        with patch.object(mod, "_run_learn_stage"):
            mod._run_learn_stage_standalone(
                status=status,
                prompt_builder=pb,
                settings_path=str(tmp_path / "settings.json"),
                run_dir=str(run_dir),
                run_id="test-run",
                termination_type="success",
                termination_reason="",
                msize=1,
            )

        assert logs_dir.is_dir()


# ---------------------------------------------------------------------------
# main() integration
# ---------------------------------------------------------------------------

class TestMain:
    def test_main_calls_run_learn(self, tmp_path):
        """main() should parse args and call run_learn."""
        mod = _import_run_learn()

        with patch.object(mod, "run_learn") as mock_rl:
            with patch("sys.argv", ["run_learn.py", "--run-id", "my-run",
                                     "--status-dir", str(tmp_path),
                                     "--settings", str(tmp_path / "s.json")]):
                mod.main()

        mock_rl.assert_called_once_with(
            run_id="my-run",
            status_dir=str(tmp_path),
            settings_path=str(tmp_path / "s.json"),
            msize=1,
        )
