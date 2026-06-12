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
import re

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

_STAGE_ENTRY_FIELDS = {
    "name", "agent", "schema", "prompt_block", "enabled", "post", "on", "outputs",
}
_TRANSITION_FIELDS = {"goto", "loop"}

# Declared stage outputs (W-072): output name -> JSON pointer into the
# stage's validated schema result. Names become the trailing segment of the
# namespaced context key ``stages.<stage>.<output>``.
_OUTPUT_NAME_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")
_OUTPUT_POINTER_RE = re.compile(r"^(/[^/]+)+$")

# Builtin per-stage output declarations (W-072 Phase 3). Stages convert one
# at a time; an entry here means the executor auto-publishes these picks
# under stages.<name>.* after schema validation. Transforms (filtered issue
# lists, accumulated file sets) stay handler code — they reach the namespace
# through the CONTEXT_ALIASES dual-write, not through declarations.
DEFAULT_STAGE_OUTPUTS: dict = {
    Stage.PLAN.value: {
        "approach": "/approach",
        "tasks_outline": "/tasks_outline",
    },
    # The raw reviewer issue list. The severity-filtered list that drives the
    # revise loop stays handler code (stages.plan_review.critical_issues via
    # alias dual-write).
    Stage.PLAN_REVIEW.value: {
        "issues": "/issues",
    },
    Stage.COORDINATE.value: {
        "beads_ids": "/beads_ids",
        "dependency_graph": "/dependency_graph",
    },
    # Per-bead picks; the cross-bead accumulations (all_files_changed,
    # all_tests_added) and the final deduped overwrite stay handler code.
    Stage.IMPLEMENT.value: {
        "files_changed": "/files_changed",
        "tests_added": "/tests_added",
    },
    # passed is required; coverage_pct/proof_artifacts are optional picks
    # (absent fields are skipped — they render falsy/empty downstream).
    # The failure list/history that drive the fix loop stay handler code.
    Stage.TEST.value: {
        "passed": "/passed",
        "coverage_pct": "/coverage_pct",
        "proof_artifacts": "/proof_artifacts",
    },
    # The raw reviewer issue list. The severity-filtered list that drives
    # the review-fix loop stays handler code (stages.review.critical_issues
    # via alias dual-write).
    Stage.REVIEW.value: {
        "issues": "/issues",
    },
    # pr and learn declare no outputs by design: the guardian's PR metadata
    # lifts into status.json (not the prompt context), and learn is a
    # post-pipeline consumer.
}

_BUILTIN_BY_NAME = {s.value: s for s in Stage}
_BUILTIN_AGENTS = {a for a in STAGE_AGENT_MAP.values() if a}

# Custom stage and agent names (W-071). Hyphens are rejected because the
# resolved prompt filename is ``{stage}-{agent}-iter-{N}`` — a hyphenated
# agent name breaks the role extraction that keys dispatch governance.
_NAME_RE = re.compile(r"^[a-z][a-z0-9_]*$")


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

    __slots__ = ("name", "agent", "schema", "prompt_block", "enabled", "post",
                 "on", "outputs")

    def __init__(self, name, agent=None, schema=None, prompt_block=None,
                 enabled=True, post=False, on=None, outputs=None):
        self.name = name
        self.agent = agent
        self.schema = schema
        self.prompt_block = prompt_block
        self.enabled = enabled
        self.post = post
        self.on = dict(on or {})
        # W-072: output name -> JSON pointer into the validated schema result.
        self.outputs = dict(outputs or {})

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
                "outputs": dict(sorted(s.outputs.items())),
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
            outputs=DEFAULT_STAGE_OUTPUTS.get(name),
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

        # W-072: declared outputs — name -> JSON pointer. Builtin stages
        # default to their shipped declarations; an explicit entry replaces
        # them outright (it's a contract, not a merge).
        raw_outputs = raw.get("outputs")
        if raw_outputs is None:
            outputs = dict(DEFAULT_STAGE_OUTPUTS.get(name, {}))
        else:
            if not isinstance(raw_outputs, dict):
                raise FlowError(f"flow stage {name!r}: 'outputs' must be an object")
            outputs = {}
            for oname, pointer in raw_outputs.items():
                if not _OUTPUT_NAME_RE.match(oname or ""):
                    raise FlowError(
                        f"flow stage {name!r}: invalid output name {oname!r} — "
                        f"must match ^[a-zA-Z_][a-zA-Z0-9_]*$"
                    )
                if not isinstance(pointer, str) or not _OUTPUT_POINTER_RE.match(pointer):
                    raise FlowError(
                        f"flow stage {name!r}: output {oname!r} needs a JSON "
                        f"pointer string like '/field' (got {pointer!r})"
                    )
                outputs[oname] = pointer

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
            outputs=outputs,
        ))
    return entries


