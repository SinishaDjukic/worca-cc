"""Tests for agent dispatch rules and Beads task sync hooks."""

from unittest.mock import patch
import pytest
from worca.hooks.tracking import (
    LOCKDOWN_SENTINEL,
    ConfigUnreadable,
    check_dispatch,
    check_allowed,
    handle_agent_stop,
    _DISPATCH_DEFAULTS,
    _load_settings,
    _matches_any,
    _reset_dispatch_cache,
    is_lockdown,
    resolve_per_agent_entry,
)


@pytest.fixture(autouse=True)
def reset_cache():
    """Reset dispatch cache before and after each test for isolation."""
    _reset_dispatch_cache()
    yield
    _reset_dispatch_cache()


# --- check_dispatch tests ---


def test_blocks_implementer_dispatching_planner_under_narrow_default():
    """Under a narrowed _defaults (e.g. ["Explore"]), the implementer can't
    dispatch arbitrary pipeline-stage names. PR B changed the bundled default
    to ["*"], so this only blocks when the project narrows the allow list.
    """
    cfg = {"worca": {"governance": {"dispatch": {"subagents": {
        "always_disallowed": ["general-purpose"],
        "default_denied": [],
        "per_agent_allow": {"_defaults": ["Explore"]},
    }}}}}
    allowed, reason, _ = check_allowed(
        "subagents", "implementer", "planner", settings_override=cfg,
    )
    assert allowed is False
    assert reason == "not_in_allow_list"


def test_implementer_dispatching_planner_allowed_under_wildcard_default():
    """PR B: wildcard default allows the implementer to dispatch any
    non-denied subagent — including a project-defined `planner` subagent."""
    cfg = {"worca": {"governance": {"dispatch": {"subagents": {
        "always_disallowed": ["general-purpose"],
        "default_denied": [],
        "per_agent_allow": {"_defaults": ["*"]},
    }}}}}
    allowed, reason, _ = check_allowed(
        "subagents", "implementer", "planner", settings_override=cfg,
    )
    assert allowed is True
    assert reason == "ok"


def test_allows_planner_dispatching_explore():
    code, reason = check_dispatch("planner", "Explore")
    assert code == 0
    assert reason == ""


def test_allows_implementer_dispatching_explore():
    code, reason = check_dispatch("implementer", "Explore")
    assert code == 0


def test_coordinator_gets_explore_via_defaults():
    """W-054 + PR B: coordinator now gets Explore via _defaults wildcard."""
    code, reason = check_dispatch("coordinator", "Explore")
    assert code == 0


def test_allows_tester_dispatching_explore():
    """tester can now dispatch explore (W-038)."""
    code, reason = check_dispatch("tester", "Explore")
    assert code == 0


def test_allows_guardian_dispatching_explore():
    code, reason = check_dispatch("guardian", "Explore")
    assert code == 0


def test_blocks_guardian_dispatching_implementer_under_narrow_default():
    """Under a narrowed _defaults, guardian can't dispatch unrelated names."""
    cfg = {"worca": {"governance": {"dispatch": {"subagents": {
        "always_disallowed": ["general-purpose"],
        "default_denied": [],
        "per_agent_allow": {"_defaults": ["Explore"]},
    }}}}}
    allowed, _, _ = check_allowed(
        "subagents", "guardian", "implementer", settings_override=cfg,
    )
    assert allowed is False


def test_allows_all_in_interactive_mode():
    code, reason = check_dispatch("", "planner")
    assert code == 0


def test_allows_all_in_interactive_mode_any_agent():
    code, reason = check_dispatch("", "implementer")
    assert code == 0


def test_unknown_parent_locked_down():
    """W-071 §4: unknown (custom) agents resolve to the lockdown sentinel
    instead of _defaults — an unknown role must be granted explicitly.
    (Supersedes the W-054 PR B fall-through-to-defaults behavior.)"""
    code, reason = check_dispatch("unknown_agent", "Explore")
    assert code == 2


