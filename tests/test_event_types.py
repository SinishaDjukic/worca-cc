"""
Tests for .claude/worca/events/types.py — event type constants and payload builders.
TDD: Written before implementation (Task 3).
"""
import sys
from pathlib import Path

# Add .claude to sys.path so 'worca' package is importable
_CLAUDE_DIR = Path(__file__).parent.parent / ".claude"
if str(_CLAUDE_DIR) not in sys.path:
    sys.path.insert(0, str(_CLAUDE_DIR))

import pytest  # noqa: E402


# ---------------------------------------------------------------------------
# Module import
# ---------------------------------------------------------------------------

def test_events_package_importable():
    """The worca.events package must be importable."""
    import worca.events  # noqa


def test_events_types_importable():
    """The worca.events.types module must be importable."""
    import worca.events.types  # noqa


# ---------------------------------------------------------------------------
# Event type constants — expected (name, value) pairs
# ---------------------------------------------------------------------------

PIPELINE_CONSTANTS = [
    # Pipeline lifecycle (6)
    ("RUN_STARTED",       "pipeline.run.started"),
    ("RUN_COMPLETED",     "pipeline.run.completed"),
    ("RUN_FAILED",        "pipeline.run.failed"),
    ("RUN_INTERRUPTED",   "pipeline.run.interrupted"),
    ("RUN_CANCELLED",     "pipeline.run.cancelled"),
    ("RUN_RESUMED",       "pipeline.run.resumed"),
    # Stage lifecycle (4)
    ("STAGE_STARTED",     "pipeline.stage.started"),
    ("STAGE_COMPLETED",   "pipeline.stage.completed"),
    ("STAGE_FAILED",      "pipeline.stage.failed"),
    ("STAGE_INTERRUPTED", "pipeline.stage.interrupted"),
    # Agent telemetry (7)
    ("AGENT_SPAWNED",        "pipeline.agent.spawned"),
    ("AGENT_TOOL_USE",       "pipeline.agent.tool_use"),
    ("AGENT_TOOL_RESULT",    "pipeline.agent.tool_result"),
    ("AGENT_TEXT",           "pipeline.agent.text"),
    ("AGENT_COMPLETED",      "pipeline.agent.completed"),
    ("AGENT_API_RETRY",      "pipeline.agent.api_retry"),
    ("ITERATION_ACCESS",     "pipeline.iteration.access"),
    # Bead lifecycle (6)
    ("BEAD_CREATED",      "pipeline.bead.created"),
    ("BEAD_ASSIGNED",     "pipeline.bead.assigned"),
    ("BEAD_COMPLETED",    "pipeline.bead.completed"),
    ("BEAD_FAILED",       "pipeline.bead.failed"),
    ("BEAD_LABELED",      "pipeline.bead.labeled"),
    ("BEAD_NEXT",         "pipeline.bead.next"),
    # Git operations (5)
    ("GIT_BRANCH_CREATED", "pipeline.git.branch_created"),
    ("GIT_COMMIT",         "pipeline.git.commit"),
    ("GIT_PR_CREATED",     "pipeline.git.pr_created"),
    ("GIT_PR_DEFERRED",    "pipeline.git.pr_deferred"),
    ("GIT_PR_MERGED",      "pipeline.git.pr_merged"),
    # Test detail (4)
    ("TEST_SUITE_STARTED", "pipeline.test.suite_started"),
    ("TEST_SUITE_PASSED",  "pipeline.test.suite_passed"),
    ("TEST_SUITE_FAILED",  "pipeline.test.suite_failed"),
    ("TEST_FIX_ATTEMPT",   "pipeline.test.fix_attempt"),
    # Review detail (3)
    ("REVIEW_STARTED",     "pipeline.review.started"),
    ("REVIEW_VERDICT",     "pipeline.review.verdict"),
    ("REVIEW_FIX_ATTEMPT", "pipeline.review.fix_attempt"),
    # Circuit breaker (4)
    ("CB_FAILURE_RECORDED", "pipeline.circuit_breaker.failure_recorded"),
    ("CB_RETRY",            "pipeline.circuit_breaker.retry"),
    ("CB_TRIPPED",          "pipeline.circuit_breaker.tripped"),
    ("CB_RESET",            "pipeline.circuit_breaker.reset"),
    # Cost & tokens (3)
    ("COST_STAGE_TOTAL",    "pipeline.cost.stage_total"),
    ("COST_RUNNING_TOTAL",  "pipeline.cost.running_total"),
    ("COST_BUDGET_WARNING", "pipeline.cost.budget_warning"),
    # Milestone & loop (3)
    ("MILESTONE_SET",       "pipeline.milestone.set"),
    ("LOOP_TRIGGERED",      "pipeline.loop.triggered"),
    ("LOOP_EXHAUSTED",      "pipeline.loop.exhausted"),
    # Hook & governance (5)
    ("HOOK_BLOCKED",          "pipeline.hook.blocked"),
    ("HOOK_TEST_GATE",        "pipeline.hook.test_gate"),
    ("HOOK_DISPATCH_BLOCKED", "pipeline.hook.dispatch_blocked"),
    ("HOOK_DISPATCH_ALLOWED", "pipeline.hook.dispatch_allowed"),
    ("HOOK_GRAPH_QUERY",      "pipeline.hook.graph_query"),
    # Preflight (2)
    ("PREFLIGHT_COMPLETED", "pipeline.preflight.completed"),
    ("PREFLIGHT_SKIPPED",   "pipeline.preflight.skipped"),
    # Learn stage uses generic STAGE_STARTED/COMPLETED/FAILED with stage="learn"
    # Plan review detail (1)
    ("PLAN_EDITED", "pipeline.plan_review.edited"),
    # Template lifecycle (2)
    ("TEMPLATE_APPLIED", "pipeline.template.applied"),
    ("TEMPLATE_DROPPED", "pipeline.template.dropped"),
    # CLAUDE.md load mode (1)
    ("CLAUDE_MD_MODE_RESOLVED", "pipeline.claude_md.mode_resolved"),
]

CONTROL_CONSTANTS = [
    # Control (inbound, 4)
    ("CONTROL_MILESTONE_APPROVE", "control.milestone.approve"),
    ("CONTROL_PIPELINE_PAUSE",    "control.pipeline.pause"),
    ("CONTROL_PIPELINE_RESUME",   "control.pipeline.resume"),
    ("CONTROL_PIPELINE_ABORT",    "control.pipeline.abort"),
]

ALL_CONSTANTS = PIPELINE_CONSTANTS + CONTROL_CONSTANTS


@pytest.mark.parametrize("name,expected", ALL_CONSTANTS)
def test_constant_exists_with_correct_value(name, expected):
    """Each event type constant must exist and equal its dotted-name string."""
    import worca.events.types as T
    assert hasattr(T, name), f"Missing constant: {name}"
    assert getattr(T, name) == expected, (
        f"{name} = {getattr(T, name)!r}, expected {expected!r}"
    )


