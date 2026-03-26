"""Tests for worca.orchestrator.error_classifier module."""
import json
import os
import subprocess
from unittest.mock import MagicMock, patch


from worca.orchestrator.error_classifier import (
    CATEGORY_TRANSIENT,
    CATEGORY_PERMANENT,
    CATEGORY_LOGIC_STUCK,
    CATEGORY_ENV_MISSING,
    CATEGORY_UNKNOWN,
    classify_error,
    clear_cache,
    init_circuit_breaker_state,
    get_circuit_breaker_state,
    record_failure,
    record_success,
    should_halt,
    get_retry_delay,
)


# --- Constants ---

class TestConstants:
    def test_category_transient(self):
        assert CATEGORY_TRANSIENT == "infra_transient"

    def test_category_permanent(self):
        assert CATEGORY_PERMANENT == "infra_permanent"

    def test_category_logic_stuck(self):
        assert CATEGORY_LOGIC_STUCK == "logic_stuck"

    def test_category_env_missing(self):
        assert CATEGORY_ENV_MISSING == "env_missing"

    def test_category_unknown(self):
        assert CATEGORY_UNKNOWN == "unknown"


# --- classify_error ---

class TestClassifyError:
    def setup_method(self):
        clear_cache()

    def _make_claude_output(self, category, retriable=True, remediation="retry", similar=False):
        return json.dumps({
            "category": category,
            "retriable": retriable,
            "remediation": remediation,
            "similar_to_previous": similar,
        })

    def test_returns_classification_on_success(self, tmp_path):
        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps({"worca": {"circuit_breaker": {"classifier_model": "haiku"}}}))

        output = self._make_claude_output(CATEGORY_TRANSIENT)
        mock_result = MagicMock(returncode=0, stdout=output, stderr="")

        with patch("subprocess.run", return_value=mock_result):
            result = classify_error(
                "Connection timeout", "implement", [], str(settings_file)
            )

        assert result["category"] == CATEGORY_TRANSIENT
        assert result["retriable"] is True
        assert "remediation" in result
        assert "similar_to_previous" in result

    def test_classify_permanent_error(self, tmp_path):
        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps({"worca": {}}))

        output = self._make_claude_output(CATEGORY_PERMANENT, retriable=False)
        mock_result = MagicMock(returncode=0, stdout=output, stderr="")

        with patch("subprocess.run", return_value=mock_result):
            result = classify_error("Auth failed", "plan", [], str(settings_file))

        assert result["category"] == CATEGORY_PERMANENT
        assert result["retriable"] is False

    def test_returns_fallback_on_subprocess_error(self, tmp_path):
        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps({"worca": {}}))

        with patch("subprocess.run", side_effect=Exception("subprocess failed")):
            result = classify_error("Some error", "test", [], str(settings_file))

        assert result["category"] == CATEGORY_UNKNOWN
        assert result["retriable"] is False
        assert result.get("classifier_error") is True
        assert result["classifier_error_detail"] == "subprocess failed"

    def test_returns_fallback_on_nonzero_exit(self, tmp_path):
        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps({"worca": {}}))

        mock_result = MagicMock(returncode=1, stdout="", stderr="claude init error")
        with patch("subprocess.run", return_value=mock_result):
            result = classify_error("Some error", "test", [], str(settings_file))

        assert result["category"] == CATEGORY_UNKNOWN
        assert result["retriable"] is False
        assert result.get("classifier_error") is True
        assert result["classifier_error_detail"] == "claude init error"

    def test_returns_fallback_on_invalid_json(self, tmp_path):
        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps({"worca": {}}))

        mock_result = MagicMock(returncode=0, stdout="not json", stderr="")
        with patch("subprocess.run", return_value=mock_result):
            result = classify_error("Some error", "test", [], str(settings_file))

        assert result["category"] == CATEGORY_UNKNOWN
        assert result.get("classifier_error") is True
        assert "classifier_error_detail" in result

    def test_returns_fallback_on_timeout(self, tmp_path):
        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps({"worca": {}}))

        with patch("subprocess.run", side_effect=subprocess.TimeoutExpired("claude", 30)):
            result = classify_error("Some error", "test", [], str(settings_file))

        assert result["category"] == CATEGORY_UNKNOWN
        assert result.get("classifier_error") is True
        assert "classifier_error_detail" in result

    def test_uses_haiku_model_by_default(self, tmp_path):
        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps({"worca": {}}))

        output = self._make_claude_output(CATEGORY_UNKNOWN)
        mock_result = MagicMock(returncode=0, stdout=output, stderr="")

        with patch("subprocess.run", return_value=mock_result) as mock_run:
            classify_error("error", "implement", [], str(settings_file))

        call_args = mock_run.call_args
        cmd = call_args[0][0]
        assert any("haiku" in arg for arg in cmd)

    def test_uses_configured_model(self, tmp_path):
        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps({"worca": {"circuit_breaker": {"classifier_model": "sonnet"}}}))

        output = self._make_claude_output(CATEGORY_UNKNOWN)
        mock_result = MagicMock(returncode=0, stdout=output, stderr="")

        with patch("subprocess.run", return_value=mock_result) as mock_run:
            classify_error("error", "implement", [], str(settings_file))

        call_args = mock_run.call_args
        cmd = call_args[0][0]
        assert any("sonnet" in arg for arg in cmd)

    def test_includes_failure_history_in_prompt(self, tmp_path):
        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps({"worca": {}}))

        history = [{"error": "prev error 1"}, {"error": "prev error 2"}]
        output = self._make_claude_output(CATEGORY_TRANSIENT)
        mock_result = MagicMock(returncode=0, stdout=output, stderr="")

        with patch("subprocess.run", return_value=mock_result) as mock_run:
            classify_error("new error", "implement", history, str(settings_file))

        call_args = mock_run.call_args
        # The prompt should be in the command args
        cmd = call_args[0][0]
        cmd_str = " ".join(cmd)
        assert "prev error 1" in cmd_str or "prev error" in cmd_str

    def test_handles_missing_settings_file(self, tmp_path):
        missing = str(tmp_path / "missing.json")

        output = self._make_claude_output(CATEGORY_UNKNOWN)
        mock_result = MagicMock(returncode=0, stdout=output, stderr="")

        with patch("subprocess.run", return_value=mock_result):
            # Should not raise, just use defaults
            result = classify_error("error", "test", [], missing)
        assert "category" in result

    def test_large_prompt_offloaded_to_file(self, tmp_path):
        """When error_message + history make the prompt > 128 KiB, it's offloaded."""
        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps({"worca": {}}))

        # Create a large error message that will push prompt over the limit
        large_error = "E" * (128 * 1024 + 1)
        output = self._make_claude_output(CATEGORY_TRANSIENT)
        mock_result = MagicMock(returncode=0, stdout=output, stderr="")

        prompt_file_seen = None

        def check_run(cmd, **kwargs):
            nonlocal prompt_file_seen
            idx = cmd.index("-p")
            cli_prompt = cmd[idx + 1]
            # If offloaded, the CLI prompt is short and references a temp file
            if "Read the file at" in cli_prompt:
                # Extract path: it appears after "Read the file at " and before " and"
                import re
                m = re.search(r"Read the file at (\S+)", cli_prompt)
                if m:
                    prompt_file_seen = m.group(1)
            return mock_result

        with patch("subprocess.run", side_effect=check_run):
            result = classify_error(large_error, "implement", [], str(settings_file))

        assert result["category"] == CATEGORY_TRANSIENT
        # The prompt should have been offloaded (short CLI arg referencing a file)
        assert prompt_file_seen is not None
        # The temp file should be cleaned up after the call
        assert not os.path.exists(prompt_file_seen)

    def test_small_prompt_stays_inline(self, tmp_path):
        """Small prompts should be passed inline, not offloaded."""
        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps({"worca": {}}))

        output = self._make_claude_output(CATEGORY_TRANSIENT)
        mock_result = MagicMock(returncode=0, stdout=output, stderr="")

        with patch("subprocess.run", return_value=mock_result) as mock_run:
            classify_error("small error", "implement", [], str(settings_file))

        cmd = mock_run.call_args[0][0]
        idx = cmd.index("-p")
        cli_prompt = cmd[idx + 1]
        assert "Read the file at" not in cli_prompt
        assert "small error" in cli_prompt


