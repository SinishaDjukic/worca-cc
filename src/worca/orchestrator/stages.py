"""Pipeline stage definitions and transition validation."""
from enum import Enum

from worca.utils.settings import load_settings


class Stage(Enum):
    """Pipeline stages in order."""
    PREFLIGHT = "preflight"
    PLAN = "plan"
    PLAN_REVIEW = "plan_review"
    COORDINATE = "coordinate"
    IMPLEMENT = "implement"
    TEST = "test"
    REVIEW = "review"
    PR = "pr"
    LEARN = "learn"


TRANSITIONS = {
    Stage.PREFLIGHT: {Stage.PLAN},
    Stage.PLAN: {Stage.PLAN_REVIEW, Stage.COORDINATE},
    Stage.PLAN_REVIEW: {Stage.COORDINATE, Stage.PLAN},
    Stage.COORDINATE: {Stage.IMPLEMENT},
    Stage.IMPLEMENT: {Stage.TEST},
    Stage.TEST: {Stage.REVIEW, Stage.IMPLEMENT},
    Stage.REVIEW: {Stage.PR, Stage.IMPLEMENT, Stage.PLAN},
    Stage.PR: set(),
}

STAGE_AGENT_MAP = {
    Stage.PREFLIGHT: None,
    Stage.PLAN: "planner",
    Stage.PLAN_REVIEW: "plan_reviewer",
    Stage.COORDINATE: "coordinator",
    Stage.IMPLEMENT: "implementer",
    Stage.TEST: "tester",
    Stage.REVIEW: "guardian",
    Stage.PR: "guardian",
    Stage.LEARN: "learner",
}

STAGE_SCHEMA_MAP = {
    Stage.PREFLIGHT: None,
    Stage.PLAN: "plan.json",
    Stage.PLAN_REVIEW: "plan_review.json",
    Stage.COORDINATE: "coordinate.json",
    Stage.IMPLEMENT: "implement.json",
    Stage.TEST: "test_result.json",
    Stage.REVIEW: "review.json",
    Stage.PR: "pr.json",
    Stage.LEARN: "learn.json",
}


def can_transition(from_stage: Stage, to_stage: Stage) -> bool:
    """Return True if transition from from_stage to to_stage is valid."""
    return to_stage in TRANSITIONS.get(from_stage, set())


# Canonical stage order (not configurable — use enabled flag to skip)
STAGE_ORDER = [Stage.PREFLIGHT, Stage.PLAN, Stage.PLAN_REVIEW, Stage.COORDINATE, Stage.IMPLEMENT, Stage.TEST, Stage.REVIEW, Stage.PR]

# Stages that default to disabled when not configured in settings.json
_STAGES_DEFAULT_DISABLED = {Stage.PLAN_REVIEW, Stage.LEARN}


def _read_settings(settings_path: str) -> dict:
    """Read and parse settings, with .local.json merge support."""
    return load_settings(settings_path)


_DEFAULT_MODEL_MAP = {
    "opus": "claude-opus-4-6",
    "sonnet": "claude-sonnet-4-6",
    "haiku": "claude-haiku-4-5-20251001",
}


def _resolve_model(shorthand: str, model_map: dict) -> str:
    """Resolve a model shorthand to a full model ID.

    Looks up shorthand in the provided model_map (from settings), then falls
    back to _DEFAULT_MODEL_MAP.  If neither has an entry, returns the input
    as-is (assumed to already be a full model ID).
    """
    return model_map.get(shorthand, _DEFAULT_MODEL_MAP.get(shorthand, shorthand))


def get_stage_config(stage: Stage, settings_path: str = ".claude/settings.json") -> dict:
    """Read settings.json and return agent config for the given stage.

    Agent mapping priority:
    1. worca.stages.<stage>.agent (if present)
    2. STAGE_AGENT_MAP[stage] (hardcoded default)

    Model resolution:
    1. worca.agents.<agent>.model (shorthand like "sonnet")
    2. Resolved via worca.models mapping in settings, then _DEFAULT_MODEL_MAP
    """
    settings = _read_settings(settings_path)
    worca = settings.get("worca", {})

    # Determine agent: prefer stages config, fall back to hardcoded map
    stages_config = worca.get("stages", {})
    stage_entry = stages_config.get(stage.value, {})
    agent_name = stage_entry.get("agent") or STAGE_AGENT_MAP.get(stage)

    if agent_name is None:
        return {"agent": None, "model": None, "max_turns": None, "schema": None}

    agent_config = worca.get("agents", {}).get(agent_name, {})
    model_map = worca.get("models", {})
    raw_model = agent_config.get("model", "sonnet")
    return {
        "agent": agent_name,
        "model": _resolve_model(raw_model, model_map),
        "max_turns": agent_config.get("max_turns", 30),
        "schema": STAGE_SCHEMA_MAP.get(stage, f"{stage.value}.json"),
    }


def get_enabled_stages(settings_path: str = ".claude/settings.json") -> list:
    """Return list of enabled stages in pipeline order.

    Reads worca.stages.<stage>.enabled from settings.json.
    Stages in _STAGES_DEFAULT_DISABLED default to disabled if not configured.
    All other stages default to enabled if not configured.
    """
    settings = _read_settings(settings_path)
    stages_config = settings.get("worca", {}).get("stages", {})

    enabled = []
    for stage in STAGE_ORDER:
        stage_entry = stages_config.get(stage.value, {})
        default_enabled = stage not in _STAGES_DEFAULT_DISABLED
        if stage_entry.get("enabled", default_enabled):
            enabled.append(stage)
    return enabled


def is_learn_enabled(settings_path: str = ".claude/settings.json") -> bool:
    """Check if learn stage is enabled. Defaults to False (opposite of other stages)."""
    settings = _read_settings(settings_path)
    return settings.get("worca", {}).get("stages", {}).get("learn", {}).get("enabled", False)