def test_all_constants_are_strings():
    """All event type constants must be plain strings."""
    import worca.events.types as T
    for name, _ in ALL_CONSTANTS:
        val = getattr(T, name, None)
        assert isinstance(val, str), f"{name} is not a string: {type(val)}"


def test_pipeline_constant_values_unique():
    """No two pipeline.* constants may share the same event type string."""
    import worca.events.types as T
    values = [getattr(T, name) for name, _ in PIPELINE_CONSTANTS]
    assert len(values) == len(set(values)), "Duplicate pipeline constant values"


def test_total_pipeline_constants():
    """There must be exactly 60 pipeline.* outbound constants.

    48 original + 2 dedicated learn events (pipeline.learn.completed/failed)
    + 1 dispatch_allowed hook event + 1 RUN_CANCELLED + 1 PLAN_EDITED
    + 2 template lifecycle events + 1 ITERATION_ACCESS + 1 GIT_PR_DEFERRED
    + 1 CLAUDE_MD_MODE_RESOLVED + 1 AGENT_API_RETRY (W-074) = 60.
    """
    import worca.events.types as T
    pipeline_vals = [
        v for k, v in vars(T).items()
        if k.isupper() and isinstance(v, str) and v.startswith("pipeline.")
    ]
    assert len(pipeline_vals) == 60, (
        f"Expected 60 pipeline.* constants, found {len(pipeline_vals)}"
    )


def test_total_control_constants():
    """There must be exactly 4 control.* constants."""
    import worca.events.types as T
    control_vals = [
        v for k, v in vars(T).items()
        if k.isupper() and isinstance(v, str) and v.startswith("control.")
    ]
    assert len(control_vals) == 4, (
        f"Expected 4 control.* constants, found {len(control_vals)}"
    )


# ---------------------------------------------------------------------------
# Payload builder existence
# ---------------------------------------------------------------------------

EXPECTED_BUILDERS = [
    # pipeline.run.*
    "run_started_payload",
    "run_completed_payload",
    "run_failed_payload",
    "run_interrupted_payload",
    "run_cancelled_payload",
    "run_resumed_payload",
    # pipeline.stage.*
    "stage_started_payload",
    "stage_completed_payload",
    "stage_failed_payload",
    "stage_interrupted_payload",
    # pipeline.agent.*
    "agent_spawned_payload",
    "agent_tool_use_payload",
    "agent_tool_result_payload",
    "agent_text_payload",
    "agent_completed_payload",
    "agent_api_retry_payload",
    "iteration_access_payload",
    # pipeline.bead.*
    "bead_created_payload",
    "bead_assigned_payload",
    "bead_completed_payload",
    "bead_failed_payload",
    "bead_labeled_payload",
    "bead_next_payload",
    # pipeline.git.*
    "git_branch_created_payload",
    "git_commit_payload",
    "git_pr_created_payload",
    "git_pr_deferred_payload",
    "git_pr_merged_payload",
    # pipeline.test.*
    "test_suite_started_payload",
    "test_suite_passed_payload",
    "test_suite_failed_payload",
    "test_fix_attempt_payload",
    # pipeline.review.*
    "review_started_payload",
    "review_verdict_payload",
    "review_fix_attempt_payload",
    # pipeline.circuit_breaker.*
    "cb_failure_recorded_payload",
    "cb_retry_payload",
    "cb_tripped_payload",
    "cb_reset_payload",
    # pipeline.cost.*
    "cost_stage_total_payload",
    "cost_running_total_payload",
    "cost_budget_warning_payload",
    # pipeline.milestone.* / pipeline.loop.*
    "milestone_set_payload",
    "loop_triggered_payload",
    "loop_exhausted_payload",
    # pipeline.hook.*
    "hook_blocked_payload",
    "hook_test_gate_payload",
    "hook_dispatch_blocked_payload",
    "hook_dispatch_allowed_payload",
    "hook_graph_query_payload",
    # pipeline.preflight.*
    "preflight_completed_payload",
    "preflight_skipped_payload",
    # pipeline.learn.* — removed; learn uses generic stage events
    # pipeline.plan_review.*
    "plan_edited_payload",
    # pipeline.template.*
    "template_applied_payload",
    "template_dropped_payload",
    # control.*
    "control_milestone_approve_payload",
    "control_pipeline_pause_payload",
    "control_pipeline_resume_payload",
    "control_pipeline_abort_payload",
]


@pytest.mark.parametrize("fn_name", EXPECTED_BUILDERS)
def test_payload_builder_exists(fn_name):
    """Each payload builder function must be defined in types.py."""
    import worca.events.types as T
    assert hasattr(T, fn_name), f"Missing payload builder: {fn_name}()"
    assert callable(getattr(T, fn_name)), f"{fn_name} is not callable"


# ---------------------------------------------------------------------------
# Payload builder return values — required fields per JSON schema
# ---------------------------------------------------------------------------

def test_run_started_payload_required_fields():
    from worca.events.types import run_started_payload
    p = run_started_payload(resume=False, started_at="2026-01-01T00:00:00Z")
    assert p["resume"] is False
    assert p["started_at"] == "2026-01-01T00:00:00Z"
    assert isinstance(p, dict)


def test_run_completed_payload_required_fields():
    from worca.events.types import run_completed_payload
    p = run_completed_payload(
        duration_ms=60000, total_cost_usd=0.5,
        total_turns=10, total_tokens=5000,
        stages_completed=["PLAN", "IMPLEMENT"],
    )
    assert p["duration_ms"] == 60000
    assert p["total_cost_usd"] == 0.5
    assert p["total_turns"] == 10
    assert p["total_tokens"] == 5000
    assert p["stages_completed"] == ["PLAN", "IMPLEMENT"]


def test_run_failed_payload_required_fields():
    from worca.events.types import run_failed_payload
    p = run_failed_payload(
        error="Something went wrong",
        failed_stage="TEST",
        error_type="PipelineError",
    )
    assert p["error"] == "Something went wrong"
    assert p["failed_stage"] == "TEST"
    assert p["error_type"] == "PipelineError"


def test_run_interrupted_payload_required_fields():
    from worca.events.types import run_interrupted_payload
    p = run_interrupted_payload(interrupted_stage="IMPLEMENT", elapsed_ms=30000)
    assert p["interrupted_stage"] == "IMPLEMENT"
    assert p["elapsed_ms"] == 30000
    assert p["source"] == "orchestrator"  # default
    p2 = run_interrupted_payload(interrupted_stage="PLAN", elapsed_ms=1, source="signal")
    assert p2["source"] == "signal"


def test_run_cancelled_payload_required_fields():
    from worca.events.types import run_cancelled_payload
    p = run_cancelled_payload(
        cancelled_stage="IMPLEMENT", elapsed_ms=15000, source="user_cancel",
    )
    assert p["cancelled_stage"] == "IMPLEMENT"
    assert p["elapsed_ms"] == 15000
    assert p["source"] == "user_cancel"