def test_unknown_parent_with_explicit_grant_allowed():
    """A custom agent named in per_agent_allow gets exactly its grants."""
    cfg = {"worca": {"governance": {"dispatch": {"subagents": {
        "per_agent_allow": {"docs_auditor": ["Explore"]},
    }}}}}
    allowed, _, via = check_allowed(
        "subagents", "docs_auditor", "Explore", settings_override=cfg,
    )
    assert allowed is True
    assert via == "explicit"
    allowed, reason, _ = check_allowed(
        "subagents", "docs_auditor", "general-purpose", settings_override=cfg,
    )
    assert allowed is False


def test_unknown_agent_locked_down_for_tools():
    """The lockdown applies to every dispatch section, tools included."""
    allowed, reason, _ = check_allowed(
        "tools", "docs_auditor", "Read", settings_override={},
    )
    assert allowed is False
    assert reason == "lockdown"


def test_known_pipeline_agents_match_orchestrator_roster():
    """The hook-local roster stays in sync with the orchestrator's agent set
    (plus plan_editor, which substitutes for plan_reviewer in edit mode but
    has no STAGE_AGENT_MAP entry of its own)."""
    from worca.hooks.tracking import KNOWN_PIPELINE_AGENTS
    from worca.orchestrator.stages import ALL_AGENTS

    assert KNOWN_PIPELINE_AGENTS == frozenset(ALL_AGENTS) | {"plan_editor"}


def test_plan_editor_still_falls_back_to_defaults():
    """plan_editor is a shipped agent — it must keep the _defaults fall-through."""
    code, reason = check_dispatch("plan_editor", "Explore")
    assert code == 0


def test_blocks_plan_reviewer_dispatching_implementer_under_narrow_default():
    """Under a narrowed _defaults, plan_reviewer can't dispatch implementer."""
    cfg = {"worca": {"governance": {"dispatch": {"subagents": {
        "always_disallowed": ["general-purpose"],
        "default_denied": [],
        "per_agent_allow": {"_defaults": ["Explore"]},
    }}}}}
    allowed, _, _ = check_allowed(
        "subagents", "plan_reviewer", "implementer", settings_override=cfg,
    )
    assert allowed is False


def test_reviewer_dispatching_explore():
    """W-037 gap fix: reviewer can dispatch explore."""
    code, reason = check_dispatch("reviewer", "Explore")
    assert code == 0


def test_allows_learner_dispatching_explore():
    code, _reason = check_dispatch("learner", "Explore")
    assert code == 0


def test_check_dispatch_maps_default_denied_to_cannot_dispatch():
    """check_dispatch maps a default_denied verdict to the "cannot dispatch"
    message (not the always_disallowed "denylist" message). general-purpose is
    now allowed by default, so we force the denied verdict via the underlying
    check_allowed to test the mapping independent of the shipped config."""
    with patch(
        "worca.hooks.tracking.check_allowed",
        return_value=(False, "default_denied", None),
    ):
        code, reason = check_dispatch("coordinator", "general-purpose")
    assert code == 2
    assert "cannot dispatch" in reason
    assert "denylist" not in reason.lower()


def test_check_dispatch_allows_general_purpose_by_default():
    """With general-purpose removed from default_denied it now dispatches via
    the `*` wildcard (config-independent: forced through the default map)."""
    allowed, _reason, via = check_allowed(
        "subagents", "coordinator", "general-purpose", settings_override={},
    )
    assert allowed is True
    assert via == "wildcard"


def test_always_disallowed_wins_over_per_agent_allow():
    """User config that names a denied item is overruled by always_disallowed.
    Settings.json wins is the design intent (project-memory), but a user listing
    `general-purpose` in per_agent_allow while leaving it on `always_disallowed`
    still gets blocked — the tiers stack."""
    settings = {
        "worca": {"governance": {"dispatch": {"subagents": {
            "always_disallowed": ["general-purpose"],
            "default_denied": [],
            "per_agent_allow": {"implementer": ["*", "general-purpose"]},
        }}}}
    }
    allowed, reason, _ = check_allowed(
        "subagents", "implementer", "general-purpose", settings_override=settings,
    )
    assert allowed is False
    assert reason == "always_disallowed"


