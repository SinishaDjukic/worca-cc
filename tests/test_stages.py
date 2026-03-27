"""Tests for worca.orchestrator.stages module."""
import json

from worca.orchestrator.stages import (
    Stage,
    TRANSITIONS,
    STAGE_AGENT_MAP,
    STAGE_SCHEMA_MAP,
    STAGE_ORDER,
    _STAGES_DEFAULT_DISABLED,
    _resolve_model,
    can_transition,
    get_stage_config,
    get_enabled_stages,
    is_learn_enabled,
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

    def test_has_exactly_nine_stages(self):
        assert len(Stage) == 9

    def test_plan_review_value(self):
        assert Stage.PLAN_REVIEW.value == "plan_review"

    def test_preflight_value(self):
        assert Stage.PREFLIGHT.value == "preflight"

    def test_preflight_is_first_member(self):
        members = list(Stage)
        assert members[0] == Stage.PREFLIGHT


# --- TRANSITIONS dict ---

class TestTransitions:
    def test_plan_transitions_to_plan_review_and_coordinate(self):
        assert TRANSITIONS[Stage.PLAN] == {Stage.PLAN_REVIEW, Stage.COORDINATE}

    def test_plan_review_transitions_to_coordinate_and_plan(self):
        assert TRANSITIONS[Stage.PLAN_REVIEW] == {Stage.COORDINATE, Stage.PLAN}

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

    def test_preflight_transitions_to_plan_only(self):
        assert TRANSITIONS[Stage.PREFLIGHT] == {Stage.PLAN}

    def test_all_pipeline_stages_have_transition_entries(self):
        for stage in STAGE_ORDER:
            assert stage in TRANSITIONS


# --- STAGE_ORDER ---

class TestStageOrder:
    def test_preflight_is_first_in_stage_order(self):
        assert STAGE_ORDER[0] == Stage.PREFLIGHT

    def test_plan_follows_preflight_in_stage_order(self):
        assert STAGE_ORDER[1] == Stage.PLAN

    def test_plan_review_between_plan_and_coordinate(self):
        plan_idx = STAGE_ORDER.index(Stage.PLAN)
        coord_idx = STAGE_ORDER.index(Stage.COORDINATE)
        pr_idx = STAGE_ORDER.index(Stage.PLAN_REVIEW)
        assert plan_idx < pr_idx < coord_idx


# --- can_transition ---

class TestCanTransition:
    def test_plan_can_go_to_plan_review(self):
        assert can_transition(Stage.PLAN, Stage.PLAN_REVIEW) is True

    def test_plan_can_go_directly_to_coordinate(self):
        """PLAN can go to COORDINATE (when PLAN_REVIEW is disabled)."""
        assert can_transition(Stage.PLAN, Stage.COORDINATE) is True

    def test_plan_review_can_go_to_coordinate(self):
        assert can_transition(Stage.PLAN_REVIEW, Stage.COORDINATE) is True

    def test_plan_review_can_loop_to_plan(self):
        assert can_transition(Stage.PLAN_REVIEW, Stage.PLAN) is True

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
        for stage in STAGE_ORDER:
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

    def test_preflight_agent_is_none(self):
        assert STAGE_AGENT_MAP[Stage.PREFLIGHT] is None

    def test_plan_review_maps_to_plan_reviewer(self):
        assert STAGE_AGENT_MAP[Stage.PLAN_REVIEW] == "plan_reviewer"

    def test_all_stages_have_agent_mappings(self):
        for stage in Stage:
            assert stage in STAGE_AGENT_MAP


# --- STAGE_SCHEMA_MAP for PREFLIGHT ---

class TestPreflightSchemaMap:
    def test_preflight_schema_is_none(self):
        assert STAGE_SCHEMA_MAP[Stage.PREFLIGHT] is None

    def test_plan_review_schema_is_plan_review_json(self):
        assert STAGE_SCHEMA_MAP[Stage.PLAN_REVIEW] == "plan_review.json"


# --- get_stage_config ---

class TestGetStageConfig:
    def test_returns_defaults_when_no_settings_file(self, tmp_path):
        missing = str(tmp_path / "nonexistent.json")
        config = get_stage_config(Stage.PLAN, settings_path=missing)
        assert config["agent"] == "planner"
        assert config["model"] == "claude-sonnet-4-6"  # default "sonnet" resolved
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
        assert config["model"] == "claude-opus-4-6"  # "opus" resolved via default map
        assert config["max_turns"] == 10
        assert config["schema"] == "plan.json"

    def test_defaults_for_missing_agent_in_settings(self, tmp_path):
        settings = {"worca": {"agents": {}}}
        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps(settings))

        config = get_stage_config(Stage.IMPLEMENT, settings_path=str(settings_file))
        assert config["agent"] == "implementer"
        assert config["model"] == "claude-sonnet-4-6"  # default "sonnet" resolved
        assert config["max_turns"] == 30
        assert config["schema"] == "implement.json"

    def test_schema_matches_stage_map(self, tmp_path):
        from worca.orchestrator.stages import STAGE_SCHEMA_MAP
        missing = str(tmp_path / "nonexistent.json")
        for stage in Stage:
            config = get_stage_config(stage, settings_path=missing)
            assert config["schema"] == STAGE_SCHEMA_MAP.get(stage, f"{stage.value}.json")

    def test_test_stage_uses_test_result_schema(self, tmp_path):
        missing = str(tmp_path / "nonexistent.json")
        config = get_stage_config(Stage.TEST, settings_path=missing)
        assert config["schema"] == "test_result.json"

    def test_handles_malformed_json(self, tmp_path):
        bad_file = tmp_path / "bad.json"
        bad_file.write_text("not valid json")
        config = get_stage_config(Stage.TEST, settings_path=str(bad_file))
        assert config["agent"] == "tester"
        assert config["model"] == "claude-sonnet-4-6"

    def test_handles_empty_settings(self, tmp_path):
        empty_file = tmp_path / "empty.json"
        empty_file.write_text("{}")
        config = get_stage_config(Stage.REVIEW, settings_path=str(empty_file))
        assert config["agent"] == "guardian"
        assert config["model"] == "claude-sonnet-4-6"
        assert config["max_turns"] == 30

    def test_preflight_returns_null_config(self, tmp_path):
        missing = str(tmp_path / "nonexistent.json")
        config = get_stage_config(Stage.PREFLIGHT, settings_path=missing)
        assert config["agent"] is None
        assert config["model"] is None
        assert config["max_turns"] is None
        assert config["schema"] is None