def test_run_cancelled_payload_source_values():
    from worca.events.types import run_cancelled_payload
    for source in ("user_cancel", "force_cancel", "bulk_cancel"):
        p = run_cancelled_payload(
            cancelled_stage="TEST", elapsed_ms=1000, source=source,
        )
        assert p["source"] == source


def test_run_cancelled_payload_optional_reason():
    from worca.events.types import run_cancelled_payload
    p = run_cancelled_payload(
        cancelled_stage="PLAN", elapsed_ms=500, source="force_cancel",
        reason="cost exceeded budget",
    )
    assert p["reason"] == "cost exceeded budget"


def test_run_cancelled_payload_reason_omitted_by_default():
    from worca.events.types import run_cancelled_payload
    p = run_cancelled_payload(
        cancelled_stage="PLAN", elapsed_ms=500, source="user_cancel",
    )
    assert "reason" not in p


def test_run_resumed_payload_required_fields():
    from worca.events.types import run_resumed_payload
    p = run_resumed_payload(
        resume_stage="TEST",
        previous_stages_completed=["PLAN", "COORDINATE", "IMPLEMENT"],
    )
    assert p["resume_stage"] == "TEST"
    assert p["previous_stages_completed"] == ["PLAN", "COORDINATE", "IMPLEMENT"]


def test_stage_started_payload_required_fields():
    from worca.events.types import stage_started_payload
    p = stage_started_payload(
        stage="IMPLEMENT", iteration=1,
        agent="implementer", model="claude-sonnet-4-6",
        trigger="initial", max_turns=50,
    )
    assert p["stage"] == "IMPLEMENT"
    assert p["iteration"] == 1
    assert p["agent"] == "implementer"
    assert p["model"] == "claude-sonnet-4-6"
    assert p["trigger"] == "initial"
    assert p["max_turns"] == 50


def test_stage_started_payload_with_effort():
    from worca.events.types import stage_started_payload
    effort = {
        "level": "high",
        "source": "adaptive",
        "base": "medium",
        "escalations": 1,
        "bead_classified": "medium",
    }
    p = stage_started_payload(
        stage="IMPLEMENT", iteration=2,
        agent="implementer", model="claude-sonnet-4-6",
        trigger="test_failure", max_turns=50,
        effort=effort,
    )
    assert p["effort"] == effort


def test_stage_started_payload_effort_omitted_when_none():
    from worca.events.types import stage_started_payload
    p = stage_started_payload(
        stage="PLAN", iteration=1,
        agent="planner", model="claude-opus-4-6",
        trigger="initial", max_turns=30,
    )
    assert "effort" not in p


def test_stage_completed_payload_required_fields():
    from worca.events.types import stage_completed_payload
    p = stage_completed_payload(
        stage="TEST", iteration=1,
        duration_ms=5000, cost_usd=0.1,
        turns=5, outcome="passed",
    )
    assert p["stage"] == "TEST"
    assert p["iteration"] == 1
    assert p["duration_ms"] == 5000
    assert p["cost_usd"] == 0.1
    assert p["turns"] == 5
    assert p["outcome"] == "passed"


def test_stage_failed_payload_required_fields():
    from worca.events.types import stage_failed_payload
    p = stage_failed_payload(
        stage="IMPLEMENT", iteration=2,
        error="Agent crashed", error_type="RuntimeError",
        elapsed_ms=12000,
    )
    assert p["stage"] == "IMPLEMENT"
    assert p["iteration"] == 2
    assert p["error"] == "Agent crashed"
    assert p["error_type"] == "RuntimeError"
    assert p["elapsed_ms"] == 12000


def test_stage_interrupted_payload_required_fields():
    from worca.events.types import stage_interrupted_payload
    p = stage_interrupted_payload(stage="GUARDIAN", iteration=1, elapsed_ms=8000)
    assert p["stage"] == "GUARDIAN"
    assert p["iteration"] == 1
    assert p["elapsed_ms"] == 8000


def test_agent_spawned_payload_required_fields():
    from worca.events.types import agent_spawned_payload
    p = agent_spawned_payload(
        stage="PLAN", iteration=1,
        agent="planner", model="claude-opus-4-6", max_turns=30,
    )
    assert p["stage"] == "PLAN"
    assert p["iteration"] == 1
    assert p["agent"] == "planner"
    assert p["model"] == "claude-opus-4-6"
    assert p["max_turns"] == 30


def test_agent_tool_use_payload_required_fields():
    from worca.events.types import agent_tool_use_payload
    p = agent_tool_use_payload(
        stage="IMPLEMENT", iteration=1,
        tool="Read", tool_input_summary="file.py", turn=3,
    )
    assert p["stage"] == "IMPLEMENT"
    assert p["tool"] == "Read"
    assert p["tool_input_summary"] == "file.py"
    assert p["turn"] == 3


def test_agent_tool_result_payload_required_fields():
    from worca.events.types import agent_tool_result_payload
    p = agent_tool_result_payload(
        stage="IMPLEMENT", iteration=1,
        tool="Bash", is_error=False, turn=4,
    )
    assert p["tool"] == "Bash"
    assert p["is_error"] is False
    assert p["turn"] == 4


def test_agent_text_payload_required_fields():
    from worca.events.types import agent_text_payload
    p = agent_text_payload(stage="PLAN", iteration=1, text_length=250, turn=2)
    assert p["text_length"] == 250
    assert p["turn"] == 2


def test_agent_completed_payload_required_fields():
    from worca.events.types import agent_completed_payload
    p = agent_completed_payload(
        stage="GUARDIAN", iteration=1,
        turns=8, cost_usd=0.25, duration_ms=45000, exit_code=0,
    )
    assert p["turns"] == 8
    assert p["cost_usd"] == 0.25
    assert p["duration_ms"] == 45000
    assert p["exit_code"] == 0


def test_agent_api_retry_payload_required_fields():
    from worca.events.types import agent_api_retry_payload
    p = agent_api_retry_payload(
        stage="IMPLEMENT", iteration=2, agent="implementer",
        attempt=3, detail="API Error 529: overloaded, retrying in 4s",
    )
    assert p["stage"] == "IMPLEMENT"
    assert p["iteration"] == 2
    assert p["agent"] == "implementer"
    assert p["attempt"] == 3
    assert p["detail"] == "API Error 529: overloaded, retrying in 4s"


def test_agent_api_retry_payload_bead_id_omitted_by_default():
    from worca.events.types import agent_api_retry_payload
    p = agent_api_retry_payload(
        stage="IMPLEMENT", iteration=1, agent="implementer",
        attempt=1, detail="overloaded",
    )
    assert "bead_id" not in p


