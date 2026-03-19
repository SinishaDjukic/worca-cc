"""Tests for run_preflight() in worca.orchestrator.runner.

TDD: these tests were written before the implementation.
"""

import json
import sys
from contextlib import ExitStack
from unittest.mock import patch, MagicMock

import pytest

from worca.orchestrator.runner import PipelineError


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _settings_file(tmp_path, script_path=None):
    """Write a minimal settings.json. If script_path given, sets preflight.script."""
    settings = {"worca": {"stages": {}}}
    if script_path is not None:
        settings["worca"]["stages"]["preflight"] = {"script": script_path}
    f = tmp_path / "settings.json"
    f.write_text(json.dumps(settings))
    return str(f)


def _script(tmp_path, result_dict, exit_code=0, name="preflight.py"):
    """Write a Python script that prints JSON and exits with given code."""
    script = tmp_path / name
    script.write_text(
        f"import json, sys\n"
        f"print(json.dumps({result_dict!r}))\n"
        f"sys.exit({exit_code})\n"
    )
    return str(script)


# ---------------------------------------------------------------------------
# Script missing → skipped
# ---------------------------------------------------------------------------

class TestRunPreflightScriptMissing:

    def test_returns_skipped_status_when_script_not_found(self, tmp_path):
        from worca.orchestrator.runner import run_preflight
        missing = str(tmp_path / "no_such_file.py")
        settings_path = _settings_file(tmp_path, script_path=missing)
        context = {"_logs_dir": str(tmp_path / "logs")}

        result = run_preflight(context, settings_path)

        assert result["status"] == "skipped"

    def test_returns_empty_checks_when_skipped(self, tmp_path):
        from worca.orchestrator.runner import run_preflight
        settings_path = _settings_file(tmp_path, script_path=str(tmp_path / "missing.py"))
        context = {"_logs_dir": str(tmp_path / "logs")}

        result = run_preflight(context, settings_path)

        assert result["checks"] == []

    def test_logs_warn_when_script_missing(self, tmp_path):
        from worca.orchestrator.runner import run_preflight
        settings_path = _settings_file(tmp_path, script_path=str(tmp_path / "missing.py"))
        context = {"_logs_dir": str(tmp_path / "logs")}

        with patch("worca.orchestrator.runner._log") as mock_log:
            run_preflight(context, settings_path)

        warn_calls = [
            c for c in mock_log.call_args_list
            if len(c[0]) > 1 and c[0][1] == "warn"
        ]
        assert len(warn_calls) > 0

    def test_default_script_path_contains_preflight_checks(self, tmp_path):
        """When no script in settings, falls back to .claude/scripts/preflight_checks.py."""
        from worca.orchestrator.runner import run_preflight
        # Settings with no preflight section
        settings_path = _settings_file(tmp_path)
        context = {"_logs_dir": str(tmp_path / "logs")}

        with patch("os.path.exists", return_value=False) as mock_exists:
            run_preflight(context, settings_path)

        checked = [str(c[0][0]) for c in mock_exists.call_args_list]
        assert any("preflight_checks" in p for p in checked)

    def test_default_script_path_skips_gracefully(self, tmp_path):
        """Falls back to default script path and returns skipped when missing."""
        from worca.orchestrator.runner import run_preflight
        settings_path = _settings_file(tmp_path)
        context = {"_logs_dir": str(tmp_path / "logs")}

        with patch("os.path.exists", return_value=False):
            result = run_preflight(context, settings_path)

        assert result["status"] == "skipped"


# ---------------------------------------------------------------------------
# Script exists, exits 0 → returns parsed JSON
# ---------------------------------------------------------------------------

