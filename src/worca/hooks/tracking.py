"""Agent dispatch rules and Beads task sync for SubagentStart/Stop events.

Reads JSON from stdin with an event field.
- subagent_start: checks dispatch rules, exit code 0 = allow, 2 = block.
- subagent_stop: closes bead on success if bead_id is provided.
"""

import json
import os
import sys

# Literal sentinel that means "lock this agent out — allow nothing".
# Used as the sole entry of a per_agent_allow list, e.g. ["none"]. Any other
# combination treats "none" as just a tool/skill/subagent name (it won't match
# anything real). Empty list [] falls through to _defaults instead.
LOCKDOWN_SENTINEL = "none"

# Pipeline agents shipped with worca: the stage agents plus plan_editor
# (substitutes for plan_reviewer in review_and_edit mode) and the workspace
# planner. Kept as a literal so the hook stays stdlib-only; a sync test
# asserts it matches worca.orchestrator.stages.ALL_AGENTS | {"plan_editor"}.
#
# W-071: agents OUTSIDE this set (user-defined custom stage agents) that have
# no explicit per_agent_allow entry resolve to the lockdown sentinel instead
# of _defaults — an unknown role must be granted explicitly.
KNOWN_PIPELINE_AGENTS = frozenset({
    "planner", "plan_reviewer", "plan_editor", "coordinator", "implementer",
    "tester", "reviewer", "guardian", "learner", "workspace_planner",
})

_DISPATCH_DEFAULTS = {
    "tools": {
        "always_disallowed": ["EnterPlanMode", "EnterWorktree", "TodoWrite"],
        "default_denied": [],
        "per_agent_allow": {"_defaults": ["*"]},
    },
    "skills": {
        "always_disallowed": [
            "batch",
            "fewer-permission-prompts",
            "loop",
            "schedule",
            # worca-* dev skills that genuinely must stay off-limits to pipeline
            # agents: release/publish, PR merges, cross-repo sync, installation,
            # agent/governance override (privilege escalation), pipeline launch
            # (recursion), and autonomous issue/plan creation. The rest of the
            # worca-* dev tooling (precommit, coverage, ui/event scaffolding,
            # webhook-test, issue read) is allowed via the per-agent "*" wildcard.
            "worca-release",
            "worca-rc",
            "worca-pr-prep",
            "worca-install",
            "worca-sync",
            "worca-sync-commit",
            "worca-sync-pr",
            "worca-agent-override",
            "worca-analyze",
            "worca-plan-new",
            "update-config",
            "hookify:hookify",
            "hookify:configure",
            "hookify:list",
            "hookify:writing-rules",
            "init",
        ],
        "default_denied": [
            "claude-api",
            "debug",
            "review",
            "security-review",
            "simplify",
            "feature-dev:feature-dev",
            "claude-md-management:revise-claude-md",
            "claude-md-management:claude-md-improver",
        ],
        "per_agent_allow": {
            "_defaults": ["*"],
            "implementer": ["*", "simplify", "claude-api"],
            "tester": ["*", "debug"],
            "reviewer": ["*", "review", "security-review"],
            "learner": [
                "*",
                "claude-md-management:revise-claude-md",
                "claude-md-management:claude-md-improver",
            ],
        },
    },
    "subagents": {
        # No subagents are denied by default. general-purpose (a full-tool
        # Claude session) is now allowed under the "*" wildcard like any other
        # subagent; a project can still deny specific subagents by adding them
        # to always_disallowed or default_denied.
        "always_disallowed": [],
        "default_denied": [],
        "per_agent_allow": {"_defaults": ["*"]},
    },
}

# --- One-time dispatch-default normalization (W-054 follow-up) ---------------
#
# Version of the dispatch normalization. Stamped onto
# governance.dispatch_migration_version so the normalization runs exactly once
# per config; re-runs (and fresh installs already at this version) are no-ops.
# Bump when adding a new one-time normalization below.
#   v1: collapse stale Explore-only subagent default; narrow worca-* skills glob.
#   v2: move general-purpose from subagents.always_disallowed to default_denied
#       (still denied by default, but allowable per-agent).
#   v3: release general-purpose from default_denied entirely (now allowed under
#       the "*" wildcard, matching the shipped default after the policy change).
DISPATCH_MIGRATION_VERSION = 3

