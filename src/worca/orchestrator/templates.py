"""Template resolver and utility functions for pipeline templates."""

from __future__ import annotations

import copy
import json
import re
import shutil
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

# Keys under `worca.*` that are owned by the selected template at run launch.
# When a template is in play (explicit at launch or resolved from
# worca.default_template), these are stripped from the project-settings merge
# base BEFORE the template's config applies. Result: a shared template behaves
# identically across machines until explicitly edited.
#
# Keys NOT in this list (worca.models, worca.webhooks, worca.pricing,
# worca.governance.guards, worca.graphify, worca.code_review_graph, etc.)
# stay cross-template — they're project-machine concerns (creds, infra,
# integrations) that should be the same for every template the project runs.
TEMPLATE_OWNED_KEYS: list[tuple[str, ...]] = [
    ("agents",),
    ("stages",),
    # Declarative pipeline topology (W-070). A template that reshapes the
    # flow owns it outright — a project's custom worca.flow must not leak
    # under a template that expects the builtin topology.
    ("flow",),
    ("loops",),
    ("circuit_breaker",),
    ("effort",),
    ("governance", "dispatch"),
    # Approval gates (plan_approval / pr_approval / deploy_approval). Every
    # existing built-in already declares these per its intent; promoting the
    # block to template-owned closes the "teammate's Settings silently flips
    # my gates" gap and makes the template's gate posture explicit.
    ("milestones",),
    # Test-gate strike count is a per-pipeline tolerance knob (same family
    # as circuit_breaker.max_consecutive_failures). A quick-fix template
    # legitimately wants strikes=1 to fail fast; a feature template wants
    # strikes=3 to recover from flakiness. Project Settings used to own
    # it; promoted to template-owned in the W-062 Phase 6 cleanup so
    # templates can express their own retry posture.
    ("governance", "test_gate_strikes"),
    # plan_review enforcement mode (auto / review / review_and_edit). Sits
    # under governance because it tightens what the plan_review stage may
    # do, but each template owns its own enforcement posture — a
    # research-only "investigate" template can keep auto, an audited
    # production template can pin review. Promoted to template-owned in
    # the same cleanup.
    ("governance", "plan_review_enforce"),
]
# NOTE: claude_md_mode is intentionally NOT in TEMPLATE_OWNED_KEYS.
# It is a cross-template project setting that flows through like worca.models.
# When a template explicitly sets config.claude_md_mode the deep-merge still
# lets the template override the project value — but when the template is
# silent the project's worca.claude_md_mode applies. This means
# `worca.claude_md_mode: "project"` in settings.json works correctly even on
# templated runs, which is the canonical CI/hermetic configuration pattern.
# Custom templates that need to pin a specific mode can still do so via their
# config block.

# Nested paths that sit under a template-owned block but are themselves
# cross-template: stripped along with the parent, then restored from the
# project's Settings before the template's config applies. The template can
# still deep-merge over them (so a template that explicitly sets
# stages.preflight.enabled=false still wins), but project Settings values
# survive when the template doesn't touch them.
#
# stages.preflight: the preflight check list is a project-machine concern
# (what does THIS project need to pass before launching?) — not a template
# choice. Every template should respect the project's preflight setup unless
# it explicitly opts out.
CROSS_TEMPLATE_CARVEOUTS: list[tuple[str, ...]] = [
    ("stages", "preflight"),
]


def _get_at_path(d: dict, path: tuple[str, ...]):
    """Walk path; return the leaf value or None if any segment is missing."""
    node = d
    for segment in path:
        if not isinstance(node, dict) or segment not in node:
            return None
        node = node[segment]
    return node


def _set_at_path(d: dict, path: tuple[str, ...], value) -> None:
    """Set value at path, creating intermediate dicts as needed."""
    node = d
    for segment in path[:-1]:
        node = node.setdefault(segment, {})
    node[path[-1]] = value


def _delete_at_path(d: dict, path: tuple[str, ...]) -> None:
    """Delete the leaf at path; no-op if any segment is missing."""
    node = d
    for segment in path[:-1]:
        if not isinstance(node, dict) or segment not in node:
            return
        node = node[segment]
    if isinstance(node, dict) and path[-1] in node:
        del node[path[-1]]