def test_user_can_clear_always_disallowed_floor():
    """When the user empties always_disallowed, general-purpose becomes allowed.
    Project-memory: settings.json wins is intentional — there is no frozen floor."""
    settings = {
        "worca": {"governance": {"dispatch": {"subagents": {
            "always_disallowed": [],
            "default_denied": [],
            "per_agent_allow": {"implementer": ["*", "general-purpose"]},
        }}}}
    }
    allowed, _, _ = check_allowed(
        "subagents", "implementer", "general-purpose", settings_override=settings,
    )
    assert allowed is True


def test_default_constant_matches_settings_json():
    """settings.json dispatch.subagents shape must match _DISPATCH_DEFAULTS."""
    import json
    import os

    settings_path = os.path.join(
        os.path.dirname(__file__), "..", "src", "worca", "settings.json"
    )
    with open(settings_path) as f:
        raw = json.load(f)

    for section in ("tools", "skills", "subagents"):
        json_section = (
            raw.get("worca", {})
            .get("governance", {})
            .get("dispatch", {})
            .get(section, {})
        )
        defaults_section = _DISPATCH_DEFAULTS[section]
        assert json_section["always_disallowed"] == defaults_section["always_disallowed"], (
            f"{section}.always_disallowed mismatch"
        )
        assert json_section["default_denied"] == defaults_section["default_denied"], (
            f"{section}.default_denied mismatch"
        )


def test_cache_reset_between_config_changes():
    """After _reset_dispatch_cache(), a new settings_override is honoured."""
    settings_a = {"worca": {"governance": {"dispatch": {"subagents": {
        "per_agent_allow": {"planner": [LOCKDOWN_SENTINEL]},
    }}}}}
    settings_b = {"worca": {"governance": {"dispatch": {"subagents": {
        "per_agent_allow": {"planner": ["Explore"]},
    }}}}}
    allowed_a, _, _ = check_allowed(
        "subagents", "planner", "Explore", settings_override=settings_a,
    )
    assert allowed_a is False

    _reset_dispatch_cache()

    allowed_b, _, _ = check_allowed(
        "subagents", "planner", "Explore", settings_override=settings_b,
    )
    assert allowed_b is True


def test_load_dispatch_section_caches_disk_reads():
    """W-054 cache: _load_dispatch_section reads disk once per section and
    reuses the resolved dict on subsequent calls (until _reset_dispatch_cache).
    """
    import worca.hooks.tracking as tracking

    load_calls = {"n": 0}

    def counting_load():
        load_calls["n"] += 1
        return {
            "worca": {
                "governance": {
                    "dispatch": {
                        "tools": {"per_agent_allow": {"planner": ["Read"]}},
                    },
                },
            },
        }

    with patch.object(tracking, "_load_settings", side_effect=counting_load):
        # First call hits disk
        cfg1 = tracking._load_dispatch_section("tools")
        # Second call (no settings_override) must use the cache
        cfg2 = tracking._load_dispatch_section("tools")
        # Different section also reads disk once, doesn't share the tools cache
        cfg3 = tracking._load_dispatch_section("skills")

    assert load_calls["n"] == 2, f"expected 2 disk reads (tools + skills), got {load_calls['n']}"
    assert cfg1 is cfg2  # same cached object
    assert cfg3["per_agent_allow"]["_defaults"] == ["*"]