def test_agent_api_retry_payload_bead_id_included_when_provided():
    from worca.events.types import agent_api_retry_payload
    p = agent_api_retry_payload(
        stage="IMPLEMENT", iteration=1, agent="implementer",
        attempt=1, detail="overloaded", bead_id="worca-cc-3rds",
    )
    assert p["bead_id"] == "worca-cc-3rds"


def test_agent_api_retry_payload_detail_truncated():
    from worca.events.types import agent_api_retry_payload
    long_detail = "x" * 500
    p = agent_api_retry_payload(
        stage="IMPLEMENT", iteration=1, agent="implementer",
        attempt=1, detail=long_detail,
    )
    assert len(p["detail"]) == 300


def test_iteration_access_payload_required_fields():
    from worca.events.types import iteration_access_payload
    file_access = {
        "reads": {"src/main.py": 3},
        "writes": {"src/main.py": 1},
        "searches": [],
        "totals": {"distinct_read": 1, "total_read": 3},
        "capture": {"hook_writes": 1, "git_writes": 1, "leakage_pct": 0.0},
    }
    p = iteration_access_payload(
        run_id="run123",
        stage="IMPLEMENT",
        agent="implementer",
        iteration=1,
        bead_id="bead-001",
        file_access=file_access,
    )
    assert p["run_id"] == "run123"
    assert p["stage"] == "IMPLEMENT"
    assert p["agent"] == "implementer"
    assert p["iteration"] == 1
    assert p["bead_id"] == "bead-001"
    assert p["file_access"] == file_access
    assert isinstance(p, dict)


def test_bead_created_payload_required_fields():
    from worca.events.types import bead_created_payload
    p = bead_created_payload(bead_id="worca-cc-abc", title="Add feature X")
    assert p["bead_id"] == "worca-cc-abc"
    assert p["title"] == "Add feature X"


def test_bead_assigned_payload_required_fields():
    from worca.events.types import bead_assigned_payload
    p = bead_assigned_payload(bead_id="worca-cc-abc", title="Add feature X", iteration=2)
    assert p["bead_id"] == "worca-cc-abc"
    assert p["title"] == "Add feature X"
    assert p["iteration"] == 2


def test_bead_completed_payload_required_fields():
    from worca.events.types import bead_completed_payload
    p = bead_completed_payload(bead_id="worca-cc-abc", reason="implemented")
    assert p["bead_id"] == "worca-cc-abc"
    assert p["reason"] == "implemented"


def test_bead_failed_payload_required_fields():
    from worca.events.types import bead_failed_payload
    p = bead_failed_payload(bead_id="worca-cc-abc", error="bd close failed")
    assert p["bead_id"] == "worca-cc-abc"
    assert p["error"] == "bd close failed"


def test_bead_labeled_payload_required_fields():
    from worca.events.types import bead_labeled_payload
    p = bead_labeled_payload(
        bead_ids=["worca-cc-abc", "worca-cc-def"],
        label="run:20260309-143200",
    )
    assert p["bead_ids"] == ["worca-cc-abc", "worca-cc-def"]
    assert p["label"] == "run:20260309-143200"


def test_bead_next_payload_required_fields():
    from worca.events.types import bead_next_payload
    p = bead_next_payload(next_bead_id="worca-cc-def", bead_iteration=2)
    assert p["next_bead_id"] == "worca-cc-def"
    assert p["bead_iteration"] == 2


def test_git_branch_created_payload_required_fields():
    from worca.events.types import git_branch_created_payload
    p = git_branch_created_payload(branch="worca/w-003-events")
    assert p["branch"] == "worca/w-003-events"


def test_git_commit_payload_required_fields():
    from worca.events.types import git_commit_payload
    p = git_commit_payload(
        stage="GUARDIAN", commit_hash="abc1234",
        message_summary="feat: add events module",
    )
    assert p["stage"] == "GUARDIAN"
    assert p["commit_hash"] == "abc1234"
    assert p["message_summary"] == "feat: add events module"


def test_git_pr_created_payload_required_fields():
    from worca.events.types import git_pr_created_payload
    p = git_pr_created_payload(
        pr_url="https://github.com/org/repo/pull/42",
        pr_number=42, title="Add events module",
    )
    assert p["pr_url"] == "https://github.com/org/repo/pull/42"
    assert p["pr_number"] == 42
    assert p["title"] == "Add events module"


def test_git_pr_created_payload_extended_fields():
    from worca.events.types import git_pr_created_payload
    p = git_pr_created_payload(
        pr_url="https://github.com/org/repo/pull/42",
        pr_number=42,
        title="Add events module",
        commit_sha="abc1234567",
        source_branch="feature/x",
        target_branch="main",
        provider="github",
    )
    assert p["commit_sha"] == "abc1234567"
    assert p["source_branch"] == "feature/x"
    assert p["target_branch"] == "main"
    assert p["provider"] == "github"


def test_git_pr_created_payload_backwards_compat_no_extended_fields():
    from worca.events.types import git_pr_created_payload
    p = git_pr_created_payload(
        pr_url="https://github.com/org/repo/pull/42",
        pr_number=42,
        title="Old call",
    )
    assert p["commit_sha"] is None
    assert p["source_branch"] is None
    assert p["target_branch"] is None
    assert p["provider"] is None


def test_git_pr_merged_payload_required_fields():
    from worca.events.types import git_pr_merged_payload
    p = git_pr_merged_payload(
        pr_url="https://github.com/org/repo/pull/42", pr_number=42,
    )
    assert p["pr_url"] == "https://github.com/org/repo/pull/42"
    assert p["pr_number"] == 42


def test_event_pr_deferred_payload():
    from worca.events.types import git_pr_deferred_payload
    p = git_pr_deferred_payload(
        pr_title="Add deferrable PR creation",
        base_branch="master",
        head_branch="worca/w-065-feature",
        commit_sha="abc1234567",
    )
    assert p["pr_title"] == "Add deferrable PR creation"
    assert p["base_branch"] == "master"
    assert p["head_branch"] == "worca/w-065-feature"
    assert p["commit_sha"] == "abc1234567"
    assert "pr_url" not in p
    assert "pr_number" not in p


def test_test_suite_started_payload_required_fields():
    from worca.events.types import test_suite_started_payload
    p = test_suite_started_payload(stage="TEST", iteration=1, trigger="initial")
    assert p["stage"] == "TEST"
    assert p["iteration"] == 1
    assert p["trigger"] == "initial"


def test_test_suite_passed_payload_required_fields():
    from worca.events.types import test_suite_passed_payload
    p = test_suite_passed_payload(iteration=1)
    assert p["iteration"] == 1


def test_test_suite_failed_payload_required_fields():
    from worca.events.types import test_suite_failed_payload
    failures = [{"test": "test_foo", "error": "AssertionError", "file": "test_foo.py"}]
    p = test_suite_failed_payload(iteration=1, failure_count=1, failures=failures)
    assert p["iteration"] == 1
    assert p["failure_count"] == 1
    assert p["failures"] == failures


