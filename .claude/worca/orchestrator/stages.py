"""Pipeline stage definitions and transition validation."""
import json
from enum import Enum
from typing import Optional


class Stage(Enum):
    """Pipeline stages in order."""
    PLAN = "plan"
    COORDINATE = "coordinate"
    IMPLEMENT = "implement"
    TEST = "test"
    REVIEW = "review"
    PR = "pr"


TRANSITIONS = {
    Stage.PLAN: {Stage.COORDINATE},
    Stage.COORDINATE: {Stage.IMPLEMENT},
    Stage.IMPLEMENT: {Stage.TEST},
    Stage.TEST: {Stage.REVIEW, Stage.IMPLEMENT},
    Stage.REVIEW: {Stage.PR, Stage.IMPLEMENT, Stage.PLAN},
    Stage.PR: set(),
}

STAGE_AGENT_MAP = {
    Stage.PLAN: "planner",
    Stage.COORDINATE: "coordinator",
    Stage.IMPLEMENT: "implementer",
    Stage.TEST: "tester",
    Stage.REVIEW: "guardian",
    Stage.PR: "guardian",
}

STAGE_SCHEMA_MAP = {
    Stage.PLAN: "plan.json",
    Stage.COORDINATE: "coordinate.json",
    Stage.IMPLEMENT: "implement.json",
    Stage.TEST: "test_result.json",
    Stage.REVIEW: "review.json",
    Stage.PR: "pr.json",
}


def can_transition(from_stage: Stage, to_stage: Stage) -> bool:
    """Return True if transition from from_stage to to_stage is valid."""
    return to_stage in TRANSITIONS.get(from_stage, set())


def get_stage_config(stage: Stage, settings_path: str = ".claude/settings.json") -> dict:
    """Read settings.json and return agent config for the given stage."""
    agent_name = STAGE_AGENT_MAP[stage]
    try:
        with open(settings_path) as f:
            settings = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        settings = {}
    agent_config = settings.get("worca", {}).get("agents", {}).get(agent_name, {})
    return {
        "agent": agent_name,
        "model": agent_config.get("model", "sonnet"),
        "max_turns": agent_config.get("max_turns", 30),
        "schema": STAGE_SCHEMA_MAP.get(stage, f"{stage.value}.json"),
    }