def test_load_dispatch_section_override_bypasses_cache():
    """settings_override must bypass the cache so test fixtures stay isolated."""
    import worca.hooks.tracking as tracking

    # Prime cache with one config
    primed = {"worca": {"governance": {"dispatch": {"tools": {"per_agent_allow": {"planner": ["Read"]}}}}}}
    with patch.object(tracking, "_load_settings", return_value=primed):
        tracking._load_dispatch_section("tools")  # cache is populated

    # Override produces a different result even though the cache holds the primed one
    override = {"worca": {"governance": {"dispatch": {"tools": {"per_agent_allow": {"planner": ["Grep"]}}}}}}
    cfg = tracking._load_dispatch_section("tools", settings_override=override)
    assert cfg["per_agent_allow"]["planner"] == ["Grep"]


def test_missing_settings_file_uses_defaults():
    """When settings.json is missing, _load_dispatch_section falls back to _DISPATCH_DEFAULTS."""
    import worca.hooks.tracking as tracking

    with patch.object(tracking, "_load_settings", return_value={}):
        cfg = tracking._load_dispatch_section("subagents")

    assert cfg["always_disallowed"] == _DISPATCH_DEFAULTS["subagents"]["always_disallowed"]
    assert cfg["per_agent_allow"]["_defaults"] == ["*"]


# --- handle_agent_stop tests ---


def test_closes_bead_on_success():
    with patch("worca.utils.beads.bd_close") as mock_close:
        handle_agent_stop("implementer", "bd-123", True)
    mock_close.assert_called_once_with("bd-123")


def test_no_close_on_failure():
    with patch("worca.utils.beads.bd_close") as mock_close:
        handle_agent_stop("implementer", "bd-123", False)
    mock_close.assert_not_called()


def test_no_close_when_no_bead_id():
    with patch("worca.utils.beads.bd_close") as mock_close:
        handle_agent_stop("implementer", None, True)
    mock_close.assert_not_called()


def test_no_close_on_failure_without_bead():
    with patch("worca.utils.beads.bd_close") as mock_close:
        handle_agent_stop("tester", None, False)
    mock_close.assert_not_called()


# --- Helper ---


def _settings_with_dispatch(section: str, section_config: dict) -> dict:
    """Construct a settings dict for a dispatch section."""
    return {"worca": {"governance": {"dispatch": {section: section_config}}}}


# --- _matches_any tests (W-054 §11) ---


def test_matches_any_exact_match():
    """Exact string match works; different strings don't match."""
    assert _matches_any("hookify:hookify", ["hookify:hookify"]) is True
    assert _matches_any("hookify:list", ["hookify:hookify"]) is False


def test_matches_any_glob_worca_prefix():
    """Trailing-* glob matches prefix; missing separator doesn't match."""
    assert _matches_any("worca-install", ["worca-*"]) is True
    assert _matches_any("worca-release", ["worca-*"]) is True
    assert _matches_any("worca", ["worca-*"]) is False


def test_matches_any_bare_wildcard():
    """Bare '*' matches everything."""
    assert _matches_any("anything", ["*"]) is True
    assert _matches_any("*", ["*"]) is True


def test_matches_any_empty_candidate():
    """Empty string doesn't match a prefix glob."""
    assert _matches_any("", ["worca-*"]) is False


# --- check_allowed tests (W-054 §2.1) ---


def test_check_allowed_wildcard_allows_unknown():
    """'*' allows any candidate not in deny tiers — no all_known needed."""
    cfg = _settings_with_dispatch("subagents", {
        "always_disallowed": [],
        "default_denied": [],
        "per_agent_allow": {"_defaults": ["*"]},
    })
    allowed, reason, via = check_allowed(
        "subagents", "planner", "some-new-agent", settings_override=cfg,
    )
    assert allowed is True
    assert via == "wildcard"


def test_check_allowed_mixed_form():
    """'["*", "review"]' includes default_denied 'review' with via='explicit'."""
    cfg = _settings_with_dispatch("skills", {
        "always_disallowed": [],
        "default_denied": ["review", "security-review"],
        "per_agent_allow": {"_defaults": ["*"], "reviewer": ["*", "review"]},
    })
    allowed, reason, via = check_allowed(
        "skills", "reviewer", "review", settings_override=cfg,
    )
    assert allowed is True
    assert via == "explicit"


