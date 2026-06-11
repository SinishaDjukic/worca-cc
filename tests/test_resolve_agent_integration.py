"""Integration tests for agent .md + block resolution.

Post channel-separation restoration (block routing in the runner loop), the
agent .md files carry only static role/process/rules content — the per-run
block content travels via the -p user message. These tests split into two
suites:

1. Agent .md resolution (resolve_agent) — static content only; verifies
   placeholders like {{plan_file}} / {{run_id}} resolve, governance rules
   survive, and NO dynamic content (work_request, plan, failures, etc.)
   leaks into the system prompt.

2. Block resolution (resolve_block + resolve_placeholders) — verifies each
   .block.md renders the expected dynamic content for its stage.
"""

import pathlib

import pytest

from worca.orchestrator.overlay import (
    OverlayResolver,
    resolve_agent,
    resolve_blocks,
    resolve_placeholders,
)

CORE_DIR = pathlib.Path(__file__).parent.parent / "src" / "worca" / "agents" / "core"


def _make_resolver() -> OverlayResolver:
    return OverlayResolver(overrides_dir="/nonexistent/no/project/overrides")


def _load_agent(agent_name: str) -> str:
    return (CORE_DIR / f"{agent_name}.md").read_text()


def _resolve_agent(agent_name: str, context: dict) -> str:
    resolver = _make_resolver()
    return resolve_agent(_load_agent(agent_name), context, resolver, str(CORE_DIR))


def _resolve_block(block_name: str, context: dict) -> str:
    # Mirrors the runner's stage-prompt path: resolve_block → nested
    # resolve_blocks (shared reminder blocks) → resolve_placeholders.
    resolver = _make_resolver()
    raw = resolver.resolve_block(block_name, str(CORE_DIR))
    assert raw is not None, f"block '{block_name}' not found under {CORE_DIR}"
    raw = resolve_blocks(raw, context, resolver, str(CORE_DIR))
    return resolve_placeholders(raw, context)


# ---------------------------------------------------------------------------
# Agent .md — static role/rules only; no dynamic content leakage
# ---------------------------------------------------------------------------


_DYNAMIC_KEYS_BY_AGENT = {
    "planner":       ["Add user authentication", "# Plan v1", "My special plan content"],
    "plan_reviewer": ["Add user authentication", "# Plan under review"],
    "coordinator":   ["Add user authentication", "Use JWT tokens"],
    "implementer":   ["Add user authentication", "Create JWT middleware",
                      "401 != 200", "SQL injection"],
    "tester":        ["Add user authentication", "files: auth.py"],
    "reviewer":      ["Add user authentication", "PASSED", "auth.py"],
    "guardian":      ["Add user authentication", "JWT approach"],
    "learner":       ["Add user authentication", "run-xyz-99", '{"foo": 1}'],
}


@pytest.mark.parametrize("agent_name,needles", list(_DYNAMIC_KEYS_BY_AGENT.items()))
def test_agent_md_excludes_dynamic_content(agent_name, needles):
    """Agent .md must not embed any run-specific content — that lives in -p."""
    # Context values are deliberately supplied; they must be dropped on the floor
    # because the agent .md no longer embeds {{block:X}}.
    ctx = {
        "plan_file": "MASTER_PLAN.md",
        "run_id": "run-xyz-99",
        "work_request": "Add user authentication",
        "claude_md": "# Project CLAUDE.md content",
        "plan_content": "# Plan v1\n\nMy special plan content",
        "plan_summary": "Use JWT tokens. Tasks: auth module.",
        "plan_revision_mode": True,
        "plan_review_issues_formatted": "1. Missing error handling",
        "plan_review_history_formatted": "- Attempt 1: issue",
        "is_retry": True,
        "issue_type": "Test Failures",
        "attempt_count": "2",
        "test_failures_formatted": "1. **test_login** — AssertionError: 401 != 200",
        "review_issues_formatted": "1. [critical] `auth.py:42` — SQL injection",
        "previous_attempts": "",
        "assigned_task": "**worca-abc123**: Create JWT middleware",
        "test_results": "**Status:** PASSED",
        "files_changed_formatted": "- auth.py\n- middleware.py",
        "implementation_summary": "files: auth.py changed",
        "plan_approach": "JWT approach with refresh tokens",
        "termination_type": "success",
        "termination_reason": "",
        "run_data": '{"foo": 1}',
    }
    result = _resolve_agent(agent_name, ctx)
    for needle in needles:
        assert needle not in result, (
            f"{agent_name}.md leaked dynamic content '{needle}' into system prompt"
        )


def test_planner_agent_md_has_placeholder_resolved():
    result = _resolve_agent("planner", {"plan_file": "docs/plans/W-001-auth.md"})
    assert "docs/plans/W-001-auth.md" in result


def test_planner_agent_md_keeps_governance():
    result = _resolve_agent("planner", {"plan_file": "p.md"})
    assert "Do NOT write implementation" in result