class TestRunPreflightSuccess:

    def test_returns_parsed_json_on_success(self, tmp_path):
        from worca.orchestrator.runner import run_preflight
        expected = {"status": "pass", "checks": [], "summary": "all good"}
        script_path = _script(tmp_path, expected, exit_code=0)
        settings_path = _settings_file(tmp_path, script_path=script_path)
        context = {"_logs_dir": str(tmp_path / "logs")}

        result = run_preflight(context, settings_path)

        assert result == expected

    def test_reads_script_path_from_settings(self, tmp_path):
        from worca.orchestrator.runner import run_preflight
        result_data = {"status": "pass", "checks": [], "summary": "custom script ran"}
        custom_script = tmp_path / "my_checks.py"
        custom_script.write_text(
            f"import json; print(json.dumps({result_data!r}))"
        )
        settings_path = _settings_file(tmp_path, script_path=str(custom_script))
        context = {"_logs_dir": str(tmp_path / "logs")}

        result = run_preflight(context, settings_path)

        assert result["summary"] == "custom script ran"

    def test_writes_stdout_to_log_file(self, tmp_path):
        from worca.orchestrator.runner import run_preflight
        result_data = {"status": "pass", "checks": [], "summary": "ok"}
        script_path = _script(tmp_path, result_data)
        settings_path = _settings_file(tmp_path, script_path=script_path)
        logs_dir = tmp_path / "logs"
        context = {"_logs_dir": str(logs_dir)}

        run_preflight(context, settings_path, iteration=1)

        log_file = logs_dir / "preflight" / "iter-1.log"
        assert log_file.exists()
        assert "pass" in log_file.read_text()

    def test_log_filename_uses_iteration(self, tmp_path):
        from worca.orchestrator.runner import run_preflight
        result_data = {"status": "pass", "checks": [], "summary": "ok"}
        script_path = _script(tmp_path, result_data)
        settings_path = _settings_file(tmp_path, script_path=script_path)
        logs_dir = tmp_path / "logs"
        context = {"_logs_dir": str(logs_dir)}

        run_preflight(context, settings_path, iteration=7)

        assert (logs_dir / "preflight" / "iter-7.log").exists()

    def test_default_iteration_is_1(self, tmp_path):
        from worca.orchestrator.runner import run_preflight
        result_data = {"status": "pass", "checks": [], "summary": "ok"}
        script_path = _script(tmp_path, result_data)
        settings_path = _settings_file(tmp_path, script_path=script_path)
        logs_dir = tmp_path / "logs"
        context = {"_logs_dir": str(logs_dir)}

        run_preflight(context, settings_path)

        assert (logs_dir / "preflight" / "iter-1.log").exists()

    def test_uses_logs_dir_from_context(self, tmp_path):
        from worca.orchestrator.runner import run_preflight
        result_data = {"status": "pass", "checks": [], "summary": "ok"}
        script_path = _script(tmp_path, result_data)
        settings_path = _settings_file(tmp_path, script_path=script_path)
        custom_logs = tmp_path / "custom"
        context = {"_logs_dir": str(custom_logs)}

        run_preflight(context, settings_path)

        assert (custom_logs / "preflight" / "iter-1.log").exists()

    def test_uses_sys_executable_for_subprocess(self, tmp_path):
        from worca.orchestrator.runner import run_preflight
        result_data = {"status": "pass", "checks": [], "summary": "ok"}
        script_path = _script(tmp_path, result_data)
        settings_path = _settings_file(tmp_path, script_path=script_path)
        context = {"_logs_dir": str(tmp_path / "logs")}

        with patch("subprocess.Popen") as mock_popen:
            mock_proc = MagicMock()
            mock_proc.communicate.return_value = (json.dumps(result_data), "")
            mock_proc.returncode = 0
            mock_popen.return_value = mock_proc

            run_preflight(context, settings_path)

        cmd = mock_popen.call_args[0][0]
        assert cmd[0] == sys.executable
        assert cmd[1] == script_path


# ---------------------------------------------------------------------------
# Logging of check results
# ---------------------------------------------------------------------------