def test_check_allowed_replace_not_union():
    """Per-agent entry replaces _defaults, does not union."""
    cfg = _settings_with_dispatch("subagents", {
        "always_disallowed": [],
        "default_denied": [],
        "per_agent_allow": {"_defaults": ["Explore"], "implementer": ["foo"]},
    })
    allowed, _, _ = check_allowed(
        "subagents", "implementer", "Explore", settings_override=cfg,
    )
    assert allowed is False
    allowed, _, _ = check_allowed(
        "subagents", "implementer", "foo", settings_override=cfg,
    )
    assert allowed is True


def test_check_allowed_always_disallowed_short_circuit():
    """Tier 1 (always_disallowed) wins over '*' and explicit naming."""
    cfg = _settings_with_dispatch("subagents", {
        "always_disallowed": ["general-purpose"],
        "default_denied": [],
        "per_agent_allow": {
            "_defaults": ["*"],
            "implementer": ["*", "general-purpose"],
        },
    })
    allowed, reason, via = check_allowed(
        "subagents", "implementer", "general-purpose", settings_override=cfg,
    )
    assert allowed is False
    assert reason == "always_disallowed"
    assert via is None


def test_check_allowed_default_denied_not_in_wildcard():
    """'*' excludes default_denied items; reason is 'default_denied'."""
    cfg = _settings_with_dispatch("skills", {
        "always_disallowed": [],
        "default_denied": ["review"],
        "per_agent_allow": {"_defaults": ["*"]},
    })
    allowed, reason, via = check_allowed(
        "skills", "implementer", "review", settings_override=cfg,
    )
    assert allowed is False
    assert reason == "default_denied"
    assert via is None


def test_check_allowed_missing_section_uses_defaults():
    """Empty config falls back to _DISPATCH_DEFAULTS.

    PR B: subagent _defaults is now ['*'], so Explore resolves via wildcard.
    """
    allowed, reason, via = check_allowed(
        "subagents", "planner", "Explore", settings_override={},
    )
    assert allowed is True
    assert via == "wildcard"


def test_check_allowed_workspace_planner_falls_back_to_defaults():
    """Agent not in per_agent_allow resolves via _defaults (§1.2 regression fix)."""
    cfg = _settings_with_dispatch("subagents", {
        "always_disallowed": ["general-purpose"],
        "default_denied": [],
        "per_agent_allow": {"_defaults": ["Explore"]},
    })
    allowed, reason, via = check_allowed(
        "subagents", "workspace_planner", "Explore", settings_override=cfg,
    )
    assert allowed is True
    assert via == "explicit"


def test_check_allowed_via_field():
    """Returns 'wildcard' when resolved via '*', 'explicit' when named."""
    cfg_wildcard = _settings_with_dispatch("subagents", {
        "always_disallowed": [],
        "default_denied": [],
        "per_agent_allow": {"_defaults": ["*"]},
    })
    _, _, via = check_allowed(
        "subagents", "planner", "Explore", settings_override=cfg_wildcard,
    )
    assert via == "wildcard"

    cfg_explicit = _settings_with_dispatch("subagents", {
        "always_disallowed": [],
        "default_denied": [],
        "per_agent_allow": {"_defaults": ["Explore"]},
    })
    _, _, via = check_allowed(
        "subagents", "planner", "Explore", settings_override=cfg_explicit,
    )
    assert via == "explicit"


def test_check_allowed_empty_agent_allows_all():
    """Empty agent (interactive mode) allows all dispatches."""
    allowed, reason, via = check_allowed(
        "subagents", "", "anything", settings_override={},
    )
    assert allowed is True


def test_check_allowed_bare_wildcard_in_deny_list_blocks_everything():
    """Footgun: bare '*' in always_disallowed blocks everything."""
    cfg = _settings_with_dispatch("skills", {
        "always_disallowed": ["*"],
        "default_denied": [],
        "per_agent_allow": {"_defaults": ["*"]},
    })
    allowed, reason, _ = check_allowed(
        "skills", "implementer", "any-skill", settings_override=cfg,
    )
    assert allowed is False
    assert reason == "always_disallowed"


