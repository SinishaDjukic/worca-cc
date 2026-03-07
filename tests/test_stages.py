"""Tests for worca.orchestrator.stages module."""
import json

from worca.orchestrator.stages import (
    Stage,
    TRANSITIONS,
    STAGE_AGENT_MAP,
    can_transition,
    get_stage_config,
)


# --- Stage enum ---

class TestStageEnum:
    def test_plan_value(self):
        assert Stage.PLAN.value == "plan"

    def test_coordinate_value(self):
        assert Stage.COORDINATE.value == "coordinate"

    def test_implement_value(self):
        assert Stage.IMPLEMENT.value == "implement"

    def test_test_value(self):
        assert Stage.TEST.value == "test"

    def test_review_value(self):
        assert Stage.REVIEW.value == "review"

    def test_pr_value(self):
        assert Stage.PR.value == "pr"

    def test_has_exactly_six_stages(self):
        assert len(Stage) == 6


# --- TRANSITIONS dict ---

class TestTransitions:
    def test_plan_transitions_to_coordinate_only(self):
        assert TRANSITIONS[Stage.PLAN] == {Stage.COORDINATE}

    def test_coordinate_transitions_to_implement_only(self):
        assert TRANSITIONS[Stage.COORDINATE] == {Stage.IMPLEMENT}

    def test_implement_transitions_to_test_only(self):
        assert TRANSITIONS[Stage.IMPLEMENT] == {Stage.TEST}

    def test_test_can_go_to_review_or_implement(self):
        assert TRANSITIONS[Stage.TEST] == {Stage.REVIEW, Stage.IMPLEMENT}

    def test_review_can_go_to_pr_implement_or_plan(self):
        assert TRANSITIONS[Stage.REVIEW] == {Stage.PR, Stage.IMPLEMENT, Stage.PLAN}

    def test_pr_is_terminal(self):
        assert TRANSITIONS[Stage.PR] == set()

    def test_all_stages_have_transition_entries(self):
        for stage in Stage:
            assert stage in TRANSITIONS


# --- can_transition ---

class TestCanTransition:
    def test_plan_can_go_to_coordinate(self):
        assert can_transition(Stage.PLAN, Stage.COORDINATE) is True

    def test_plan_cannot_skip_to_pr(self):
        assert can_transition(Stage.PLAN, Stage.PR) is False

    def test_plan_cannot_go_to_implement(self):
        assert can_transition(Stage.PLAN, Stage.IMPLEMENT) is False

    def test_test_can_loop_to_implement(self):
        assert can_transition(Stage.TEST, Stage.IMPLEMENT) is True

    def test_test_can_go_to_review(self):
        assert can_transition(Stage.TEST, Stage.REVIEW) is True

    def test_test_cannot_go_to_pr(self):
        assert can_transition(Stage.TEST, Stage.PR) is False

    def test_review_can_loop_to_plan(self):
        assert can_transition(Stage.REVIEW, Stage.PLAN) is True

    def test_review_can_loop_to_implement(self):
        assert can_transition(Stage.REVIEW, Stage.IMPLEMENT) is True

    def test_review_can_go_to_pr(self):
        assert can_transition(Stage.REVIEW, Stage.PR) is True

    def test_pr_cannot_go_anywhere(self):
        for stage in Stage:
            assert can_transition(Stage.PR, stage) is False

    def test_coordinate_cannot_go_to_plan(self):
        assert can_transition(Stage.COORDINATE, Stage.PLAN) is False


# --- STAGE_AGENT_MAP ---

class TestStageAgentMap:
    def test_plan_maps_to_planner(self):
        assert STAGE_AGENT_MAP[Stage.PLAN] == "planner"

    def test_coordinate_maps_to_coordinator(self):
        assert STAGE_AGENT_MAP[Stage.COORDINATE] == "coordinator"

    def test_implement_maps_to_implementer(self):
        assert STAGE_AGENT_MAP[Stage.IMPLEMENT] == "implementer"

    def test_test_maps_to_tester(self):
        assert STAGE_AGENT_MAP[Stage.TEST] == "tester"

    def test_review_maps_to_guardian(self):
        assert STAGE_AGENT_MAP[Stage.REVIEW] == "guardian"

    def test_pr_maps_to_guardian(self):
        assert STAGE_AGENT_MAP[Stage.PR] == "guardian"

    def test_all_stages_have_agent_mappings(self):
        for stage in Stage:
            assert stage in STAGE_AGENT_MAP


# --- get_stage_config ---

class TestGetStageConfig:
    def test_returns_defaults_when_no_settings_file(self, tmp_path):
        missing = str(tmp_path / "nonexistent.json")
        config = get_stage_config(Stage.PLAN, settings_path=missing)
        assert config["agent"] == "planner"
        assert config["model"] == "sonnet"
        assert config["max_turns"] == 30
        assert config["schema"] == "plan.json"

    def test_reads_agent_config_from_settings(self, tmp_path):
        settings = {
            "worca": {
                "agents": {
                    "planner": {
                        "model": "opus",
                        "max_turns": 10,
                    }
                }
            }
        }
        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps(settings))

        config = get_stage_config(Stage.PLAN, settings_path=str(settings_file))
        assert config["agent"] == "planner"
        assert config["model"] == "opus"
        assert config["max_turns"] == 10
        assert config["schema"] == "plan.json"

    def test_defaults_for_missing_agent_in_settings(self, tmp_path):
        settings = {"worca": {"agents": {}}}
        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps(settings))

        config = get_stage_config(Stage.IMPLEMENT, settings_path=str(settings_file))
        assert config["agent"] == "implementer"
        assert config["model"] == "sonnet"
        assert config["max_turns"] == 30
        assert config["schema"] == "implement.json"

    def test_schema_matches_stage_value(self, tmp_path):
        missing = str(tmp_path / "nonexistent.json")
        for stage in Stage:
            config = get_stage_config(stage, settings_path=missing)
            assert config["schema"] == f"{stage.value}.json"

    def test_handles_malformed_json(self, tmp_path):
        bad_file = tmp_path / "bad.json"
        bad_file.write_text("not valid json")
        config = get_stage_config(Stage.TEST, settings_path=str(bad_file))
        assert config["agent"] == "tester"
        assert config["model"] == "sonnet"

    def test_handles_empty_settings(self, tmp_path):
        empty_file = tmp_path / "empty.json"
        empty_file.write_text("{}")
        config = get_stage_config(Stage.REVIEW, settings_path=str(empty_file))
        assert config["agent"] == "guardian"
        assert config["model"] == "sonnet"
        assert config["max_turns"] == 30