def test_coordinator_agent_md_has_placeholders_resolved():
    result = _resolve_agent("coordinator", {"plan_file": "docs/plans/W-001.md", "run_id": "run-xyz-99"})
    assert "docs/plans/W-001.md" in result
    assert "run-xyz-99" in result


def test_coordinator_agent_md_keeps_governance():
    result = _resolve_agent("coordinator", {"plan_file": "p.md", "run_id": "r1"})
    assert "Do NOT write implementation" in result


def test_reviewer_agent_md_references_output_schema():
    result = _resolve_agent("reviewer", {})
    assert "review.json" in result


@pytest.mark.parametrize("agent_name,context", [
    ("planner", {"plan_file": "p.md"}),
    ("plan_reviewer", {}),
    ("coordinator", {"plan_file": "p.md", "run_id": "r1"}),
    ("implementer", {}),
    ("tester", {}),
    ("reviewer", {}),
    ("guardian", {}),
    ("learner", {}),
])
def test_agent_md_no_unresolved_block_tokens(agent_name, context):
    result = _resolve_agent(agent_name, context)
    assert "{{block:" not in result, (
        f"Agent '{agent_name}' resolved output still contains {{{{block:...}}}} tokens"
    )


# ---------------------------------------------------------------------------
# Block resolution — dynamic content flows through -p user message
# ---------------------------------------------------------------------------


def test_plan_block_initial_contains_work_request():
    result = _resolve_block("plan", {
        "work_request": "Add user authentication",
        "claude_md": "",
        "plan_revision_mode": False,
    })
    assert "Add user authentication" in result


def test_plan_block_does_not_inline_claude_md_even_if_provided():
    # The claude_md context var was removed (CLAUDE.md is auto-loaded by the
    # CLI). Even if a caller still passes it, the plan block must not inline it.
    result = _resolve_block("plan", {
        "work_request": "Add auth",
        "claude_md": "# My Project\n\nUses FastAPI.",
        "plan_revision_mode": False,
    })
    assert "# My Project" not in result and "FastAPI" not in result


def test_plan_block_revision_contains_current_plan_and_issues():
    result = _resolve_block("plan", {
        "work_request": "Add auth",
        "plan_revision_mode": True,
        "plan_content": "# Plan v1\n\nMy special plan content",
        "plan_review_issues_formatted": "1. [critical] Security flaw in auth",
    })
    assert "My special plan content" in result
    assert "Security flaw in auth" in result


def test_coordinate_block_excludes_work_request():
    result = _resolve_block("coordinate", {
        "work_request": "Add user authentication",
        "current_plan": "",
    })
    assert "Add user authentication" not in result


def test_coordinate_block_includes_current_plan_when_present():
    # W-061: the full current plan is surfaced via {{current_plan}}.
    result = _resolve_block("coordinate", {
        "current_plan": "## Phase 1\nUse JWT tokens.\n## Phase 2\nAdd middleware.",
    })
    assert "Use JWT tokens" in result
    assert "Phase 2" in result


def test_coordinate_block_carries_decompose_framing():
    result = _resolve_block("coordinate", {"current_plan": ""})
    assert "decompose" in result.lower()
    assert "approved plan" in result.lower()
    assert "do not implement" in result.lower() or "NOT implement" in result
    # W-061: must steer the coordinator away from git-diff scope inference.
    assert "git diff" in result.lower() and "source of truth" in result.lower()


def test_coordinate_block_renders_guide_section():
    result = _resolve_block("coordinate", {
        "has_guide": True,
        "guide_content": "Follow RFC-999 strictly.",
        "current_plan": "The plan.",
    })
    assert "## Reference Guide (normative)" in result
    assert "Follow RFC-999 strictly." in result
    assert "outranks" in result


def test_coordinate_block_graphify_at_top_level():
    result = _resolve_block("coordinate", {
        "has_graphify": True,
        "current_plan": "",
    })
    assert "graphify query" in result
    assert "<work_request>" not in result


def test_implement_block_initial_contains_task_not_work_request():
    result = _resolve_block("implement", {
        "is_retry": False,
        "work_request": "Add user authentication",
        "assigned_task": "**worca-abc123**: Create JWT middleware",
    })
    assert "Add user authentication" not in result
    assert "worca-abc123" in result and "Create JWT middleware" in result


def test_implement_block_surfaces_plan_file_path_when_present():
    # W-061: advisory PATH reference (not raw plan content) to the approved plan.
    result = _resolve_block("implement", {
        "is_retry": False,
        "assigned_task": "**worca-abc123**: Create JWT middleware",
        "plan_file": ".worca/runs/run-x/plan-002.md",
    })
    assert ".worca/runs/run-x/plan-002.md" in result
    assert "only your bead" in result