class TestGetStageConfigWithStages:
    """Tests for get_stage_config reading agent from worca.stages."""

    def test_reads_agent_from_stages_config(self, tmp_path):
        settings = {
            "worca": {
                "stages": {
                    "plan": {"agent": "guardian", "enabled": True}
                },
                "agents": {
                    "guardian": {"model": "opus", "max_turns": 30}
                }
            }
        }
        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps(settings))
        config = get_stage_config(Stage.PLAN, settings_path=str(settings_file))
        assert config["agent"] == "guardian"
        assert config["model"] == "claude-opus-4-6"
        assert config["max_turns"] == 30

    def test_falls_back_to_hardcoded_when_no_stages_config(self, tmp_path):
        settings = {
            "worca": {
                "agents": {
                    "planner": {"model": "opus", "max_turns": 40}
                }
            }
        }
        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps(settings))
        config = get_stage_config(Stage.PLAN, settings_path=str(settings_file))
        assert config["agent"] == "planner"
        assert config["model"] == "claude-opus-4-6"

    def test_falls_back_to_hardcoded_when_stage_missing_from_stages(self, tmp_path):
        settings = {
            "worca": {
                "stages": {
                    "plan": {"agent": "guardian", "enabled": True}
                },
                "agents": {
                    "planner": {"model": "opus", "max_turns": 40}
                }
            }
        }
        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps(settings))
        # coordinate is not in stages config, falls back to STAGE_AGENT_MAP
        config = get_stage_config(Stage.COORDINATE, settings_path=str(settings_file))
        assert config["agent"] == "coordinator"


