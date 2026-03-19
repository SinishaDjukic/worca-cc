"""Tests for --skip-preflight flag (task worca-cc-4f6).

TDD: these tests were written before the implementation.
Covers:
  - CLI parser accepts --skip-preflight
  - skip_preflight is passed to run_pipeline()
  - In stage loop, when PREFLIGHT is current and skip_preflight=True,
    mark completed+skipped and advance without calling run_preflight()
"""

import json
import sys
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

# Make .claude/scripts importable for CLI tests
sys.path.insert(0, str(Path(__file__).parent.parent / ".claude" / "scripts"))
import run_pipeline as _run_pipeline_module


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_settings(tmp_path, preflight_enabled=True):
    """Minimal settings.json with preflight + plan stages enabled."""
    settings = {
        "worca": {
            "stages": {
                "preflight": {"enabled": preflight_enabled},
                "plan": {"enabled": False},
                "coordinate": {"enabled": False},
                "implement": {"enabled": False},
                "test": {"enabled": False},
                "review": {"enabled": False},
                "pr": {"enabled": False},
                "learn": {"enabled": False},
            },
            "agents": {},
            "loops": {},
        }
    }
    f = tmp_path / "settings.json"
    f.write_text(json.dumps(settings))
    return str(f)


def _make_fake_status():
    return {
        "stage": "",
        "stages": {},
        "started_at": "2026-01-01T00:00:00+00:00",
        "branch": "test-branch",
        "work_request": {"title": "Test"},
        "run_id": "20260101-000000",
        "milestones": {},
    }


# ---------------------------------------------------------------------------
# CLI parser
# ---------------------------------------------------------------------------

class TestSkipPreflightCLIParser:

    def test_parser_accepts_skip_preflight_flag(self):
        """create_parser() must accept --skip-preflight as a boolean flag."""
        parser = _run_pipeline_module.create_parser()
        args = parser.parse_args(["--prompt", "test", "--skip-preflight"])
        assert args.skip_preflight is True

    def test_skip_preflight_defaults_to_false(self):
        """--skip-preflight defaults to False when not provided."""
        parser = _run_pipeline_module.create_parser()
        args = parser.parse_args(["--prompt", "test"])
        assert args.skip_preflight is False


# ---------------------------------------------------------------------------
# run_pipeline() signature accepts skip_preflight
# ---------------------------------------------------------------------------

class TestRunPipelineSkipPreflightParam:

    def test_run_pipeline_accepts_skip_preflight_param(self, tmp_path):
        """run_pipeline() must accept a skip_preflight keyword argument."""
        from worca.orchestrator.runner import run_pipeline
        from worca.orchestrator.work_request import WorkRequest
        import inspect
        sig = inspect.signature(run_pipeline)
        assert "skip_preflight" in sig.parameters

    def test_run_pipeline_skip_preflight_defaults_false(self, tmp_path):
        """skip_preflight must default to False."""
        from worca.orchestrator.runner import run_pipeline
        import inspect
        sig = inspect.signature(run_pipeline)
        param = sig.parameters["skip_preflight"]
        assert param.default is False


# ---------------------------------------------------------------------------
# Stage loop: skip_preflight=True bypasses run_preflight()
# ---------------------------------------------------------------------------