def strip_template_owned(worca_settings: dict) -> dict:
    """Return a deep-copy of worca_settings with every TEMPLATE_OWNED_KEYS path
    removed, then restore CROSS_TEMPLATE_CARVEOUTS from the original.

    Called by run launch before a template's config is deep-merged in, so
    project Settings can't leak template-driven keys into the merge base.
    Cross-template carve-outs (e.g. stages.preflight) are preserved so they
    still flow through to the merged config — the template can still override
    them via deep-merge if it explicitly sets a value.

    Missing intermediate paths are skipped silently — a clean project that
    never customized any of these keys is a no-op.
    """
    # Snapshot carve-outs from the original settings BEFORE stripping.
    saved_carveouts: list[tuple[tuple[str, ...], object]] = []
    for path in CROSS_TEMPLATE_CARVEOUTS:
        value = _get_at_path(worca_settings, path)
        if value is not None:
            saved_carveouts.append((path, copy.deepcopy(value)))

    # Strip the template-owned paths.
    result = copy.deepcopy(worca_settings)
    for path in TEMPLATE_OWNED_KEYS:
        _delete_at_path(result, path)

    # Restore carve-outs so they survive into the template-merge base.
    for path, value in saved_carveouts:
        _set_at_path(result, path, value)

    return result


@dataclass
class TemplateSummary:
    id: str
    name: str
    description: str
    builtin: bool
    tags: list
    created_at: str
    tier: str  # "builtin" | "project" | "user"


@dataclass
class Template:
    id: str
    name: str
    description: str
    builtin: bool
    created_at: str
    tags: list
    params: dict
    config: dict
    agents_dir: str | None
    source_dir: str
    tier: str  # "builtin" | "project" | "user"


class TemplateError(Exception):
    def __init__(self, message, code, details=None):
        super().__init__(message)
        self.code = code
        self.details = details


def deep_merge_config(base: dict, overlay: dict) -> dict:
    """Deep-merge overlay into base. Overlay values win for scalars.

    Dicts are merged recursively unless overlay has '__replace__': True,
    in which case the overlay replaces the base key wholesale.
    """
    result = base.copy()
    for key, value in overlay.items():
        if key == "__replace__":
            continue
        if isinstance(value, dict) and not value.get("__replace__"):
            if key in result and isinstance(result[key], dict):
                result[key] = deep_merge_config(result[key], value)
            else:
                clean = {k: v for k, v in value.items() if k != "__replace__"}
                result[key] = clean
        else:
            if isinstance(value, dict):
                result[key] = {k: v for k, v in value.items() if k != "__replace__"}
            else:
                result[key] = value
    return result


# Loop names recognised by the pipeline. Each defaults to LOOP_DEFAULT_LIMIT
# iterations when not configured (runner.within_loop_limit / _get_loop_limit).
# Enumerated here so a standalone export can materialise the loop block.
PIPELINE_LOOP_NAMES: tuple[str, ...] = (
    "implement_test",
    "plan_review",
    "pr_changes",
    "restart_planning",
)
LOOP_DEFAULT_LIMIT = 5

# Agent-config defaults applied inline at consumption (stages.get_stage_config):
# model shorthand "sonnet", max_turns 30, coordinator max_beads 0. Kept here as
# named constants so the drift test (tests/test_templates_standalone.py) can
# assert default_pipeline_config() still matches the live resolver defaults.
AGENT_DEFAULT_MODEL = "sonnet"
AGENT_DEFAULT_MAX_TURNS = 30
COORDINATOR_DEFAULT_MAX_BEADS = 0

# Effort block defaults (runner.py resolve path).
EFFORT_DEFAULT_AUTO_MODE = "adaptive"
EFFORT_DEFAULT_AUTO_CAP = "xhigh"

# Circuit-breaker defaults (schemas/keys.json defaults block).
CIRCUIT_BREAKER_DEFAULTS = {
    "enabled": True,
    "max_consecutive_failures": 3,
    "classifier_model": "haiku",
}


def default_pipeline_config() -> dict:
    """Build the built-in default config snapshot for the template-owned keys
    that survive export (``stages``, ``agents``, ``effort``, ``loops``,
    ``circuit_breaker``).

    This is the materialisation base for a *standalone* export: the template's
    sparse delta is deep-merged over this snapshot so the exported config is a
    complete, version-pinned picture rather than a delta interpreted against the
    importer's defaults.

    Derived from the live constants in ``stages.py`` (stage order, default-agent
    map, default-disabled set) where possible so it tracks those automatically;
    the inline scalar defaults are mirrored from named constants above and
    guarded by a drift test against the real resolvers. Governance/milestones
    are deliberately omitted — they are stripped by CONFIG_ALLOWLIST on export.
    """
    from worca.orchestrator.stages import (
        STAGE_AGENT_MAP,
        STAGE_ORDER,
        Stage,
        _STAGES_DEFAULT_DISABLED,
    )

    stages: dict = {}
    # STAGE_ORDER omits LEARN (it's not in the per-stage flow); include it so the
    # snapshot covers every stage a template might toggle.
    for stage in (*STAGE_ORDER, Stage.LEARN):
        entry: dict = {"enabled": stage not in _STAGES_DEFAULT_DISABLED}
        agent = STAGE_AGENT_MAP.get(stage)
        if agent is not None:
            entry["agent"] = agent
        stages[stage.value] = entry

    agents: dict = {}
    for agent in sorted(a for a in STAGE_AGENT_MAP.values() if a is not None):
        cfg = {"model": AGENT_DEFAULT_MODEL, "max_turns": AGENT_DEFAULT_MAX_TURNS}
        if agent == "coordinator":
            cfg["max_beads"] = COORDINATOR_DEFAULT_MAX_BEADS
        agents[agent] = cfg

    return {
        "stages": stages,
        "agents": agents,
        "effort": {
            "auto_mode": EFFORT_DEFAULT_AUTO_MODE,
            "auto_cap": EFFORT_DEFAULT_AUTO_CAP,
        },
        "loops": {name: LOOP_DEFAULT_LIMIT for name in PIPELINE_LOOP_NAMES},
        "circuit_breaker": dict(CIRCUIT_BREAKER_DEFAULTS),
    }