# The pre-W-054 (W-038-era) shipped subagent dispatch default: every pipeline
# agent capped to Explore-only. W-054 changed the default to `_defaults: ["*"]`,
# but the migration preserved these explicit values verbatim, leaving upgraders
# pinned to Explore-only. We detect this exact (untouched) shape and adopt the
# new permissive default. coordinator:[] (and any empty list) is treated as
# "falls through to _defaults" and ignored in the comparison.
_LEGACY_EXPLORE_SUBAGENT_DEFAULT = {
    "planner": ["Explore"],
    "implementer": ["Explore"],
    "tester": ["Explore"],
    "guardian": ["Explore"],
    "reviewer": ["Explore"],
    "plan_reviewer": ["Explore"],
    "learner": ["Explore"],
}

# The pre-narrowing skills denylist (carried the broad `worca-*` glob). An
# untouched config matching this set is widened to the current default, which
# disallows only the genuinely-dangerous worca-* skills.
_LEGACY_SKILLS_ALWAYS_DISALLOWED = frozenset({
    "batch",
    "fewer-permission-prompts",
    "loop",
    "schedule",
    "worca-*",
    "update-config",
    "hookify:hookify",
    "hookify:configure",
    "hookify:list",
    "hookify:writing-rules",
    "init",
})


def _canonical_per_agent(per_agent: dict) -> dict:
    """Drop _defaults and empty/passthrough entries; sort values for comparison."""
    out = {}
    for agent, allow in per_agent.items():
        if agent == "_defaults":
            continue
        if not allow:  # [] or None falls through to _defaults — ignore
            continue
        out[agent] = sorted(allow)
    return out


def adopt_stale_subagent_default(subagents_cfg: dict) -> bool:
    """Collapse a stale Explore-only per_agent_allow to the new default.

    Returns True if the config was the untouched W-038 Explore-only default
    (and was rewritten to ``{"_defaults": ["*"]}``), else False. Only fires
    when ``_defaults`` is the new wildcard (or unset) — a customized
    ``_defaults`` means the operator has touched this section.
    """
    if not isinstance(subagents_cfg, dict):
        return False
    pa = subagents_cfg.get("per_agent_allow")
    if not isinstance(pa, dict):
        return False
    if pa.get("_defaults") not in (None, ["*"]):
        return False
    expected = {a: sorted(v) for a, v in _LEGACY_EXPLORE_SUBAGENT_DEFAULT.items()}
    if _canonical_per_agent(pa) != expected:
        return False
    subagents_cfg["per_agent_allow"] = {"_defaults": ["*"]}
    return True


def adopt_narrowed_skills_denylist(skills_cfg: dict) -> bool:
    """Widen an untouched skills denylist (broad ``worca-*``) to the current set.

    Returns True if ``always_disallowed`` exactly matched the legacy default
    (and was replaced with the current narrowed default), else False.
    """
    if not isinstance(skills_cfg, dict):
        return False
    current = skills_cfg.get("always_disallowed")
    if not isinstance(current, list):
        return False
    if frozenset(current) != _LEGACY_SKILLS_ALWAYS_DISALLOWED:
        return False
    skills_cfg["always_disallowed"] = list(
        _DISPATCH_DEFAULTS["skills"]["always_disallowed"]
    )
    return True


def adopt_general_purpose_allowable(subagents_cfg: dict) -> bool:
    """Move general-purpose from always_disallowed to default_denied.

    W-054 hard-denied general-purpose via always_disallowed, which meant a
    project could not re-allow it even by naming it explicitly in
    per_agent_allow (the denylist short-circuits first). The current default
    lists it in default_denied instead: still blocked under the "*" wildcard,
    but allowable per-agent. We migrate an *untouched* denylist (exactly
    ``["general-purpose"]``) to the new shape; a customized denylist (extra
    entries) is a deliberate operator choice and is left alone.

    Returns True if migrated, else False. Preserves any existing default_denied
    entries (general-purpose is appended, de-duplicated).
    """
    if not isinstance(subagents_cfg, dict):
        return False
    if subagents_cfg.get("always_disallowed") != ["general-purpose"]:
        return False
    denied = subagents_cfg.get("default_denied")
    if not isinstance(denied, list):
        denied = []
    subagents_cfg["always_disallowed"] = []
    if "general-purpose" not in denied:
        denied = [*denied, "general-purpose"]
    subagents_cfg["default_denied"] = denied
    return True