class TestSkipPreflightInStageLoop:

    def test_run_preflight_not_called_when_skip_preflight_true(self, tmp_path):
        """When skip_preflight=True, run_preflight() must not be called."""
        from worca.orchestrator.runner import run_pipeline, PipelineError
        from worca.orchestrator.work_request import WorkRequest

        settings_path = _make_settings(tmp_path, preflight_enabled=True)
        wr = WorkRequest(title="Test", description="test", source_type="prompt")

        with ExitStack() as stack:
            stack.enter_context(patch("worca.orchestrator.runner._write_pid"))
            stack.enter_context(patch("worca.orchestrator.runner._remove_pid"))
            stack.enter_context(patch("worca.orchestrator.runner.create_branch"))
            stack.enter_context(patch("worca.orchestrator.runner.init_status",
                                      return_value=_make_fake_status()))
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
            stack.enter_context(patch("worca.orchestrator.runner._run_learn_stage"))
            mock_preflight = stack.enter_context(
                patch("worca.orchestrator.runner.run_preflight")
            )

            run_pipeline(
                wr,
                settings_path=settings_path,
                status_path=str(tmp_path / "status.json"),
                skip_preflight=True,
            )

        mock_preflight.assert_not_called()

    def test_preflight_stage_marked_skipped_when_skip_preflight_true(self, tmp_path):
        """When skipping, update_stage must be called with skipped=True."""
        from worca.orchestrator.runner import run_pipeline
        from worca.orchestrator.work_request import WorkRequest

        settings_path = _make_settings(tmp_path, preflight_enabled=True)
        wr = WorkRequest(title="Test", description="test", source_type="prompt")

        with ExitStack() as stack:
            stack.enter_context(patch("worca.orchestrator.runner._write_pid"))
            stack.enter_context(patch("worca.orchestrator.runner._remove_pid"))
            stack.enter_context(patch("worca.orchestrator.runner.create_branch"))
            stack.enter_context(patch("worca.orchestrator.runner.init_status",
                                      return_value=_make_fake_status()))
            stack.enter_context(patch("worca.orchestrator.runner.save_status"))
            stack.enter_context(patch("worca.orchestrator.runner.start_iteration",
                                      return_value={"number": 1}))
            stack.enter_context(patch("worca.orchestrator.runner.complete_iteration"))
            mock_update = stack.enter_context(
                patch("worca.orchestrator.runner.update_stage")
            )
            stack.enter_context(patch("worca.orchestrator.runner.gh_issue_start"))
            stack.enter_context(patch("worca.orchestrator.runner.gh_issue_complete"))
            stack.enter_context(patch("worca.orchestrator.runner._init_orchestrator_log"))
            stack.enter_context(patch("worca.orchestrator.runner._close_orchestrator_log"))
            stack.enter_context(patch("worca.orchestrator.runner._render_agent_templates"))
            stack.enter_context(patch("worca.orchestrator.runner._run_learn_stage"))
            stack.enter_context(patch("worca.orchestrator.runner.run_preflight"))

            run_pipeline(
                wr,
                settings_path=settings_path,
                status_path=str(tmp_path / "status.json"),
                skip_preflight=True,
            )

        # update_stage must have been called with skipped=True for preflight
        skipped_calls = [
            c for c in mock_update.call_args_list
            if c[0][1] == "preflight" and c[1].get("skipped") is True
        ]
        assert len(skipped_calls) > 0, (
            f"Expected update_stage('preflight', skipped=True). Calls: {mock_update.call_args_list}"
        )

    def test_skip_preflight_false_calls_run_preflight(self, tmp_path):
        """Control: when skip_preflight=False (default), run_preflight IS called."""
        from worca.orchestrator.runner import run_pipeline
        from worca.orchestrator.work_request import WorkRequest

        settings_path = _make_settings(tmp_path, preflight_enabled=True)
        wr = WorkRequest(title="Test", description="test", source_type="prompt")

        with ExitStack() as stack:
            stack.enter_context(patch("worca.orchestrator.runner._write_pid"))
            stack.enter_context(patch("worca.orchestrator.runner._remove_pid"))
            stack.enter_context(patch("worca.orchestrator.runner.create_branch"))
            stack.enter_context(patch("worca.orchestrator.runner.init_status",
                                      return_value=_make_fake_status()))
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
            stack.enter_context(patch("worca.orchestrator.runner._run_learn_stage"))
            mock_preflight = stack.enter_context(
                patch("worca.orchestrator.runner.run_preflight",
                      return_value={"status": "pass", "checks": [], "summary": "ok"})
            )

            run_pipeline(
                wr,
                settings_path=settings_path,
                status_path=str(tmp_path / "status.json"),
                skip_preflight=False,
            )

        mock_preflight.assert_called_once()

    def test_skip_preflight_logs_message(self, tmp_path):
        """When skipping, a log message should indicate preflight was skipped."""
        from worca.orchestrator.runner import run_pipeline
        from worca.orchestrator.work_request import WorkRequest

        settings_path = _make_settings(tmp_path, preflight_enabled=True)
        wr = WorkRequest(title="Test", description="test", source_type="prompt")

        with ExitStack() as stack:
            stack.enter_context(patch("worca.orchestrator.runner._write_pid"))
            stack.enter_context(patch("worca.orchestrator.runner._remove_pid"))
            stack.enter_context(patch("worca.orchestrator.runner.create_branch"))
            stack.enter_context(patch("worca.orchestrator.runner.init_status",
                                      return_value=_make_fake_status()))
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
            stack.enter_context(patch("worca.orchestrator.runner._run_learn_stage"))
            stack.enter_context(patch("worca.orchestrator.runner.run_preflight"))
            mock_log = stack.enter_context(patch("worca.orchestrator.runner._log"))

            run_pipeline(
                wr,
                settings_path=settings_path,
                status_path=str(tmp_path / "status.json"),
                skip_preflight=True,
            )

        logged = [str(c[0][0]) for c in mock_log.call_args_list]
        assert any("skip" in m.lower() and "preflight" in m.lower() for m in logged), (
            f"Expected a log message about skipping preflight. Got: {logged}"
        )


# ---------------------------------------------------------------------------
# CLI passes skip_preflight to run_pipeline
# ---------------------------------------------------------------------------

class TestCLIPassesSkipPreflight:

    def test_main_passes_skip_preflight_to_run_pipeline(self, tmp_path, monkeypatch):
        """When --skip-preflight is given, main() passes skip_preflight=True to run_pipeline."""
        import sys
        monkeypatch.setattr(sys, "argv", [
            "run_pipeline.py",
            "--prompt", "test prompt",
            "--skip-preflight",
            "--status-dir", str(tmp_path),
            "--settings", str(tmp_path / "settings.json"),
        ])
        # Write a minimal settings file so it doesn't fail reading
        (tmp_path / "settings.json").write_text(json.dumps({"worca": {}}))

        with patch.object(_run_pipeline_module, "run_pipeline", return_value={"status": "done"}) as mock_rp, \
             patch.object(_run_pipeline_module, "normalize") as mock_norm:
            from worca.orchestrator.work_request import WorkRequest
            mock_norm.return_value = WorkRequest(
                title="test prompt", description="test prompt", source_type="prompt"
            )
            _run_pipeline_module.main()

        call_kwargs = mock_rp.call_args[1]
        assert call_kwargs.get("skip_preflight") is True