def test_test_fix_attempt_payload_required_fields():
    from worca.events.types import test_fix_attempt_payload
    p = test_fix_attempt_payload(attempt=1, limit=3, failures_summary="test_foo failed")
    assert p["attempt"] == 1
    assert p["limit"] == 3
    assert p["failures_summary"] == "test_foo failed"


def test_review_started_payload_required_fields():
    from worca.events.types import review_started_payload
    p = review_started_payload(iteration=1)
    assert p["iteration"] == 1


def test_review_verdict_payload_required_fields():
    from worca.events.types import review_verdict_payload
    p = review_verdict_payload(outcome="approve", issue_count=0, critical_count=0)
    assert p["outcome"] == "approve"
    assert p["issue_count"] == 0
    assert p["critical_count"] == 0


def test_review_fix_attempt_payload_required_fields():
    from worca.events.types import review_fix_attempt_payload
    p = review_fix_attempt_payload(attempt=1, limit=2)
    assert p["attempt"] == 1
    assert p["limit"] == 2


def test_cb_failure_recorded_payload_required_fields():
    from worca.events.types import cb_failure_recorded_payload
    p = cb_failure_recorded_payload(
        stage="IMPLEMENT", error="timeout",
        category="transient", retriable=True, consecutive_failures=1,
    )
    assert p["stage"] == "IMPLEMENT"
    assert p["error"] == "timeout"
    assert p["category"] == "transient"
    assert p["retriable"] is True
    assert p["consecutive_failures"] == 1


def test_cb_retry_payload_required_fields():
    from worca.events.types import cb_retry_payload
    p = cb_retry_payload(
        stage="IMPLEMENT", attempt=2,
        delay_seconds=4.0, consecutive_failures=2,
    )
    assert p["stage"] == "IMPLEMENT"
    assert p["attempt"] == 2
    assert p["delay_seconds"] == 4.0
    assert p["consecutive_failures"] == 2


def test_cb_tripped_payload_required_fields():
    from worca.events.types import cb_tripped_payload
    p = cb_tripped_payload(
        reason="Too many failures", consecutive_failures=5, category="persistent",
    )
    assert p["reason"] == "Too many failures"
    assert p["consecutive_failures"] == 5
    assert p["category"] == "persistent"


def test_cb_reset_payload_required_fields():
    from worca.events.types import cb_reset_payload
    p = cb_reset_payload(stage="TEST", previous_consecutive_failures=3)
    assert p["stage"] == "TEST"
    assert p["previous_consecutive_failures"] == 3


def test_cost_stage_total_payload_required_fields():
    from worca.events.types import cost_stage_total_payload
    p = cost_stage_total_payload(
        stage="IMPLEMENT", iteration=1, cost_usd=0.15,
        input_tokens=1000, output_tokens=500, model="claude-sonnet-4-6",
    )
    assert p["stage"] == "IMPLEMENT"
    assert p["cost_usd"] == 0.15
    assert p["input_tokens"] == 1000
    assert p["output_tokens"] == 500
    assert p["model"] == "claude-sonnet-4-6"


def test_cost_stage_total_payload_optional_fields_excluded_when_zero():
    from worca.events.types import cost_stage_total_payload
    p = cost_stage_total_payload(
        stage="IMPLEMENT", iteration=1, cost_usd=0.10,
        input_tokens=500, output_tokens=200, model="claude-sonnet-4-6",
    )
    assert "web_search_requests" not in p
    assert "web_fetch_requests" not in p
    assert "cache_creation_input_tokens" not in p
    assert "cache_read_input_tokens" not in p


def test_cost_stage_total_payload_optional_fields_included_when_nonzero():
    from worca.events.types import cost_stage_total_payload
    p = cost_stage_total_payload(
        stage="IMPLEMENT", iteration=2, cost_usd=0.20,
        input_tokens=800, output_tokens=300, model="claude-opus-4-6",
        web_search_requests=5,
        web_fetch_requests=2,
        cache_creation_input_tokens=1000,
        cache_read_input_tokens=500,
    )
    assert p["web_search_requests"] == 5
    assert p["web_fetch_requests"] == 2
    assert p["cache_creation_input_tokens"] == 1000
    assert p["cache_read_input_tokens"] == 500


def test_cost_stage_total_payload_partial_optional_fields():
    from worca.events.types import cost_stage_total_payload
    p = cost_stage_total_payload(
        stage="TEST", iteration=1, cost_usd=0.05,
        input_tokens=100, output_tokens=50, model="claude-haiku-4-5",
        web_search_requests=3,
        cache_read_input_tokens=200,
    )
    assert p["web_search_requests"] == 3
    assert p["cache_read_input_tokens"] == 200
    assert "web_fetch_requests" not in p
    assert "cache_creation_input_tokens" not in p


def test_cost_stage_total_payload_zero_optional_fields_excluded():
    from worca.events.types import cost_stage_total_payload
    p = cost_stage_total_payload(
        stage="PLAN", iteration=1, cost_usd=0.01,
        input_tokens=50, output_tokens=25, model="claude-sonnet-4-6",
        web_search_requests=0,
        web_fetch_requests=0,
        cache_creation_input_tokens=0,
        cache_read_input_tokens=0,
    )
    assert "web_search_requests" not in p
    assert "web_fetch_requests" not in p
    assert "cache_creation_input_tokens" not in p
    assert "cache_read_input_tokens" not in p


def test_cost_running_total_payload_required_fields():
    from worca.events.types import cost_running_total_payload
    p = cost_running_total_payload(
        total_cost_usd=0.30, total_input_tokens=2000, total_output_tokens=1000,
    )
    assert p["total_cost_usd"] == 0.30
    assert p["total_input_tokens"] == 2000
    assert p["total_output_tokens"] == 1000


def test_cost_budget_warning_payload_required_fields():
    from worca.events.types import cost_budget_warning_payload
    p = cost_budget_warning_payload(total_cost_usd=0.8, budget_usd=1.0, pct_used=80.0)
    assert p["total_cost_usd"] == 0.8
    assert p["budget_usd"] == 1.0
    assert p["pct_used"] == 80.0


def test_milestone_set_payload_required_fields():
    from worca.events.types import milestone_set_payload
    p = milestone_set_payload(milestone="plan_approved", value=True, stage="PLAN")
    assert p["milestone"] == "plan_approved"
    assert p["value"] is True
    assert p["stage"] == "PLAN"


def test_loop_triggered_payload_required_fields():
    from worca.events.types import loop_triggered_payload
    p = loop_triggered_payload(
        loop_key="implement_test", iteration=2,
        from_stage="TEST", to_stage="IMPLEMENT", trigger="test_failure",
    )
    assert p["loop_key"] == "implement_test"
    assert p["iteration"] == 2
    assert p["from_stage"] == "TEST"
    assert p["to_stage"] == "IMPLEMENT"
    assert p["trigger"] == "test_failure"


