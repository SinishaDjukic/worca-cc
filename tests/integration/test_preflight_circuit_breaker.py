"""Integration tests for preflight stage and circuit breaker.

Tests the components working together with real scripts, real state functions,
and real settings files — minimal mocking.

Scenarios:
- Preflight pass (real script) → pipeline can advance to PLAN
- Preflight fail (real script) → raises PipelineError, LEARN is skipped
- --skip-preflight → run_preflight not called, stage marked skipped
- Resume → find_resume_point always returns PREFLIGHT
- Circuit breaker trips after consecutive failure threshold
- Transient retry with backoff delay
"""

import json
from unittest.mock import patch

import pytest

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_settings(tmp_path, cb_enabled=True, max_consecutive=3,
                   backoff=None, preflight_enabled=True, plan_enabled=False):
    backoff = backoff or [0.001, 0.002, 0.003]  # very short for tests
    settings = {
        "worca": {
            "stages": {
                "preflight": {"enabled": preflight_enabled},
                "plan": {"enabled": plan_enabled},
                "coordinate": {"enabled": False},
                "implement": {"enabled": False},
                "test": {"enabled": False},
                "review": {"enabled": False},
                "pr": {"enabled": False},
                "learn": {"enabled": False},
            },
            "agents": {
                "planner": {"model": "sonnet", "max_turns": 30},
            },
            "loops": {},
            "circuit_breaker": {
                "enabled": cb_enabled,
                "max_consecutive_failures": max_consecutive,
                "transient_retry_count": len(backoff),
                "transient_retry_backoff_seconds": backoff,
                "classifier_model": "haiku",
            },
        }
    }
    p = tmp_path / "settings.json"
    p.write_text(json.dumps(settings))
    return str(p)


def _make_script(tmp_path, result_dict, exit_code=0, name="check.py"):
    script = tmp_path / name
    script.write_text(
        f"import json, sys\n"
        f"print(json.dumps({result_dict!r}))\n"
        f"sys.exit({exit_code})\n"
    )
    return str(script)


# ---------------------------------------------------------------------------
# Preflight pass: real script, real run_preflight()
# ---------------------------------------------------------------------------

class TestPreflightPassIntegration:
    """run_preflight() with a real passing script."""

    def test_pass_script_returns_status_pass(self, tmp_path):
        from worca.orchestrator.runner import run_preflight

        result_data = {
            "status": "pass",
            "checks": [
                {"name": "claude_cli", "status": "pass", "message": "claude 1.0.40"},
                {"name": "git_repo", "status": "pass", "message": "inside git repo"},
                {"name": "bd_cli", "status": "pass", "message": "bd found"},
            ],
            "summary": "3/3 checks passed, 0 failed",
        }
        script_path = _make_script(tmp_path, result_data, exit_code=0)
        settings = {"worca": {"stages": {"preflight": {"script": script_path}}}}
        sf = tmp_path / "settings.json"
        sf.write_text(json.dumps(settings))
        context = {"_logs_dir": str(tmp_path / "logs")}

        result = run_preflight(context, str(sf))

        assert result["status"] == "pass"
        assert len(result["checks"]) == 3

    def test_pass_script_creates_log_file(self, tmp_path):
        from worca.orchestrator.runner import run_preflight

        result_data = {"status": "pass", "checks": [], "summary": "ok"}
        script_path = _make_script(tmp_path, result_data, exit_code=0)
        settings = {"worca": {"stages": {"preflight": {"script": script_path}}}}
        sf = tmp_path / "settings.json"
        sf.write_text(json.dumps(settings))
        logs_dir = tmp_path / "logs"
        context = {"_logs_dir": str(logs_dir)}

        run_preflight(context, str(sf), iteration=1)

        assert (logs_dir / "preflight" / "iter-1.log").exists()

    def test_pass_with_warnings_does_not_raise(self, tmp_path):
        """Warn-level checks do not cause failure (exit 0 with warnings)."""
        from worca.orchestrator.runner import run_preflight

        result_data = {
            "status": "pass",
            "checks": [
                {"name": "claude_cli", "status": "pass", "message": "ok"},
                {"name": "gh_cli", "status": "warn", "message": "gh not found (optional)"},
                {"name": "pytest", "status": "warn", "message": "pytest not found (optional)"},
            ],
            "summary": "1/3 required passed, 2 warnings",
        }
        script_path = _make_script(tmp_path, result_data, exit_code=0)
        settings = {"worca": {"stages": {"preflight": {"script": script_path}}}}
        sf = tmp_path / "settings.json"
        sf.write_text(json.dumps(settings))
        context = {"_logs_dir": str(tmp_path / "logs")}

        # Should not raise
        result = run_preflight(context, str(sf))
        assert result["status"] == "pass"

    def test_pass_with_multiple_iterations(self, tmp_path):
        """Each call creates a distinct iteration log file."""
        from worca.orchestrator.runner import run_preflight

        result_data = {"status": "pass", "checks": [], "summary": "ok"}
        script_path = _make_script(tmp_path, result_data, exit_code=0)
        settings = {"worca": {"stages": {"preflight": {"script": script_path}}}}
        sf = tmp_path / "settings.json"
        sf.write_text(json.dumps(settings))
        logs_dir = tmp_path / "logs"
        context = {"_logs_dir": str(logs_dir)}

        run_preflight(context, str(sf), iteration=1)
        run_preflight(context, str(sf), iteration=2)
        run_preflight(context, str(sf), iteration=3)

        assert (logs_dir / "preflight" / "iter-1.log").exists()
        assert (logs_dir / "preflight" / "iter-2.log").exists()
        assert (logs_dir / "preflight" / "iter-3.log").exists()


