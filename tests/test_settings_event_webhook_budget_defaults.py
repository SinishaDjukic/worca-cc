"""Tests that settings.json contains worca.events, worca.webhooks, and worca.budget defaults."""
import json
from pathlib import Path

SETTINGS_PATH = Path(__file__).resolve().parents[1] / ".claude" / "settings.json"


class TestSettingsEventWebhookBudgetDefaults:
    def setup_method(self):
        with open(SETTINGS_PATH) as f:
            self.settings = json.load(f)
        self.worca = self.settings["worca"]

    # ------------------------------------------------------------------
    # worca.events
    # ------------------------------------------------------------------

    def test_events_key_exists(self):
        assert "events" in self.worca

    def test_events_enabled_true(self):
        assert self.worca["events"]["enabled"] is True

    def test_events_agent_telemetry_true(self):
        assert self.worca["events"]["agent_telemetry"] is True

    def test_events_hook_events_true(self):
        assert self.worca["events"]["hook_events"] is True

    def test_events_rate_limit_ms_1000(self):
        assert self.worca["events"]["rate_limit_ms"] == 1000

    # ------------------------------------------------------------------
    # worca.webhooks
    # ------------------------------------------------------------------

    def test_webhooks_key_exists(self):
        assert "webhooks" in self.worca

    def test_webhooks_is_empty_list(self):
        assert self.worca["webhooks"] == []

    # ------------------------------------------------------------------
    # worca.budget
    # ------------------------------------------------------------------

    def test_budget_key_exists(self):
        assert "budget" in self.worca

    def test_budget_max_cost_usd_is_null(self):
        assert self.worca["budget"]["max_cost_usd"] is None

    def test_budget_warning_pct_is_80(self):
        assert self.worca["budget"]["warning_pct"] == 80

    # ------------------------------------------------------------------
    # worca.hooks
    # ------------------------------------------------------------------

    def test_hooks_key_exists(self):
        assert "hooks" in self.worca

    def test_hooks_is_dict(self):
        assert isinstance(self.worca["hooks"], dict)