def materialize_config(template_config: dict) -> dict:
    """Return the effective config for a *standalone* export: the built-in
    defaults (``default_pipeline_config``) with the template's sparse delta
    deep-merged on top.

    Only the keys present in the defaults snapshot are materialised. Any other
    key the template carries (e.g. ``models``) is preserved verbatim on top, so
    nothing the template declared is lost. Secret scrubbing is NOT done here —
    the manifest still goes through ``redact_bundle`` after materialisation.
    """
    return deep_merge_config(default_pipeline_config(), template_config or {})


VALID_EFFORT_LEVELS = frozenset({"low", "medium", "high", "xhigh", "max"})

_VALID_TIERS = frozenset({"builtin", "user", "project"})
# Canonical grammar: ^(builtin:|user:|project:)?[a-zA-Z0-9_-]{1,64}$
_TIER_ALIAS_RE = re.compile(r"^(builtin:|user:|project:)?[a-zA-Z0-9_-]{1,64}$")


def _check_model_grammar(model: str, field: str, issues: list, models_config: dict, default_map: dict) -> None:
    """Validate a model reference string and append issues as appropriate.

    Accepts:
      - bare alias (no colon) — warns if not in models_config or default_map
      - tier:alias — errors if tier not in {builtin, user, project} or alias invalid
    Rejects (severity=error):
      - any string not matching the canonical grammar
    """
    if ":" in model:
        # Must match tier:alias grammar exactly
        if not _TIER_ALIAS_RE.match(model):
            issues.append({
                "field": field,
                "severity": "error",
                "message": (
                    f"Malformed model reference '{model}'. "
                    "Expected 'tier:alias' where tier ∈ {{builtin, user, project}} "
                    "and alias matches [a-zA-Z0-9_-]{1,64}, "
                    "or a bare alias without any colon."
                ),
            })
            return
        tier, alias = model.split(":", 1)
        if tier not in _VALID_TIERS:
            issues.append({
                "field": field,
                "severity": "error",
                "message": (
                    f"Malformed model reference '{model}': "
                    f"tier '{tier}' is not valid. Must be one of: {sorted(_VALID_TIERS)}."
                ),
            })
        # tier-pinned refs get a separate alias-not-in-named-tier check (future phase)
        return

    # Bare alias: warn if unknown
    if (
        model not in models_config
        and model not in ("opa", "oha")
        and model not in default_map
    ):
        issues.append({
            "field": field,
            "severity": "warning",
            "message": (
                f"Model alias '{model}' is not defined in worca.models "
                "and not in default map (may be treated as a raw model ID)"
            ),
        })