# ---------------------------------------------------------------------------
# Preflight fail: real script raises PipelineError
# ---------------------------------------------------------------------------

class TestPreflightFailIntegration:
    """run_preflight() with a real failing script."""

    def test_fail_script_raises_pipeline_error(self, tmp_path):
        from worca.orchestrator.runner import run_preflight, PipelineError

        result_data = {
            "status": "fail",
            "checks": [
                {"name": "claude_cli", "status": "fail", "message": "claude: command not found"},
                {"name": "git_repo", "status": "pass", "message": "inside git repo"},
            ],
            "summary": "1/2 checks failed",
        }
        script_path = _make_script(tmp_path, result_data, exit_code=1)
        settings = {"worca": {"stages": {"preflight": {"script": script_path}}}}
        sf = tmp_path / "settings.json"
        sf.write_text(json.dumps(settings))
        context = {"_logs_dir": str(tmp_path / "logs")}

        with pytest.raises(PipelineError, match="1/2 checks failed"):
            run_preflight(context, str(sf))

    def test_fail_script_still_writes_log(self, tmp_path):
        """Even on failure, the log file is written for post-mortem."""
        from worca.orchestrator.runner import run_preflight, PipelineError

        result_data = {
            "status": "fail",
            "checks": [{"name": "bd_cli", "status": "fail", "message": "bd not found"}],
            "summary": "1 check failed",
        }
        script_path = _make_script(tmp_path, result_data, exit_code=1)
        settings = {"worca": {"stages": {"preflight": {"script": script_path}}}}
        sf = tmp_path / "settings.json"
        sf.write_text(json.dumps(settings))
        logs_dir = tmp_path / "logs"
        context = {"_logs_dir": str(logs_dir)}

        with pytest.raises(PipelineError):
            run_preflight(context, str(sf), iteration=1)

        log_file = logs_dir / "preflight" / "iter-1.log"
        assert log_file.exists()
        assert "bd_cli" in log_file.read_text()

    def test_fail_script_missing_raises_gracefully(self, tmp_path):
        """Missing script returns skipped status (does not raise)."""
        from worca.orchestrator.runner import run_preflight

        settings = {"worca": {"stages": {"preflight": {"script": str(tmp_path / "missing.py")}}}}
        sf = tmp_path / "settings.json"
        sf.write_text(json.dumps(settings))
        context = {"_logs_dir": str(tmp_path / "logs")}

        result = run_preflight(context, str(sf))
        assert result["status"] == "skipped"


# ---------------------------------------------------------------------------
# Resume always re-runs PREFLIGHT
# ---------------------------------------------------------------------------