def test_implement_block_omits_plan_reference_when_no_plan_file():
    result = _resolve_block("implement", {
        "is_retry": False,
        "assigned_task": "**worca-abc123**: Create JWT middleware",
    })
    assert "The approved plan for this run is at" not in result


def test_implement_block_retry_contains_priority_and_failures():
    result = _resolve_block("implement", {
        "is_retry": True,
        "issue_type": "Test Failures",
        "attempt_count": "2",
        "test_failures_formatted": "1. **test_login** — AssertionError: 401 != 200",
        "review_issues_formatted": "",
        "previous_attempts": "",
        "assigned_task": "",
        "work_request": "Add auth",
    })
    assert "PRIORITY: Fix Test Failures" in result
    assert "test_login" in result and "401 != 200" in result


def test_implement_block_retry_review_issues_mode():
    result = _resolve_block("implement", {
        "is_retry": True,
        "issue_type": "Review Issues",
        "attempt_count": "1",
        "test_failures_formatted": "",
        "review_issues_formatted": "1. [critical] `auth.py:42` — SQL injection",
        "previous_attempts": "",
        "assigned_task": "",
        "work_request": "Add auth",
    })
    assert "Review Issues" in result
    assert "SQL injection" in result


def test_test_block_excludes_work_request():
    result = _resolve_block("test", {
        "work_request": "Add user authentication",
        "implementation_summary": "files: auth.py changed",
    })
    assert "Add user authentication" not in result
    assert "auth.py changed" in result


def test_test_block_renders_standalone_guide():
    result = _resolve_block("test", {
        "work_request": "Add auth",
        "has_guide": True,
        "guide_content": "Follow the RFC-9999 spec.",
        "implementation_summary": "",
    })
    assert "Follow the RFC-9999 spec." in result
    assert "it outranks the" in result
    assert "lower-authority source" in result


def test_review_block_excludes_work_request():
    result = _resolve_block("review", {
        "work_request": "Add user authentication",
        "test_results": "**Status:** PASSED\n**Coverage:** 87.5%",
        "files_changed_formatted": "- auth.py\n- middleware.py",
    })
    assert "Add user authentication" not in result
    assert "PASSED" in result and "87.5%" in result
    assert "auth.py" in result and "middleware.py" in result


def test_review_block_renders_standalone_guide():
    result = _resolve_block("review", {
        "work_request": "Add auth",
        "has_guide": True,
        "guide_content": "Follow the RFC-9999 spec.",
        "test_results": "",
        "files_changed_formatted": "",
    })
    assert "Follow the RFC-9999 spec." in result
    assert "it outranks the" in result
    assert "lower-authority source" in result


def test_plan_review_block_contains_read_only_framing():
    result = _resolve_block("plan-review", {
        "work_request": "Add auth",
        "plan_content": "# Plan v1",
        "plan_review_history_formatted": "",
    })
    assert "read-only analyst" in result.lower() or "do NOT modify" in result


def test_learn_block_contains_postmortem_framing_and_run_data():
    result = _resolve_block("learn", {
        "work_request": "Add auth",
        "termination_type": "success",
        "termination_reason": "",
        "plan_content": "",
        "run_id": "run-xyz-99",
        "run_data": '{"foo": 1}',
    })
    assert "post-mortem" in result.lower()
    assert "run-xyz-99" in result
    assert '{"foo": 1}' in result


# ---------------------------------------------------------------------------
# Custom agent names (W-071) — project tier resolves with an empty core base
# ---------------------------------------------------------------------------


def test_project_tier_agent_with_no_core_base_resolves(tmp_path):
    """A .claude/agents/ file for a NEW name is the agent definition itself:
    OverlayResolver.resolve applies it as a replace-mode overlay onto an
    empty base, and placeholders still resolve."""
    overrides = tmp_path / "agents"
    overrides.mkdir()
    (overrides / "docs_auditor.md").write_text(
        "# Docs Auditor\n\nAudit docs for {{title}} (run {{run_id}}).\n",
        encoding="utf-8",
    )
    resolver = OverlayResolver(overrides_dir=str(overrides))

    merged = resolver.resolve("docs_auditor", "")  # empty core base
    result = resolve_placeholders(merged, {"title": "W-071", "run_id": "run-1"})

    assert "# Docs Auditor" in result
    assert "Audit docs for W-071 (run run-1)." in result


def test_project_tier_block_with_no_core_base_resolves(tmp_path):
    """A .block.md for a NEW name resolves through the project tier alone."""
    overrides = tmp_path / "agents"
    overrides.mkdir()
    (overrides / "docs_audit.block.md").write_text(
        "Audit the docs.\n\nPlan: {{plan_file}}\n", encoding="utf-8",
    )
    resolver = OverlayResolver(overrides_dir=str(overrides))

    raw = resolver.resolve_block("docs_audit", str(CORE_DIR))
    assert raw is not None
    result = resolve_placeholders(raw, {"plan_file": "plans/p.md"})
    assert "Plan: plans/p.md" in result
