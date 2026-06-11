"""Declarative pipeline flow specification (W-070).

A flow spec describes the ordered stage list and outcome-driven transitions
(including loops). The builtin default flow is compiled from the same enum +
maps the runner has always used (STAGE_ORDER, STAGE_AGENT_MAP,
STAGE_SCHEMA_MAP, the stage block map) so default behavior is byte-identical
to the legacy index-walking loop — parity is asserted in tests/test_flow.py.

Projects and templates override the topology via `worca.flow` (settings.json
or template config), validated against src/worca/schemas/flow.json. A
malformed flow fails at launch (FlowError), never mid-run.
"""
import hashlib
import json
import os

from worca.orchestrator.stages import (
    STAGE_AGENT_MAP,
    STAGE_ORDER,
    STAGE_SCHEMA_MAP,
    Stage,
    _STAGES_DEFAULT_DISABLED,
)
from worca.utils.settings import load_settings

FLOW_VERSION = 1

# User-message block (.block.md) per builtin stage. The single source of
# truth since W-071 — the runner consumes FlowStage.prompt_block (compiled
# from this map for the default flow). Stages absent here (PREFLIGHT) fall
# back to the default rendered prompt.
DEFAULT_STAGE_BLOCKS = {
    Stage.PLAN.value:        "plan",
    Stage.PLAN_REVIEW.value: "plan-review",
    Stage.COORDINATE.value:  "coordinate",
    Stage.IMPLEMENT.value:   "implement",
    Stage.TEST.value:        "test",
    Stage.REVIEW.value:      "review",
    Stage.PR.value:          "pr",
    Stage.LEARN.value:       "learn",
}

# The five legacy loopback transitions, exactly as hardcoded at the runner
# jump sites: stage -> {trigger: (goto, loop_key)}. bead_iteration's limit is
# dynamic (depends on created bead count) — provided at runtime via
# resolve_loop_limit(runtime_limits=...), never from worca.loops.
DEFAULT_TRANSITIONS = {
    Stage.PLAN_REVIEW.value: {
        "plan_review_revise": ("plan", "plan_review"),
    },
    Stage.IMPLEMENT.value: {
        "next_bead": ("implement", "bead_iteration"),
    },
    Stage.TEST.value: {
        "test_failure": ("implement", "implement_test"),
    },
    Stage.REVIEW.value: {
        "review_changes": ("implement", "pr_changes"),
        "restart_planning": ("plan", "restart_planning"),
    },
}

_STAGE_ENTRY_FIELDS = {"name", "agent", "schema", "prompt_block", "enabled", "post", "on"}
_TRANSITION_FIELDS = {"goto", "loop"}

_BUILTIN_BY_NAME = {s.value: s for s in Stage}


class FlowError(Exception):
    """Raised when a flow spec is malformed. Always at launch, never mid-run."""


class Transition:
    """An outcome-driven jump: trigger -> goto stage, with optional loop key."""

    __slots__ = ("goto", "loop")

    def __init__(self, goto: str, loop: str | None = None):
        self.goto = goto
        self.loop = loop

    def __eq__(self, other):
        return (
            isinstance(other, Transition)
            and self.goto == other.goto
            and self.loop == other.loop
        )

    def __repr__(self):
        return f"Transition(goto={self.goto!r}, loop={self.loop!r})"


class FlowStage:
    """One resolved stage entry. `name` is the status.json stages.* key verbatim."""

    __slots__ = ("name", "agent", "schema", "prompt_block", "enabled", "post", "on")

    def __init__(self, name, agent=None, schema=None, prompt_block=None,
                 enabled=True, post=False, on=None):
        self.name = name
        self.agent = agent
        self.schema = schema
        self.prompt_block = prompt_block
        self.enabled = enabled
        self.post = post
        self.on = dict(on or {})

    def __repr__(self):
        return f"FlowStage({self.name!r}, enabled={self.enabled}, post={self.post})"