class TestGetEnabledStages:
    """Tests for get_enabled_stages filtering and ordering."""

    def test_all_stages_enabled_by_default(self, tmp_path):
        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps({}))
        stages = get_enabled_stages(str(settings_file))
        assert stages == [
            Stage.PREFLIGHT, Stage.PLAN, Stage.COORDINATE, Stage.IMPLEMENT,
            Stage.TEST, Stage.REVIEW, Stage.PR
        ]

    def test_disabled_stage_excluded(self, tmp_path):
        settings = {
            "worca": {
                "stages": {
                    "test": {"agent": "tester", "enabled": False}
                }
            }
        }
        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps(settings))
        stages = get_enabled_stages(str(settings_file))
        assert Stage.TEST not in stages
        assert stages == [
            Stage.PREFLIGHT, Stage.PLAN, Stage.COORDINATE, Stage.IMPLEMENT,
            Stage.REVIEW, Stage.PR
        ]

    def test_multiple_disabled_stages(self, tmp_path):
        settings = {
            "worca": {
                "stages": {
                    "test": {"agent": "tester", "enabled": False},
                    "review": {"agent": "guardian", "enabled": False}
                }
            }
        }
        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps(settings))
        stages = get_enabled_stages(str(settings_file))
        assert stages == [
            Stage.PREFLIGHT, Stage.PLAN, Stage.COORDINATE, Stage.IMPLEMENT, Stage.PR
        ]

    def test_preserves_stage_order(self, tmp_path):
        settings = {
            "worca": {
                "stages": {
                    "coordinate": {"agent": "coordinator", "enabled": False}
                }
            }
        }
        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps(settings))
        stages = get_enabled_stages(str(settings_file))
        # Order is preserved: preflight, plan, implement, test, review, pr
        assert stages[0] == Stage.PREFLIGHT
        assert stages[1] == Stage.PLAN
        assert stages[2] == Stage.IMPLEMENT

    def test_handles_missing_settings_file(self, tmp_path):
        missing = str(tmp_path / "nonexistent.json")
        stages = get_enabled_stages(missing)
        assert len(stages) == 7  # all enabled by default (preflight + 6)

    def test_enabled_true_explicitly(self, tmp_path):
        settings = {
            "worca": {
                "stages": {
                    "plan": {"agent": "planner", "enabled": True}
                }
            }
        }
        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps(settings))
        stages = get_enabled_stages(str(settings_file))
        assert Stage.PLAN in stages

    def test_plan_review_not_enabled_by_default(self, tmp_path):
        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps({}))
        stages = get_enabled_stages(str(settings_file))
        assert Stage.PLAN_REVIEW not in stages

    def test_plan_review_enabled_when_explicitly_set(self, tmp_path):
        settings = {
            "worca": {
                "stages": {
                    "plan_review": {"agent": "plan_reviewer", "enabled": True}
                }
            }
        }
        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps(settings))
        stages = get_enabled_stages(str(settings_file))
        assert Stage.PLAN_REVIEW in stages
        plan_idx = stages.index(Stage.PLAN)
        coord_idx = stages.index(Stage.COORDINATE)
        pr_idx = stages.index(Stage.PLAN_REVIEW)
        assert plan_idx < pr_idx < coord_idx


# --- LEARN stage (out-of-band) ---

class TestLearnStage:
    """Tests for LEARN stage enum, maps, and exclusion from pipeline flow."""

    def test_learn_enum_value(self):
        assert Stage.LEARN.value == "learn"

    def test_learn_in_agent_map(self):
        assert STAGE_AGENT_MAP[Stage.LEARN] == "learner"

    def test_learn_in_schema_map(self):
        assert STAGE_SCHEMA_MAP[Stage.LEARN] == "learn.json"

    def test_learn_not_in_stage_order(self):
        assert Stage.LEARN not in STAGE_ORDER

    def test_learn_not_in_transitions(self):
        assert Stage.LEARN not in TRANSITIONS

    def test_learn_not_in_enabled_stages(self, tmp_path):
        """LEARN should never appear in get_enabled_stages (it's out-of-band)."""
        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps({}))
        stages = get_enabled_stages(str(settings_file))
        assert Stage.LEARN not in stages

    def test_learn_not_in_enabled_stages_even_when_enabled(self, tmp_path):
        """Even with learn.enabled=True, it should not appear in pipeline stages."""
        settings = {
            "worca": {
                "stages": {
                    "learn": {"agent": "learner", "enabled": True}
                }
            }
        }
        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps(settings))
        stages = get_enabled_stages(str(settings_file))
        assert Stage.LEARN not in stages


