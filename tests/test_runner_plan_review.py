"""Tests for PLAN_REVIEW handler in worca.orchestrator.runner.

TDD: these tests were written before the implementation.
"""
import json
from unittest.mock import patch

import pytest

from worca.orchestrator.runner import run_pipeline
from worca.orchestrator.stages import Stage
from worca.orchestrator.work_request import WorkRequest


# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------

def _settings(tmp_path, plan_review_enabled=True, plan_review_loops=2, extra_stages=None):
    """Write settings.json with PLAN_REVIEW enabled and minimal stages."""
    stages = {
        "plan": {"agent": "planner", "enabled": True},
        "plan_review": {"agent": "plan_reviewer", "enabled": plan_review_enabled},
        "coordinate": {"agent": "coordinator", "enabled": True},
        "implement": {"agent": "implementer", "enabled": False},
        "test": {"agent": "tester", "enabled": False},
        "review": {"agent": "guardian", "enabled": False},
        "pr": {"agent": "guardian", "enabled": False},
    }
    if extra_stages:
        stages.update(extra_stages)
    data = {
        "worca": {
            "stages": stages,
            "agents": {
                "planner": {"model": "opus", "max_turns": 10},
                "plan_reviewer": {"model": "opus", "max_turns": 20},
                "coordinator": {"model": "opus", "max_turns": 10},
            },
            "loops": {
                "plan_review": plan_review_loops,
            },
        }
    }
    f = tmp_path / "settings.json"
    f.write_text(json.dumps(data))
    return str(f)


def _worca(tmp_path):
    """Create a .worca dir and return (worca_dir, status_path)."""
    d = tmp_path / ".worca"
    d.mkdir()
    return str(d), str(d / "status.json")


def _wr(title="Test task"):
    return WorkRequest(source_type="prompt", title=title)


def _make_runner(tmp_path, plan_review_loops=2, plan_review_enabled=True):
    """Return (settings_path, status_path, wr) for a minimal pipeline test."""
    settings_path = _settings(tmp_path, plan_review_enabled=plan_review_enabled,
                               plan_review_loops=plan_review_loops)
    _, status_path = _worca(tmp_path)
    wr = _wr()
    return settings_path, status_path, wr


def _mock_stage(stage, result):
    """Stage result tuple with minimal raw envelope."""
    return result, {"type": "result"}


@pytest.fixture(autouse=True)
def _mock_beads():
    with patch("worca.orchestrator.runner._ensure_beads_initialized"):
        yield


# ---------------------------------------------------------------------------
# _STAGE_PROMPT_PREFIX entry
# ---------------------------------------------------------------------------

class TestStagePromptPrefix:
    def test_plan_review_in_stage_prompt_prefix(self):
        from worca.orchestrator.runner import _STAGE_PROMPT_PREFIX
        assert Stage.PLAN_REVIEW in _STAGE_PROMPT_PREFIX

    def test_plan_review_prompt_contains_plan_reference(self):
        from worca.orchestrator.runner import _STAGE_PROMPT_PREFIX
        prefix = _STAGE_PROMPT_PREFIX[Stage.PLAN_REVIEW]
        assert "plan" in prefix.lower() or "review" in prefix.lower()


# ---------------------------------------------------------------------------
# Approve path
# ---------------------------------------------------------------------------

class TestPlanReviewApprovePath:

    def test_approve_advances_to_coordinate(self, tmp_path):
        """PLAN_REVIEW with outcome=approve leads to COORDINATE running."""
        settings_path, status_path, wr = _make_runner(tmp_path)
        stages_run = []

        def mock_run_stage(stage, context, settings_path, msize=1, iteration=1,
                           prompt_override=None, **kwargs):
            stages_run.append(stage.value)
            if stage == Stage.PLAN:
                return _mock_stage(stage, {"approved": True, "approach": "x", "tasks_outline": []})
            if stage == Stage.PLAN_REVIEW:
                return _mock_stage(stage, {"outcome": "approve", "issues": [], "summary": "Good"})
            if stage == Stage.COORDINATE:
                return _mock_stage(stage, {"beads_ids": [], "dependency_graph": {}})
            return _mock_stage(stage, {})

        with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
            with patch("worca.orchestrator.runner.create_branch"):
                with patch("worca.orchestrator.runner._write_pid"):
                    with patch("worca.orchestrator.runner._remove_pid"):
                        run_pipeline(wr, settings_path=settings_path, status_path=status_path)

        assert "plan_review" in stages_run
        assert "coordinate" in stages_run
        plan_review_idx = stages_run.index("plan_review")
        coordinate_idx = stages_run.index("coordinate")
        assert plan_review_idx < coordinate_idx

    def test_approve_pops_plan_review_issues_from_context(self, tmp_path):
        """After approve, plan_review_issues is removed from prompt context."""
        settings_path, status_path, wr = _make_runner(tmp_path)
        captured_context = {}

        def mock_run_stage(stage, context, settings_path, msize=1, iteration=1,
                           prompt_override=None, **kwargs):
            if stage == Stage.COORDINATE:
                # Capture context at COORDINATE time
                captured_context.update(context.get("_prompt_context", {}))
            if stage == Stage.PLAN:
                return _mock_stage(stage, {"approved": True, "approach": "x", "tasks_outline": []})
            if stage == Stage.PLAN_REVIEW:
                return _mock_stage(stage, {"outcome": "approve", "issues": [], "summary": "Good"})
            if stage == Stage.COORDINATE:
                return _mock_stage(stage, {"beads_ids": [], "dependency_graph": {}})
            return _mock_stage(stage, {})

        from worca.orchestrator.prompt_builder import PromptBuilder as PB
        original_pop_ctx = PB.pop_context

        popped_keys = []

        def tracking_pop(self, key):
            popped_keys.append(key)
            return original_pop_ctx(self, key)

        with patch.object(PB, "pop_context", tracking_pop):
            with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
                with patch("worca.orchestrator.runner.create_branch"):
                    with patch("worca.orchestrator.runner._write_pid"):
                        with patch("worca.orchestrator.runner._remove_pid"):
                            try:
                                run_pipeline(wr, settings_path=settings_path, status_path=status_path)
                            except Exception:
                                pass

        # pop_context should be called for the plan_review keys
        assert "plan_review_issues" in popped_keys
        assert "plan_revision_mode" in popped_keys
        assert "plan_review_history" in popped_keys

    def test_approve_runs_plan_once(self, tmp_path):
        """On approve, PLAN only runs once (no loop-back)."""
        settings_path, status_path, wr = _make_runner(tmp_path)
        stage_counts = {}

        def mock_run_stage(stage, context, settings_path, msize=1, iteration=1,
                           prompt_override=None, **kwargs):
            stage_counts[stage.value] = stage_counts.get(stage.value, 0) + 1
            if stage == Stage.PLAN:
                return _mock_stage(stage, {"approved": True, "approach": "x", "tasks_outline": []})
            if stage == Stage.PLAN_REVIEW:
                return _mock_stage(stage, {"outcome": "approve", "issues": [], "summary": "Good"})
            if stage == Stage.COORDINATE:
                return _mock_stage(stage, {"beads_ids": [], "dependency_graph": {}})
            return _mock_stage(stage, {})

        with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
            with patch("worca.orchestrator.runner.create_branch"):
                with patch("worca.orchestrator.runner._write_pid"):
                    with patch("worca.orchestrator.runner._remove_pid"):
                        run_pipeline(wr, settings_path=settings_path, status_path=status_path)

        assert stage_counts.get("plan", 0) == 1
        assert stage_counts.get("plan_review", 0) == 1