# --- init_circuit_breaker_state ---

class TestInitCircuitBreakerState:
    def test_returns_dict_with_expected_keys(self):
        state = init_circuit_breaker_state()
        assert "consecutive_failures" in state
        assert "failure_history" in state
        assert "tripped" in state

    def test_consecutive_failures_starts_at_zero(self):
        state = init_circuit_breaker_state()
        assert state["consecutive_failures"] == 0

    def test_failure_history_starts_empty(self):
        state = init_circuit_breaker_state()
        assert state["failure_history"] == []

    def test_tripped_starts_false(self):
        state = init_circuit_breaker_state()
        assert state["tripped"] is False


# --- get_circuit_breaker_state ---

class TestGetCircuitBreakerState:
    def test_returns_existing_state_from_status(self):
        status = {"circuit_breaker": {"consecutive_failures": 2, "tripped": False, "failure_history": []}}
        state = get_circuit_breaker_state(status)
        assert state["consecutive_failures"] == 2

    def test_inits_state_when_missing(self):
        status = {}
        state = get_circuit_breaker_state(status)
        assert state["consecutive_failures"] == 0
        assert state["tripped"] is False

    def test_stores_initialized_state_in_status(self):
        status = {}
        get_circuit_breaker_state(status)
        assert "circuit_breaker" in status

    def test_returns_same_object_as_in_status(self):
        status = {}
        state = get_circuit_breaker_state(status)
        assert state is status["circuit_breaker"]


