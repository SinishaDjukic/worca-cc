"""Tests that settings.json contains the learn stage and learner agent config."""
import json
from pathlib import Path

SETTINGS_PATH = Path(__file__).resolve().parents[1] / "src" / "worca" / "settings.json"


class TestSettingsLearnStage:
    def setup_method(self):
        with open(SETTINGS_PATH) as f:
            self.settings = json.load(f)
        self.stages = self.settings["worca"]["stages"]
        self.agents = self.settings["worca"]["agents"]

    def test_learn_stage_exists(self):
        assert "learn" in self.stages

    def test_learn_stage_agent_is_learner(self):
        assert self.stages["learn"]["agent"] == "learner"

    def test_learn_stage_disabled_by_default(self):
        assert self.stages["learn"]["enabled"] is False

    def test_learner_agent_exists(self):
        assert "learner" in self.agents

    def test_learner_agent_model_is_sonnet(self):
        assert self.agents["learner"]["model"] == "sonnet"

    def test_learner_agent_max_turns(self):
        assert self.agents["learner"]["max_turns"] == 50