class TestRunPreflightLogging:

    def test_logs_each_check_name(self, tmp_path):
        from worca.orchestrator.runner import run_preflight
        checks = [
            {"name": "claude_cli", "status": "pass", "message": "claude 1.0"},
            {"name": "git_repo", "status": "pass", "message": "in repo"},
        ]
        result_data = {"status": "pass", "checks": checks, "summary": "2/2"}
        script_path = _script(tmp_path, result_data)
        settings_path = _settings_file(tmp_path, script_path=script_path)
        context = {"_logs_dir": str(tmp_path / "logs")}

        with patch("worca.orchestrator.runner._log") as mock_log:
            run_preflight(context, settings_path)

        logged = [str(c[0][0]) for c in mock_log.call_args_list]
        assert any("claude_cli" in m for m in logged)
        assert any("git_repo" in m for m in logged)

    def test_pass_check_uses_ok_level(self, tmp_path):
        from worca.orchestrator.runner import run_preflight
        checks = [{"name": "claude_cli", "status": "pass", "message": "ok"}]
        result_data = {"status": "pass", "checks": checks, "summary": "1/1"}
        script_path = _script(tmp_path, result_data)
        settings_path = _settings_file(tmp_path, script_path=script_path)
        context = {"_logs_dir": str(tmp_path / "logs")}

        with patch("worca.orchestrator.runner._log") as mock_log:
            run_preflight(context, settings_path)

        ok_calls = [
            c for c in mock_log.call_args_list
            if len(c[0]) > 1 and c[0][1] == "ok" and "claude_cli" in str(c[0][0])
        ]
        assert len(ok_calls) > 0

    def test_fail_check_uses_err_level(self, tmp_path):
        from worca.orchestrator.runner import run_preflight
        checks = [{"name": "bd_cli", "status": "fail", "message": "not found"}]
        result_data = {"status": "fail", "checks": checks, "summary": "1 failed"}
        script_path = _script(tmp_path, result_data, exit_code=1)
        settings_path = _settings_file(tmp_path, script_path=script_path)
        context = {"_logs_dir": str(tmp_path / "logs")}

        with patch("worca.orchestrator.runner._log") as mock_log:
            with pytest.raises(PipelineError):
                run_preflight(context, settings_path)

        err_calls = [
            c for c in mock_log.call_args_list
            if len(c[0]) > 1 and c[0][1] == "err" and "bd_cli" in str(c[0][0])
        ]
        assert len(err_calls) > 0

    def test_warn_check_uses_warn_level(self, tmp_path):
        from worca.orchestrator.runner import run_preflight
        checks = [{"name": "gh_cli", "status": "warn", "message": "optional"}]
        result_data = {"status": "pass", "checks": checks, "summary": "1/1"}
        script_path = _script(tmp_path, result_data, exit_code=0)
        settings_path = _settings_file(tmp_path, script_path=script_path)
        context = {"_logs_dir": str(tmp_path / "logs")}

        with patch("worca.orchestrator.runner._log") as mock_log:
            run_preflight(context, settings_path)

        warn_calls = [
            c for c in mock_log.call_args_list
            if len(c[0]) > 1 and c[0][1] == "warn" and "gh_cli" in str(c[0][0])
        ]
        assert len(warn_calls) > 0

    def test_logs_summary(self, tmp_path):
        from worca.orchestrator.runner import run_preflight
        result_data = {"status": "pass", "checks": [], "summary": "10/10 passed, 0 failed"}
        script_path = _script(tmp_path, result_data)
        settings_path = _settings_file(tmp_path, script_path=script_path)
        context = {"_logs_dir": str(tmp_path / "logs")}

        with patch("worca.orchestrator.runner._log") as mock_log:
            run_preflight(context, settings_path)

        logged = [str(c[0][0]) for c in mock_log.call_args_list]
        assert any("10/10" in m for m in logged)


# ---------------------------------------------------------------------------
# Script exits non-zero → PipelineError
# ---------------------------------------------------------------------------