class TestResumeRerunsPreflight:
    """find_resume_point() always returns Stage.PREFLIGHT on resume."""

    def test_preflight_completed_still_returns_preflight(self):
        from worca.orchestrator.resume import find_resume_point
        from worca.orchestrator.stages import Stage

        status = {
            "stages": {
                "preflight": {"status": "completed"},
                "plan": {"status": "completed"},
                "coordinate": {"status": "in_progress"},
                "implement": {"status": "pending"},
                "test": {"status": "pending"},
                "review": {"status": "pending"},
                "pr": {"status": "pending"},
            },
            "milestones": {"plan_approved": True},
        }
        assert find_resume_point(status) == Stage.PREFLIGHT

    def test_preflight_skipped_still_returns_preflight(self):
        """Skipped preflight (--skip-preflight) still re-runs on resume."""
        from worca.orchestrator.resume import find_resume_point
        from worca.orchestrator.stages import Stage

        status = {
            "stages": {
                "preflight": {"status": "completed", "skipped": True},
                "plan": {"status": "in_progress"},
                "coordinate": {"status": "pending"},
                "implement": {"status": "pending"},
                "test": {"status": "pending"},
                "review": {"status": "pending"},
                "pr": {"status": "pending"},
            },
            "milestones": {},
        }
        assert find_resume_point(status) == Stage.PREFLIGHT

    def test_mid_pipeline_resume_returns_preflight(self):
        """Resuming mid-pipeline always starts at PREFLIGHT."""
        from worca.orchestrator.resume import find_resume_point
        from worca.orchestrator.stages import Stage

        status = {
            "stages": {
                "preflight": {"status": "completed"},
                "plan": {"status": "completed"},
                "coordinate": {"status": "completed"},
                "implement": {"status": "in_progress"},
                "test": {"status": "pending"},
                "review": {"status": "pending"},
                "pr": {"status": "pending"},
            },
            "milestones": {"plan_approved": True},
        }
        assert find_resume_point(status) == Stage.PREFLIGHT

    def test_circuit_breaker_state_preserved_on_resume(self):
        """CB state in status dict persists across resume (not cleared)."""
        from worca.orchestrator.error_classifier import get_circuit_breaker_state

        status = {
            "stages": {"plan": {"status": "in_progress"}},
            "milestones": {},
            "circuit_breaker": {
                "consecutive_failures": 2,
                "failure_history": [
                    {"stage": "plan", "error": "api error", "classification": {"category": "infra_transient"}},
                    {"stage": "plan", "error": "api error again", "classification": {"category": "infra_transient"}},
                ],
                "tripped": False,
            },
        }
        # The CB state is preserved — consecutive_failures still 2
        cb = get_circuit_breaker_state(status)
        assert cb["consecutive_failures"] == 2
        assert len(cb["failure_history"]) == 2


# ---------------------------------------------------------------------------
# Circuit breaker state accumulation (real functions, real settings)
# ---------------------------------------------------------------------------