# ---------------------------------------------------------------------------
# Revise path with critical issues
# ---------------------------------------------------------------------------

class TestPlanReviewRevisePath:

    def test_revise_loops_back_to_plan(self, tmp_path):
        """PLAN_REVIEW revise with critical issues loops back to PLAN."""
        settings_path, status_path, wr = _make_runner(tmp_path, plan_review_loops=2)
        stages_run = []

        critical_issue = {"category": "risk", "severity": "critical",
                          "description": "No rollback strategy"}

        call_count = {"plan_review": 0}

        def mock_run_stage(stage, context, settings_path, msize=1, iteration=1,
                           prompt_override=None, **kwargs):
            stages_run.append(stage.value)
            if stage == Stage.PLAN:
                return _mock_stage(stage, {"approved": True, "approach": "x", "tasks_outline": []})
            if stage == Stage.PLAN_REVIEW:
                call_count["plan_review"] += 1
                if call_count["plan_review"] == 1:
                    # First review: revise
                    return _mock_stage(stage, {
                        "outcome": "revise",
                        "issues": [critical_issue],
                        "summary": "Issues found",
                    })
                # Second review: approve
                return _mock_stage(stage, {"outcome": "approve", "issues": [], "summary": "OK"})
            if stage == Stage.COORDINATE:
                return _mock_stage(stage, {"beads_ids": [], "dependency_graph": {}})
            return _mock_stage(stage, {})

        with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
            with patch("worca.orchestrator.runner.create_branch"):
                with patch("worca.orchestrator.runner._write_pid"):
                    with patch("worca.orchestrator.runner._remove_pid"):
                        run_pipeline(wr, settings_path=settings_path, status_path=status_path)

        # PLAN ran twice (initial + after revise loop)
        assert stages_run.count("plan") == 2
        # PLAN_REVIEW ran twice
        assert stages_run.count("plan_review") == 2
        # COORDINATE ran once (after final approval)
        assert stages_run.count("coordinate") == 1

    def test_revise_increments_loop_counter(self, tmp_path):
        """Loop counter increments on each revise iteration."""
        from worca.state.status import load_status
        settings_path, status_path, wr = _make_runner(tmp_path, plan_review_loops=3)
        critical_issue = {"category": "feasibility", "severity": "major",
                          "description": "Infeasible approach"}
        call_count = {"plan_review": 0}

        def mock_run_stage(stage, context, settings_path, msize=1, iteration=1,
                           prompt_override=None, **kwargs):
            if stage == Stage.PLAN:
                return _mock_stage(stage, {"approved": True, "approach": "x", "tasks_outline": []})
            if stage == Stage.PLAN_REVIEW:
                call_count["plan_review"] += 1
                if call_count["plan_review"] < 3:
                    return _mock_stage(stage, {
                        "outcome": "revise",
                        "issues": [critical_issue],
                        "summary": "Issues",
                    })
                return _mock_stage(stage, {"outcome": "approve", "issues": [], "summary": "OK"})
            if stage == Stage.COORDINATE:
                return _mock_stage(stage, {"beads_ids": [], "dependency_graph": {}})
            return _mock_stage(stage, {})

        with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
            with patch("worca.orchestrator.runner.create_branch"):
                with patch("worca.orchestrator.runner._write_pid"):
                    with patch("worca.orchestrator.runner._remove_pid"):
                        result = run_pipeline(wr, settings_path=settings_path,
                                              status_path=status_path)

        # Find the actual status file path (it's in a per-run dir)
        run_id = result["run_id"]
        worca_dir = str(tmp_path / ".worca")
        import os
        actual_status_path = os.path.join(worca_dir, "runs", run_id, "status.json")
        final_status = load_status(actual_status_path)
        # Counter should be 2 (2 revise iterations before final approve)
        assert final_status["loop_counters"].get("plan_review", 0) == 2

    def test_revise_sets_context_keys(self, tmp_path):
        """On revise, plan_review_issues and plan_revision_mode are set in context."""
        settings_path, status_path, wr = _make_runner(tmp_path, plan_review_loops=2)
        critical_issue = {"category": "architecture", "severity": "critical",
                          "description": "Wrong layer"}
        call_count = {"plan_review": 0}
        plan_context_on_revision = {}

        def mock_run_stage(stage, context, settings_path, msize=1, iteration=1,
                           prompt_override=None, **kwargs):
            if stage == Stage.PLAN:
                if call_count["plan_review"] >= 1:
                    # Second PLAN call — capture context
                    plan_context_on_revision.update(context)
                return _mock_stage(stage, {"approved": True, "approach": "x", "tasks_outline": []})
            if stage == Stage.PLAN_REVIEW:
                call_count["plan_review"] += 1
                if call_count["plan_review"] == 1:
                    return _mock_stage(stage, {
                        "outcome": "revise",
                        "issues": [critical_issue],
                        "summary": "Issues",
                    })
                return _mock_stage(stage, {"outcome": "approve", "issues": [], "summary": "OK"})
            if stage == Stage.COORDINATE:
                return _mock_stage(stage, {"beads_ids": [], "dependency_graph": {}})
            return _mock_stage(stage, {})

        # Track update_context calls on the PromptBuilder
        from worca.orchestrator.prompt_builder import PromptBuilder
        updated_keys = {}
        original_update = PromptBuilder.update_context

        def tracking_update(self, key, value):
            updated_keys[key] = value
            return original_update(self, key, value)

        with patch.object(PromptBuilder, "update_context", tracking_update):
            with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
                with patch("worca.orchestrator.runner.create_branch"):
                    with patch("worca.orchestrator.runner._write_pid"):
                        with patch("worca.orchestrator.runner._remove_pid"):
                            run_pipeline(wr, settings_path=settings_path, status_path=status_path)

        assert "plan_review_issues" in updated_keys
        assert "plan_revision_mode" in updated_keys
        assert updated_keys["plan_revision_mode"] is True
        assert "plan_review_history" in updated_keys

    def test_revise_resets_plan_stage_status(self, tmp_path):
        """On revise loop-back, PLAN stage status is reset to allow re-running."""
        from worca.state.status import load_status
        settings_path, status_path, wr = _make_runner(tmp_path, plan_review_loops=2)
        critical_issue = {"category": "completeness", "severity": "major",
                          "description": "Missing requirements"}
        call_count = {"plan_review": 0}

        def mock_run_stage(stage, context, settings_path, msize=1, iteration=1,
                           prompt_override=None, **kwargs):
            if stage == Stage.PLAN:
                return _mock_stage(stage, {"approved": True, "approach": "x", "tasks_outline": []})
            if stage == Stage.PLAN_REVIEW:
                call_count["plan_review"] += 1
                if call_count["plan_review"] == 1:
                    return _mock_stage(stage, {
                        "outcome": "revise",
                        "issues": [critical_issue],
                        "summary": "Issues",
                    })
                return _mock_stage(stage, {"outcome": "approve", "issues": [], "summary": "OK"})
            if stage == Stage.COORDINATE:
                return _mock_stage(stage, {"beads_ids": [], "dependency_graph": {}})
            return _mock_stage(stage, {})

        with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
            with patch("worca.orchestrator.runner.create_branch"):
                with patch("worca.orchestrator.runner._write_pid"):
                    with patch("worca.orchestrator.runner._remove_pid"):
                        result = run_pipeline(wr, settings_path=settings_path,
                                              status_path=status_path)

        # Pipeline should complete (PLAN ran twice)
        run_id = result["run_id"]
        import os
        actual_status_path = os.path.join(str(tmp_path / ".worca"), "runs", run_id, "status.json")
        final_status = load_status(actual_status_path)
        # PLAN should have run 2 iterations
        plan_iters = final_status["stages"]["plan"].get("iterations", [])
        assert len(plan_iters) == 2

    def test_revise_history_stores_only_critical_major_issues(self, tmp_path):
        """Only critical/major issues are stored in plan_review_history."""
        settings_path, status_path, wr = _make_runner(tmp_path, plan_review_loops=2)
        critical_issue = {"category": "risk", "severity": "critical",
                          "description": "Critical gap"}
        minor_issue = {"category": "decomposition", "severity": "minor",
                       "description": "Could be split"}
        call_count = {"plan_review": 0}
        history_captured = {}

        from worca.orchestrator.prompt_builder import PromptBuilder
        original_update = PromptBuilder.update_context

        def capturing_update(self, key, value):
            if key == "plan_review_history":
                history_captured["value"] = value
            return original_update(self, key, value)

        def mock_run_stage(stage, context, settings_path, msize=1, iteration=1,
                           prompt_override=None, **kwargs):
            if stage == Stage.PLAN:
                return _mock_stage(stage, {"approved": True, "approach": "x", "tasks_outline": []})
            if stage == Stage.PLAN_REVIEW:
                call_count["plan_review"] += 1
                if call_count["plan_review"] == 1:
                    return _mock_stage(stage, {
                        "outcome": "revise",
                        "issues": [critical_issue, minor_issue],
                        "summary": "Issues",
                    })
                return _mock_stage(stage, {"outcome": "approve", "issues": [], "summary": "OK"})
            if stage == Stage.COORDINATE:
                return _mock_stage(stage, {"beads_ids": [], "dependency_graph": {}})
            return _mock_stage(stage, {})

        with patch.object(PromptBuilder, "update_context", capturing_update):
            with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
                with patch("worca.orchestrator.runner.create_branch"):
                    with patch("worca.orchestrator.runner._write_pid"):
                        with patch("worca.orchestrator.runner._remove_pid"):
                            run_pipeline(wr, settings_path=settings_path, status_path=status_path)

        assert history_captured
        # History should only contain the critical issue, not the minor one
        history = history_captured["value"]
        assert len(history) == 1
        first_entry = history[0]
        assert len(first_entry["issues"]) == 1
        assert first_entry["issues"][0]["severity"] == "critical"

    def test_revise_history_accumulates_across_rounds(self, tmp_path):
        """plan_review_history grows with each revise round, preserving all entries."""
        settings_path, status_path, wr = _make_runner(tmp_path, plan_review_loops=3)
        issue_round1 = {"category": "risk", "severity": "critical",
                        "description": "Round 1 issue"}
        issue_round2 = {"category": "feasibility", "severity": "major",
                        "description": "Round 2 issue"}
        call_count = {"plan_review": 0}
        history_snapshots = []

        from worca.orchestrator.prompt_builder import PromptBuilder
        original_update = PromptBuilder.update_context

        def capturing_update(self, key, value):
            if key == "plan_review_history":
                # Deep copy to capture the snapshot at this point in time
                import copy
                history_snapshots.append(copy.deepcopy(value))
            return original_update(self, key, value)

        def mock_run_stage(stage, context, settings_path, msize=1, iteration=1,
                           prompt_override=None, **kwargs):
            if stage == Stage.PLAN:
                return _mock_stage(stage, {"approved": True, "approach": "x", "tasks_outline": []})
            if stage == Stage.PLAN_REVIEW:
                call_count["plan_review"] += 1
                if call_count["plan_review"] == 1:
                    return _mock_stage(stage, {
                        "outcome": "revise",
                        "issues": [issue_round1],
                        "summary": "Round 1",
                    })
                if call_count["plan_review"] == 2:
                    return _mock_stage(stage, {
                        "outcome": "revise",
                        "issues": [issue_round2],
                        "summary": "Round 2",
                    })
                return _mock_stage(stage, {"outcome": "approve", "issues": [], "summary": "OK"})
            if stage == Stage.COORDINATE:
                return _mock_stage(stage, {"beads_ids": [], "dependency_graph": {}})
            return _mock_stage(stage, {})

        with patch.object(PromptBuilder, "update_context", capturing_update):
            with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
                with patch("worca.orchestrator.runner.create_branch"):
                    with patch("worca.orchestrator.runner._write_pid"):
                        with patch("worca.orchestrator.runner._remove_pid"):
                            run_pipeline(wr, settings_path=settings_path, status_path=status_path)

        # Should have captured 2 history snapshots (one per revise round)
        assert len(history_snapshots) >= 2
        # First snapshot: 1 entry from round 1
        assert len(history_snapshots[0]) == 1
        assert history_snapshots[0][0]["attempt"] == 1
        assert history_snapshots[0][0]["issues"][0]["description"] == "Round 1 issue"
        # Second snapshot: 2 entries (accumulated)
        assert len(history_snapshots[1]) == 2
        assert history_snapshots[1][0]["attempt"] == 1
        assert history_snapshots[1][1]["attempt"] == 2
        assert history_snapshots[1][1]["issues"][0]["description"] == "Round 2 issue"


