"""Tests for W-037 T3: 8 block files in src/worca/agents/core/.

Verifies each block file exists and contains expected placeholder tokens.
"""

import pathlib

import pytest

CORE_DIR = pathlib.Path(__file__).parent.parent / "src" / "worca" / "agents" / "core"

BLOCK_FILES = [
    "plan.block.md",
    "plan-review.block.md",
    "plan-edit.block.md",
    "coordinate.block.md",
    "implement.block.md",
    "test.block.md",
    "review.block.md",
    "pr.block.md",
    "learn.block.md",
]


@pytest.mark.parametrize("filename", BLOCK_FILES)
def test_block_file_exists(filename):
    assert (CORE_DIR / filename).exists(), f"{filename} not found in {CORE_DIR}"


def _read(filename):
    return (CORE_DIR / filename).read_text()


# ---------------------------------------------------------------------------
# plan.block.md
# ---------------------------------------------------------------------------


def test_plan_block_has_work_request():
    content = _read("plan.block.md")
    assert "{{work_request}}" in content


def test_plan_block_has_revision_conditional():
    """W-072: the revision flag is consumed via the plan_review namespace
    (legacy flat plan_revision_mode still resolves via alias)."""
    content = _read("plan.block.md")
    assert "{{#if stages.plan_review.revision_mode}}" in content
    assert "{{/if}}" in content


def test_plan_block_has_plan_content_conditional():
    content = _read("plan.block.md")
    assert "{{#if plan_content}}" in content


def test_plan_block_has_plan_review_issues():
    content = _read("plan.block.md")
    assert "{{#if plan_review_issues_formatted}}" in content


def test_plan_block_has_plan_review_history():
    content = _read("plan.block.md")
    assert "{{#if plan_review_history_formatted}}" in content


def test_plan_block_does_not_inline_claude_md():
    # CLAUDE.md is auto-loaded by the claude CLI into every session, so the
    # planner prompt no longer inlines it (the {{claude_md}} block was removed
    # to avoid duplicating ~9.5K tokens per planner run).
    content = _read("plan.block.md")
    assert "{{#if claude_md}}" not in content
    assert "{{claude_md}}" not in content
    assert "Project Context (from CLAUDE.md)" not in content


# ---------------------------------------------------------------------------
# plan-review.block.md
# ---------------------------------------------------------------------------


def test_plan_review_block_has_work_request():
    content = _read("plan-review.block.md")
    assert "{{work_request}}" in content


def test_plan_review_block_has_plan_content_conditional():
    content = _read("plan-review.block.md")
    assert "{{#if plan_content}}" in content


def test_plan_review_block_has_history_conditional():
    content = _read("plan-review.block.md")
    assert "{{#if plan_review_history_formatted}}" in content


def test_plan_review_block_has_convergence_directive():
    content = _read("plan-review.block.md")
    assert "verify convergence" in content


def test_plan_review_block_convergence_inside_history_conditional():
    content = _read("plan-review.block.md")
    if_tag = "{{#if plan_review_history_formatted}}"
    endif_tag = "{{/if}}"
    start = content.index(if_tag)
    end = content.index(endif_tag, start)
    history_block = content[start:end]
    assert "verify convergence" in history_block


# ---------------------------------------------------------------------------
# plan-edit.block.md
# ---------------------------------------------------------------------------


def test_plan_edit_block_has_work_request():
    content = _read("plan-edit.block.md")
    assert "{{work_request}}" in content


def test_plan_edit_block_has_plan_content_conditional():
    content = _read("plan-edit.block.md")
    assert "{{#if plan_content}}" in content


def test_plan_edit_block_not_read_only():
    content = _read("plan-edit.block.md")
    assert "read-only" not in content.lower()


def test_plan_edit_block_no_history_section():
    content = _read("plan-edit.block.md")
    assert "{{#if plan_review_history_formatted}}" not in content


def test_plan_edit_block_no_convergence_directive():
    content = _read("plan-edit.block.md")
    assert "verify convergence" not in content


def test_plan_edit_block_mentions_rewrite():
    content = _read("plan-edit.block.md")
    assert "rewrite" in content.lower() or "edit" in content.lower()


# ---------------------------------------------------------------------------
# coordinate.block.md
# ---------------------------------------------------------------------------


def test_coordinate_block_has_no_work_request():
    content = _read("coordinate.block.md")
    assert "{{work_request}}" not in content