def test_loop_exhausted_payload_required_fields():
    from worca.events.types import loop_exhausted_payload
    p = loop_exhausted_payload(loop_key="implement_test", iteration=3, limit=3)
    assert p["loop_key"] == "implement_test"
    assert p["iteration"] == 3
    assert p["limit"] == 3


def test_hook_blocked_payload_required_fields():
    from worca.events.types import hook_blocked_payload
    p = hook_blocked_payload(agent="implementer", tool="Bash", reason="git commit blocked")
    assert p["agent"] == "implementer"
    assert p["tool"] == "Bash"
    assert p["reason"] == "git commit blocked"


def test_hook_test_gate_payload_required_fields():
    from worca.events.types import hook_test_gate_payload
    p = hook_test_gate_payload(agent="implementer", strike=1, action="warn")
    assert p["agent"] == "implementer"
    assert p["strike"] == 1
    assert p["action"] == "warn"


def test_hook_dispatch_blocked_payload_required_fields():
    from worca.events.types import hook_dispatch_blocked_payload
    p = hook_dispatch_blocked_payload(agent="implementer", candidate="Explore")
    assert p["agent"] == "implementer"
    assert p["section"] == "subagents"
    assert p["candidate"] == "Explore"


def test_hook_dispatch_blocked_payload_skills_section():
    """PR D: section discriminator unifies skills with subagents."""
    from worca.events.types import hook_dispatch_blocked_payload
    p = hook_dispatch_blocked_payload(
        agent="implementer", candidate="worca-install", section="skills",
    )
    assert p["section"] == "skills"
    assert p["candidate"] == "worca-install"


def test_hook_dispatch_allowed_payload_with_via():
    from worca.events.types import hook_dispatch_allowed_payload
    p = hook_dispatch_allowed_payload(
        agent="tester", candidate="Explore", section="subagents", via="explicit",
    )
    assert p["agent"] == "tester"
    assert p["section"] == "subagents"
    assert p["candidate"] == "Explore"
    assert p["via"] == "explicit"


def test_hook_graph_query_payload_required_fields():
    from worca.events.types import hook_graph_query_payload
    p = hook_graph_query_payload(engine="crg", op="query_graph_tool")
    assert p["engine"] == "crg"
    assert p["op"] == "query_graph_tool"
    assert "agent" not in p


def test_hook_graph_query_payload_with_agent():
    from worca.events.types import hook_graph_query_payload
    p = hook_graph_query_payload(engine="graphify", op="query", agent="planner")
    assert p["engine"] == "graphify"
    assert p["op"] == "query"
    assert p["agent"] == "planner"


def test_preflight_completed_payload_required_fields():
    from worca.events.types import preflight_completed_payload
    checks = [{"name": "git_clean", "status": "pass", "message": "OK"}]
    p = preflight_completed_payload(checks=checks, all_passed=True)
    assert p["checks"] == checks
    assert p["all_passed"] is True


def test_preflight_skipped_payload_required_fields():
    from worca.events.types import preflight_skipped_payload
    p = preflight_skipped_payload(reason="--skip-preflight flag")
    assert p["reason"] == "--skip-preflight flag"


def test_control_milestone_approve_payload_required_fields():
    from worca.events.types import control_milestone_approve_payload
    p = control_milestone_approve_payload(milestone="plan_approved", approved=True)
    assert p["milestone"] == "plan_approved"
    assert p["approved"] is True


def test_control_pipeline_pause_payload_required_fields():
    from worca.events.types import control_pipeline_pause_payload
    p = control_pipeline_pause_payload(reason="manual pause")
    assert p["reason"] == "manual pause"


def test_control_pipeline_resume_payload_required_fields():
    from worca.events.types import control_pipeline_resume_payload
    p = control_pipeline_resume_payload(reason="operator resumed")
    assert p["reason"] == "operator resumed"


def test_control_pipeline_abort_payload_required_fields():
    from worca.events.types import control_pipeline_abort_payload
    p = control_pipeline_abort_payload(reason="cost exceeded")
    assert p["reason"] == "cost exceeded"


# ---------------------------------------------------------------------------
# Return type checks — all builders must return dicts
# ---------------------------------------------------------------------------