class TestRunPreflightFailure:

    def test_raises_pipeline_error_on_nonzero_exit(self, tmp_path):
        from worca.orchestrator.runner import run_preflight
        result_data = {"status": "fail", "checks": [], "summary": "claude not found"}
        script_path = _script(tmp_path, result_data, exit_code=1)
        settings_path = _settings_file(tmp_path, script_path=script_path)
        context = {"_logs_dir": str(tmp_path / "logs")}

        with pytest.raises(PipelineError):
            run_preflight(context, settings_path)

    def test_error_message_includes_summary(self, tmp_path):
        from worca.orchestrator.runner import run_preflight
        result_data = {"status": "fail", "checks": [], "summary": "2 checks failed"}
        script_path = _script(tmp_path, result_data, exit_code=1)
        settings_path = _settings_file(tmp_path, script_path=script_path)
        context = {"_logs_dir": str(tmp_path / "logs")}

        with pytest.raises(PipelineError, match="2 checks failed"):
            run_preflight(context, settings_path)

    def test_log_file_written_even_on_failure(self, tmp_path):
        from worca.orchestrator.runner import run_preflight
        result_data = {"status": "fail", "checks": [], "summary": "failed"}
        script_path = _script(tmp_path, result_data, exit_code=1)
        settings_path = _settings_file(tmp_path, script_path=script_path)
        logs_dir = tmp_path / "logs"
        context = {"_logs_dir": str(logs_dir)}

        with pytest.raises(PipelineError):
            run_preflight(context, settings_path)

        assert (logs_dir / "preflight" / "iter-1.log").exists()

    def test_raises_pipeline_error_on_non_json_output(self, tmp_path):
        from worca.orchestrator.runner import run_preflight
        script = tmp_path / "bad.py"
        script.write_text("print('not json')")
        settings_path = _settings_file(tmp_path, script_path=str(script))
        context = {"_logs_dir": str(tmp_path / "logs")}

        with pytest.raises(PipelineError):
            run_preflight(context, settings_path)


# ---------------------------------------------------------------------------
# LEARN stage skipped when preflight fails
# ---------------------------------------------------------------------------