def release_general_purpose_default_deny(subagents_cfg: dict) -> bool:
    """Remove general-purpose from default_denied to match the shipped default.

    The v2 migration parked general-purpose in default_denied (blocked under
    "*", allowable per-agent). The policy later changed to allow it by default
    (``_DISPATCH_DEFAULTS`` ships ``default_denied: []``), but that change did
    not self-heal already-migrated projects: a project stamped at v2 keeps
    ``default_denied: ["general-purpose"]`` forever and silently denies the
    subagent even though a fresh install allows it. We reverse the *untouched*
    v2 artifact — ``default_denied`` exactly ``["general-purpose"]`` — and leave
    a customized denylist (extra entries) alone as a deliberate operator choice.

    Returns True if migrated, else False.
    """
    if not isinstance(subagents_cfg, dict):
        return False
    if subagents_cfg.get("default_denied") != ["general-purpose"]:
        return False
    subagents_cfg["default_denied"] = []
    return True


def normalize_dispatch_defaults(governance_cfg: dict) -> list[str]:
    """Apply one-time dispatch-default normalizations, gated by a version stamp.

    Brings an *untouched* config up to the current shipped defaults for the
    things that changed after W-054:
      1. subagents.per_agent_allow pinned to the legacy Explore-only set,
      2. skills.always_disallowed carrying the broad ``worca-*`` glob,
      3. subagents.always_disallowed hard-denying general-purpose (moved to
         default_denied so it is allowable per-agent), and
      4. subagents.default_denied still carrying general-purpose (released so it
         is allowed under ``*``, matching the post-policy-change default).

    Each is exact-match guarded so a customized config is never silently
    widened. Stamps ``dispatch_migration_version`` so it runs once. Mutates
    ``governance_cfg`` in place; returns a list of change descriptions.
    """
    changes: list[str] = []
    if not isinstance(governance_cfg, dict):
        return changes
    stamp = governance_cfg.get("dispatch_migration_version")
    if not isinstance(stamp, int):
        stamp = 0
    if stamp >= DISPATCH_MIGRATION_VERSION:
        return changes
    dispatch = governance_cfg.get("dispatch")
    if not isinstance(dispatch, dict):
        return changes
    if adopt_stale_subagent_default(dispatch.get("subagents")):
        changes.append(
            "  governance.dispatch.subagents: adopted new default "
            '(_defaults: ["*"]) for config pinned to legacy Explore-only set'
        )
    if adopt_narrowed_skills_denylist(dispatch.get("skills")):
        changes.append(
            "  governance.dispatch.skills.always_disallowed: narrowed legacy "
            '"worca-*" glob to the current must-disallow set'
        )
    if adopt_general_purpose_allowable(dispatch.get("subagents")):
        changes.append(
            "  governance.dispatch.subagents: moved general-purpose from "
            "always_disallowed to default_denied (now allowable per-agent)"
        )
    # Runs AFTER adopt_general_purpose_allowable so a v1 project that just had
    # general-purpose moved into default_denied gets it released in the same
    # pass — net result: general-purpose allowed under "*", matching the default.
    if release_general_purpose_default_deny(dispatch.get("subagents")):
        changes.append(
            "  governance.dispatch.subagents: released general-purpose from "
            'default_denied (now allowed under "*", matching the shipped default)'
        )
    governance_cfg["dispatch_migration_version"] = DISPATCH_MIGRATION_VERSION
    return changes

# In-process cache for resolved dispatch sections. Each entry is keyed by section
# and stores (resolved_dict, settings_mtime). On every read we re-stat
# settings.json — if its mtime changed the cache is invalidated automatically.
# This keeps the cache useful for repeated reads in a single process while
# never serving stale config to long-running orchestrator runs that span a
# settings.json edit.
_cached_sections: dict[str, tuple[dict, float | None]] = {}


def _reset_dispatch_cache() -> None:
    """Reset the cached dispatch sections (used in tests and after config changes)."""
    _cached_sections.clear()