def validate_merged_config(merged: dict) -> list[dict]:
    """Run validation rules against an already-merged worca config.

    Single source of truth for the validation ruleset. Used by both
    `TemplateResolver.validate` (template + base settings → merge → check)
    and the CLI's `worca templates validate --config <json>` (caller has
    pre-merged config in hand).

    Returns a list of issues:
        {"field": <dot.path>, "severity": "error" | "warning", "message": <str>}

    "error" means a run with this config would break; "warning" is suspicious
    but legal (e.g. model alias falls back via `_DEFAULT_MODEL_MAP`).
    """
    from worca.orchestrator.stages import ALL_AGENTS
    from worca.utils.settings import _DEFAULT_MODEL_MAP

    issues: list[dict] = []
    if not isinstance(merged, dict):
        issues.append({
            "field": "",
            "severity": "error",
            "message": "config must be a JSON object",
        })
        return issues

    known_agents = {v for v in ALL_AGENTS if v is not None}
    agents_config = merged.get("agents", {}) if isinstance(merged.get("agents"), dict) else {}
    models_config = merged.get("models", {}) if isinstance(merged.get("models"), dict) else {}

    for agent_key in agents_config:
        if agent_key not in known_agents:
            issues.append({
                "field": f"agents.{agent_key}",
                "severity": "error",
                "message": (
                    f"Unknown agent '{agent_key}'. "
                    f"Must be one of: {sorted(known_agents)}"
                ),
            })

    for agent_name in known_agents:
        agent_data = agents_config.get(agent_name, {})
        if not isinstance(agent_data, dict):
            continue

        model = agent_data.get("model")
        if model and isinstance(model, str):
            _check_model_grammar(model, f"agents.{agent_name}.model", issues, models_config, _DEFAULT_MODEL_MAP)

        agent_effort = agent_data.get("effort")
        if agent_effort and agent_effort not in VALID_EFFORT_LEVELS:
            issues.append({
                "field": f"agents.{agent_name}.effort",
                "severity": "error",
                "message": (
                    f"Invalid effort level for {agent_name}: '{agent_effort}'. "
                    f"Must be one of: {sorted(VALID_EFFORT_LEVELS)}"
                ),
            })

        if "max_beads" in agent_data:
            max_beads = agent_data["max_beads"]
            if not isinstance(max_beads, int) or isinstance(max_beads, bool):
                issues.append({
                    "field": f"agents.{agent_name}.max_beads",
                    "severity": "error",
                    "message": f"agents.{agent_name}.max_beads must be an integer",
                })
            elif max_beads < 0:
                issues.append({
                    "field": f"agents.{agent_name}.max_beads",
                    "severity": "error",
                    "message": f"agents.{agent_name}.max_beads must be >= 0",
                })
            elif max_beads > 50:
                issues.append({
                    "field": f"agents.{agent_name}.max_beads",
                    "severity": "error",
                    "message": f"agents.{agent_name}.max_beads must be <= 50",
                })

    effort_config = merged.get("effort", {})
    if isinstance(effort_config, dict):
        auto_cap = effort_config.get("auto_cap")
        if auto_cap and auto_cap not in VALID_EFFORT_LEVELS:
            issues.append({
                "field": "effort.auto_cap",
                "severity": "error",
                "message": (
                    f"Invalid effort level for auto_cap: '{auto_cap}'. "
                    f"Must be one of: {sorted(VALID_EFFORT_LEVELS)}"
                ),
            })

        for agent_name, agent_effort in effort_config.items():
            if agent_name == "auto_cap" or not isinstance(agent_effort, dict):
                continue
            effort_level = agent_effort.get("effort")
            if effort_level and effort_level not in VALID_EFFORT_LEVELS:
                issues.append({
                    "field": f"effort.{agent_name}.effort",
                    "severity": "error",
                    "message": (
                        f"Invalid effort level for {agent_name}: '{effort_level}'. "
                        f"Must be one of: {sorted(VALID_EFFORT_LEVELS)}"
                    ),
                })

    return issues