# ---------------------------------------------------------------------------
# Revise with minor-only issues → approve
# ---------------------------------------------------------------------------

class TestPlanReviewReviseMinorOnly:

    def test_revise_minor_only_treated_as_approve(self, tmp_path):
        """outcome=revise with only minor/suggestion issues → no loop-back."""
        settings_path, status_path, wr = _make_runner(tmp_path, plan_review_loops=2)
        stages_run = []
        minor_issue = {"category": "decomposition", "severity": "minor",
                       "description": "Could be split further"}

        def mock_run_stage(stage, context, settings_path, msize=1, iteration=1,
                           prompt_override=None, **kwargs):
            stages_run.append(stage.value)
            if stage == Stage.PLAN:
                return _mock_stage(stage, {"approved": True, "approach": "x", "tasks_outline": []})
            if stage == Stage.PLAN_REVIEW:
                return _mock_stage(stage, {
                    "outcome": "revise",
                    "issues": [minor_issue],
                    "summary": "Minor issues only",
                })
            if stage == Stage.COORDINATE:
                return _mock_stage(stage, {"beads_ids": [], "dependency_graph": {}})
            return _mock_stage(stage, {})

        with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
            with patch("worca.orchestrator.runner.create_branch"):
                with patch("worca.orchestrator.runner._write_pid"):
                    with patch("worca.orchestrator.runner._remove_pid"):
                        run_pipeline(wr, settings_path=settings_path, status_path=status_path)

        # PLAN should only run once (no loop-back)
        assert stages_run.count("plan") == 1
        # COORDINATE should run (treat as approve)
        assert "coordinate" in stages_run

    def test_revise_suggestion_only_treated_as_approve(self, tmp_path):
        """outcome=revise with only suggestion-level issues → no loop-back."""
        settings_path, status_path, wr = _make_runner(tmp_path, plan_review_loops=2)
        stages_run = []
        suggestion_issue = {"category": "test_strategy", "severity": "suggestion",
                            "description": "Consider adding property tests"}

        def mock_run_stage(stage, context, settings_path, msize=1, iteration=1,
                           prompt_override=None, **kwargs):
            stages_run.append(stage.value)
            if stage == Stage.PLAN:
                return _mock_stage(stage, {"approved": True, "approach": "x", "tasks_outline": []})
            if stage == Stage.PLAN_REVIEW:
                return _mock_stage(stage, {
                    "outcome": "revise",
                    "issues": [suggestion_issue],
                    "summary": "Suggestions only",
                })
            if stage == Stage.COORDINATE:
                return _mock_stage(stage, {"beads_ids": [], "dependency_graph": {}})
            return _mock_stage(stage, {})

        with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
            with patch("worca.orchestrator.runner.create_branch"):
                with patch("worca.orchestrator.runner._write_pid"):
                    with patch("worca.orchestrator.runner._remove_pid"):
                        run_pipeline(wr, settings_path=settings_path, status_path=status_path)

        assert stages_run.count("plan") == 1
        assert "coordinate" in stages_run