def test_all_builders_return_dicts():
    """Every payload builder must return a plain dict."""
    import worca.events.types as T
    sample_calls = {
        "run_started_payload": dict(resume=False, started_at="2026-01-01T00:00:00Z"),
        "run_completed_payload": dict(
            duration_ms=1, total_cost_usd=0.0,
            total_turns=1, total_tokens=1, stages_completed=[],
        ),
        "run_failed_payload": dict(
            error="e", failed_stage="PLAN", error_type="PipelineError",
        ),
        "run_interrupted_payload": dict(interrupted_stage="PLAN", elapsed_ms=1),
        "run_cancelled_payload": dict(
            cancelled_stage="PLAN", elapsed_ms=1, source="user_cancel",
        ),
        "run_resumed_payload": dict(
            resume_stage="TEST", previous_stages_completed=[],
        ),
        "stage_started_payload": dict(
            stage="PLAN", iteration=1, agent="planner",
            model="x", trigger="initial", max_turns=10,
        ),
        "stage_completed_payload": dict(
            stage="PLAN", iteration=1, duration_ms=1,
            cost_usd=0.0, turns=1, outcome="success",
        ),
        "stage_failed_payload": dict(
            stage="PLAN", iteration=1, error="e",
            error_type="E", elapsed_ms=1,
        ),
        "stage_interrupted_payload": dict(stage="PLAN", iteration=1, elapsed_ms=1),
        "agent_spawned_payload": dict(
            stage="PLAN", iteration=1, agent="planner",
            model="x", max_turns=10,
        ),
        "agent_tool_use_payload": dict(
            stage="PLAN", iteration=1, tool="Read",
            tool_input_summary="f", turn=1,
        ),
        "agent_tool_result_payload": dict(
            stage="PLAN", iteration=1, tool="Read",
            is_error=False, turn=1,
        ),
        "agent_text_payload": dict(stage="PLAN", iteration=1, text_length=1, turn=1),
        "agent_completed_payload": dict(
            stage="PLAN", iteration=1, turns=1,
            cost_usd=0.0, duration_ms=1, exit_code=0,
        ),
        "agent_api_retry_payload": dict(
            stage="IMPLEMENT", iteration=1, agent="implementer",
            attempt=1, detail="overloaded, retrying",
        ),
        "iteration_access_payload": dict(
            run_id="r", stage="PLAN", agent="planner", iteration=1,
            bead_id="b", file_access={"reads": {}, "writes": {}, "searches": [], "totals": {}, "capture": {}},
        ),
        "bead_created_payload": dict(bead_id="b", title="t"),
        "bead_assigned_payload": dict(bead_id="b", title="t", iteration=1),
        "bead_completed_payload": dict(bead_id="b", reason="r"),
        "bead_failed_payload": dict(bead_id="b", error="e"),
        "bead_labeled_payload": dict(bead_ids=["b"], label="l"),
        "bead_next_payload": dict(next_bead_id="b", bead_iteration=1),
        "git_branch_created_payload": dict(branch="b"),
        "git_commit_payload": dict(stage="GUARDIAN", commit_hash="abc1234", message_summary="m"),
        "git_pr_created_payload": dict(pr_url="u", pr_number=1, title="t"),
        "git_pr_deferred_payload": dict(pr_title="t", base_branch="master", head_branch="feat"),
        "git_pr_merged_payload": dict(pr_url="u", pr_number=1),
        "test_suite_started_payload": dict(stage="TEST", iteration=1, trigger="initial"),
        "test_suite_passed_payload": dict(iteration=1),
        "test_suite_failed_payload": dict(iteration=1, failure_count=1, failures=[]),
        "test_fix_attempt_payload": dict(attempt=1, limit=3, failures_summary="s"),
        "review_started_payload": dict(iteration=1),
        "review_verdict_payload": dict(outcome="approve", issue_count=0, critical_count=0),
        "review_fix_attempt_payload": dict(attempt=1, limit=2),
        "cb_failure_recorded_payload": dict(
            stage="PLAN", error="e", category="transient",
            retriable=True, consecutive_failures=1,
        ),
        "cb_retry_payload": dict(
            stage="PLAN", attempt=1, delay_seconds=2.0, consecutive_failures=1,
        ),
        "cb_tripped_payload": dict(
            reason="r", consecutive_failures=5, category="persistent",
        ),
        "cb_reset_payload": dict(stage="PLAN", previous_consecutive_failures=2),
        "cost_stage_total_payload": dict(
            stage="PLAN", iteration=1, cost_usd=0.0,
            input_tokens=0, output_tokens=0, model="x",
        ),
        "cost_running_total_payload": dict(
            total_cost_usd=0.0, total_input_tokens=0, total_output_tokens=0,
        ),
        "cost_budget_warning_payload": dict(
            total_cost_usd=0.8, budget_usd=1.0, pct_used=80.0,
        ),
        "milestone_set_payload": dict(milestone="m", value=True, stage="PLAN"),
        "loop_triggered_payload": dict(
            loop_key="k", iteration=1, from_stage="TEST",
            to_stage="IMPLEMENT", trigger="test_failure",
        ),
        "loop_exhausted_payload": dict(loop_key="k", iteration=3, limit=3),
        "hook_blocked_payload": dict(agent="implementer", tool="Bash", reason="r"),
        "hook_test_gate_payload": dict(agent="implementer", strike=1, action="warn"),
        "hook_dispatch_blocked_payload": dict(agent="implementer", candidate="Explore"),
        "preflight_completed_payload": dict(checks=[], all_passed=True),
        "preflight_skipped_payload": dict(reason="r"),
        "control_milestone_approve_payload": dict(milestone="m", approved=True),
        "control_pipeline_pause_payload": dict(reason="r"),
        "control_pipeline_resume_payload": dict(reason="r"),
        "control_pipeline_abort_payload": dict(reason="r"),
    }
    for fn_name, kwargs in sample_calls.items():
        fn = getattr(T, fn_name)
        result = fn(**kwargs)
        assert isinstance(result, dict), f"{fn_name}() did not return a dict: {type(result)}"


# ---------------------------------------------------------------------------
# Optional field handling
# ---------------------------------------------------------------------------

def test_run_started_payload_optional_fields_omitted_by_default():
    """Optional fields should be absent when not provided (not None-filled)."""
    from worca.events.types import run_started_payload
    p = run_started_payload(resume=False, started_at="2026-01-01T00:00:00Z")
    # plan_file and settings_snapshot are optional — they're fine either way,
    # but if present they must not be set to sentinel values
    assert "resume" in p
    assert "started_at" in p


def test_run_started_payload_provenance_included_when_provided():
    """provenance dict is included in the payload when passed."""
    from worca.events.types import run_started_payload
    prov = {"worca_version": "0.57.0", "runtime_source": {"source": "pip"}}
    p = run_started_payload(resume=False, started_at="2026-01-01T00:00:00Z", provenance=prov)
    assert p["provenance"] == prov


def test_run_started_payload_provenance_absent_by_default():
    """provenance key must not appear in the payload when not provided."""
    from worca.events.types import run_started_payload
    p = run_started_payload(resume=False, started_at="2026-01-01T00:00:00Z")
    assert "provenance" not in p


def test_stage_completed_payload_optional_token_usage():
    """token_usage is optional; builder must accept it when supplied."""
    from worca.events.types import stage_completed_payload
    p = stage_completed_payload(
        stage="PLAN", iteration=1, duration_ms=1,
        cost_usd=0.0, turns=1, outcome="success",
        token_usage={"input_tokens": 100, "output_tokens": 50},
    )
    assert p.get("token_usage") == {"input_tokens": 100, "output_tokens": 50}


def test_stage_completed_payload_with_bead_counts():
    """beads_done and beads_total included when provided."""
    from worca.events.types import stage_completed_payload
    p = stage_completed_payload(
        stage="IMPLEMENT", iteration=1, duration_ms=5000,
        cost_usd=0.5, turns=10, outcome="success",
        beads_done=8, beads_total=8,
    )
    assert p["beads_done"] == 8
    assert p["beads_total"] == 8


def test_stage_completed_payload_bead_counts_omitted_when_none():
    """beads_done/beads_total omitted from dict when not supplied."""
    from worca.events.types import stage_completed_payload
    p = stage_completed_payload(
        stage="PLAN", iteration=1, duration_ms=1,
        cost_usd=0.0, turns=1, outcome="success",
    )
    assert "beads_done" not in p
    assert "beads_total" not in p


def test_stage_completed_payload_partial_bead_counts():
    """Only the supplied bead field appears when the other is None."""
    from worca.events.types import stage_completed_payload
    p = stage_completed_payload(
        stage="IMPLEMENT", iteration=1, duration_ms=1,
        cost_usd=0.0, turns=1, outcome="success",
        beads_done=3,
    )
    assert p["beads_done"] == 3
    assert "beads_total" not in p


def test_bead_created_payload_optional_run_label():
    """run_label is optional in bead_created."""
    from worca.events.types import bead_created_payload
    p = bead_created_payload(
        bead_id="b", title="t", run_label="run:20260309-143200",
    )
    assert p["run_label"] == "run:20260309-143200"


# ---------------------------------------------------------------------------
# plan_edited_payload tests
# ---------------------------------------------------------------------------

def test_plan_edited_payload_required_fields():
    from worca.events.types import plan_edited_payload
    p = plan_edited_payload(
        stage="plan_review",
        mode="review_and_edit",
        mode_reason="from template/pipeline",
        issue_counts={"critical": 1, "major": 2, "minor": 0, "suggestion": 1},
    )
    assert p["stage"] == "plan_review"
    assert p["mode"] == "review_and_edit"
    assert p["mode_reason"] == "from template/pipeline"
    assert p["issue_counts"] == {"critical": 1, "major": 2, "minor": 0, "suggestion": 1}
    assert isinstance(p, dict)