def test_coordinate_block_has_current_plan_conditional():
    # W-061: the coordinator decomposes the full current plan file, surfaced via
    # {{current_plan}} — not the delta-prone {{plan_summary}} of older revisions.
    content = _read("coordinate.block.md")
    assert "{{#if current_plan}}" in content
    assert "{{current_plan}}" in content
    assert "{{plan_summary}}" not in content


def test_coordinate_block_has_unresolved_plan_issues_conditional():
    content = _read("coordinate.block.md")
    assert "{{#if unresolved_plan_issues_formatted}}" in content


# ---------------------------------------------------------------------------
# implement.block.md
# ---------------------------------------------------------------------------


def test_implement_block_has_no_work_request():
    content = _read("implement.block.md")
    assert "{{work_request}}" not in content


def test_implement_block_has_plan_file_reference():
    # W-061: advisory path reference to the approved plan, in BOTH branches
    # (retry + first-attempt), gated on plan_file and scope-guarded to the bead.
    content = _read("implement.block.md")
    assert content.count("{{#if plan_file}}") == 2
    assert content.count("The approved plan for this run is at `{{plan_file}}`") == 2
    # Scope guard must be present so the implementer doesn't widen scope.
    assert "only your bead" in content
    # It is a path reference, never the raw plan content.
    assert "{{plan_content}}" not in content
    assert "{{current_plan}}" not in content


def test_implement_block_has_retry_conditional():
    content = _read("implement.block.md")
    assert "{{#if is_retry}}" in content
    assert "{{/if}}" in content


def test_implement_block_has_test_failures_conditional():
    content = _read("implement.block.md")
    assert "{{#if test_failures_formatted}}" in content


def test_implement_block_has_review_issues_conditional():
    content = _read("implement.block.md")
    assert "{{#if review_issues_formatted}}" in content


def test_implement_block_has_issue_type():
    content = _read("implement.block.md")
    assert "{{issue_type}}" in content


def test_implement_block_has_attempt_count():
    content = _read("implement.block.md")
    assert "{{attempt_count}}" in content


def test_implement_block_has_assigned_task_conditional():
    content = _read("implement.block.md")
    assert "{{#if assigned_task}}" in content


# ---------------------------------------------------------------------------
# test.block.md
# ---------------------------------------------------------------------------


def test_test_block_has_no_work_request():
    content = _read("test.block.md")
    assert "{{work_request}}" not in content


def test_test_block_has_standalone_guide_section():
    content = _read("test.block.md")
    assert "it outranks the" in content
    assert "lower-authority source" in content


def test_test_block_has_implementation_summary_conditional():
    content = _read("test.block.md")
    assert "{{#if implementation_summary}}" in content


# ---------------------------------------------------------------------------
# review.block.md
# ---------------------------------------------------------------------------


def test_review_block_has_no_work_request():
    content = _read("review.block.md")
    assert "{{work_request}}" not in content


def test_review_block_has_standalone_guide_section():
    content = _read("review.block.md")
    assert "it outranks the" in content
    assert "lower-authority source" in content


def test_review_block_has_test_results_conditional():
    content = _read("review.block.md")
    assert "{{#if test_results}}" in content


def test_review_block_has_files_changed_conditional():
    content = _read("review.block.md")
    assert "{{#if files_changed_formatted}}" in content


# ---------------------------------------------------------------------------
# pr.block.md
# ---------------------------------------------------------------------------


def test_pr_block_has_work_request():
    content = _read("pr.block.md")
    assert "{{work_request}}" in content


def test_pr_block_has_plan_approach_conditional():
    """W-072: the PR block consumes the plan stage's declared output via the
    namespaced key (legacy flat plan_approach still resolves via alias)."""
    content = _read("pr.block.md")
    assert "{{#if stages.plan.approach}}" in content
    assert "{{stages.plan.approach}}" in content


# ---------------------------------------------------------------------------
# learn.block.md
# ---------------------------------------------------------------------------


def test_learn_block_has_work_request():
    content = _read("learn.block.md")
    assert "{{work_request}}" in content


def test_learn_block_has_termination_type():
    content = _read("learn.block.md")
    assert "{{termination_type" in content


def test_learn_block_has_termination_reason_conditional():
    content = _read("learn.block.md")
    assert "{{#if termination_reason}}" in content


def test_learn_block_has_plan_content_conditional():
    content = _read("learn.block.md")
    assert "{{#if plan_content}}" in content


def test_learn_block_has_run_id():
    content = _read("learn.block.md")
    assert "{{run_id}}" in content


def test_learn_block_has_run_data():
    content = _read("learn.block.md")
    assert "{{run_data}}" in content
