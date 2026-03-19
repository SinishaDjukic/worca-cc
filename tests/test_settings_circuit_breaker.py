"""Tests that settings.json contains the circuit_breaker and preflight stage configs."""
import json
from pathlib import Path

SETTINGS_PATH = Path(__file__).resolve().parents[1] / ".claude" / "settings.json"


class TestSettingsCircuitBreaker:
    def setup_method(self):
        with open(SETTINGS_PATH) as f:
            self.settings = json.load(f)
        self.worca = self.settings["worca"]

    def test_circuit_breaker_key_exists(self):
        assert "circuit_breaker" in self.worca

    def test_circuit_breaker_enabled(self):
        assert self.worca["circuit_breaker"]["enabled"] is True

    def test_circuit_breaker_max_consecutive_failures(self):
        assert self.worca["circuit_breaker"]["max_consecutive_failures"] == 3

    def test_circuit_breaker_transient_retry_count(self):
        assert self.worca["circuit_breaker"]["transient_retry_count"] == 3

    def test_circuit_breaker_transient_retry_backoff_seconds(self):
        assert self.worca["circuit_breaker"]["transient_retry_backoff_seconds"] == [10, 30, 90]

    def test_circuit_breaker_classifier_model(self):
        assert self.worca["circuit_breaker"]["classifier_model"] == "haiku"


class TestSettingsPreflightStage:
    def setup_method(self):
        with open(SETTINGS_PATH) as f:
            self.settings = json.load(f)
        self.stages = self.settings["worca"]["stages"]

    def test_preflight_stage_exists(self):
        assert "preflight" in self.stages

    def test_preflight_stage_enabled(self):
        assert self.stages["preflight"]["enabled"] is True

    def test_preflight_stage_has_script(self):
        assert self.stages["preflight"]["script"] == ".claude/scripts/preflight_checks.py"

    def test_preflight_stage_require_is_list(self):
        assert isinstance(self.stages["preflight"]["require"], list)