# --- record_failure ---

class TestRecordFailure:
    def _make_status(self):
        return {"circuit_breaker": init_circuit_breaker_state()}

    def test_increments_consecutive_failures(self):
        status = self._make_status()
        record_failure(status, "implement", "some error", {"category": CATEGORY_TRANSIENT})
        assert status["circuit_breaker"]["consecutive_failures"] == 1

    def test_increments_multiple_times(self):
        status = self._make_status()
        record_failure(status, "implement", "error 1", {"category": CATEGORY_TRANSIENT})
        record_failure(status, "implement", "error 2", {"category": CATEGORY_TRANSIENT})
        assert status["circuit_breaker"]["consecutive_failures"] == 2

    def test_appends_to_failure_history(self):
        status = self._make_status()
        record_failure(status, "implement", "some error", {"category": CATEGORY_TRANSIENT})
        assert len(status["circuit_breaker"]["failure_history"]) == 1

    def test_failure_history_entry_has_stage(self):
        status = self._make_status()
        record_failure(status, "implement", "some error", {"category": CATEGORY_TRANSIENT})
        entry = status["circuit_breaker"]["failure_history"][0]
        assert entry["stage"] == "implement"

    def test_failure_history_entry_has_error(self):
        status = self._make_status()
        record_failure(status, "implement", "some error", {"category": CATEGORY_TRANSIENT})
        entry = status["circuit_breaker"]["failure_history"][0]
        assert entry["error"] == "some error"

    def test_failure_history_entry_has_classification(self):
        status = self._make_status()
        classification = {"category": CATEGORY_TRANSIENT, "retriable": True}
        record_failure(status, "implement", "some error", classification)
        entry = status["circuit_breaker"]["failure_history"][0]
        assert entry["classification"] == classification

    def test_history_capped_at_20(self):
        status = self._make_status()
        for i in range(25):
            record_failure(status, "implement", f"error {i}", {"category": CATEGORY_TRANSIENT})
        assert len(status["circuit_breaker"]["failure_history"]) == 20

    def test_history_keeps_most_recent_entries(self):
        status = self._make_status()
        for i in range(25):
            record_failure(status, "implement", f"error {i}", {"category": CATEGORY_TRANSIENT})
        last_entry = status["circuit_breaker"]["failure_history"][-1]
        assert last_entry["error"] == "error 24"


# --- record_success ---

class TestRecordSuccess:
    def test_resets_consecutive_failures_to_zero(self):
        status = {"circuit_breaker": {
            "consecutive_failures": 3,
            "failure_history": [],
            "tripped": False,
        }}
        record_success(status)
        assert status["circuit_breaker"]["consecutive_failures"] == 0

    def test_does_not_clear_failure_history(self):
        status = {"circuit_breaker": {
            "consecutive_failures": 2,
            "failure_history": [{"stage": "implement", "error": "err"}],
            "tripped": False,
        }}
        record_success(status)
        assert len(status["circuit_breaker"]["failure_history"]) == 1

    def test_inits_state_if_missing(self):
        status = {}
        record_success(status)
        assert status["circuit_breaker"]["consecutive_failures"] == 0


