"""Tests that settings.json contains the plan_review stage and plan_reviewer agent config."""
import json
from pathlib import Path

SETTINGS_PATH = Path(__file__).resolve().parents[1] / ".claude" / "settings.json"


class TestSettingsPlanReviewStage:
    def setup_method(self):
        with open(SETTINGS_PATH) as f:
            self.settings = json.load(f)
        self.stages = self.settings["worca"]["stages"]
        self.agents = self.settings["worca"]["agents"]
        self.loops = self.settings["worca"]["loops"]

    def test_plan_review_stage_exists(self):
        assert "plan_review" in self.stages

    def test_plan_review_stage_agent_is_plan_reviewer(self):
        assert self.stages["plan_review"]["agent"] == "plan_reviewer"

    def test_plan_review_stage_disabled_by_default(self):
        assert self.stages["plan_review"]["enabled"] is False

    def test_plan_reviewer_agent_exists(self):
        assert "plan_reviewer" in self.agents

    def test_plan_reviewer_agent_model_is_opus(self):
        assert self.agents["plan_reviewer"]["model"] == "opus"

    def test_plan_reviewer_agent_max_turns(self):
        assert self.agents["plan_reviewer"]["max_turns"] == 50

    def test_plan_review_loop_count(self):
        assert self.loops["plan_review"] == 2
