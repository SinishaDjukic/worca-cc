"""Pipeline stage definitions and transition validation."""
import os
import sys
from enum import Enum

from worca.utils.settings import (
    load_settings,
    load_settings_with_global_fallback,
    resolve_model,
    _parse_model_ref,
    resolve_tier_pinned,
)


class PreflightError(Exception):
    """Raised when a tier-pinned model ref fails to resolve at preflight time."""


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
    Stage.REVIEW: "reviewer",
    Stage.PR: "guardian",
    Stage.LEARN: "learner",
}

# Agents that exist outside the per-stage flow. Workspace runs use
# `workspace_planner` to decompose a prompt across sibling projects; it's
# governed alongside the stage agents but never tied to a Stage enum value.
# Add new non-stage agents here so the JS roster + the denylist-sync test stay
# aligned without ad-hoc additions at the test layer.
NON_STAGE_AGENTS = frozenset({"workspace_planner"})

ALL_AGENTS = frozenset(
    {v for v in STAGE_AGENT_MAP.values() if v is not None} | NON_STAGE_AGENTS
)

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


def can_transition(from_stage: Stage, to_stage: Stage, *, mode: str | None = None) -> bool:
    """Return True if transition from from_stage to to_stage is valid.

    In review_and_edit mode, PLAN_REVIEW cannot loop back to PLAN.
    """
    allowed = TRANSITIONS.get(from_stage, set())
    if mode == "review_and_edit" and from_stage == Stage.PLAN_REVIEW:
        allowed = allowed - {Stage.PLAN}
    return to_stage in allowed


# Canonical stage order (not configurable — use enabled flag to skip)
STAGE_ORDER = [Stage.PREFLIGHT, Stage.PLAN, Stage.PLAN_REVIEW, Stage.COORDINATE, Stage.IMPLEMENT, Stage.TEST, Stage.REVIEW, Stage.PR]

# Stages that default to disabled when not configured in settings.json
_STAGES_DEFAULT_DISABLED = {Stage.PLAN_REVIEW, Stage.LEARN}

# Env-var names that, when set on a model alias's `env` block in worca.models,
# reroute Claude CLI to a non-Anthropic endpoint. Their presence is the signal
# that Claude CLI's total_cost_usd was computed against the wrong pricing table
# and worca should override it from worca.pricing.models.<alias>. Conservative
# and explicit by design — new entries are added deliberately, never inferred.
_ALT_ENDPOINT_ENV_KEYS = frozenset({"ANTHROPIC_BASE_URL"})


def _read_settings(settings_path: str) -> dict:
    """Read and parse settings, with .local.json merge support."""
    return load_settings(settings_path)


def _resolve_model(shorthand, model_map):
    """Resolve a model shorthand to (full_id, env_dict)."""
    return resolve_model(shorthand, model_map)


def get_stage_config(
    stage: Stage,
    settings_path: str = ".claude/settings.json",
    *,
    global_path: str | None = None,
) -> dict:
    """Read settings.json and return agent config for the given stage.

    Agent mapping priority:
    1. worca.stages.<stage>.agent (if present)
    2. STAGE_AGENT_MAP[stage] (hardcoded default)

    Model resolution:
    1. WORCA_MODEL_<AGENT> env var (highest priority, logs override to stderr)
    2. worca.agents.<agent>.model — tier-pinned ('tier:alias') or bare alias
    3. Resolved via worca.models / _DEFAULT_MODEL_MAP

    Pass global_path to enable tier-pinned ('user:'/'project:') resolution via the
    per-tier stash.  Without global_path, 'user:' and 'project:' pins raise
    PreflightError.  'builtin:' pins always work (no stash needed).
    """
    settings = load_settings_with_global_fallback(settings_path, global_path=global_path)

    worca = settings.get("worca", {})

    # Determine agent: prefer stages config, fall back to hardcoded map
    stages_config = worca.get("stages", {})
    stage_entry = stages_config.get(stage.value, {})
    agent_name = stage_entry.get("agent") or STAGE_AGENT_MAP.get(stage)

    return _resolve_agent_config(
        agent_name, STAGE_SCHEMA_MAP.get(stage, f"{stage.value}.json"), settings,
    )


def get_stage_config_for(
    flow_stage,
    settings_path: str = ".claude/settings.json",
    *,
    global_path: str | None = None,
) -> dict:
    """Agent config for a resolved FlowSpec stage entry (W-071).

    Unlike get_stage_config (Stage enum + legacy maps), the agent and schema
    come from the flow entry — already merged from worca.flow, worca.stages,
    and the builtin defaults at flow compile time. This is what lets a flow
    entry's per-stage agent/schema overrides (and custom stage names) actually
    reach agent dispatch. Model/effort/turns resolution is shared with
    get_stage_config and stays keyed by agent name.
    """
    settings = load_settings_with_global_fallback(settings_path, global_path=global_path)
    return _resolve_agent_config(flow_stage.agent, flow_stage.schema, settings)