# ---------------------------------------------------------------------------
# Fail-closed: revise with empty issues
# ---------------------------------------------------------------------------

class TestPlanReviewReviseEmptyIssues:

    def test_revise_empty_issues_still_revises(self, tmp_path):
        """outcome=revise with empty issues list → still treated as revise (fail-closed)."""
        settings_path, status_path, wr = _make_runner(tmp_path, plan_review_loops=2)
        stages_run = []
        call_count = {"plan_review": 0}

        def mock_run_stage(stage, context, settings_path, msize=1, iteration=1,
                           prompt_override=None, **kwargs):
            stages_run.append(stage.value)
            if stage == Stage.PLAN:
                return _mock_stage(stage, {"approved": True, "approach": "x", "tasks_outline": []})
            if stage == Stage.PLAN_REVIEW:
                call_count["plan_review"] += 1
                if call_count["plan_review"] == 1:
                    # Revise with empty issues — still fail-closed
                    return _mock_stage(stage, {"outcome": "revise", "issues": [], "summary": ""})
                return _mock_stage(stage, {"outcome": "approve", "issues": [], "summary": "OK"})
            if stage == Stage.COORDINATE:
                return _mock_stage(stage, {"beads_ids": [], "dependency_graph": {}})
            return _mock_stage(stage, {})

        with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
            with patch("worca.orchestrator.runner.create_branch"):
                with patch("worca.orchestrator.runner._write_pid"):
                    with patch("worca.orchestrator.runner._remove_pid"):
                        run_pipeline(wr, settings_path=settings_path, status_path=status_path)

        # PLAN should run twice (first review revises back)
        assert stages_run.count("plan") == 2

    def test_missing_outcome_defaults_to_revise(self, tmp_path):
        """Missing outcome field defaults to 'revise' (fail-closed)."""
        settings_path, status_path, wr = _make_runner(tmp_path, plan_review_loops=2)
        stages_run = []
        call_count = {"plan_review": 0}

        def mock_run_stage(stage, context, settings_path, msize=1, iteration=1,
                           prompt_override=None, **kwargs):
            stages_run.append(stage.value)
            if stage == Stage.PLAN:
                return _mock_stage(stage, {"approved": True, "approach": "x", "tasks_outline": []})
            if stage == Stage.PLAN_REVIEW:
                call_count["plan_review"] += 1
                if call_count["plan_review"] == 1:
                    # No outcome field — should default to revise
                    return _mock_stage(stage, {"issues": [], "summary": "No outcome"})
                return _mock_stage(stage, {"outcome": "approve", "issues": [], "summary": "OK"})
            if stage == Stage.COORDINATE:
                return _mock_stage(stage, {"beads_ids": [], "dependency_graph": {}})
            return _mock_stage(stage, {})

        with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
            with patch("worca.orchestrator.runner.create_branch"):
                with patch("worca.orchestrator.runner._write_pid"):
                    with patch("worca.orchestrator.runner._remove_pid"):
                        run_pipeline(wr, settings_path=settings_path, status_path=status_path)

        # PLAN should run twice (missing outcome = revise = loop back)
        assert stages_run.count("plan") == 2