def _settings_path() -> str | None:
    """Return the absolute path to settings.json, or None if it can't be located.

    Resolution order:
      1. ``WORCA_SETTINGS_PATH`` — the *effective* settings file the runner pins
         for the run (template-merged + template-owned-key-stripped). Set so the
         dispatch hooks (subagent_start / skill_use) AND the
         ``--tools``/``--disallowedTools`` CLI-flag resolution read the SAME
         config as the rest of the pipeline. Without it both fall through to the
         raw on-disk project ``.claude/settings.json`` below, which silently
         overrides a template's ``governance.dispatch`` (the only template-owned
         key consumed via these on-disk paths). See ``run_pipeline``.
      2. ``CLAUDE_PROJECT_DIR``/.claude/settings.json
      3. git-toplevel/.claude/settings.json
    """
    pinned = os.environ.get("WORCA_SETTINGS_PATH")
    if pinned and os.path.exists(pinned):
        return pinned
    project_dir = os.environ.get("CLAUDE_PROJECT_DIR")
    if not project_dir:
        import subprocess

        result = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True,
            text=True,
        )
        if result.returncode == 0:
            project_dir = result.stdout.strip()
    if not project_dir:
        return None
    return os.path.join(project_dir, ".claude", "settings.json")


class ConfigUnreadable(Exception):
    """Raised when settings.json exists on disk but cannot be parsed as JSON.

    Distinguishes "no config, use defaults" (file absent) from "config is
    present but broken" (file there, JSON invalid). Hooks that catch this
    MUST fail-closed (exit 2) rather than fall back to defaults — under
    the new dispatch model, defaults are effectively wildcard-allow, so a
    silent fallback would grant near-full permissions while the user
    believes their custom config is in effect. See preflight stage for
    the corresponding startup-time check.
    """


def _load_settings() -> dict:
    """Load settings.json from the project root.

    Returns ``{}`` when no settings file exists (defaults apply).
    Raises ``ConfigUnreadable`` when the file exists but is not valid JSON
    — callers MUST treat this as a fail-closed condition.
    """
    path = _settings_path()
    if not path or not os.path.exists(path):
        return {}
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError as e:
        raise ConfigUnreadable(f"{path}: invalid JSON ({e})") from e


def _settings_mtime() -> float | None:
    """Return settings.json mtime, or None if not stat-able. Used for cache invalidation."""
    path = _settings_path()
    if not path:
        return None
    try:
        return os.path.getmtime(path)
    except OSError:
        return None


def _matches_any(candidate: str, patterns: list[str]) -> bool:
    """Check if candidate matches any pattern in the list.

    Supported: exact match, trailing-* prefix glob, bare '*' (matches all).
    """
    for pattern in patterns:
        if pattern == candidate:
            return True
        if pattern == "*":
            return True
        if pattern.endswith("*") and len(pattern) > 1 and candidate.startswith(pattern[:-1]):
            return True
    return False


def _load_dispatch_section(section: str, settings_override: dict | None = None) -> dict:
    """Load worca.governance.dispatch.{tools,skills,subagents}.

    Returns the normalized section dict with all three tiers populated.

    Results are cached in-process per section, keyed by settings.json mtime —
    if the file changes on disk the next read transparently picks up the new
    config. ``settings_override`` bypasses the cache (used by tests and any
    caller that needs a fresh read against a synthetic config).
    """
    if settings_override is None:
        cached = _cached_sections.get(section)
        current_mtime = _settings_mtime()
        if cached is not None and cached[1] == current_mtime:
            return cached[0]

    settings = settings_override if settings_override is not None else _load_settings()
    raw = (
        settings
        .get("worca", {})
        .get("governance", {})
        .get("dispatch", {})
        .get(section, {})
    )
    defaults = _DISPATCH_DEFAULTS[section]
    resolved = {
        "always_disallowed": list(raw.get("always_disallowed", defaults["always_disallowed"])),
        "default_denied": list(raw.get("default_denied", defaults["default_denied"])),
        "per_agent_allow": {**defaults["per_agent_allow"], **raw.get("per_agent_allow", {})},
    }

    if settings_override is None:
        _cached_sections[section] = (resolved, _settings_mtime())
    return resolved