class TestCircuitBreakerStateIntegration:
    """Test record_failure / record_success / should_halt with real settings."""

    def test_consecutive_failures_increment(self, tmp_path):
        from worca.orchestrator.error_classifier import (
            record_failure, get_circuit_breaker_state
        )
        _settings_path = _make_settings(tmp_path, max_consecutive=3)
        status = {}
        classification = {"category": "infra_transient", "retriable": True,
                          "remediation": "wait", "similar_to_previous": False}

        record_failure(status, "plan", "error 1", classification)
        record_failure(status, "plan", "error 2", classification)
        record_failure(status, "plan", "error 3", classification)

        cb = get_circuit_breaker_state(status)
        assert cb["consecutive_failures"] == 3
        assert len(cb["failure_history"]) == 3

    def test_record_success_resets_counter(self, tmp_path):
        from worca.orchestrator.error_classifier import (
            record_failure, record_success, get_circuit_breaker_state
        )
        status = {}
        classification = {"category": "infra_transient", "retriable": True,
                          "remediation": "wait", "similar_to_previous": False}

        record_failure(status, "plan", "err", classification)
        record_failure(status, "plan", "err", classification)
        record_success(status)

        cb = get_circuit_breaker_state(status)
        assert cb["consecutive_failures"] == 0
        # History is preserved even after success
        assert len(cb["failure_history"]) == 2

    def test_should_halt_after_threshold(self, tmp_path):
        """Circuit breaker halts when consecutive failures reach threshold."""
        from worca.orchestrator.error_classifier import (
            record_failure, should_halt
        )
        settings_path = _make_settings(tmp_path, max_consecutive=3)
        status = {}
        classification = {"category": "infra_transient", "retriable": True,
                          "remediation": "wait", "similar_to_previous": False}

        record_failure(status, "plan", "err 1", classification)
        record_failure(status, "plan", "err 2", classification)
        record_failure(status, "plan", "err 3", classification)

        halt, reason = should_halt(status, classification, settings_path)
        assert halt is True
        assert "3" in reason  # consecutive count in reason

    def test_should_not_halt_below_threshold(self, tmp_path):
        """No halt when consecutive failures are below threshold."""
        from worca.orchestrator.error_classifier import (
            record_failure, should_halt
        )
        settings_path = _make_settings(tmp_path, max_consecutive=3)
        status = {}
        classification = {"category": "infra_transient", "retriable": True,
                          "remediation": "wait", "similar_to_previous": False}

        record_failure(status, "plan", "err 1", classification)
        record_failure(status, "plan", "err 2", classification)
        # Only 2 failures, threshold is 3

        halt, _ = should_halt(status, classification, settings_path)
        assert halt is False

    def test_permanent_error_halts_immediately(self, tmp_path):
        """infra_permanent category halts immediately (no threshold check)."""
        from worca.orchestrator.error_classifier import should_halt
        settings_path = _make_settings(tmp_path, max_consecutive=10)
        status = {}
        classification = {"category": "infra_permanent", "retriable": False,
                          "remediation": "fix auth", "similar_to_previous": False}

        halt, reason = should_halt(status, classification, settings_path)
        assert halt is True
        assert "infra_permanent" in reason

    def test_env_missing_halts_immediately(self, tmp_path):
        """env_missing category halts immediately."""
        from worca.orchestrator.error_classifier import should_halt
        settings_path = _make_settings(tmp_path)
        status = {}
        classification = {"category": "env_missing", "retriable": False,
                          "remediation": "install bd", "similar_to_previous": False}

        halt, reason = should_halt(status, classification, settings_path)
        assert halt is True
        assert "env_missing" in reason

    def test_logic_stuck_halts_immediately(self, tmp_path):
        """logic_stuck category halts immediately."""
        from worca.orchestrator.error_classifier import should_halt
        settings_path = _make_settings(tmp_path)
        status = {}
        classification = {"category": "logic_stuck", "retriable": False,
                          "remediation": "check agent prompt", "similar_to_previous": True}

        halt, reason = should_halt(status, classification, settings_path)
        assert halt is True
        assert "logic_stuck" in reason

    def test_failure_history_capped_at_20(self, tmp_path):
        """Failure history does not grow beyond 20 entries."""
        from worca.orchestrator.error_classifier import (
            record_failure, get_circuit_breaker_state
        )
        status = {}
        classification = {"category": "infra_transient", "retriable": True,
                          "remediation": "wait", "similar_to_previous": False}

        for i in range(25):
            record_failure(status, "plan", f"error {i}", classification)

        cb = get_circuit_breaker_state(status)
        assert len(cb["failure_history"]) == 20
        assert cb["consecutive_failures"] == 25  # counter not capped


# ---------------------------------------------------------------------------
# Transient retry with backoff (real get_retry_delay)
# ---------------------------------------------------------------------------