# ---------------------------------------------------------------------------
# Loop exhaustion
# ---------------------------------------------------------------------------

class TestPlanReviewLoopExhaustion:

    def test_loop_exhaustion_advances_to_coordinate(self, tmp_path):
        """When plan_review loop exhausted, pipeline continues to COORDINATE."""
        settings_path, status_path, wr = _make_runner(tmp_path, plan_review_loops=1)
        stages_run = []
        critical_issue = {"category": "risk", "severity": "critical",
                          "description": "Critical gap"}

        def mock_run_stage(stage, context, settings_path, msize=1, iteration=1,
                           prompt_override=None, **kwargs):
            stages_run.append(stage.value)
            if stage == Stage.PLAN:
                return _mock_stage(stage, {"approved": True, "approach": "x", "tasks_outline": []})
            if stage == Stage.PLAN_REVIEW:
                # Always revise — loop should exhaust after limit
                return _mock_stage(stage, {
                    "outcome": "revise",
                    "issues": [critical_issue],
                    "summary": "Always issues",
                })
            if stage == Stage.COORDINATE:
                return _mock_stage(stage, {"beads_ids": [], "dependency_graph": {}})
            return _mock_stage(stage, {})

        with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
            with patch("worca.orchestrator.runner.create_branch"):
                with patch("worca.orchestrator.runner._write_pid"):
                    with patch("worca.orchestrator.runner._remove_pid"):
                        run_pipeline(wr, settings_path=settings_path, status_path=status_path)

        # COORDINATE should run even after exhaustion
        assert "coordinate" in stages_run

    def test_loop_exhaustion_emits_loop_exhausted_event(self, tmp_path):
        """LOOP_EXHAUSTED event emitted when plan_review loop limit reached."""
        from worca.events.types import LOOP_EXHAUSTED
        settings_path, status_path, wr = _make_runner(tmp_path, plan_review_loops=1)
        critical_issue = {"category": "risk", "severity": "critical", "description": "gap"}
        emitted_events = []

        def mock_run_stage(stage, context, settings_path, msize=1, iteration=1,
                           prompt_override=None, **kwargs):
            if stage == Stage.PLAN:
                return _mock_stage(stage, {"approved": True, "approach": "x", "tasks_outline": []})
            if stage == Stage.PLAN_REVIEW:
                return _mock_stage(stage, {
                    "outcome": "revise",
                    "issues": [critical_issue],
                    "summary": "Issues",
                })
            if stage == Stage.COORDINATE:
                return _mock_stage(stage, {"beads_ids": [], "dependency_graph": {}})
            return _mock_stage(stage, {})

        def capturing_emit(ctx, event_type, payload, **kwargs):
            emitted_events.append(event_type)
            return None

        with patch("worca.orchestrator.runner.emit_event", side_effect=capturing_emit):
            with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
                with patch("worca.orchestrator.runner.create_branch"):
                    with patch("worca.orchestrator.runner._write_pid"):
                        with patch("worca.orchestrator.runner._remove_pid"):
                            run_pipeline(wr, settings_path=settings_path, status_path=status_path)

        assert LOOP_EXHAUSTED in emitted_events

    def test_loop_counter_persisted_before_loop_back(self, tmp_path):
        """Loop counter is saved to disk before in-memory loop-back transitions."""
        from worca.state.status import load_status
        settings_path, status_path, wr = _make_runner(tmp_path, plan_review_loops=2)
        critical_issue = {"category": "risk", "severity": "critical", "description": "gap"}
        call_count = {"plan_review": 0}

        def mock_run_stage(stage, context, settings_path, msize=1, iteration=1,
                           prompt_override=None, **kwargs):
            if stage == Stage.PLAN:
                return _mock_stage(stage, {"approved": True, "approach": "x", "tasks_outline": []})
            if stage == Stage.PLAN_REVIEW:
                call_count["plan_review"] += 1
                if call_count["plan_review"] <= 1:
                    return _mock_stage(stage, {
                        "outcome": "revise",
                        "issues": [critical_issue],
                        "summary": "Issues",
                    })
                return _mock_stage(stage, {"outcome": "approve", "issues": [], "summary": "OK"})
            if stage == Stage.COORDINATE:
                return _mock_stage(stage, {"beads_ids": [], "dependency_graph": {}})
            return _mock_stage(stage, {})

        with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
            with patch("worca.orchestrator.runner.create_branch"):
                with patch("worca.orchestrator.runner._write_pid"):
                    with patch("worca.orchestrator.runner._remove_pid"):
                        result = run_pipeline(wr, settings_path=settings_path,
                                              status_path=status_path)

        import os
        run_id = result["run_id"]
        actual_status_path = os.path.join(str(tmp_path / ".worca"), "runs", run_id, "status.json")
        final_status = load_status(actual_status_path)
        # Counter should be 1 (one revise iteration)
        assert final_status["loop_counters"].get("plan_review", 0) == 1

    def test_persist_calls_happen_before_plan_reruns(self, tmp_path):
        """save_status and save_context are called before PLAN re-runs on loop-back."""
        settings_path, status_path, wr = _make_runner(tmp_path, plan_review_loops=2)
        critical_issue = {"category": "risk", "severity": "critical", "description": "gap"}
        call_count = {"plan_review": 0}
        call_order = []  # tracks ordering of persist vs run_stage(PLAN)

        def mock_run_stage(stage, context, settings_path, msize=1, iteration=1,
                           prompt_override=None, **kwargs):
            call_order.append(("run_stage", stage.value))
            if stage == Stage.PLAN:
                return _mock_stage(stage, {"approved": True, "approach": "x", "tasks_outline": []})
            if stage == Stage.PLAN_REVIEW:
                call_count["plan_review"] += 1
                if call_count["plan_review"] == 1:
                    return _mock_stage(stage, {
                        "outcome": "revise",
                        "issues": [critical_issue],
                        "summary": "Issues",
                    })
                return _mock_stage(stage, {"outcome": "approve", "issues": [], "summary": "OK"})
            if stage == Stage.COORDINATE:
                return _mock_stage(stage, {"beads_ids": [], "dependency_graph": {}})
            return _mock_stage(stage, {})

        from worca.state import status as status_mod
        original_save = status_mod.save_status

        def tracking_save(status, path):
            call_order.append(("save_status", None))
            return original_save(status, path)

        from worca.orchestrator.prompt_builder import PromptBuilder
        original_save_ctx = PromptBuilder.save_context

        def tracking_save_ctx(self, path=None):
            call_order.append(("save_context", None))
            return original_save_ctx(self, path)

        with patch("worca.orchestrator.runner.save_status", side_effect=tracking_save):
            with patch.object(PromptBuilder, "save_context", tracking_save_ctx):
                with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
                    with patch("worca.orchestrator.runner.create_branch"):
                        with patch("worca.orchestrator.runner._write_pid"):
                            with patch("worca.orchestrator.runner._remove_pid"):
                                run_pipeline(wr, settings_path=settings_path,
                                             status_path=status_path)

        # Find the second run_stage("plan") call — it's the loop-back re-run
        plan_indices = [i for i, (fn, s) in enumerate(call_order) if fn == "run_stage" and s == "plan"]
        assert len(plan_indices) >= 2, f"Expected PLAN to run twice, got {plan_indices}"
        second_plan_idx = plan_indices[1]

        # Find persist calls between the first plan_review and the second plan
        first_review_idx = next(
            i for i, (fn, s) in enumerate(call_order)
            if fn == "run_stage" and s == "plan_review"
        )
        between = call_order[first_review_idx:second_plan_idx]
        persist_fns = [fn for fn, _ in between if fn in ("save_status", "save_context")]
        assert "save_status" in persist_fns, (
            f"save_status must be called before PLAN re-runs; sequence: {between}"
        )
        assert "save_context" in persist_fns, (
            f"save_context must be called before PLAN re-runs; sequence: {between}"
        )