# --- PR A: refreshed Claude Code built-in defaults ---


@pytest.mark.parametrize("agent", [
    "planner", "coordinator", "implementer", "tester",
    "guardian", "reviewer", "plan_reviewer", "learner",
])
def test_batch_skill_always_denied_for_every_agent(agent):
    """The bundled /batch skill must be hard-denied — it spawns parallel pipelines."""
    allowed, reason, _ = check_allowed("skills", agent, "batch", settings_override={})
    assert allowed is False
    assert reason == "always_disallowed"


@pytest.mark.parametrize("agent", [
    "planner", "coordinator", "implementer", "tester",
    "guardian", "reviewer", "plan_reviewer", "learner",
])
def test_fewer_permission_prompts_skill_always_denied(agent):
    """fewer-permission-prompts rewrites the project's allowlist — always denied."""
    allowed, reason, _ = check_allowed(
        "skills", agent, "fewer-permission-prompts", settings_override={},
    )
    assert allowed is False
    assert reason == "always_disallowed"


def test_simplify_default_denied_under_wildcard():
    """simplify is in default_denied — agents under _defaults: ["*"] cannot use it."""
    allowed, reason, _ = check_allowed(
        "skills", "planner", "simplify", settings_override={},
    )
    assert allowed is False
    assert reason == "default_denied"


def test_simplify_allowed_for_implementer_opt_in():
    """implementer is opted into simplify via per_agent_allow."""
    allowed, _, via = check_allowed(
        "skills", "implementer", "simplify", settings_override={},
    )
    assert allowed is True
    assert via == "explicit"


def test_debug_default_denied_but_allowed_for_tester():
    """debug is default_denied; only the tester is opted in."""
    allowed, reason, _ = check_allowed(
        "skills", "planner", "debug", settings_override={},
    )
    assert allowed is False
    assert reason == "default_denied"

    allowed, _, via = check_allowed(
        "skills", "tester", "debug", settings_override={},
    )
    assert allowed is True
    assert via == "explicit"


def test_claude_api_default_denied_but_allowed_for_implementer():
    """claude-api is default_denied; the implementer is opted in."""
    allowed, reason, _ = check_allowed(
        "skills", "reviewer", "claude-api", settings_override={},
    )
    assert allowed is False
    assert reason == "default_denied"

    allowed, _, via = check_allowed(
        "skills", "implementer", "claude-api", settings_override={},
    )
    assert allowed is True
    assert via == "explicit"


def test_review_skill_opted_in_for_reviewer():
    """reviewer can dispatch the review and security-review skills."""
    for skill in ("review", "security-review"):
        allowed, _, via = check_allowed(
            "skills", "reviewer", skill, settings_override={},
        )
        assert allowed is True, f"{skill} should be allowed for reviewer"
        assert via == "explicit"


def test_claude_md_management_skills_opted_in_for_learner():
    """learner is opted into claude-md-management:* skills."""
    for skill in (
        "claude-md-management:revise-claude-md",
        "claude-md-management:claude-md-improver",
    ):
        allowed, _, via = check_allowed(
            "skills", "learner", skill, settings_override={},
        )
        assert allowed is True, f"{skill} should be allowed for learner"
        assert via == "explicit"


# --- PR B: subagents _defaults flipped to ["*"] ---


@pytest.mark.parametrize("agent", [
    "planner", "coordinator", "implementer", "tester",
    "guardian", "reviewer", "plan_reviewer", "learner", "workspace_planner",
])
def test_subagents_wildcard_default_allows_any_non_denied(agent):
    """PR B: every pipeline agent dispatches arbitrary subagents via wildcard."""
    allowed, reason, via = check_allowed(
        "subagents", agent, "feature-dev:code-reviewer", settings_override={},
    )
    assert allowed is True, f"{agent} should dispatch via wildcard"
    assert via == "wildcard"