class TestTransientRetryBackoffIntegration:
    """get_retry_delay() returns correct delays from real settings."""

    def test_first_retry_returns_first_backoff(self, tmp_path):
        from worca.orchestrator.error_classifier import get_retry_delay
        settings_path = _make_settings(tmp_path, backoff=[5, 30, 90])

        delay = get_retry_delay(0, settings_path)
        assert delay == 5

    def test_second_retry_returns_second_backoff(self, tmp_path):
        from worca.orchestrator.error_classifier import get_retry_delay
        settings_path = _make_settings(tmp_path, backoff=[5, 30, 90])

        delay = get_retry_delay(1, settings_path)
        assert delay == 30

    def test_exhausted_retries_returns_none(self, tmp_path):
        """When attempt exceeds backoff list, returns None."""
        from worca.orchestrator.error_classifier import get_retry_delay
        settings_path = _make_settings(tmp_path, backoff=[5, 30, 90])

        delay = get_retry_delay(3, settings_path)
        assert delay is None

    def test_retry_delay_uses_settings_file(self, tmp_path):
        """Backoff values come from the settings file, not defaults."""
        from worca.orchestrator.error_classifier import get_retry_delay

        settings = {
            "worca": {
                "circuit_breaker": {
                    "transient_retry_backoff_seconds": [100, 200, 300],
                }
            }
        }
        sf = tmp_path / "settings.json"
        sf.write_text(json.dumps(settings))

        assert get_retry_delay(0, str(sf)) == 100
        assert get_retry_delay(1, str(sf)) == 200
        assert get_retry_delay(2, str(sf)) == 300
        assert get_retry_delay(3, str(sf)) is None

    def test_missing_settings_uses_default_backoff(self, tmp_path):
        """When settings file has no backoff, defaults are used."""
        from worca.orchestrator.error_classifier import get_retry_delay, _DEFAULT_BACKOFF

        sf = tmp_path / "settings.json"
        sf.write_text(json.dumps({"worca": {}}))

        # First retry uses first default backoff
        delay = get_retry_delay(0, str(sf))
        assert delay == _DEFAULT_BACKOFF[0]


# ---------------------------------------------------------------------------
# Skip preflight integration: pipeline marks stage skipped, no script runs
# ---------------------------------------------------------------------------

class TestSkipPreflightIntegration:
    """Integration: run_pipeline with skip_preflight=True skips the stage."""

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

    def test_skip_preflight_does_not_run_real_script(self, tmp_path):
        """With skip_preflight=True, the preflight script is never executed."""
        from contextlib import ExitStack
        from worca.orchestrator.runner import run_pipeline
        from worca.orchestrator.work_request import WorkRequest

        # Create a script that would fail if run
        fail_script = _make_script(tmp_path,
                                   {"status": "fail", "checks": [], "summary": "SHOULD NOT RUN"},
                                   exit_code=1, name="fail_check.py")
        settings = {
            "worca": {
                "stages": {
                    "preflight": {"enabled": True, "script": fail_script},
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
            stack.enter_context(patch("worca.orchestrator.runner._run_learn_stage"))

            # Should not raise PipelineError even though script would fail
            run_pipeline(
                wr,
                settings_path=str(sf),
                status_path=str(tmp_path / "status.json"),
                skip_preflight=True,
            )

    def test_skip_preflight_marks_stage_completed(self, tmp_path):
        """With skip_preflight=True, update_stage is called with skipped=True."""
        from contextlib import ExitStack
        from worca.orchestrator.runner import run_pipeline
        from worca.orchestrator.work_request import WorkRequest

        settings = {
            "worca": {
                "stages": {
                    "preflight": {"enabled": True},
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
                settings_path=str(sf),
                status_path=str(tmp_path / "status.json"),
                skip_preflight=True,
            )

        skipped_calls = [
            c for c in mock_update.call_args_list
            if c[0][1] == "preflight" and c[1].get("skipped") is True
        ]
        assert len(skipped_calls) > 0


# ---------------------------------------------------------------------------
# Preflight fail in pipeline → LEARN skipped
# ---------------------------------------------------------------------------

class TestPreflightFailPipelineIntegration:
    """Integration: pipeline correctly skips LEARN when preflight fails."""

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

    def test_preflight_fail_with_real_script_raises_and_skips_learn(self, tmp_path):
        """A real failing preflight script raises PipelineError and skips LEARN."""
        from contextlib import ExitStack
        from worca.orchestrator.runner import run_pipeline, PipelineError
        from worca.orchestrator.work_request import WorkRequest

        # Real script that fails
        fail_script = _make_script(
            tmp_path,
            {
                "status": "fail",
                "checks": [
                    {"name": "claude_cli", "status": "fail", "message": "not found"}
                ],
                "summary": "1 check failed",
            },
            exit_code=1,
        )
        settings = {
            "worca": {
                "stages": {
                    "preflight": {"enabled": True, "script": fail_script},
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
            mock_learn = stack.enter_context(
                patch("worca.orchestrator.runner._run_learn_stage")
            )

            with pytest.raises(PipelineError, match="1 check failed"):
                run_pipeline(
                    wr,
                    settings_path=str(sf),
                    status_path=str(tmp_path / "status.json"),
                )

        mock_learn.assert_not_called()