# ---------------------------------------------------------------------------
# Event emissions
# ---------------------------------------------------------------------------

class TestPlanReviewEvents:

    def test_stage_completed_emitted_on_approve(self, tmp_path):
        """STAGE_COMPLETED event emitted for plan_review on approve path."""
        from worca.events.types import STAGE_COMPLETED
        settings_path, status_path, wr = _make_runner(tmp_path)
        emitted_events = []

        def capturing_emit(ctx, event_type, payload, **kwargs):
            emitted_events.append((event_type, payload))
            return None

        def mock_run_stage(stage, context, settings_path, msize=1, iteration=1,
                           prompt_override=None, **kwargs):
            if stage == Stage.PLAN:
                return _mock_stage(stage, {"approved": True, "approach": "x", "tasks_outline": []})
            if stage == Stage.PLAN_REVIEW:
                return _mock_stage(stage, {"outcome": "approve", "issues": [], "summary": "Good"})
            if stage == Stage.COORDINATE:
                return _mock_stage(stage, {"beads_ids": [], "dependency_graph": {}})
            return _mock_stage(stage, {})

        with patch("worca.orchestrator.runner.emit_event", side_effect=capturing_emit):
            with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
                with patch("worca.orchestrator.runner.create_branch"):
                    with patch("worca.orchestrator.runner._write_pid"):
                        with patch("worca.orchestrator.runner._remove_pid"):
                            run_pipeline(wr, settings_path=settings_path, status_path=status_path)

        plan_review_completions = [
            (et, p) for et, p in emitted_events
            if et == STAGE_COMPLETED and isinstance(p, dict) and p.get("stage") == "plan_review"
        ]
        assert len(plan_review_completions) >= 1

    def test_loop_triggered_emitted_on_revise(self, tmp_path):
        """LOOP_TRIGGERED event emitted when plan_review revises back to plan."""
        from worca.events.types import LOOP_TRIGGERED
        settings_path, status_path, wr = _make_runner(tmp_path, plan_review_loops=2)
        emitted_events = []
        critical_issue = {"category": "risk", "severity": "critical", "description": "gap"}
        call_count = {"plan_review": 0}

        def capturing_emit(ctx, event_type, payload, **kwargs):
            emitted_events.append((event_type, payload))
            return None

        def mock_run_stage(stage, context, settings_path, msize=1, iteration=1,
                           prompt_override=None, **kwargs):
            if stage == Stage.PLAN:
                return _mock_stage(stage, {"approved": True, "approach": "x", "tasks_outline": []})
            if stage == Stage.PLAN_REVIEW:
                call_count["plan_review"] += 1
                if call_count["plan_review"] == 1:
                    return _mock_stage(stage, {
                        "outcome": "revise",
                        "issues": [critical_issue],
                        "summary": "Issues",
                    })
                return _mock_stage(stage, {"outcome": "approve", "issues": [], "summary": "OK"})
            if stage == Stage.COORDINATE:
                return _mock_stage(stage, {"beads_ids": [], "dependency_graph": {}})
            return _mock_stage(stage, {})

        with patch("worca.orchestrator.runner.emit_event", side_effect=capturing_emit):
            with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
                with patch("worca.orchestrator.runner.create_branch"):
                    with patch("worca.orchestrator.runner._write_pid"):
                        with patch("worca.orchestrator.runner._remove_pid"):
                            run_pipeline(wr, settings_path=settings_path, status_path=status_path)

        loop_triggered = [
            (et, p) for et, p in emitted_events
            if et == LOOP_TRIGGERED and isinstance(p, dict) and p.get("loop_key") == "plan_review"
        ]
        assert len(loop_triggered) == 1