def test_subagents_general_purpose_allowed_by_default_via_wildcard():
    """general-purpose is no longer denied by default — it now dispatches via
    the '*' wildcard like any other subagent (was previously default_denied)."""
    allowed, reason, via = check_allowed(
        "subagents", "implementer", "general-purpose", settings_override={},
    )
    assert allowed is True
    assert via == "wildcard"


def test_subagents_general_purpose_allowable_when_named_explicitly():
    """Because general-purpose is default_denied (not always_disallowed), a
    project can re-allow it for an agent by naming it in per_agent_allow."""
    cfg = _settings_with_dispatch("subagents", {
        "always_disallowed": [],
        "default_denied": ["general-purpose"],
        "per_agent_allow": {
            "_defaults": ["*"],
            "implementer": ["*", "general-purpose"],
        },
    })
    allowed, reason, via = check_allowed(
        "subagents", "implementer", "general-purpose", settings_override=cfg,
    )
    assert allowed is True
    assert via == "explicit"


def test_subagents_explore_now_via_wildcard():
    """PR B: Explore is no longer enumerated per-agent — it resolves via wildcard."""
    _, _, via = check_allowed(
        "subagents", "planner", "Explore", settings_override={},
    )
    assert via == "wildcard"


# --- Empty-list fall-through + lockdown sentinel (post-review #2) ---


def test_resolve_per_agent_entry_missing_key_falls_through():
    cfg = {"per_agent_allow": {"_defaults": ["Explore"], "planner": ["foo"]}}
    assert resolve_per_agent_entry(cfg, "tester") == ["Explore"]


def test_resolve_per_agent_entry_empty_list_falls_through():
    """[]-as-entry must behave like a missing key (clearing UI chips ≠ lockdown)."""
    cfg = {"per_agent_allow": {"_defaults": ["Explore"], "implementer": []}}
    assert resolve_per_agent_entry(cfg, "implementer") == ["Explore"]


def test_resolve_per_agent_entry_lockdown_sentinel_preserved():
    """[LOCKDOWN_SENTINEL] is the only explicit lockdown form — preserved as-is."""
    cfg = {
        "per_agent_allow": {"_defaults": ["*"], "implementer": [LOCKDOWN_SENTINEL]},
    }
    assert resolve_per_agent_entry(cfg, "implementer") == [LOCKDOWN_SENTINEL]


def test_is_lockdown_only_singleton():
    assert is_lockdown([LOCKDOWN_SENTINEL]) is True
    assert is_lockdown([]) is False
    assert is_lockdown([LOCKDOWN_SENTINEL, "Read"]) is False  # mixed → not lockdown
    assert is_lockdown(["*"]) is False


def test_check_allowed_empty_list_falls_through_to_defaults():
    cfg = _settings_with_dispatch("skills", {
        "always_disallowed": [],
        "default_denied": [],
        "per_agent_allow": {"_defaults": ["*"], "implementer": []},
    })
    allowed, _, via = check_allowed(
        "skills", "implementer", "any-skill", settings_override=cfg,
    )
    assert allowed is True
    assert via == "wildcard"


def test_check_allowed_lockdown_sentinel_blocks_everything():
    cfg = _settings_with_dispatch("skills", {
        "always_disallowed": [],
        "default_denied": [],
        "per_agent_allow": {"_defaults": ["*"], "implementer": [LOCKDOWN_SENTINEL]},
    })
    allowed, reason, _ = check_allowed(
        "skills", "implementer", "any-skill", settings_override=cfg,
    )
    assert allowed is False
    assert reason == "lockdown"


def test_check_allowed_lockdown_blocks_even_safe_candidate():
    """Lockdown is total — even a candidate that the wildcard would allow is denied."""
    cfg = _settings_with_dispatch("subagents", {
        "always_disallowed": [],
        "default_denied": [],
        "per_agent_allow": {"_defaults": ["*"], "implementer": [LOCKDOWN_SENTINEL]},
    })
    allowed, reason, _ = check_allowed(
        "subagents", "implementer", "Explore", settings_override=cfg,
    )
    assert allowed is False
    assert reason == "lockdown"