def resolve_per_agent_entry(cfg: dict, agent: str) -> list[str]:
    """Resolve the effective per_agent_allow entry for an agent.

    Fall-through rules:
      * Missing key for a KNOWN agent → use ``_defaults``.
      * Missing key for an UNKNOWN agent (W-071 custom stage agents) → the
        lockdown sentinel. ``_defaults`` is calibrated for the shipped agent
        roster; an unknown role is too permissive a fit, so the grant must be
        explicit (per_agent_allow.<agent>).
      * Empty list ``[]`` for ``agent`` → fall through to ``_defaults`` too,
        because clearing the chip list in the UI shouldn't silently brick
        an agent. To express lockdown, set the entry to ``[LOCKDOWN_SENTINEL]``.

    The returned list may still contain ``"*"``, named entries, or be
    ``[LOCKDOWN_SENTINEL]`` — callers interpret those.
    """
    entry = cfg["per_agent_allow"].get(agent)
    if not entry:  # None or [] both fall through
        if agent and agent not in KNOWN_PIPELINE_AGENTS:
            return [LOCKDOWN_SENTINEL]
        entry = list(cfg["per_agent_allow"].get("_defaults", []))
    return list(entry)


def is_lockdown(entry: list[str]) -> bool:
    """True iff ``entry`` is the lockdown sentinel (exactly ``[LOCKDOWN_SENTINEL]``)."""
    return entry == [LOCKDOWN_SENTINEL]


def check_allowed(
    section: str,
    agent: str,
    candidate: str,
    *,
    settings_override: dict | None = None,
) -> tuple:
    """Returns (allowed: bool, reason: str, via: 'wildcard'|'explicit'|None)."""
    if not agent:
        return (True, "ok", None)

    cfg = _load_dispatch_section(section, settings_override)

    if _matches_any(candidate, cfg["always_disallowed"]):
        return (False, "always_disallowed", None)

    entry = resolve_per_agent_entry(cfg, agent)

    if is_lockdown(entry):
        return (False, "lockdown", None)

    has_wildcard = "*" in entry
    explicit = {x for x in entry if x != "*"}

    if has_wildcard:
        if candidate in explicit:
            return (True, "ok", "explicit")
        if _matches_any(candidate, cfg["default_denied"]):
            return (False, "default_denied", None)
        return (True, "ok", "wildcard")
    else:
        if candidate in explicit:
            return (True, "ok", "explicit")
        return (False, "not_in_allow_list", None)


def check_dispatch(parent_agent: str, child_agent: str) -> tuple:
    """Check if parent_agent is allowed to dispatch child_agent.

    Returns (0, "") for allowed, (2, reason) for blocked.
    Thin shim over check_allowed('subagents', ...).
    """
    if not parent_agent:
        return (0, "")

    allowed, reason, via = check_allowed("subagents", parent_agent, child_agent)
    if allowed:
        return (0, "")
    if reason == "always_disallowed":
        return (2, f"Blocked: {child_agent} is on the subagent denylist")
    return (2, f"Blocked: {parent_agent} cannot dispatch {child_agent}")


def handle_agent_stop(agent_type: str, bead_id: str | None, success: bool) -> None:
    """Handle agent stop event. Close bead on success if bead_id is provided."""
    if success and bead_id:
        from worca.utils.beads import bd_close

        bd_close(bead_id)


def main():
    data = json.load(sys.stdin)
    event = data.get("event", "")
    if event == "subagent_start":
        parent = os.environ.get("WORCA_AGENT", "")
        child = data.get("agent_type", "")
        try:
            code, reason = check_dispatch(parent, child)
        except ConfigUnreadable as e:
            print(
                f"Blocked: settings.json malformed — pipeline runtime cannot "
                f"evaluate dispatch governance. Fix and retry. ({e})",
                file=sys.stderr,
            )
            sys.exit(2)
        if code != 0:
            print(reason, file=sys.stderr)
        sys.exit(code)
    elif event == "subagent_stop":
        agent_type = data.get("agent_type", "")
        bead_id = data.get("bead_id")
        success = data.get("success", False)
        handle_agent_stop(agent_type, bead_id, success)


if __name__ == "__main__":
    main()