# ---------------------------------------------------------------------------
# Stage disabled (default off)
# ---------------------------------------------------------------------------

class TestPlanReviewDisabled:

    def test_plan_review_disabled_skips_to_coordinate(self, tmp_path):
        """When plan_review disabled, PLAN transitions directly to COORDINATE."""
        settings_path, status_path, wr = _make_runner(tmp_path, plan_review_enabled=False)
        stages_run = []

        def mock_run_stage(stage, context, settings_path, msize=1, iteration=1,
                           prompt_override=None, **kwargs):
            stages_run.append(stage.value)
            if stage == Stage.PLAN:
                return _mock_stage(stage, {"approved": True, "approach": "x", "tasks_outline": []})
            if stage == Stage.COORDINATE:
                return _mock_stage(stage, {"beads_ids": [], "dependency_graph": {}})
            return _mock_stage(stage, {})

        with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
            with patch("worca.orchestrator.runner.create_branch"):
                with patch("worca.orchestrator.runner._write_pid"):
                    with patch("worca.orchestrator.runner._remove_pid"):
                        run_pipeline(wr, settings_path=settings_path, status_path=status_path)

        assert "plan_review" not in stages_run
        assert "plan" in stages_run
        assert "coordinate" in stages_run


# ---------------------------------------------------------------------------
# Schema validation / malformed output
# ---------------------------------------------------------------------------

