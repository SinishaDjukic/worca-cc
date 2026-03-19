"""Tests for CircuitBreakerTripped exception class in runner.py."""

import pytest

from worca.orchestrator.runner import PipelineError


class TestCircuitBreakerTripped:

    def test_can_be_imported(self):
        from worca.orchestrator.runner import CircuitBreakerTripped
        assert CircuitBreakerTripped is not None

    def test_is_subclass_of_pipeline_error(self):
        from worca.orchestrator.runner import CircuitBreakerTripped
        assert issubclass(CircuitBreakerTripped, PipelineError)

    def test_caught_by_except_pipeline_error(self):
        from worca.orchestrator.runner import CircuitBreakerTripped
        with pytest.raises(PipelineError):
            raise CircuitBreakerTripped("threshold exceeded")

    def test_message_preserved(self):
        from worca.orchestrator.runner import CircuitBreakerTripped
        exc = CircuitBreakerTripped("3 consecutive failures")
        assert "3 consecutive failures" in str(exc)

    def test_not_same_as_pipeline_error(self):
        from worca.orchestrator.runner import CircuitBreakerTripped
        assert CircuitBreakerTripped is not PipelineError

    def test_class_name(self):
        from worca.orchestrator.runner import CircuitBreakerTripped
        assert CircuitBreakerTripped.__name__ == "CircuitBreakerTripped"