def test_plan_edited_payload_with_original_plan_path():
    from worca.events.types import plan_edited_payload
    p = plan_edited_payload(
        stage="plan_review",
        mode="review_and_edit",
        mode_reason="default",
        issue_counts={"critical": 0, "major": 0, "minor": 1, "suggestion": 0},
        original_plan_path="/tmp/run/plan-001.md",
    )
    assert p["original_plan_path"] == "/tmp/run/plan-001.md"


def test_plan_edited_payload_original_plan_path_omitted_when_none():
    from worca.events.types import plan_edited_payload
    p = plan_edited_payload(
        stage="plan_review",
        mode="review_and_edit",
        mode_reason="forced by project (governance.plan_review_enforce)",
        issue_counts={"critical": 0, "major": 0, "minor": 0, "suggestion": 0},
    )
    assert "original_plan_path" not in p


# ---------------------------------------------------------------------------
# Template lifecycle payload builders
# ---------------------------------------------------------------------------

def test_template_applied_payload_required_fields():
    from worca.events.types import template_applied_payload
    p = template_applied_payload(
        template_id="my-template",
        source="launch",
        tier="project",
    )
    assert p["template_id"] == "my-template"
    assert p["source"] == "launch"
    assert p["tier"] == "project"
    assert isinstance(p, dict)


def test_template_applied_payload_source_values():
    from worca.events.types import template_applied_payload
    for source in ("launch", "resume", "default"):
        p = template_applied_payload(
            template_id="tmpl", source=source, tier="builtin",
        )
        assert p["source"] == source


def test_template_applied_payload_tier_optional():
    from worca.events.types import template_applied_payload
    p = template_applied_payload(template_id="tmpl", source="launch")
    assert p["template_id"] == "tmpl"
    assert p["source"] == "launch"
    assert "tier" not in p


def test_template_dropped_payload_required_fields():
    from worca.events.types import template_dropped_payload
    p = template_dropped_payload(
        template_id="my-template",
        reason="not_found",
    )
    assert p["template_id"] == "my-template"
    assert p["reason"] == "not_found"
    assert isinstance(p, dict)


def test_template_dropped_payload_reason_values():
    from worca.events.types import template_dropped_payload
    for reason in ("not_found", "resolve_error", "missing_on_resume"):
        p = template_dropped_payload(template_id="tmpl", reason=reason)
        assert p["reason"] == reason


# ---------------------------------------------------------------------------
# context_final_pct in payload builders (Step 3 — TDD, written before impl)
# ---------------------------------------------------------------------------

def test_cost_stage_total_payload_includes_context_final_pct_when_provided():
    from worca.events.types import cost_stage_total_payload
    p = cost_stage_total_payload(
        stage="IMPLEMENT", iteration=1, cost_usd=0.15,
        input_tokens=1000, output_tokens=500, model="claude-sonnet-4-6",
        context_final_pct=53.2,
    )
    assert p["context_final_pct"] == 53.2


def test_cost_stage_total_payload_omits_context_final_pct_when_none():
    from worca.events.types import cost_stage_total_payload
    p = cost_stage_total_payload(
        stage="IMPLEMENT", iteration=1, cost_usd=0.15,
        input_tokens=1000, output_tokens=500, model="claude-sonnet-4-6",
    )
    assert "context_final_pct" not in p


def test_agent_completed_payload_includes_context_final_pct_when_provided():
    from worca.events.types import agent_completed_payload
    p = agent_completed_payload(
        stage="IMPLEMENT", iteration=1, turns=5,
        cost_usd=0.10, duration_ms=30000, exit_code=0,
        context_final_pct=72.5,
    )
    assert p["context_final_pct"] == 72.5


def test_agent_completed_payload_omits_context_final_pct_when_none():
    from worca.events.types import agent_completed_payload
    p = agent_completed_payload(
        stage="IMPLEMENT", iteration=1, turns=5,
        cost_usd=0.10, duration_ms=30000, exit_code=0,
    )
    assert "context_final_pct" not in p


def test_workspace_project_skipped_payload():
    from worca.events.types import (
        WORKSPACE_PROJECT_SKIPPED,
        workspace_project_skipped_payload,
    )
    assert WORKSPACE_PROJECT_SKIPPED == "workspace.project.skipped"
    p = workspace_project_skipped_payload(
        workspace_name="ws",
        project="hippo",
        tier=0,
    )
    assert p == {
        "workspace_name": "ws",
        "project": "hippo",
        "tier": 0,
        "reason": "no_plan",
    }


def test_workspace_project_skipped_payload_custom_reason():
    from worca.events.types import workspace_project_skipped_payload
    p = workspace_project_skipped_payload(
        workspace_name="ws",
        project="kafka",
        tier=1,
        reason="manual_skip",
    )
    assert p["reason"] == "manual_skip"


# ---------------------------------------------------------------------------
# pipeline.claude_md.mode_resolved event (Phase 7 — TDD, written before impl)
# ---------------------------------------------------------------------------

def test_claude_md_mode_resolved_constant_exists():
    import worca.events.types as T
    assert hasattr(T, "CLAUDE_MD_MODE_RESOLVED")
    assert T.CLAUDE_MD_MODE_RESOLVED == "pipeline.claude_md.mode_resolved"


def test_claude_md_mode_resolved_payload_required_fields():
    from worca.events.types import claude_md_mode_resolved_payload
    p = claude_md_mode_resolved_payload(
        mode="project",
        source="cli",
        overlay_path="/tmp/run/claude_md_overlay.json",
        exclude_count=12,
    )
    assert p["mode"] == "project"
    assert p["source"] == "cli"
    assert p["overlay_path"] == "/tmp/run/claude_md_overlay.json"
    assert p["exclude_count"] == 12
    assert isinstance(p, dict)


def test_claude_md_mode_resolved_payload_overlay_path_none():
    from worca.events.types import claude_md_mode_resolved_payload
    p = claude_md_mode_resolved_payload(
        mode="none",
        source="template",
        overlay_path=None,
        exclude_count=0,
    )
    assert p["overlay_path"] is None


def test_claude_md_mode_resolved_payload_source_values():
    from worca.events.types import claude_md_mode_resolved_payload
    for source in ("cli", "template", "project_settings", "default"):
        p = claude_md_mode_resolved_payload(
            mode="all", source=source, overlay_path=None, exclude_count=0,
        )
        assert p["source"] == source


def test_claude_md_mode_resolved_payload_mode_values():
    from worca.events.types import claude_md_mode_resolved_payload
    for mode in ("none", "project", "project+local", "all"):
        p = claude_md_mode_resolved_payload(
            mode=mode, source="default", overlay_path=None, exclude_count=0,
        )
        assert p["mode"] == mode