def _pointer_targets_schema(schema_doc: dict, pointer: str) -> bool:
    """Whether a JSON pointer matches the schema's declared shape (W-072 §1).

    Walks the pointer segments through ``properties`` (objects) and ``items``
    (arrays, for numeric segments). A level that declares no ``properties``
    is free-form — deeper segments can't be verified and are accepted.
    """
    node = schema_doc
    for seg in pointer.lstrip("/").split("/"):
        if not isinstance(node, dict):
            return True  # can't verify deeper — accept
        if seg.isdigit() and isinstance(node.get("items"), dict):
            node = node["items"]
            continue
        props = node.get("properties")
        if not isinstance(props, dict):
            return True  # free-form object — accept
        if seg not in props:
            return False
        node = props[seg]
    return True


def _validate_flow(entries: list, project_root: str = ".") -> None:
    """Semantic validation for user-supplied flows. Raises FlowError."""
    names = [e.name for e in entries]
    seen = set()
    for n in names:
        if n in seen:
            raise FlowError(f"duplicate stage name {n!r} in worca.flow")
        seen.add(n)
        # Custom stage names (W-071) run under the generic stage executor.
        # They must be safe identifiers — the name becomes the status.json
        # stages.* key and the resolved-prompt filename prefix.
        if n not in _BUILTIN_BY_NAME and not _NAME_RE.match(n):
            raise FlowError(
                f"invalid custom stage name {n!r} in worca.flow — must match "
                f"^[a-z][a-z0-9_]*$ (use underscores, not hyphens)"
            )

    for entry in entries:
        # Custom (non-builtin) agent names key dispatch governance and the
        # {stage}-{agent}-iter-N role extraction — same identifier rule.
        if (
            entry.agent
            and entry.agent not in _BUILTIN_AGENTS
            and not _NAME_RE.match(entry.agent)
        ):
            raise FlowError(
                f"stage {entry.name!r}: invalid agent name {entry.agent!r} — "
                f"must match ^[a-z][a-z0-9_]*$ (use underscores, not hyphens)"
            )
        # Custom post stages would need the bespoke learn execution path
        # generalized — deliberately out of W-071 scope.
        if entry.name not in _BUILTIN_BY_NAME and entry.post:
            raise FlowError(
                f"stage {entry.name!r}: custom stages cannot be post stages "
                f"(post-pipeline execution is builtin-only; W-071 scope)"
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
    # W-071: artifacts resolve across tiers — shipped core AND the project
    # tiers (.claude/agents/ for agent .md, .claude/schemas/ for schemas) —
    # so custom stages ship as project files with no core counterpart.
    for entry in entries:
        if not entry.enabled:
            continue
        if entry.agent:
            agent_candidates = [
                os.path.join(project_root, ".claude", "worca", "agents",
                             "core", f"{entry.agent}.md"),
                os.path.join(project_root, ".claude", "agents",
                             f"{entry.agent}.md"),
            ]
            if not any(os.path.exists(p) for p in agent_candidates):
                raise FlowError(
                    f"stage {entry.name!r}: agent template not found for "
                    f"{entry.agent!r} (searched: {', '.join(agent_candidates)})"
                )
        schema_path = None
        if entry.schema:
            schema_candidates = [
                os.path.join(project_root, ".claude", "schemas", entry.schema),
                os.path.join(project_root, ".claude", "worca", "schemas",
                             entry.schema),
            ]
            schema_path = next(
                (p for p in schema_candidates if os.path.exists(p)), None
            )
            if schema_path is None:
                raise FlowError(
                    f"stage {entry.name!r}: schema file not found for "
                    f"{entry.schema!r} (searched: {', '.join(schema_candidates)})"
                )

        # Load the schema document once for the cross-checks below (the
        # W-071 outcome-enum check and the W-072 output-pointer check).
        schema_doc = None
        _needs_schema_doc = bool(entry.outputs) or (
            entry.name not in _BUILTIN_BY_NAME and entry.on
        )
        if schema_path and _needs_schema_doc:
            try:
                with open(schema_path, encoding="utf-8") as f:
                    schema_doc = json.load(f)
            except (OSError, json.JSONDecodeError) as exc:
                raise FlowError(
                    f"stage {entry.name!r}: cannot read schema "
                    f"{schema_path!r}: {exc}"
                ) from None

        # W-072 §1: declared outputs are validated against the schema at
        # launch — an output naming a nonexistent field must fail loudly
        # here, not render as a silent empty string mid-run.
        if entry.outputs:
            if schema_doc is None:
                raise FlowError(
                    f"stage {entry.name!r}: declares outputs but has no "
                    f"schema — outputs are JSON pointers into the stage's "
                    f"validated schema result"
                )
            for oname, pointer in entry.outputs.items():
                if not _pointer_targets_schema(schema_doc, pointer):
                    raise FlowError(
                        f"stage {entry.name!r}: output {oname!r} pointer "
                        f"{pointer!r} does not match any field declared in "
                        f"schema {entry.schema!r}"
                    )

        # W-071 §2 cross-check: a custom stage's on: triggers are driven by
        # its structured output's `outcome` field, so the schema must declare
        # outcome as a string enum covering every declared trigger — an
        # undeclared outcome would silently advance instead of jumping.
        if entry.name not in _BUILTIN_BY_NAME and entry.on and schema_doc is not None:
            enum = (
                schema_doc.get("properties", {})
                .get("outcome", {})
                .get("enum")
            )
            if not isinstance(enum, list) or not enum:
                raise FlowError(
                    f"stage {entry.name!r}: declares on: transitions but its "
                    f"schema {entry.schema!r} has no 'outcome' string enum — "
                    f"the generic executor maps outcome values to triggers"
                )
            undeclared = sorted(set(entry.on) - set(enum))
            if undeclared:
                raise FlowError(
                    f"stage {entry.name!r}: on: trigger(s) {undeclared} are "
                    f"not in the schema's outcome enum {sorted(enum)} — the "
                    f"agent could never produce them"
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


# W-072 §3: with the Phase 3 builtin stage conversions complete (all shipped
# templates lint clean), namespaced-reference violations are launch-time
# errors for the default flow too — a typo'd stages.* key in a project
# overlay fails the launch instead of silently rendering empty. Flat-key
# findings remain warnings either way (third-party overlays own their flat
# refs; the alias table keeps them resolving).
DEFAULT_FLOW_LINT_ERRORS = True

# stages.<producer>.<output>[.<deeper>...] — namespaced context reference.
_STAGES_REF_RE = re.compile(
    r"^stages\.([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z0-9_]+)(?:\.[a-zA-Z0-9_]+)*$"
)


def lint_flow_consumption(flow: FlowSpec, core_dir: str,
                          overrides_dir: str = ".claude/agents",
                          template_agents_dir: str | None = None) -> tuple:
    """Lint placeholder consumption against the declared contract (W-072 §3).

    Renders each enabled stage's *resolved* template set (agent .md through
    the three-tier overlay chain, plus its prompt block, with nested blocks
    expanded) and collects every referenced placeholder/conditional key.

    Returns ``(violations, warnings)`` — both lists of human-readable strings:

    - violations: namespaced ``stages.<producer>.<output>`` references whose
      producer is missing/not upstream (and not reachable via a declared
      loop), or whose output is undeclared. The caller escalates these to
      :class:`FlowError` for custom flows (and for the default flow once
      ``DEFAULT_FLOW_LINT_ERRORS`` flips).
    - warnings: flat keys that no known producer accounts for (not runtime
      builtins, not aliased legacy keys, not handler code outputs, not the
      consumer's own builder-computed keys) and carry no ``|default``.
      Always advisory — third-party overlays may reference flat keys we
      don't control.

    Missing template files contribute no keys (projects without a rendered
    worca runtime simply lint clean).
    """
    from worca.orchestrator.context_keys import (
        CONTEXT_ALIASES,
        RESERVED_CONTEXT_KEYS,
        flat_for,
    )
    from worca.orchestrator.executor import HANDLER_REGISTRY
    from worca.orchestrator.overlay import (
        OverlayResolver,
        collect_placeholder_keys,
        resolve_blocks,
    )
    from worca.orchestrator.prompt_builder import BUILDER_STAGE_KEYS

    violations: list = []
    warnings: list = []
    resolver = OverlayResolver(overrides_dir=overrides_dir)

    consumers = list(flow.stages) + list(flow.post_stages)
    order = {s.name: i for i, s in enumerate(flow.stages)}
    for j, s in enumerate(flow.post_stages):
        order[s.name] = len(flow.stages) + j
    # Producers resolve against ALL declared stages, disabled included: a
    # reference to a disabled producer legitimately renders empty (e.g. the
    # plan template's revision-mode section when plan_review is off), so it
    # gets the declared-output check but not the ordering check.
    by_name = {s.name: s for s in flow.all_stages}

    # Handler-published flat keys (transforms that aren't schema picks).
    code_outputs: set = set()
    for cls in HANDLER_REGISTRY.values():
        code_outputs.update(getattr(cls, "code_outputs", ()) or ())
    known_flat = set(RESERVED_CONTEXT_KEYS) | set(CONTEXT_ALIASES) | code_outputs

    # Backward jumps make a later producer reachable before its consumer
    # re-runs (test -> implement, review -> plan, ...).
    backward_jumps = [
        (order[s.name], order[tr.goto])
        for s in flow.stages
        for tr in s.on.values()
        if tr.goto in order
    ]

    def _read(path: str) -> str:
        try:
            with open(path, encoding="utf-8") as f:
                return f.read()
        except OSError:
            return ""

    for stage in consumers:
        if not stage.agent:
            continue
        texts = []
        core_content = _read(os.path.join(core_dir, f"{stage.agent}.md"))
        agent_md = resolver.resolve(stage.agent, core_content, template_agents_dir)
        if agent_md:
            texts.append(resolve_blocks(
                agent_md, {}, resolver, core_dir, template_agents_dir))
        if stage.prompt_block:
            block = resolver.resolve_block(
                stage.prompt_block, core_dir, template_agents_dir)
            if block:
                texts.append(resolve_blocks(
                    block, {}, resolver, core_dir, template_agents_dir))

        keys: dict = {}
        for text in texts:
            for key, meta in collect_placeholder_keys(text).items():
                entry = keys.setdefault(key, {"defaulted": True})
                if not meta["defaulted"]:
                    entry["defaulted"] = False

        consumer_idx = order[stage.name]
        for key, meta in sorted(keys.items()):
            if key.startswith("stages."):
                m = _STAGES_REF_RE.match(key)
                if not m:
                    violations.append(
                        f"stage {stage.name!r}: malformed namespaced "
                        f"reference {{{{{key}}}}}"
                    )
                    continue
                producer_name, output_name = m.group(1), m.group(2)
                producer = by_name.get(producer_name)
                if producer is None:
                    violations.append(
                        f"stage {stage.name!r}: references {{{{{key}}}}} but "
                        f"the flow has no stage named {producer_name!r}"
                    )
                    continue
                producer_idx = order.get(producer_name)
                upstream = producer_idx is None or producer_idx < consumer_idx or any(
                    src >= producer_idx and dst <= consumer_idx
                    for src, dst in backward_jumps
                )
                # Ordering is topology-dependent, not a typo class: builtin
                # templates legitimately reference a later stage inside
                # {{#if}} (or with a |default) and rely on the section
                # collapsing when the flow never loops back — e.g. the plan
                # template's revision branch under a custom flow that keeps
                # plan_review but drops the plan_review_revise loop. Only a
                # BARE value reference to a later producer is a wiring error.
                if not upstream and not meta["defaulted"]:
                    violations.append(
                        f"stage {stage.name!r}: references {{{{{key}}}}} but "
                        f"stage {producer_name!r} runs later and no declared "
                        f"loop brings execution back"
                    )
                declared = (
                    output_name in producer.outputs
                    # code-published outputs are registered via the alias
                    # table (their namespaced form has a flat alias)
                    or flat_for(f"stages.{producer_name}.{output_name}") is not None
                )
                if not declared:
                    violations.append(
                        f"stage {stage.name!r}: references {{{{{key}}}}} but "
                        f"stage {producer_name!r} does not declare output "
                        f"{output_name!r} (declared: "
                        f"{sorted(producer.outputs) or 'none'})"
                    )
            elif "." in key:
                warnings.append(
                    f"stage {stage.name!r}: dotted reference {{{{{key}}}}} "
                    f"is outside the stages.* namespace — nothing publishes it"
                )
            elif (
                key not in known_flat
                and key not in BUILDER_STAGE_KEYS.get(stage.name, ())
                and not meta["defaulted"]
            ):
                warnings.append(
                    f"stage {stage.name!r}: flat key {{{{{key}}}}} has no "
                    f"known producer (legacy keys resolve via the alias "
                    f"table; see docs/flow.md)"
                )

    return violations, warnings


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