class FlowSpec:
    """A compiled, validated flow.

    `stages` holds the enabled, non-post stages in pipeline order — the list
    the runner walks. `post_stages` holds enabled post-pipeline stages
    (today: learn). `all_stages` keeps every entry, disabled included, for
    introspection and fingerprinting.
    """

    def __init__(self, all_stages: list, custom: bool = False):
        self.all_stages = list(all_stages)
        # True when this flow came from a user-supplied worca.flow document.
        # The runner's resume fingerprint check is enforced only for custom
        # flows — default-flow runs keep the legacy "re-derive from current
        # settings" resume semantics (zero behavior change by default).
        self.custom = custom
        self.stages = [s for s in self.all_stages if s.enabled and not s.post]
        self.post_stages = [s for s in self.all_stages if s.enabled and s.post]
        self._index = {s.name: i for i, s in enumerate(self.stages)}

    def index_of(self, name: str) -> int:
        """Index of an enabled, non-post stage by name."""
        try:
            return self._index[name]
        except KeyError:
            raise FlowError(f"flow has no enabled stage named {name!r}") from None

    def transition_for(self, current: str, trigger: str) -> Transition | None:
        """The declared transition for a trigger on an enabled stage, or None.

        None means the flow has no such jump — either never declared, or
        dropped at compile time because the target stage is disabled (the
        runner's legacy "target stage is disabled — skipping loop" guards
        map onto this check).
        """
        return self.stages[self.index_of(current)].on.get(trigger)

    def next_index(self, current: str, trigger: str | None = None) -> int | None:
        """Next stage index from `current`.

        A trigger matching a declared `on:` entry jumps to its goto target;
        otherwise advance linearly. Returns None past the last stage.
        """
        cur = self.index_of(current)
        if trigger:
            transition = self.stages[cur].on.get(trigger)
            if transition is not None:
                return self.index_of(transition.goto)
        nxt = cur + 1
        return nxt if nxt < len(self.stages) else None

    def fingerprint(self) -> str:
        """sha256 over the canonicalized flow topology.

        Persisted in status.json at launch and re-checked on resume so a run
        never silently resumes under a different topology than the one that
        produced its state. Loop *limits* (worca.loops) are tuning, not
        topology — deliberately excluded.
        """
        doc = [
            {
                "name": s.name,
                "agent": s.agent,
                "schema": s.schema,
                "prompt_block": s.prompt_block,
                "enabled": s.enabled,
                "post": s.post,
                "on": {
                    t: {"goto": tr.goto, "loop": tr.loop}
                    for t, tr in sorted(s.on.items())
                },
            }
            for s in self.all_stages
        ]
        canonical = json.dumps(doc, sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _stage_enabled(name: str, entry_enabled, stages_config: dict) -> bool:
    """Resolve a stage's enabled flag.

    Precedence: explicit flow entry > worca.stages.<name>.enabled > builtin
    default (plan_review and learn default disabled, everything else enabled).
    """
    if entry_enabled is not None:
        return bool(entry_enabled)
    cfg = stages_config.get(name, {})
    builtin = _BUILTIN_BY_NAME.get(name)
    default = builtin not in _STAGES_DEFAULT_DISABLED if builtin else True
    return bool(cfg.get("enabled", default))


def _default_agent(name: str):
    builtin = _BUILTIN_BY_NAME.get(name)
    if builtin is not None:
        return STAGE_AGENT_MAP.get(builtin)
    return name


def _default_schema(name: str):
    builtin = _BUILTIN_BY_NAME.get(name)
    if builtin is not None:
        return STAGE_SCHEMA_MAP.get(builtin)
    return f"{name}.json"


def _default_block(name: str):
    if name in _BUILTIN_BY_NAME:
        return DEFAULT_STAGE_BLOCKS.get(name)
    return name


def compile_default_flow(settings_path: str = ".claude/settings.json") -> FlowSpec:
    """Compile the builtin 9-stage flow, honoring worca.stages.* overrides.

    The enum stays the single source for the builtin set: order from
    STAGE_ORDER (+ LEARN as post), agents/schemas from the legacy maps,
    transitions from DEFAULT_TRANSITIONS. worca.stages.<name>.enabled /
    .agent merge in so existing config keeps working unchanged.

    Transitions whose goto target ends up disabled are dropped, mirroring the
    runner's "target stage is disabled — skipping loop" guards. (User-supplied
    flows fail loudly on the same condition instead — see load_flow.)
    """
    settings = load_settings(settings_path)
    stages_config = settings.get("worca", {}).get("stages", {})

    entries = []
    for stage in list(STAGE_ORDER) + [Stage.LEARN]:
        name = stage.value
        cfg = stages_config.get(name, {})
        on = {
            trigger: Transition(goto=goto, loop=loop)
            for trigger, (goto, loop) in DEFAULT_TRANSITIONS.get(name, {}).items()
        }
        entries.append(FlowStage(
            name=name,
            agent=cfg.get("agent") or STAGE_AGENT_MAP.get(stage),
            schema=STAGE_SCHEMA_MAP.get(stage),
            prompt_block=DEFAULT_STAGE_BLOCKS.get(name),
            enabled=_stage_enabled(name, None, stages_config),
            post=(stage == Stage.LEARN),
            on=on,
        ))

    enabled_names = {e.name for e in entries if e.enabled and not e.post}
    for entry in entries:
        entry.on = {
            t: tr for t, tr in entry.on.items() if tr.goto in enabled_names
        }
    return FlowSpec(entries)


def _parse_flow_doc(doc, stages_config: dict) -> list:
    """Parse + structurally validate a user-supplied worca.flow document."""
    if not isinstance(doc, dict):
        raise FlowError("worca.flow must be an object")
    version = doc.get("version")
    if version != FLOW_VERSION:
        raise FlowError(
            f"worca.flow.version must be {FLOW_VERSION}, got {version!r}"
        )
    unknown_top = set(doc) - {"version", "stages"}
    if unknown_top:
        raise FlowError(f"worca.flow has unknown keys: {sorted(unknown_top)}")
    raw_stages = doc.get("stages")
    if not isinstance(raw_stages, list) or not raw_stages:
        raise FlowError("worca.flow.stages must be a non-empty list")

    entries = []
    for i, raw in enumerate(raw_stages):
        if not isinstance(raw, dict):
            raise FlowError(f"flow stage [{i}] must be an object")
        unknown = set(raw) - _STAGE_ENTRY_FIELDS
        if unknown:
            raise FlowError(
                f"flow stage [{i}] has unknown keys: {sorted(unknown)} "
                f"(allowed: {sorted(_STAGE_ENTRY_FIELDS)})"
            )
        name = raw.get("name")
        if not name or not isinstance(name, str):
            raise FlowError(f"flow stage [{i}] is missing a string 'name'")

        on = {}
        raw_on = raw.get("on", {})
        if not isinstance(raw_on, dict):
            raise FlowError(f"flow stage {name!r}: 'on' must be an object")
        for trigger, raw_tr in raw_on.items():
            if not isinstance(raw_tr, dict):
                raise FlowError(
                    f"flow stage {name!r}: transition {trigger!r} must be an object"
                )
            unknown_tr = set(raw_tr) - _TRANSITION_FIELDS
            if unknown_tr:
                raise FlowError(
                    f"flow stage {name!r}: transition {trigger!r} has unknown "
                    f"keys: {sorted(unknown_tr)}"
                )
            goto = raw_tr.get("goto")
            if not goto or not isinstance(goto, str):
                raise FlowError(
                    f"flow stage {name!r}: transition {trigger!r} needs a string 'goto'"
                )
            on[trigger] = Transition(goto=goto, loop=raw_tr.get("loop"))

        # learn keeps its builtin post default so a flow that simply lists it
        # doesn't accidentally pull it into the main walk.
        default_post = name == Stage.LEARN.value
        entries.append(FlowStage(
            name=name,
            # Agent precedence mirrors the legacy runner path (W-071): an
            # explicit flow-entry agent wins, else worca.stages.<name>.agent,
            # else the builtin map (custom names default to themselves).
            agent=(
                raw.get("agent")
                or stages_config.get(name, {}).get("agent")
                or _default_agent(name)
            ),
            schema=raw.get("schema", _default_schema(name)),
            prompt_block=raw.get("prompt_block", _default_block(name)),
            enabled=_stage_enabled(name, raw.get("enabled"), stages_config),
            post=bool(raw.get("post", default_post)),
            on=on,
        ))
    return entries


def _validate_flow(entries: list, project_root: str = ".") -> None:
    """Semantic validation for user-supplied flows. Raises FlowError."""
    names = [e.name for e in entries]
    seen = set()
    for n in names:
        if n in seen:
            raise FlowError(f"duplicate stage name {n!r} in worca.flow")
        seen.add(n)
        # W-070 is topology-only: reordering, disabling, and rewiring the
        # builtin stages. User-defined stage names need the generic stage
        # executor (W-071) to have anything to dispatch them.
        if n not in _BUILTIN_BY_NAME:
            raise FlowError(
                f"unknown stage name {n!r} in worca.flow — custom stages are "
                f"not supported yet (W-071); builtin stages: "
                f"{sorted(_BUILTIN_BY_NAME)}"
            )

    ordered = [e for e in entries if e.enabled and not e.post]
    order_index = {e.name: i for i, e in enumerate(ordered)}
    by_name = {e.name: e for e in entries}
    reserved_loop_keys = {f"{n}_iteration" for n in names}

    for entry in entries:
        for trigger, tr in entry.on.items():
            target = by_name.get(tr.goto)
            if target is None:
                raise FlowError(
                    f"stage {entry.name!r}: transition {trigger!r} targets "
                    f"unknown stage {tr.goto!r}"
                )
            if target.post:
                raise FlowError(
                    f"stage {entry.name!r}: transition {trigger!r} targets "
                    f"post stage {tr.goto!r} — post stages cannot be jump targets"
                )
            if not target.enabled:
                raise FlowError(
                    f"stage {entry.name!r}: transition {trigger!r} targets "
                    f"disabled stage {tr.goto!r}"
                )
            if tr.loop in reserved_loop_keys:
                raise FlowError(
                    f"stage {entry.name!r}: transition {trigger!r} loop key "
                    f"{tr.loop!r} is reserved (collides with the per-stage "
                    f"iteration counter)"
                )
            # A backward (or self) goto without a loop key is an unbounded
            # cycle — nothing would ever cap it.
            if entry.enabled and not entry.post and tr.loop is None:
                if order_index[tr.goto] <= order_index[entry.name]:
                    raise FlowError(
                        f"stage {entry.name!r}: transition {trigger!r} jumps "
                        f"backward to {tr.goto!r} without a 'loop' key — "
                        f"unbounded cycle"
                    )

    # File-existence checks last, enabled stages only: a flow that names a
    # missing agent template or schema must fail at launch, not mid-run.
    for entry in entries:
        if not entry.enabled:
            continue
        if entry.agent:
            agent_path = os.path.join(
                project_root, ".claude", "worca", "agents", "core",
                f"{entry.agent}.md",
            )
            if not os.path.exists(agent_path):
                raise FlowError(
                    f"stage {entry.name!r}: agent template not found: {agent_path}"
                )
        if entry.schema:
            schema_path = os.path.join(
                project_root, ".claude", "worca", "schemas", entry.schema
            )
            if not os.path.exists(schema_path):
                raise FlowError(
                    f"stage {entry.name!r}: schema file not found: {schema_path}"
                )


def load_flow(settings_path: str = ".claude/settings.json",
              project_root: str = ".") -> FlowSpec:
    """Load the effective flow: worca.flow if present, else the builtin default.

    User-supplied flows are fully validated (structure, topology, file
    existence) and fail loudly with FlowError at launch. The compiled default
    is trusted — it carries the same parity-tested behavior the runner has
    always had.
    """
    settings = load_settings(settings_path)
    worca = settings.get("worca", {})
    doc = worca.get("flow")
    if doc is None:
        return compile_default_flow(settings_path)

    entries = _parse_flow_doc(doc, worca.get("stages", {}))
    _validate_flow(entries, project_root=project_root)
    return FlowSpec(entries, custom=True)


def resolve_loop_limit(loop_key: str, settings_path: str, mloops: int = 1,
                       runtime_limits: dict | None = None,
                       default: int = 5) -> int:
    """Effective iteration limit for a loop key.

    runtime_limits wins (bead_iteration's cap depends on the created bead
    count, so the runner supplies it per-run); otherwise worca.loops.<key>
    (default 5) scaled by the mloops multiplier.
    """
    if runtime_limits and loop_key in runtime_limits:
        return runtime_limits[loop_key]
    settings = load_settings(settings_path)
    return settings.get("worca", {}).get("loops", {}).get(loop_key, default) * mloops