class TestStagesDefaultDisabled:
    """Tests for _STAGES_DEFAULT_DISABLED set."""

    def test_plan_review_in_default_disabled(self):
        assert Stage.PLAN_REVIEW in _STAGES_DEFAULT_DISABLED

    def test_learn_in_default_disabled(self):
        assert Stage.LEARN in _STAGES_DEFAULT_DISABLED

    def test_default_disabled_contains_exactly_two_stages(self):
        assert len(_STAGES_DEFAULT_DISABLED) == 2

    def test_regular_stages_not_in_default_disabled(self):
        for stage in (Stage.PREFLIGHT, Stage.PLAN, Stage.COORDINATE,
                      Stage.IMPLEMENT, Stage.TEST, Stage.REVIEW, Stage.PR):
            assert stage not in _STAGES_DEFAULT_DISABLED


class TestIsLearnEnabled:
    """Tests for is_learn_enabled() helper."""

    def test_defaults_to_false(self, tmp_path):
        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps({}))
        assert is_learn_enabled(str(settings_file)) is False

    def test_false_when_explicitly_disabled(self, tmp_path):
        settings = {
            "worca": {
                "stages": {
                    "learn": {"enabled": False}
                }
            }
        }
        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps(settings))
        assert is_learn_enabled(str(settings_file)) is False

    def test_true_when_enabled(self, tmp_path):
        settings = {
            "worca": {
                "stages": {
                    "learn": {"enabled": True}
                }
            }
        }
        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps(settings))
        assert is_learn_enabled(str(settings_file)) is True

    def test_false_when_settings_file_missing(self, tmp_path):
        missing = str(tmp_path / "nonexistent.json")
        assert is_learn_enabled(missing) is False

    def test_false_when_malformed_json(self, tmp_path):
        bad_file = tmp_path / "bad.json"
        bad_file.write_text("not valid json")
        assert is_learn_enabled(str(bad_file)) is False

    def test_get_stage_config_works_for_learn(self, tmp_path):
        """get_stage_config should return proper config for LEARN stage."""
        missing = str(tmp_path / "nonexistent.json")
        config = get_stage_config(Stage.LEARN, settings_path=missing)
        assert config["agent"] == "learner"
        assert config["schema"] == "learn.json"


class TestModelResolution:
    """Tests for _resolve_model and model mapping in get_stage_config."""

    def test_resolve_model_from_settings_map(self):
        model_map = {"sonnet": "my-custom-sonnet-id"}
        assert _resolve_model("sonnet", model_map) == "my-custom-sonnet-id"

    def test_resolve_model_falls_back_to_default_map(self):
        assert _resolve_model("opus", {}) == "claude-opus-4-6"
        assert _resolve_model("sonnet", {}) == "claude-sonnet-4-6"
        assert _resolve_model("haiku", {}) == "claude-haiku-4-5-20251001"

    def test_resolve_model_settings_overrides_default(self):
        model_map = {"opus": "claude-opus-4-99-custom"}
        assert _resolve_model("opus", model_map) == "claude-opus-4-99-custom"

    def test_resolve_model_passthrough_full_id(self):
        assert _resolve_model("claude-sonnet-4-6", {}) == "claude-sonnet-4-6"

    def test_resolve_model_unknown_shorthand_passthrough(self):
        assert _resolve_model("gpt-4o", {}) == "gpt-4o"

    def test_get_stage_config_uses_settings_model_map(self, tmp_path):
        settings = {
            "worca": {
                "models": {
                    "sonnet": "claude-sonnet-custom-123"
                },
                "agents": {
                    "implementer": {"model": "sonnet", "max_turns": 30}
                }
            }
        }
        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps(settings))
        config = get_stage_config(Stage.IMPLEMENT, settings_path=str(settings_file))
        assert config["model"] == "claude-sonnet-custom-123"

    def test_get_stage_config_resolves_without_models_section(self, tmp_path):
        settings = {
            "worca": {
                "agents": {
                    "implementer": {"model": "sonnet", "max_turns": 30}
                }
            }
        }
        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps(settings))
        config = get_stage_config(Stage.IMPLEMENT, settings_path=str(settings_file))
        assert config["model"] == "claude-sonnet-4-6"