def test_check_allowed_literal_none_with_other_entries_is_not_lockdown():
    """['none', 'Read'] is NOT lockdown — 'none' is just a skill/tool name there.
    Only the exact singleton ['none'] is the sentinel."""
    cfg = _settings_with_dispatch("tools", {
        "always_disallowed": [],
        "default_denied": [],
        "per_agent_allow": {"_defaults": ["*"], "implementer": ["none", "Read"]},
    })
    allowed, _, via = check_allowed(
        "tools", "implementer", "Read", settings_override=cfg,
    )
    assert allowed is True
    assert via == "explicit"


# --- mtime-based cache invalidation (post-review #5) ---


# --- ConfigUnreadable: fail-closed on malformed settings.json ---


def test_load_settings_returns_empty_when_file_absent(tmp_path, monkeypatch):
    """Missing settings.json is a known state, not an error — defaults apply."""
    import worca.hooks.tracking as tracking
    missing = tmp_path / "nope.json"
    monkeypatch.setattr(tracking, "_settings_path", lambda: str(missing))
    assert _load_settings() == {}


def test_load_settings_raises_config_unreadable_on_malformed_json(tmp_path, monkeypatch):
    """Malformed JSON must surface as a typed exception so hooks can fail-closed.

    Bare ``json.JSONDecodeError`` would propagate up and crash the hook
    with exit code 1, which Claude Code treats as a non-blocking error —
    the dispatch would proceed, silently bypassing governance.
    """
    import worca.hooks.tracking as tracking
    bad = tmp_path / "settings.json"
    bad.write_text('{"worca": ')  # truncated, invalid JSON
    monkeypatch.setattr(tracking, "_settings_path", lambda: str(bad))
    with pytest.raises(ConfigUnreadable) as exc:
        _load_settings()
    assert str(bad) in str(exc.value)


def test_check_allowed_propagates_config_unreadable(tmp_path, monkeypatch):
    """check_allowed surfaces ConfigUnreadable so hook main() can exit 2.

    The alternative — catching internally and falling back to defaults —
    would silently grant near-full permissions under the new dispatch
    model (defaults are ``_defaults: ["*"]`` for every section).
    """
    import worca.hooks.tracking as tracking
    bad = tmp_path / "settings.json"
    bad.write_text("{this is not json")
    monkeypatch.setattr(tracking, "_settings_path", lambda: str(bad))
    with pytest.raises(ConfigUnreadable):
        check_allowed("subagents", "implementer", "Explore")


def test_dispatch_cache_invalidates_when_settings_mtime_changes(tmp_path, monkeypatch):
    """Editing settings.json on disk transparently invalidates the per-section cache."""
    import os
    import worca.hooks.tracking as tracking

    settings_path = tmp_path / "settings.json"
    settings_path.write_text(
        '{"worca": {"governance": {"dispatch": {"subagents": '
        '{"per_agent_allow": {"planner": ["Explore"]}}}}}}'
    )
    monkeypatch.setattr(tracking, "_settings_path", lambda: str(settings_path))

    cfg1 = tracking._load_dispatch_section("subagents")
    assert cfg1["per_agent_allow"]["planner"] == ["Explore"]

    # Rewrite settings with a different per-agent value and bump mtime
    settings_path.write_text(
        '{"worca": {"governance": {"dispatch": {"subagents": '
        '{"per_agent_allow": {"planner": ["Grep"]}}}}}}'
    )
    new_mtime = os.path.getmtime(settings_path) + 10
    os.utime(settings_path, (new_mtime, new_mtime))

    cfg2 = tracking._load_dispatch_section("subagents")
    assert cfg2["per_agent_allow"]["planner"] == ["Grep"]