def _resolve_agent_config(agent_name, schema, settings: dict) -> dict:
    """Shared model/env/effort/turns resolution for a resolved agent + schema."""
    worca = settings.get("worca", {})

    if agent_name is None:
        return {"agent": None, "model": None, "model_env": {}, "max_turns": None, "effort": None, "schema": None, "cost_alias": None}

    agent_config = worca.get("agents", {}).get(agent_name, {})
    model_map = worca.get("models", {})
    raw_model = agent_config.get("model", "sonnet")

    # WORCA_MODEL_<AGENT> env var wins over both bare and tier-pinned refs.
    env_var_name = f"WORCA_MODEL_{agent_name.upper()}"
    env_override = os.environ.get(env_var_name)
    if env_override:
        print(
            f"[stages] model override: {env_var_name}={env_override!r} overrides {raw_model!r}",
            file=sys.stderr,
        )
        raw_model = env_override

    # Detect tier-pinned refs; malformed refs fall through to bare passthrough.
    try:
        tier, _alias = _parse_model_ref(raw_model)
    except ValueError:
        tier = None

    if tier is not None:
        # user:/project: require the per-tier stash populated by load_settings_with_global_fallback.
        if tier in ("user", "project") and "_worca_tier_views" not in settings:
            raise PreflightError(
                f"tier-pinned ref {raw_model!r}: per-tier views unavailable; "
                "load settings via load_settings_with_global_fallback"
            )
        model_id, model_env, error_msg = resolve_tier_pinned(raw_model, settings)
        if error_msg:
            raise PreflightError(error_msg)
    else:
        model_id, model_env = _resolve_model(raw_model, model_map)

    model_alias = raw_model if raw_model != model_id else None
    _reroutes_api = bool(_ALT_ENDPOINT_ENV_KEYS & set(model_env or {}))
    cost_alias = (_alias if tier else raw_model) if _reroutes_api else None
    return {
        "agent": agent_name,
        "model": model_id,
        "model_alias": model_alias,
        "cost_alias": cost_alias,
        "model_env": model_env,
        "max_turns": agent_config.get("max_turns", 30),
        "effort": agent_config.get("effort"),
        "max_beads": agent_config.get("max_beads", 0),
        "schema": schema,
    }


def validate_tier_pinned_agent_models(settings: dict) -> list:
    """Validate all tier-pinned agent model refs in settings.

    Returns a list of error strings (empty if all pins resolve).
    Bare refs are ignored — opaque pass-through is preserved.
    """
    agents_cfg = settings.get("worca", {}).get("agents", {})
    errors = []
    for role, agent_config in agents_cfg.items():
        if not isinstance(agent_config, dict):
            continue
        ref = agent_config.get("model")
        if ref is None:
            continue
        try:
            tier, _alias = _parse_model_ref(ref)
        except ValueError:
            continue  # malformed — caught by template validator
        if tier is None:
            continue  # bare ref
        _, _, error_msg = resolve_tier_pinned(ref, settings)
        if error_msg:
            errors.append(f"agents.{role}.model: {error_msg}")
    return errors


def get_enabled_stages(settings_path: str = ".claude/settings.json") -> list:
    """Return list of enabled stages in pipeline order.

    Thin wrapper over the declarative flow (W-070): the effective flow —
    worca.flow if present, else the compiled default — determines order and
    enabled-ness. The compiled default preserves the legacy semantics
    exactly: worca.stages.<stage>.enabled overrides, _STAGES_DEFAULT_DISABLED
    stages default disabled, everything else enabled.
    """
    from worca.orchestrator.flow import load_flow  # local import: flow imports stages

    return [Stage(s.name) for s in load_flow(settings_path).stages]


VALID_PLAN_REVIEW_MODES = ("review", "review_and_edit")
VALID_PLAN_REVIEW_ENFORCE = ("auto", "review", "review_and_edit")


def resolve_plan_review_mode(settings: dict) -> tuple[str, str]:
    """Resolve the effective plan-review mode from settings.

    Precedence: governance enforce (if != auto) -> pipeline/template mode -> built-in 'review'.
    Returns (mode, reason) tuple.
    """
    worca = settings.get("worca", {})
    enforce = worca.get("governance", {}).get("plan_review_enforce", "auto")
    if enforce in ("review", "review_and_edit"):
        return (enforce, "forced by project (governance.plan_review_enforce)")

    template_mode = worca.get("stages", {}).get("plan_review", {}).get("mode")
    if template_mode in VALID_PLAN_REVIEW_MODES:
        return (template_mode, "from template/pipeline")

    return ("review", "default")


def validate_plan_review_settings(settings: dict) -> list[str]:
    """Validate plan-review enum fields in a parsed settings dict.

    Returns a list of error strings (empty if valid).
    """
    errors: list[str] = []
    worca = settings.get("worca", {})

    mode = worca.get("stages", {}).get("plan_review", {}).get("mode")
    if mode is not None:
        if not isinstance(mode, str) or mode not in VALID_PLAN_REVIEW_MODES:
            errors.append(
                f"stages.plan_review.mode must be one of: {', '.join(VALID_PLAN_REVIEW_MODES)}"
            )

    enforce = worca.get("governance", {}).get("plan_review_enforce")
    if enforce is not None:
        if not isinstance(enforce, str) or enforce not in VALID_PLAN_REVIEW_ENFORCE:
            errors.append(
                f"governance.plan_review_enforce must be one of: {', '.join(VALID_PLAN_REVIEW_ENFORCE)}"
            )

    return errors


def is_learn_enabled(settings_path: str = ".claude/settings.json") -> bool:
    """Check if learn stage is enabled. Defaults to False (opposite of other stages)."""
    settings = _read_settings(settings_path)
    return settings.get("worca", {}).get("stages", {}).get("learn", {}).get("enabled", False)