class TestLearnSkippedOnPreflightFailure:
    """When PipelineError is raised during PREFLIGHT, _run_learn_stage is not called."""

    def _make_settings(self, tmp_path):
        """Settings with only PREFLIGHT enabled, LEARN enabled."""
        settings = {
            "worca": {
                "stages": {
                    "preflight": {
                        "enabled": True,
                        "script": ".claude/scripts/preflight_checks.py",
                    },
                    "plan": {"enabled": False},
                    "coordinate": {"enabled": False},
                    "implement": {"enabled": False},
                    "test": {"enabled": False},
                    "review": {"enabled": False},
                    "pr": {"enabled": False},
                    "learn": {"enabled": True},
                },
                "agents": {},
                "loops": {},
            }
        }
        f = tmp_path / "settings.json"
        f.write_text(json.dumps(settings))
        return str(f)

    def _make_fake_status(self):
        return {
            "stage": "",
            "stages": {},
            "started_at": "2026-01-01T00:00:00+00:00",
            "branch": "test-branch",
            "work_request": {"title": "Test"},
            "run_id": "20260101-000000",
            "milestones": {},
        }

    def test_learn_not_called_when_preflight_raises_pipeline_error(self, tmp_path):
        from worca.orchestrator.runner import run_pipeline
        from worca.orchestrator.work_request import WorkRequest

        settings_path = self._make_settings(tmp_path)
        wr = WorkRequest(title="Test", description="test desc", source_type="prompt")

        with ExitStack() as stack:
            stack.enter_context(patch("worca.orchestrator.runner._write_pid"))
            stack.enter_context(patch("worca.orchestrator.runner._remove_pid"))
            stack.enter_context(patch("worca.orchestrator.runner.create_branch"))
            stack.enter_context(patch("worca.orchestrator.runner.init_status",
                                      return_value=self._make_fake_status()))
            stack.enter_context(patch("worca.orchestrator.runner.save_status"))
            stack.enter_context(patch("worca.orchestrator.runner.start_iteration",
                                      return_value={"number": 1}))
            stack.enter_context(patch("worca.orchestrator.runner.complete_iteration"))
            stack.enter_context(patch("worca.orchestrator.runner.update_stage"))
            stack.enter_context(patch("worca.orchestrator.runner.gh_issue_start"))
            stack.enter_context(patch("worca.orchestrator.runner.gh_issue_complete"))
            stack.enter_context(patch("worca.orchestrator.runner._init_orchestrator_log"))
            stack.enter_context(patch("worca.orchestrator.runner._close_orchestrator_log"))
            stack.enter_context(patch("worca.orchestrator.runner._render_agent_templates"))
            stack.enter_context(patch("worca.orchestrator.runner.run_preflight",
                                      side_effect=PipelineError("preflight: claude not found")))
            mock_learn = stack.enter_context(
                patch("worca.orchestrator.runner._run_learn_stage")
            )

            with pytest.raises(PipelineError):
                run_pipeline(
                    wr,
                    settings_path=settings_path,
                    status_path=str(tmp_path / "status.json"),
                )

        mock_learn.assert_not_called()

    def test_learn_called_when_other_stage_fails(self, tmp_path):
        """Control: LEARN IS called when a non-preflight stage fails."""
        from worca.orchestrator.runner import run_pipeline
        from worca.orchestrator.work_request import WorkRequest

        # Enable PLAN (not PREFLIGHT) so we can test non-preflight failure
        settings = {
            "worca": {
                "stages": {
                    "preflight": {"enabled": False},
                    "plan": {"enabled": True},
                    "coordinate": {"enabled": False},
                    "implement": {"enabled": False},
                    "test": {"enabled": False},
                    "review": {"enabled": False},
                    "pr": {"enabled": False},
                    "learn": {"enabled": True},
                },
                "agents": {"planner": {"model": "sonnet", "max_turns": 30}},
                "loops": {},
            }
        }
        sf = tmp_path / "settings.json"
        sf.write_text(json.dumps(settings))
        wr = WorkRequest(title="Test", description="test", source_type="prompt")

        with ExitStack() as stack:
            stack.enter_context(patch("worca.orchestrator.runner._write_pid"))
            stack.enter_context(patch("worca.orchestrator.runner._remove_pid"))
            stack.enter_context(patch("worca.orchestrator.runner.create_branch"))
            stack.enter_context(patch("worca.orchestrator.runner.init_status",
                                      return_value=self._make_fake_status()))
            stack.enter_context(patch("worca.orchestrator.runner.save_status"))
            stack.enter_context(patch("worca.orchestrator.runner.start_iteration",
                                      return_value={"number": 1}))
            stack.enter_context(patch("worca.orchestrator.runner.complete_iteration"))
            stack.enter_context(patch("worca.orchestrator.runner.update_stage"))
            stack.enter_context(patch("worca.orchestrator.runner.gh_issue_start"))
            stack.enter_context(patch("worca.orchestrator.runner.gh_issue_complete"))
            stack.enter_context(patch("worca.orchestrator.runner._init_orchestrator_log"))
            stack.enter_context(patch("worca.orchestrator.runner._close_orchestrator_log"))
            stack.enter_context(patch("worca.orchestrator.runner._render_agent_templates"))
            # run_stage raises PipelineError for PLAN stage
            stack.enter_context(patch("worca.orchestrator.runner.run_stage",
                                      side_effect=PipelineError("plan agent failed")))
            mock_learn = stack.enter_context(
                patch("worca.orchestrator.runner._run_learn_stage")
            )

            with pytest.raises(PipelineError):
                run_pipeline(
                    wr,
                    settings_path=str(sf),
                    status_path=str(tmp_path / "status.json"),
                )

        # For non-preflight failure, LEARN should be called
        mock_learn.assert_called_once()