class TemplateResolver:
    def __init__(self, builtin_dir, project_dir, user_dir):
        """
        builtin_dir: src/worca/templates/ (from installed package)
        project_dir: .claude/templates/ (project-local)
        user_dir:    ~/.worca/templates/ (user-global)
        All arguments may be None or non-existent paths.
        """
        self._builtin_dir = Path(builtin_dir) if builtin_dir else None
        self._project_dir = Path(project_dir) if project_dir else None
        self._user_dir = Path(user_dir) if user_dir else None

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _scan_tier(self, tier_dir: Path | None, tier: str) -> list[TemplateSummary]:
        """Scan a tier directory and return TemplateSummary objects for valid templates."""
        if tier_dir is None or not tier_dir.is_dir():
            return []
        summaries = []
        for subdir in sorted(tier_dir.iterdir()):
            if not subdir.is_dir():
                continue
            manifest = subdir / "template.json"
            if not manifest.is_file():
                continue
            try:
                data = json.loads(manifest.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                continue
            try:
                summaries.append(TemplateSummary(
                    id=data["id"],
                    name=data.get("name", data["id"]),
                    description=data.get("description", ""),
                    builtin=data.get("builtin", tier == "builtin"),
                    tags=data.get("tags", []),
                    created_at=data.get("created_at", ""),
                    tier=tier,
                ))
            except (KeyError, TypeError):
                continue
        return summaries

    def _load_template(self, tmpl_dir: Path, tier: str) -> Template | None:
        """Load a Template object from a template directory."""
        manifest = tmpl_dir / "template.json"
        if not manifest.is_file():
            return None
        try:
            data = json.loads(manifest.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return None
        try:
            agents_path = tmpl_dir / "agents"
            agents_dir = str(agents_path) if agents_path.is_dir() else None
            return Template(
                id=data["id"],
                name=data.get("name", data["id"]),
                description=data.get("description", ""),
                builtin=data.get("builtin", tier == "builtin"),
                created_at=data.get("created_at", ""),
                tags=data.get("tags", []),
                params=data.get("params", {}),
                config=data.get("config", {}),
                agents_dir=agents_dir,
                source_dir=str(tmpl_dir),
                tier=tier,
            )
        except (KeyError, TypeError):
            return None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def list(self) -> list[TemplateSummary]:
        """Return all templates across all tiers, deduplicated by ID.

        Priority: project > user > builtin (highest wins on collision).
        Sort order: builtins alpha, project alpha, user newest-first.
        """
        builtins = self._scan_tier(self._builtin_dir, "builtin")
        projects = self._scan_tier(self._project_dir, "project")
        users = self._scan_tier(self._user_dir, "user")

        # Collect seen IDs in priority order (highest priority first)
        seen: dict[str, TemplateSummary] = {}

        # Project templates sorted alphabetically
        for t in sorted(projects, key=lambda t: t.id):
            seen.setdefault(t.id, t)

        # User templates sorted newest-first
        users_sorted = sorted(users, key=lambda t: t.created_at, reverse=True)
        for t in users_sorted:
            seen.setdefault(t.id, t)

        # Builtin templates sorted alphabetically
        for t in sorted(builtins, key=lambda t: t.id):
            seen.setdefault(t.id, t)

        # Output order: builtins alpha, then project alpha, then user newest-first
        result_builtins = sorted(
            [t for t in seen.values() if t.tier == "builtin"], key=lambda t: t.id
        )
        result_projects = sorted(
            [t for t in seen.values() if t.tier == "project"], key=lambda t: t.id
        )
        result_users = sorted(
            [t for t in seen.values() if t.tier == "user"],
            key=lambda t: t.created_at,
            reverse=True,
        )
        return result_builtins + result_projects + result_users

    def get(self, template_id: str) -> "Template | None":
        """Fetch a template by ID. Searches project > user > builtin."""
        for tier, tier_dir in [
            ("project", self._project_dir),
            ("user", self._user_dir),
            ("builtin", self._builtin_dir),
        ]:
            if tier_dir is None or not tier_dir.is_dir():
                continue
            tmpl_dir = tier_dir / template_id
            if tmpl_dir.is_dir():
                result = self._load_template(tmpl_dir, tier)
                if result is not None:
                    return result
        return None

    def snapshot_to_run(self, template_id: str, run_dir: str, params: dict | None = None) -> None:
        """Copy entire template directory to {run_dir}/template/ for traceability.
        Also writes a resolved-params.json with the param values used.
        """
        template = self.get(template_id)
        if template is None:
            raise TemplateError(
                f"Template '{template_id}' not found.",
                code="not_found",
                details={"template_id": template_id},
            )
        dest = Path(run_dir) / "template"
        shutil.copytree(template.source_dir, str(dest))
        resolved_params = {
            "template_id": template.id,
            "template_tier": template.tier,
            "params": params or {},
            "snapshot_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        }
        (dest / "resolved-params.json").write_text(json.dumps(resolved_params, indent=2), encoding="utf-8")

    def save(self, template_data: dict, scope: str = "project") -> "Template":
        """Save (upsert) a template. scope is 'project' or 'user'.

        Saving a template whose id matches a built-in is explicitly allowed:
        the project/user copy shadows the built-in, which is the canonical
        editing flow. scope is restricted to 'project'|'user' so there is
        no path by which save() can overwrite a built-in on disk.

        Validates all fields. Raises TemplateError(validation_error) with a
        details list if any field is invalid. Creates {scope_dir}/{id}/ and
        writes template.json with builtin=false and created_at set to now.
        """
        scope_dir = self._user_dir if scope == "user" else self._project_dir

        errors = []

        template_id = template_data.get("id", "")
        # Underscores allowed: worca init's auto-migrated `_legacy-settings`
        # template (and any intentionally-private id) must round-trip
        # through save() without tripping the validator.
        if not isinstance(template_id, str) or not re.match(r"^[a-z0-9_\-]{1,64}$", template_id):
            errors.append({"field": "id", "message": f"id must match [a-z0-9_-]{{1,64}}, got {template_id!r}"})

        name = template_data.get("name", "")
        if not isinstance(name, str) or not name or len(name) > 80:
            errors.append({"field": "name", "message": "name must be a non-empty string of max 80 chars"})

        tags = template_data.get("tags", [])
        if not isinstance(tags, list):
            errors.append({"field": "tags", "message": "tags must be a list"})
        elif len(tags) > 5:
            errors.append({"field": "tags", "message": f"max 5 tags allowed, got {len(tags)}"})
        else:
            for tag in tags:
                if not isinstance(tag, str) or not re.match(r"^[a-z0-9\-]{1,20}$", tag):
                    errors.append({"field": "tags", "message": f"tag {tag!r} must match [a-z0-9-]{{1,20}}"})

        config = template_data.get("config", {})
        if not isinstance(config, dict):
            errors.append({"field": "config", "message": "config must be a dict"})

        if errors:
            raise TemplateError(
                "Template validation failed.",
                code="validation_error",
                details=errors,
            )

        scope_path = Path(scope_dir)
        scope_path.mkdir(parents=True, exist_ok=True)
        tmpl_dir = scope_path / template_id
        tmpl_dir.mkdir(parents=True, exist_ok=True)

        tier = "user" if scope == "user" else "project"
        now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        data = {
            "id": template_id,
            "name": name,
            "description": template_data.get("description", ""),
            "builtin": False,
            "created_at": now,
            "tags": tags,
            "params": template_data.get("params", {}),
            "config": config,
        }
        (tmpl_dir / "template.json").write_text(json.dumps(data, indent=2), encoding="utf-8")

        agents_path = tmpl_dir / "agents"
        return Template(
            id=template_id,
            name=name,
            description=data["description"],
            builtin=False,
            created_at=now,
            tags=tags,
            params=data["params"],
            config=config,
            agents_dir=str(agents_path) if agents_path.is_dir() else None,
            source_dir=str(tmpl_dir),
            tier=tier,
        )

    def delete(self, template_id: str, scope: str = "project") -> bool:
        """Delete a template directory from project or user scope.

        Deleting a project/user template whose id matches a built-in is
        explicitly allowed: it un-shadows the built-in, which is the
        symmetric inverse of `save()`'s shadow-create. scope is restricted
        to 'project'|'user' so this never touches the built-in tier.

        Raises TemplateError(not_found) if not found in the given scope.
        """
        scope_dir = self._user_dir if scope == "user" else self._project_dir
        if scope_dir is None:
            raise TemplateError(
                f"Template '{template_id}' not found.",
                code="not_found",
                details={"template_id": template_id},
            )

        tmpl_dir = Path(scope_dir) / template_id
        if not tmpl_dir.is_dir():
            raise TemplateError(
                f"Template '{template_id}' not found.",
                code="not_found",
                details={"template_id": template_id},
            )

        shutil.rmtree(tmpl_dir)
        return True

    def apply(self, template_id: str, current_worca: dict, params: dict | None = None) -> dict:
        """Deep-merge template config into current worca settings.

        Loads template via get(), renders {{param}} placeholders in config string
        values, then deep-merges into a copy of current_worca. Does not mutate
        either input.
        """
        template = self.get(template_id)
        if template is None:
            raise TemplateError(
                f"Template '{template_id}' not found.",
                code="not_found",
                details={"template_id": template_id},
            )
        rendered_config = _render_params_in_dict(template.config, params or {}, template.params)
        return deep_merge_config(current_worca, rendered_config)

    def validate(
        self, template_id: str, base_settings: dict, params: dict | None = None
    ) -> list[dict]:
        """Simulate apply() over base_settings (or {}); return a list of validation issues.

        Renders params, deep-merges the template config with base settings,
        then runs `validate_merged_config` on the merged result. Use
        `validate_merged_config` directly when the caller already has a
        merged config in hand (e.g. the CLI's interactive `--config` mode).

        Issue schema:
            {"field": <dot.path>, "severity": "error" | "warning", "message": <str>}
        """
        template = self.get(template_id)
        if template is None:
            raise TemplateError(
                f"Template '{template_id}' not found.",
                code="not_found",
                details={"template_id": template_id},
            )

        rendered_config = _render_params_in_dict(template.config, params or {}, template.params)
        merged = deep_merge_config(base_settings or {}, rendered_config)
        return validate_merged_config(merged)

    def _find_core_dir(self) -> Path | None:
        """Locate the directory holding core agent prompts (`*.md`/`*.block.md`).

        Self-contained duplication composes each core prompt with the source
        template's overlay, so we need the core prompt set. It lives as a
        sibling of the templates dir in both supported layouts:

        - runtime install: ``.claude/worca/templates`` → ``.claude/worca/agents/core``
        - package/dev:      ``src/worca/templates``    → ``src/worca/agents/core``

        We probe the parent of each known tier dir (builtin/project/user) for an
        ``agents/core`` sibling. Returns the first that exists, else None — in
        which case duplication gracefully skips the self-containment pass.
        """
        candidates: list[Path] = []
        for tier_dir in (self._builtin_dir, self._project_dir, self._user_dir):
            if tier_dir is None:
                continue
            # Sibling of the templates dir: <parent>/agents/core
            candidates.append(tier_dir.parent / "agents" / "core")
        for cand in candidates:
            if cand.is_dir():
                return cand
        return None

    def resolve_self_contained_agents(
        self,
        src_template: "Template",
        core_dir: Path,
    ) -> dict[str, str]:
        """Return ``{filename: content}`` for a fully-resolved, self-contained
        prompt set: every core role + block composed with the source template's
        overlay.

        The resolution chain is core → (source) template overlay only — project
        overrides (``.claude/agents``) are deliberately excluded by pointing the
        OverlayResolver at a non-existent overrides dir. Placeholders
        (``{{...}}`` / ``{{block:...}}`` / ``{{#if}}``) are preserved verbatim;
        they are filled at runtime, not at resolution time.

        Shared by ``duplicate`` (writes the result to disk) and standalone
        ``export`` (carries the result as ``_overlays`` in the bundle).
        """
        from worca.orchestrator.overlay import OverlayResolver

        # An overrides_dir that cannot exist → the project-overlay tier is
        # always skipped, so only core + template overlay are composed.
        non_existent_overrides = str(core_dir / "__no_project_overrides__")
        resolver = OverlayResolver(overrides_dir=non_existent_overrides)

        src_agents_dir = (
            str(src_template.agents_dir) if src_template.agents_dir else None
        )

        roles: list[str] = []
        blocks: list[str] = []
        for entry in sorted(core_dir.iterdir()):
            if not entry.is_file() or entry.suffix != ".md":
                continue
            name = entry.name
            if name.endswith(".block.md"):
                blocks.append(name[: -len(".block.md")])
            else:
                roles.append(name[: -len(".md")])

        out: dict[str, str] = {}
        for role in roles:
            core_content = (core_dir / f"{role}.md").read_text(encoding="utf-8")
            out[f"{role}.md"] = resolver.resolve(role, core_content, src_agents_dir)

        for block in blocks:
            resolved = resolver.resolve_block(block, str(core_dir), src_agents_dir)
            if resolved is None:
                continue
            out[f"{block}.block.md"] = resolved

        return out

    def _write_self_contained_agents(
        self,
        src_template: "Template",
        dest_agents_dir: Path,
        core_dir: Path,
    ) -> None:
        """Compose every core role + block with the source template's overlay
        and write the fully-resolved prompts into ``dest_agents_dir``.

        The written files OVERWRITE any raw overlays already copied by the
        copytree step, leaving a uniform, resolved, self-contained set.
        """
        dest_agents_dir.mkdir(parents=True, exist_ok=True)
        for fname, content in self.resolve_self_contained_agents(
            src_template, core_dir
        ).items():
            (dest_agents_dir / fname).write_text(content, encoding="utf-8")

    def duplicate(
        self,
        src_id: str,
        dst_id: str,
        dst_scope: str = "project",
        core_dir: str | Path | None = None,
    ) -> "Template":
        """Resolve src_id from any tier, write a copy to dst_scope as dst_id.

        Duplicating a built-in to project/user scope with the SAME id is
        the canonical "shadow a built-in to edit it" UX path — that is
        explicitly supported. `dst_scope` is already restricted to
        'project' or 'user', so there is no path by which `duplicate`
        can overwrite a built-in on disk.

        The duplicate is made **self-contained**: its ``agents/`` dir carries a
        complete, resolved prompt file for every core agent role and block —
        the core prompt composed with the source template's overlay — so the
        copy no longer depends on the shipped core prompts at runtime.
        Placeholders are preserved (filled at runtime); project overrides are
        NOT baked in. If a core prompt dir can't be located, the self-contained
        pass is skipped gracefully (the duplicate keeps the source's raw
        overlays only).

        Args:
            src_id: Template id to copy from (resolves from any tier: project → user → builtin)
            dst_id: Id to assign to the copy in the destination scope
            dst_scope: "project" or "user" (builtin is not a valid destination)
            core_dir: Optional explicit core-prompt directory. None → auto-detect
                as a sibling of the templates tier dir. Mainly for tests.

        Returns:
            Template instance representing the copied template

        Raises:
            TemplateError(name_collision): if dst_id already exists in dst_scope
            TemplateError(not_found): if src_id not found
            TemplateError(validation_error): if dst_scope is invalid or unavailable
        """
        # Validate destination scope
        if dst_scope not in ("project", "user"):
            raise TemplateError(
                f"dst_scope must be 'project' or 'user', got {dst_scope!r}",
                code="validation_error",
                details={"dst_scope": dst_scope},
            )

        # Determine destination directory
        scope_dir = self._user_dir if dst_scope == "user" else self._project_dir
        if scope_dir is None:
            raise TemplateError(
                f"Destination scope '{dst_scope}' is not available.",
                code="validation_error",
                details={"dst_scope": dst_scope},
            )

        scope_path = Path(scope_dir)
        tmpl_dir = scope_path / dst_id

        # Check for name collision in target scope
        if tmpl_dir.is_dir():
            raise TemplateError(
                f"Template ID '{dst_id}' already exists in {dst_scope} scope.",
                code="name_collision",
                details={"template_id": dst_id, "scope": dst_scope},
            )

        # Load source template using existing get() method (resolves by priority)
        src_template = self.get(src_id)
        if src_template is None:
            raise TemplateError(
                f"Template '{src_id}' not found.",
                code="not_found",
                details={"template_id": src_id},
            )

        # Create destination directory
        scope_path.mkdir(parents=True, exist_ok=True)
        tmpl_dir.mkdir(parents=True, exist_ok=True)

        # Prepare destination template data - preserve all fields from source
        now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        dst_data = {
            "id": dst_id,
            "name": src_template.name,
            "description": src_template.description,
            "builtin": False,  # Duplicates are never built-in
            "created_at": now,
            "tags": list(src_template.tags),  # Copy tags
            "params": copy.deepcopy(src_template.params),  # Deep copy params
            "config": copy.deepcopy(src_template.config),  # Deep copy config
        }

        # Read the source template.json to preserve any custom fields
        source_manifest = Path(src_template.source_dir) / "template.json"
        if source_manifest.is_file():
            source_data = json.loads(source_manifest.read_text(encoding="utf-8"))
            # Preserve any additional fields not in our base set
            for key, value in source_data.items():
                if key not in ["id", "name", "description", "builtin", "created_at", "tags", "params", "config"]:
                    dst_data[key] = value

        # Write template.json
        (tmpl_dir / "template.json").write_text(json.dumps(dst_data, indent=2), encoding="utf-8")

        dest_agents_dir = tmpl_dir / "agents"

        # Copy agents directory if present
        if src_template.agents_dir and Path(src_template.agents_dir).is_dir():
            src_agents_dir = Path(src_template.agents_dir)
            if dest_agents_dir.is_dir():
                shutil.rmtree(dest_agents_dir)
            shutil.copytree(src_agents_dir, dest_agents_dir)

        # Self-containment pass: compose every core role + block with the
        # source template's overlay and write the resolved prompts, overwriting
        # the raw overlays copied above. Skips gracefully if no core dir found.
        resolved_core_dir = Path(core_dir) if core_dir else self._find_core_dir()
        if resolved_core_dir is not None and resolved_core_dir.is_dir():
            self._write_self_contained_agents(
                src_template, dest_agents_dir, resolved_core_dir
            )

        # Return new Template instance
        tier = "user" if dst_scope == "user" else "project"
        agents_path = tmpl_dir / "agents"
        return Template(
            id=dst_id,
            name=dst_data["name"],
            description=dst_data["description"],
            builtin=False,
            created_at=now,
            tags=dst_data["tags"],
            params=dst_data["params"],
            config=dst_data["config"],
            agents_dir=str(agents_path) if agents_path.is_dir() else None,
            source_dir=str(tmpl_dir),
            tier=tier,
        )


def _render_params_in_dict(obj, params: dict, param_defs: dict):
    """Recursively render {{param}} placeholders in all string values of a dict."""
    if isinstance(obj, dict):
        return {k: _render_params_in_dict(v, params, param_defs) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_render_params_in_dict(item, params, param_defs) for item in obj]
    if isinstance(obj, str) and re.search(r"\{\{\w+\}\}", obj):
        return render_params(obj, params, param_defs)
    return obj


def render_params(content: str, params: dict, param_defs: dict) -> str:
    """Replace {{param_name}} placeholders in content with resolved values.

    Uses param_defs for defaults; params dict overrides defaults.
    Raises TemplateError if a required param without a default is missing,
    or if a placeholder has no corresponding entry in param_defs.
    """
    placeholders = re.findall(r"\{\{(\w+)\}\}", content)

    resolved = {}
    for name in set(placeholders):
        if name in params:
            resolved[name] = str(params[name])
        elif name in param_defs:
            defn = param_defs[name]
            if "default" in defn:
                resolved[name] = str(defn["default"])
            else:
                raise TemplateError(
                    f"Required template parameter '{name}' has no value and no default.",
                    code="validation_error",
                    details={"param": name},
                )
        else:
            raise TemplateError(
                f"Template parameter '{name}' is not defined in param_defs.",
                code="validation_error",
                details={"param": name},
            )

    result = content
    for name, value in resolved.items():
        result = result.replace("{{" + name + "}}", value)
    return result
