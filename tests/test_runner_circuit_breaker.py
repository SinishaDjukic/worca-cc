"""Tests for circuit breaker integration in the stage loop (runner.py).

TDD: tests written before implementation.
Covers: classify_error called on exception, record_failure, should_halt →
CircuitBreakerTripped, transient retry path, record_success on success,
preflight skips CB, CB disabled path.
"""

import json
import time
from contextlib import ExitStack
from unittest.mock import MagicMock, call, patch

import pytest

from worca.orchestrator.runner import CircuitBreakerTripped, PipelineError


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_settings(tmp_path, cb_enabled=True, stage="plan"):
    """Minimal settings.json with one enabled stage and circuit_breaker config."""
    settings = {
        "worca": {
            "stages": {
                "preflight": {"enabled": False},
                "plan": {"enabled": stage == "plan"},
                "coordinate": {"enabled": False},
                "implement": {"enabled": False},
                "test": {"enabled": False},
                "review": {"enabled": False},
                "pr": {"enabled": stage == "pr"},
                "learn": {"enabled": False},
            },
            "agents": {
                "planner": {"model": "sonnet", "max_turns": 30},
                "guardian": {"model": "sonnet", "max_turns": 30},
            },
            "loops": {},
            "circuit_breaker": {
                "enabled": cb_enabled,
                "max_consecutive_failures": 3,
                "transient_retry_count": 3,
                "transient_retry_backoff_seconds": [1, 2, 3],
                "classifier_model": "haiku",
            },
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


def _base_patches(stack, fake_status, prompt_builder=None):
    """Apply common patches needed by all run_pipeline tests."""
    stack.enter_context(patch("worca.orchestrator.runner._write_pid"))
    stack.enter_context(patch("worca.orchestrator.runner._remove_pid"))
    stack.enter_context(patch("worca.orchestrator.runner.create_branch"))
    stack.enter_context(patch(
        "worca.orchestrator.runner.init_status",
        return_value=fake_status,
    ))
    stack.enter_context(patch("worca.orchestrator.runner.save_status"))
    stack.enter_context(patch(
        "worca.orchestrator.runner.start_iteration",
        return_value={"number": 1},
    ))
    stack.enter_context(patch("worca.orchestrator.runner.complete_iteration"))
    stack.enter_context(patch("worca.orchestrator.runner.update_stage"))
    stack.enter_context(patch("worca.orchestrator.runner.gh_issue_start"))
    stack.enter_context(patch("worca.orchestrator.runner.gh_issue_complete"))
    stack.enter_context(patch("worca.orchestrator.runner._init_orchestrator_log"))
    stack.enter_context(patch("worca.orchestrator.runner._close_orchestrator_log"))
    stack.enter_context(patch("worca.orchestrator.runner._render_agent_templates"))

    if prompt_builder is None:
        mock_pb = MagicMock()
        mock_pb.build.return_value = "test prompt"
        mock_pb.get_context.return_value = None
        prompt_builder = mock_pb
    stack.enter_context(patch(
        "worca.orchestrator.runner.PromptBuilder",
        return_value=prompt_builder,
    ))
    return prompt_builder


# ---------------------------------------------------------------------------
# CB disabled → original exception re-raised without classifying
# ---------------------------------------------------------------------------

class TestCircuitBreakerDisabled:

    def test_raises_original_when_cb_disabled(self, tmp_path):
        from worca.orchestrator.runner import run_pipeline
        from worca.orchestrator.work_request import WorkRequest

        settings_path = _make_settings(tmp_path, cb_enabled=False)
        wr = WorkRequest(title="Test", description="test", source_type="prompt")

        with ExitStack() as stack:
            _base_patches(stack, _make_fake_status())
            mock_classify = stack.enter_context(
                patch("worca.orchestrator.runner.classify_error")
            )
            stack.enter_context(patch(
                "worca.orchestrator.runner.run_stage",
                side_effect=ValueError("stage failed"),
            ))

            with pytest.raises(ValueError, match="stage failed"):
                run_pipeline(wr, settings_path=settings_path,
                             status_path=str(tmp_path / "status.json"))

        mock_classify.assert_not_called()

    def test_classify_not_called_when_cb_disabled(self, tmp_path):
        from worca.orchestrator.runner import run_pipeline
        from worca.orchestrator.work_request import WorkRequest

        settings_path = _make_settings(tmp_path, cb_enabled=False)
        wr = WorkRequest(title="Test", description="test", source_type="prompt")

        with ExitStack() as stack:
            _base_patches(stack, _make_fake_status())
            mock_classify = stack.enter_context(
                patch("worca.orchestrator.runner.classify_error")
            )
            stack.enter_context(patch(
                "worca.orchestrator.runner.run_stage",
                side_effect=RuntimeError("boom"),
            ))

            with pytest.raises(RuntimeError):
                run_pipeline(wr, settings_path=settings_path,
                             status_path=str(tmp_path / "status.json"))

        mock_classify.assert_not_called()


# ---------------------------------------------------------------------------
# CB enabled — classify_error and record_failure called
# ---------------------------------------------------------------------------

class TestCircuitBreakerClassifiesError:

    def _run_with_failure(self, tmp_path, *, classify_return,
                          should_halt_return=(False, ""),
                          error=ValueError("test error")):
        from worca.orchestrator.runner import run_pipeline
        from worca.orchestrator.work_request import WorkRequest

        settings_path = _make_settings(tmp_path, cb_enabled=True)
        wr = WorkRequest(title="Test", description="test", source_type="prompt")

        with ExitStack() as stack:
            _base_patches(stack, _make_fake_status())
            mock_classify = stack.enter_context(
                patch("worca.orchestrator.runner.classify_error",
                      return_value=classify_return)
            )
            mock_record_failure = stack.enter_context(
                patch("worca.orchestrator.runner.record_failure")
            )
            stack.enter_context(
                patch("worca.orchestrator.runner.should_halt",
                      return_value=should_halt_return)
            )
            stack.enter_context(patch(
                "worca.orchestrator.runner.run_stage",
                side_effect=error,
            ))

            try:
                run_pipeline(wr, settings_path=settings_path,
                             status_path=str(tmp_path / "status.json"))
            except Exception:
                pass

        return mock_classify, mock_record_failure

    def test_classify_error_called(self, tmp_path):
        classification = {"category": "infra_permanent", "retriable": False,
                          "remediation": "fix auth", "similar_to_previous": False}
        mock_classify, _ = self._run_with_failure(
            tmp_path,
            classify_return=classification,
            should_halt_return=(True, "permanent error"),
        )
        mock_classify.assert_called_once()

    def test_classify_error_called_with_error_message(self, tmp_path):
        classification = {"category": "infra_permanent", "retriable": False,
                          "remediation": "fix", "similar_to_previous": False}
        error = ValueError("something broke")
        mock_classify, _ = self._run_with_failure(
            tmp_path,
            classify_return=classification,
            should_halt_return=(True, "perm"),
            error=error,
        )
        call_args = mock_classify.call_args
        assert "something broke" in str(call_args[0][0])

    def test_classify_error_called_with_stage_name(self, tmp_path):
        classification = {"category": "infra_permanent", "retriable": False,
                          "remediation": "fix", "similar_to_previous": False}
        mock_classify, _ = self._run_with_failure(
            tmp_path,
            classify_return=classification,
            should_halt_return=(True, "perm"),
        )
        call_args = mock_classify.call_args
        assert call_args[0][1] == "plan"

    def test_record_failure_called_with_classification(self, tmp_path):
        classification = {"category": "infra_permanent", "retriable": False,
                          "remediation": "fix auth", "similar_to_previous": False}
        _, mock_record = self._run_with_failure(
            tmp_path,
            classify_return=classification,
            should_halt_return=(True, "perm"),
        )
        mock_record.assert_called_once()
        # Third positional arg is error string, fourth is classification
        args = mock_record.call_args[0]
        assert args[3] == classification

    def test_classification_logged(self, tmp_path):
        classification = {"category": "infra_transient", "retriable": True,
                          "remediation": "wait", "similar_to_previous": False}
        from worca.orchestrator.runner import run_pipeline
        from worca.orchestrator.work_request import WorkRequest

        settings_path = _make_settings(tmp_path, cb_enabled=True)
        wr = WorkRequest(title="Test", description="test", source_type="prompt")

        with ExitStack() as stack:
            _base_patches(stack, _make_fake_status())
            stack.enter_context(
                patch("worca.orchestrator.runner.classify_error",
                      return_value=classification)
            )
            stack.enter_context(
                patch("worca.orchestrator.runner.record_failure")
            )
            stack.enter_context(
                patch("worca.orchestrator.runner.should_halt",
                      return_value=(True, "threshold exceeded"))
            )
            stack.enter_context(patch(
                "worca.orchestrator.runner.run_stage",
                side_effect=ValueError("api error"),
            ))
            mock_log = stack.enter_context(
                patch("worca.orchestrator.runner._log")
            )

            with pytest.raises(CircuitBreakerTripped):
                run_pipeline(wr, settings_path=settings_path,
                             status_path=str(tmp_path / "status.json"))

        logged = [str(c[0][0]) for c in mock_log.call_args_list]
        assert any("infra_transient" in m for m in logged)


# ---------------------------------------------------------------------------
# should_halt → CircuitBreakerTripped
# ---------------------------------------------------------------------------

class TestCircuitBreakerHalt:

    def test_circuit_breaker_tripped_raised_when_should_halt(self, tmp_path):
        from worca.orchestrator.runner import run_pipeline
        from worca.orchestrator.work_request import WorkRequest

        settings_path = _make_settings(tmp_path, cb_enabled=True)
        wr = WorkRequest(title="Test", description="test", source_type="prompt")

        with ExitStack() as stack:
            _base_patches(stack, _make_fake_status())
            stack.enter_context(
                patch("worca.orchestrator.runner.classify_error",
                      return_value={"category": "env_missing", "retriable": False,
                                    "remediation": "install tools",
                                    "similar_to_previous": False})
            )
            stack.enter_context(patch("worca.orchestrator.runner.record_failure"))
            stack.enter_context(
                patch("worca.orchestrator.runner.should_halt",
                      return_value=(True, "env_missing: immediate halt"))
            )
            stack.enter_context(patch(
                "worca.orchestrator.runner.run_stage",
                side_effect=RuntimeError("bd not found"),
            ))

            with pytest.raises(CircuitBreakerTripped):
                run_pipeline(wr, settings_path=settings_path,
                             status_path=str(tmp_path / "status.json"))

    def test_circuit_breaker_tripped_reason_in_message(self, tmp_path):
        from worca.orchestrator.runner import run_pipeline
        from worca.orchestrator.work_request import WorkRequest

        settings_path = _make_settings(tmp_path, cb_enabled=True)
        wr = WorkRequest(title="Test", description="test", source_type="prompt")

        with ExitStack() as stack:
            _base_patches(stack, _make_fake_status())
            stack.enter_context(
                patch("worca.orchestrator.runner.classify_error",
                      return_value={"category": "infra_permanent", "retriable": False,
                                    "remediation": "fix auth", "similar_to_previous": False})
            )
            stack.enter_context(patch("worca.orchestrator.runner.record_failure"))
            stack.enter_context(
                patch("worca.orchestrator.runner.should_halt",
                      return_value=(True, "3 consecutive failures (threshold: 3)"))
            )
            stack.enter_context(patch(
                "worca.orchestrator.runner.run_stage",
                side_effect=RuntimeError("auth error"),
            ))

            with pytest.raises(CircuitBreakerTripped, match="3 consecutive failures"):
                run_pipeline(wr, settings_path=settings_path,
                             status_path=str(tmp_path / "status.json"))

    def test_original_exception_raised_when_not_halting_not_retriable(self, tmp_path):
        """When should_halt=False and not retriable, original exception is re-raised."""
        from worca.orchestrator.runner import run_pipeline
        from worca.orchestrator.work_request import WorkRequest

        settings_path = _make_settings(tmp_path, cb_enabled=True)
        wr = WorkRequest(title="Test", description="test", source_type="prompt")

        with ExitStack() as stack:
            _base_patches(stack, _make_fake_status())
            stack.enter_context(
                patch("worca.orchestrator.runner.classify_error",
                      return_value={"category": "unknown", "retriable": False,
                                    "remediation": "check logs", "similar_to_previous": False})
            )
            stack.enter_context(patch("worca.orchestrator.runner.record_failure"))
            stack.enter_context(
                patch("worca.orchestrator.runner.should_halt",
                      return_value=(False, ""))
            )
            stack.enter_context(patch(
                "worca.orchestrator.runner.run_stage",
                side_effect=ValueError("some error"),
            ))

            with pytest.raises(ValueError, match="some error"):
                run_pipeline(wr, settings_path=settings_path,
                             status_path=str(tmp_path / "status.json"))


# ---------------------------------------------------------------------------
# Transient retry path
# ---------------------------------------------------------------------------

class TestTransientRetry:

    def test_sleep_called_with_delay_on_transient_retriable(self, tmp_path):
        from worca.orchestrator.runner import run_pipeline
        from worca.orchestrator.work_request import WorkRequest

        settings_path = _make_settings(tmp_path, cb_enabled=True)
        wr = WorkRequest(title="Test", description="test", source_type="prompt")

        # First call raises; second call succeeds
        plan_result = {"approved": True, "approach": "do it", "tasks_outline": []}
        run_stage_mock = MagicMock(side_effect=[
            ValueError("transient api error"),
            (plan_result, {}),
        ])

        with ExitStack() as stack:
            _base_patches(stack, _make_fake_status())
            stack.enter_context(
                patch("worca.orchestrator.runner.classify_error",
                      return_value={"category": "infra_transient", "retriable": True,
                                    "remediation": "wait and retry",
                                    "similar_to_previous": False})
            )
            stack.enter_context(patch("worca.orchestrator.runner.record_failure"))
            stack.enter_context(
                patch("worca.orchestrator.runner.should_halt",
                      return_value=(False, ""))
            )
            stack.enter_context(
                patch("worca.orchestrator.runner.get_retry_delay", return_value=5.0)
            )
            mock_sleep = stack.enter_context(patch("worca.orchestrator.runner.time.sleep"))
            stack.enter_context(
                patch("worca.orchestrator.runner.run_stage", run_stage_mock)
            )
            stack.enter_context(patch("worca.orchestrator.runner.set_milestone"))

            run_pipeline(wr, settings_path=settings_path,
                         status_path=str(tmp_path / "status.json"))

        mock_sleep.assert_called_once_with(5.0)

    def test_stage_retried_on_transient_retriable(self, tmp_path):
        """run_stage is called twice when transient+retriable."""
        from worca.orchestrator.runner import run_pipeline
        from worca.orchestrator.work_request import WorkRequest

        settings_path = _make_settings(tmp_path, cb_enabled=True)
        wr = WorkRequest(title="Test", description="test", source_type="prompt")

        plan_result = {"approved": True, "approach": "do it", "tasks_outline": []}
        run_stage_calls = []

        def run_stage_side_effect(*args, **kwargs):
            run_stage_calls.append(1)
            if len(run_stage_calls) == 1:
                raise ValueError("first call fails")
            return plan_result, {}

        with ExitStack() as stack:
            _base_patches(stack, _make_fake_status())
            stack.enter_context(
                patch("worca.orchestrator.runner.classify_error",
                      return_value={"category": "infra_transient", "retriable": True,
                                    "remediation": "retry", "similar_to_previous": False})
            )
            stack.enter_context(patch("worca.orchestrator.runner.record_failure"))
            stack.enter_context(
                patch("worca.orchestrator.runner.should_halt",
                      return_value=(False, ""))
            )
            stack.enter_context(
                patch("worca.orchestrator.runner.get_retry_delay", return_value=0.0)
            )
            stack.enter_context(patch("worca.orchestrator.runner.time.sleep"))
            stack.enter_context(
                patch("worca.orchestrator.runner.run_stage",
                      side_effect=run_stage_side_effect)
            )
            stack.enter_context(patch("worca.orchestrator.runner.set_milestone"))

            run_pipeline(wr, settings_path=settings_path,
                         status_path=str(tmp_path / "status.json"))

        assert len(run_stage_calls) == 2

    def test_no_sleep_when_delay_exhausted(self, tmp_path):
        """When get_retry_delay returns None, no sleep and exception re-raised."""
        from worca.orchestrator.runner import run_pipeline
        from worca.orchestrator.work_request import WorkRequest

        settings_path = _make_settings(tmp_path, cb_enabled=True)
        wr = WorkRequest(title="Test", description="test", source_type="prompt")

        with ExitStack() as stack:
            _base_patches(stack, _make_fake_status())
            stack.enter_context(
                patch("worca.orchestrator.runner.classify_error",
                      return_value={"category": "infra_transient", "retriable": True,
                                    "remediation": "wait", "similar_to_previous": False})
            )
            stack.enter_context(patch("worca.orchestrator.runner.record_failure"))
            stack.enter_context(
                patch("worca.orchestrator.runner.should_halt",
                      return_value=(False, ""))
            )
            stack.enter_context(
                patch("worca.orchestrator.runner.get_retry_delay", return_value=None)
            )
            mock_sleep = stack.enter_context(patch("worca.orchestrator.runner.time.sleep"))
            stack.enter_context(patch(
                "worca.orchestrator.runner.run_stage",
                side_effect=ValueError("transient but retries exhausted"),
            ))

            with pytest.raises(ValueError):
                run_pipeline(wr, settings_path=settings_path,
                             status_path=str(tmp_path / "status.json"))

        mock_sleep.assert_not_called()


# ---------------------------------------------------------------------------
# PREFLIGHT stage — CB skipped
# ---------------------------------------------------------------------------

class TestPreflightSkipsCircuitBreaker:

    def _make_preflight_settings(self, tmp_path):
        settings = {
            "worca": {
                "stages": {
                    "preflight": {"enabled": True, "script": ".claude/scripts/preflight_checks.py"},
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
                "circuit_breaker": {
                    "enabled": True,
                    "max_consecutive_failures": 3,
                    "transient_retry_count": 3,
                    "transient_retry_backoff_seconds": [1, 2, 3],
                    "classifier_model": "haiku",
                },
            }
        }
        f = tmp_path / "settings.json"
        f.write_text(json.dumps(settings))
        return str(f)

    def test_classify_error_not_called_when_preflight_raises(self, tmp_path):
        from worca.orchestrator.runner import run_pipeline
        from worca.orchestrator.work_request import WorkRequest

        settings_path = self._make_preflight_settings(tmp_path)
        wr = WorkRequest(title="Test", description="test", source_type="prompt")

        with ExitStack() as stack:
            _base_patches(stack, _make_fake_status())
            mock_classify = stack.enter_context(
                patch("worca.orchestrator.runner.classify_error")
            )
            stack.enter_context(patch(
                "worca.orchestrator.runner.run_preflight",
                side_effect=PipelineError("preflight: claude not found"),
            ))

            with pytest.raises(PipelineError):
                run_pipeline(wr, settings_path=settings_path,
                             status_path=str(tmp_path / "status.json"))

        mock_classify.assert_not_called()

    def test_original_pipeline_error_raised_when_preflight_fails(self, tmp_path):
        from worca.orchestrator.runner import run_pipeline
        from worca.orchestrator.work_request import WorkRequest

        settings_path = self._make_preflight_settings(tmp_path)
        wr = WorkRequest(title="Test", description="test", source_type="prompt")

        with ExitStack() as stack:
            _base_patches(stack, _make_fake_status())
            stack.enter_context(patch("worca.orchestrator.runner.classify_error"))
            stack.enter_context(patch(
                "worca.orchestrator.runner.run_preflight",
                side_effect=PipelineError("preflight failed"),
            ))

            with pytest.raises(PipelineError, match="preflight failed"):
                run_pipeline(wr, settings_path=settings_path,
                             status_path=str(tmp_path / "status.json"))


# ---------------------------------------------------------------------------
# record_success called on successful stage completion
# ---------------------------------------------------------------------------

class TestRecordSuccessOnSuccess:

    def test_record_success_called_after_successful_stage(self, tmp_path):
        from worca.orchestrator.runner import run_pipeline
        from worca.orchestrator.work_request import WorkRequest

        settings_path = _make_settings(tmp_path, cb_enabled=True)
        wr = WorkRequest(title="Test", description="test", source_type="prompt")

        plan_result = {"approved": True, "approach": "plan it", "tasks_outline": []}

        with ExitStack() as stack:
            _base_patches(stack, _make_fake_status())
            mock_record_success = stack.enter_context(
                patch("worca.orchestrator.runner.record_success")
            )
            stack.enter_context(
                patch("worca.orchestrator.runner.run_stage",
                      return_value=(plan_result, {}))
            )
            stack.enter_context(patch("worca.orchestrator.runner.set_milestone"))

            run_pipeline(wr, settings_path=settings_path,
                         status_path=str(tmp_path / "status.json"))

        mock_record_success.assert_called()

    def test_record_success_not_called_on_error(self, tmp_path):
        """record_success is NOT called when stage raises."""
        from worca.orchestrator.runner import run_pipeline
        from worca.orchestrator.work_request import WorkRequest

        settings_path = _make_settings(tmp_path, cb_enabled=True)
        wr = WorkRequest(title="Test", description="test", source_type="prompt")

        with ExitStack() as stack:
            _base_patches(stack, _make_fake_status())
            mock_record_success = stack.enter_context(
                patch("worca.orchestrator.runner.record_success")
            )
            stack.enter_context(
                patch("worca.orchestrator.runner.classify_error",
                      return_value={"category": "unknown", "retriable": False,
                                    "remediation": "", "similar_to_previous": False})
            )
            stack.enter_context(patch("worca.orchestrator.runner.record_failure"))
            stack.enter_context(
                patch("worca.orchestrator.runner.should_halt",
                      return_value=(True, "halt"))
            )
            stack.enter_context(patch(
                "worca.orchestrator.runner.run_stage",
                side_effect=ValueError("stage failed"),
            ))

            with pytest.raises(CircuitBreakerTripped):
                run_pipeline(wr, settings_path=settings_path,
                             status_path=str(tmp_path / "status.json"))

        mock_record_success.assert_not_called()