# --- should_halt ---

class TestShouldHalt:
    def _make_status(self, consecutive=0, tripped=False):
        return {
            "circuit_breaker": {
                "consecutive_failures": consecutive,
                "failure_history": [],
                "tripped": tripped,
            }
        }

    def _make_settings(self, tmp_path, max_consecutive=3):
        settings = {
            "worca": {
                "circuit_breaker": {
                    "max_consecutive_failures": max_consecutive
                }
            }
        }
        f = tmp_path / "settings.json"
        f.write_text(json.dumps(settings))
        return str(f)

    def test_halts_immediately_for_permanent(self, tmp_path):
        status = self._make_status(consecutive=0)
        settings = self._make_settings(tmp_path)
        classification = {"category": CATEGORY_PERMANENT, "retriable": False}
        halt, reason = should_halt(status, classification, settings)
        assert halt is True
        assert reason

    def test_halts_immediately_for_env_missing(self, tmp_path):
        status = self._make_status(consecutive=0)
        settings = self._make_settings(tmp_path)
        classification = {"category": CATEGORY_ENV_MISSING, "retriable": False}
        halt, reason = should_halt(status, classification, settings)
        assert halt is True

    def test_halts_immediately_for_logic_stuck(self, tmp_path):
        status = self._make_status(consecutive=0)
        settings = self._make_settings(tmp_path)
        classification = {"category": CATEGORY_LOGIC_STUCK, "retriable": False}
        halt, reason = should_halt(status, classification, settings)
        assert halt is True

    def test_no_halt_for_transient_below_threshold(self, tmp_path):
        status = self._make_status(consecutive=2)
        settings = self._make_settings(tmp_path, max_consecutive=3)
        classification = {"category": CATEGORY_TRANSIENT, "retriable": True}
        halt, _ = should_halt(status, classification, settings)
        assert halt is False

    def test_halts_for_transient_at_threshold(self, tmp_path):
        status = self._make_status(consecutive=3)
        settings = self._make_settings(tmp_path, max_consecutive=3)
        classification = {"category": CATEGORY_TRANSIENT, "retriable": True}
        halt, reason = should_halt(status, classification, settings)
        assert halt is True
        assert reason

    def test_halts_for_unknown_at_threshold(self, tmp_path):
        status = self._make_status(consecutive=3)
        settings = self._make_settings(tmp_path, max_consecutive=3)
        classification = {"category": CATEGORY_UNKNOWN, "retriable": False}
        halt, reason = should_halt(status, classification, settings)
        assert halt is True

    def test_no_halt_for_unknown_below_threshold(self, tmp_path):
        status = self._make_status(consecutive=1)
        settings = self._make_settings(tmp_path, max_consecutive=3)
        classification = {"category": CATEGORY_UNKNOWN}
        halt, _ = should_halt(status, classification, settings)
        assert halt is False

    def test_uses_default_threshold_when_no_settings(self, tmp_path):
        missing = str(tmp_path / "missing.json")
        status = self._make_status(consecutive=3)
        classification = {"category": CATEGORY_TRANSIENT}
        # Should not raise, just use defaults
        halt, reason = should_halt(status, classification, missing)
        assert isinstance(halt, bool)


# --- get_retry_delay ---