class TestPlanReviewMalformedOutput:

    def test_completely_empty_result_treated_as_revise(self, tmp_path):
        """Empty dict result (no outcome, no issues) → fail-closed to revise."""
        settings_path, status_path, wr = _make_runner(tmp_path, plan_review_loops=2)
        stages_run = []
        call_count = {"plan_review": 0}

        def mock_run_stage(stage, context, settings_path, msize=1, iteration=1,
                           prompt_override=None, **kwargs):
            stages_run.append(stage.value)
            if stage == Stage.PLAN:
                return _mock_stage(stage, {"approved": True, "approach": "x", "tasks_outline": []})
            if stage == Stage.PLAN_REVIEW:
                call_count["plan_review"] += 1
                if call_count["plan_review"] == 1:
                    # Completely empty/malformed result
                    return _mock_stage(stage, {})
                return _mock_stage(stage, {"outcome": "approve", "issues": [], "summary": "OK"})
            if stage == Stage.COORDINATE:
                return _mock_stage(stage, {"beads_ids": [], "dependency_graph": {}})
            return _mock_stage(stage, {})

        with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
            with patch("worca.orchestrator.runner.create_branch"):
                with patch("worca.orchestrator.runner._write_pid"):
                    with patch("worca.orchestrator.runner._remove_pid"):
                        run_pipeline(wr, settings_path=settings_path, status_path=status_path)

        # Empty result → fail-closed revise → PLAN runs twice
        assert stages_run.count("plan") == 2

    def test_run_stage_exception_triggers_error_handler(self, tmp_path):
        """Exception from run_stage during PLAN_REVIEW → error handler path."""
        settings_path, status_path, wr = _make_runner(tmp_path, plan_review_loops=2)
        call_count = {"plan_review": 0}

        def mock_run_stage(stage, context, settings_path, msize=1, iteration=1,
                           prompt_override=None, **kwargs):
            if stage == Stage.PLAN:
                return _mock_stage(stage, {"approved": True, "approach": "x", "tasks_outline": []})
            if stage == Stage.PLAN_REVIEW:
                call_count["plan_review"] += 1
                if call_count["plan_review"] == 1:
                    raise RuntimeError("Schema validation failed: missing required field")
                return _mock_stage(stage, {"outcome": "approve", "issues": [], "summary": "OK"})
            if stage == Stage.COORDINATE:
                return _mock_stage(stage, {"beads_ids": [], "dependency_graph": {}})
            return _mock_stage(stage, {})

        # Pipeline should handle the error (via error handler / retry) or propagate.
        # With circuit breaker disabled (default), the error is recorded and re-raised.
        from worca.orchestrator.runner import PipelineError
        with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
            with patch("worca.orchestrator.runner.create_branch"):
                with patch("worca.orchestrator.runner._write_pid"):
                    with patch("worca.orchestrator.runner._remove_pid"):
                        with pytest.raises((PipelineError, RuntimeError)):
                            run_pipeline(wr, settings_path=settings_path,
                                         status_path=status_path)

    def test_unrecognized_outcome_treated_as_approve(self, tmp_path):
        """Unrecognized outcome value falls to approve path (not revise).

        The fail-closed default only applies to *missing* outcome field
        (via .get("outcome", "revise")). A present but unrecognized value
        is not "revise", so it takes the else/approve path.
        """
        settings_path, status_path, wr = _make_runner(tmp_path, plan_review_loops=2)
        stages_run = []

        def mock_run_stage(stage, context, settings_path, msize=1, iteration=1,
                           prompt_override=None, **kwargs):
            stages_run.append(stage.value)
            if stage == Stage.PLAN:
                return _mock_stage(stage, {"approved": True, "approach": "x", "tasks_outline": []})
            if stage == Stage.PLAN_REVIEW:
                return _mock_stage(stage, {
                    "outcome": "maybe",
                    "issues": [],
                    "summary": "Unsure",
                })
            if stage == Stage.COORDINATE:
                return _mock_stage(stage, {"beads_ids": [], "dependency_graph": {}})
            return _mock_stage(stage, {})

        with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
            with patch("worca.orchestrator.runner.create_branch"):
                with patch("worca.orchestrator.runner._write_pid"):
                    with patch("worca.orchestrator.runner._remove_pid"):
                        run_pipeline(wr, settings_path=settings_path, status_path=status_path)

        # Unrecognized outcome → not "revise" → approve path → PLAN runs once
        assert stages_run.count("plan") == 1
        assert "coordinate" in stages_run