class TestGetRetryDelay:
    def _make_settings(self, tmp_path, backoff=None):
        settings = {
            "worca": {
                "circuit_breaker": {
                    "transient_retry_count": 3,
                    "transient_retry_backoff_seconds": backoff or [10, 30, 90],
                }
            }
        }
        f = tmp_path / "settings.json"
        f.write_text(json.dumps(settings))
        return str(f)

    def test_returns_first_delay_for_attempt_zero(self, tmp_path):
        settings = self._make_settings(tmp_path)
        delay = get_retry_delay(0, settings)
        assert delay == 10

    def test_returns_second_delay_for_attempt_one(self, tmp_path):
        settings = self._make_settings(tmp_path)
        delay = get_retry_delay(1, settings)
        assert delay == 30

    def test_returns_third_delay_for_attempt_two(self, tmp_path):
        settings = self._make_settings(tmp_path)
        delay = get_retry_delay(2, settings)
        assert delay == 90

    def test_returns_none_when_retries_exhausted(self, tmp_path):
        settings = self._make_settings(tmp_path)
        delay = get_retry_delay(3, settings)
        assert delay is None

    def test_returns_none_for_large_attempt(self, tmp_path):
        settings = self._make_settings(tmp_path)
        delay = get_retry_delay(100, settings)
        assert delay is None

    def test_returns_default_when_settings_missing(self, tmp_path):
        missing = str(tmp_path / "missing.json")
        delay = get_retry_delay(0, missing)
        assert isinstance(delay, (int, float)) or delay is None

    def test_custom_backoff_list(self, tmp_path):
        settings = self._make_settings(tmp_path, backoff=[5, 15])
        assert get_retry_delay(0, settings) == 5
        assert get_retry_delay(1, settings) == 15
        assert get_retry_delay(2, settings) is None


# --- classify_error caching ---

class TestClassifyErrorCache:
    def _make_claude_output(self, category, retriable=True):
        return json.dumps({
            "category": category,
            "retriable": retriable,
            "remediation": "retry",
            "similar_to_previous": False,
        })

    def setup_method(self):
        clear_cache()

    def test_second_call_returns_cached_result(self, tmp_path):
        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps({"worca": {}}))

        output = self._make_claude_output(CATEGORY_TRANSIENT)
        mock_result = MagicMock(returncode=0, stdout=output, stderr="")

        with patch("subprocess.run", return_value=mock_result) as mock_run:
            result1 = classify_error("Connection timeout", "implement", [], str(settings_file))
            result2 = classify_error("Connection timeout", "implement", [], str(settings_file))

        assert mock_run.call_count == 1
        assert result1["category"] == CATEGORY_TRANSIENT
        assert result2["category"] == CATEGORY_TRANSIENT
        assert result2.get("from_cache") is True
        assert result1.get("from_cache") is None

    def test_cache_expires_after_ttl(self, tmp_path):
        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps({"worca": {}}))

        output = self._make_claude_output(CATEGORY_TRANSIENT)
        mock_result = MagicMock(returncode=0, stdout=output, stderr="")

        # Call 1: cache miss → time.time() for store = 0
        # Call 2: time.time() for cache check = 400 (>300 TTL) → expired → subprocess called → time.time() for store = 400
        with patch("subprocess.run", return_value=mock_result) as mock_run:
            with patch("worca.orchestrator.error_classifier.time.time", side_effect=[0, 400, 400]):
                _result1 = classify_error("timeout", "implement", [], str(settings_file))
                result2 = classify_error("timeout", "implement", [], str(settings_file))

        assert mock_run.call_count == 2
        assert result2.get("from_cache") is None

    def test_different_errors_get_different_cache_entries(self, tmp_path):
        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps({"worca": {}}))

        output_transient = self._make_claude_output(CATEGORY_TRANSIENT)
        output_permanent = self._make_claude_output(CATEGORY_PERMANENT, retriable=False)
        mock_result_1 = MagicMock(returncode=0, stdout=output_transient, stderr="")
        mock_result_2 = MagicMock(returncode=0, stdout=output_permanent, stderr="")

        with patch("subprocess.run", side_effect=[mock_result_1, mock_result_2]) as mock_run:
            result1 = classify_error("Connection timeout", "implement", [], str(settings_file))
            result2 = classify_error("Auth failed", "implement", [], str(settings_file))

        assert mock_run.call_count == 2
        assert result1["category"] == CATEGORY_TRANSIENT
        assert result2["category"] == CATEGORY_PERMANENT

    def test_clear_cache_resets(self, tmp_path):
        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps({"worca": {}}))

        output = self._make_claude_output(CATEGORY_TRANSIENT)
        mock_result = MagicMock(returncode=0, stdout=output, stderr="")

        with patch("subprocess.run", return_value=mock_result) as mock_run:
            classify_error("timeout", "implement", [], str(settings_file))
            clear_cache()
            classify_error("timeout", "implement", [], str(settings_file))

        assert mock_run.call_count == 2
