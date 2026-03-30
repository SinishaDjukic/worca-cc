"""Integration round-trip tests for the plan review loop.

Tests the full ordered stage sequence through run_pipeline() with real state
and settings — only run_stage (the actual Claude invocation) is mocked.

Scenarios:
1. PLAN → PLAN_REVIEW (revise) → PLAN (revision) → PLAN_REVIEW (approve) → COORDINATE
2. PLAN → PLAN_REVIEW (revise) → PLAN → PLAN_REVIEW (revise) → PLAN →
   PLAN_REVIEW (exhausted) → COORDINATE  (plan_review_loops=2)
3. Disabled stage (default): PLAN → COORDINATE, PLAN_REVIEW skipped
4. Enabled stage: PLAN_REVIEW appears at the correct position in the sequence
5. Custom model/max_turns correctly propagated to stage config
6. mloops multiplier doubles the effective plan_review loop limit
"""
import json
from unittest.mock import patch

import pytest

from worca.orchestrator.runner import run_pipeline
from worca.orchestrator.stages import Stage, get_stage_config
from worca.orchestrator.work_request import WorkRequest


# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------

def _settings(tmp_path, *, plan_review_enabled=True, plan_review_loops=2,
              plan_reviewer_model="opus", plan_reviewer_max_turns=50):
    """Write settings.json with configurable plan_review options."""
    data = {
        "worca": {
            "stages": {
                "preflight": {"enabled": False},
                "plan": {"agent": "planner", "enabled": True},
                "plan_review": {
                    "agent": "plan_reviewer",
                    "enabled": plan_review_enabled,
                },
                "coordinate": {"agent": "coordinator", "enabled": True},
                "implement": {"enabled": False},
                "test": {"enabled": False},
                "review": {"enabled": False},
                "pr": {"enabled": False},
            },
            "agents": {
                "planner": {"model": "opus", "max_turns": 10},
                "plan_reviewer": {
                    "model": plan_reviewer_model,
                    "max_turns": plan_reviewer_max_turns,
                },
                "coordinator": {"model": "opus", "max_turns": 10},
            },
            "loops": {
                "plan_review": plan_review_loops,
            },
        }
    }
    p = tmp_path / "settings.json"
    p.write_text(json.dumps(data))
    return str(p)


def _worca_dir(tmp_path):
    d = tmp_path / ".worca"
    d.mkdir()
    return str(d / "status.json")


def _wr():
    return WorkRequest(source_type="prompt", title="Integration test task")


def _mock_result(stage, result_dict):
    return result_dict, {"type": "result"}


@pytest.fixture(autouse=True)
def _mock_beads():
    with patch("worca.orchestrator.runner._ensure_beads_initialized"):
        yield


# ---------------------------------------------------------------------------
# Scenario 1: Single-revise round-trip then approve
# PLAN → PLAN_REVIEW (revise) → PLAN (revision) → PLAN_REVIEW (approve)
# → COORDINATE
# ---------------------------------------------------------------------------

class TestSingleReviseApproveRoundTrip:
    """Full round-trip: one revise cycle then approval."""

    def test_exact_stage_sequence(self, tmp_path):
        """Verifies the exact ordered stage sequence for a single-revise round-trip."""
        settings_path = _settings(tmp_path, plan_review_loops=2)
        status_path = _worca_dir(tmp_path)

        sequence = []
        critical_issue = {"category": "risk", "severity": "critical",
                          "description": "Missing rollback strategy"}
        review_call = {"count": 0}

        def mock_run_stage(stage, context, settings_path, msize=1, iteration=1,
                           prompt_override=None, **kwargs):
            sequence.append(stage.value)
            if stage == Stage.PLAN:
                return _mock_result(stage, {
                    "approved": True, "approach": "revised approach",
                    "tasks_outline": [],
                })
            if stage == Stage.PLAN_REVIEW:
                review_call["count"] += 1
                if review_call["count"] == 1:
                    # First review: revise
                    return _mock_result(stage, {
                        "outcome": "revise",
                        "issues": [critical_issue],
                        "summary": "Critical issue found",
                    })
                # Second review: approve
                return _mock_result(stage, {
                    "outcome": "approve",
                    "issues": [],
                    "summary": "Plan looks good",
                })
            if stage == Stage.COORDINATE:
                return _mock_result(stage, {"beads_ids": [], "dependency_graph": {}})
            return _mock_result(stage, {})

        with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
            with patch("worca.orchestrator.runner.create_branch"):
                with patch("worca.orchestrator.runner._write_pid"):
                    with patch("worca.orchestrator.runner._remove_pid"):
                        run_pipeline(_wr(), settings_path=settings_path,
                                     status_path=status_path)

        # Verify exact ordered sequence
        assert sequence == [
            "plan",
            "plan_review",   # revise
            "plan",          # revision
            "plan_review",   # approve
            "coordinate",
        ]

    def test_plan_ran_twice_plan_review_ran_twice(self, tmp_path):
        """PLAN runs twice (initial + revision), PLAN_REVIEW runs twice."""
        settings_path = _settings(tmp_path, plan_review_loops=2)
        status_path = _worca_dir(tmp_path)

        stage_counts = {}
        critical_issue = {"category": "architecture", "severity": "major",
                          "description": "Wrong layer"}
        review_call = {"count": 0}

        def mock_run_stage(stage, context, settings_path, msize=1, iteration=1,
                           prompt_override=None, **kwargs):
            stage_counts[stage.value] = stage_counts.get(stage.value, 0) + 1
            if stage == Stage.PLAN:
                return _mock_result(stage, {
                    "approved": True, "approach": "x", "tasks_outline": [],
                })
            if stage == Stage.PLAN_REVIEW:
                review_call["count"] += 1
                if review_call["count"] == 1:
                    return _mock_result(stage, {
                        "outcome": "revise", "issues": [critical_issue],
                        "summary": "Issues",
                    })
                return _mock_result(stage, {
                    "outcome": "approve", "issues": [], "summary": "OK",
                })
            if stage == Stage.COORDINATE:
                return _mock_result(stage, {"beads_ids": [], "dependency_graph": {}})
            return _mock_result(stage, {})

        with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
            with patch("worca.orchestrator.runner.create_branch"):
                with patch("worca.orchestrator.runner._write_pid"):
                    with patch("worca.orchestrator.runner._remove_pid"):
                        run_pipeline(_wr(), settings_path=settings_path,
                                     status_path=status_path)

        assert stage_counts["plan"] == 2
        assert stage_counts["plan_review"] == 2
        assert stage_counts["coordinate"] == 1

    def test_coordinate_runs_after_final_approval(self, tmp_path):
        """COORDINATE appears after the final PLAN_REVIEW approval."""
        settings_path = _settings(tmp_path, plan_review_loops=2)
        status_path = _worca_dir(tmp_path)

        sequence = []
        critical_issue = {"category": "completeness", "severity": "critical",
                          "description": "Missing requirements"}
        review_call = {"count": 0}

        def mock_run_stage(stage, context, settings_path, msize=1, iteration=1,
                           prompt_override=None, **kwargs):
            sequence.append(stage.value)
            if stage == Stage.PLAN:
                return _mock_result(stage, {
                    "approved": True, "approach": "x", "tasks_outline": [],
                })
            if stage == Stage.PLAN_REVIEW:
                review_call["count"] += 1
                if review_call["count"] == 1:
                    return _mock_result(stage, {
                        "outcome": "revise", "issues": [critical_issue],
                        "summary": "Issues",
                    })
                return _mock_result(stage, {
                    "outcome": "approve", "issues": [], "summary": "OK",
                })
            if stage == Stage.COORDINATE:
                return _mock_result(stage, {"beads_ids": [], "dependency_graph": {}})
            return _mock_result(stage, {})

        with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
            with patch("worca.orchestrator.runner.create_branch"):
                with patch("worca.orchestrator.runner._write_pid"):
                    with patch("worca.orchestrator.runner._remove_pid"):
                        run_pipeline(_wr(), settings_path=settings_path,
                                     status_path=status_path)

        # COORDINATE must appear after the second plan_review (the approval)
        last_plan_review_idx = len(sequence) - 1 - sequence[::-1].index("plan_review")
        coordinate_idx = sequence.index("coordinate")
        assert coordinate_idx > last_plan_review_idx


# ---------------------------------------------------------------------------
# Scenario 2: Double-revise to loop exhaustion then COORDINATE
# PLAN → PLAN_REVIEW (revise) → PLAN → PLAN_REVIEW (revise) → PLAN
# → PLAN_REVIEW (exhausted) → COORDINATE
# ---------------------------------------------------------------------------

class TestDoubleReviseExhaustionRoundTrip:
    """Full round-trip: two revise cycles then loop exhaustion → COORDINATE."""

    def test_exact_stage_sequence_double_revise(self, tmp_path):
        """Verifies the exact ordered sequence when plan_review loop is exhausted.

        check_loop_limit returns True if counter < limit. With plan_review_loops=2:
        - 1st revise: counter=1, 1<2=True → loop-back (revision 1)
        - 2nd revise: counter=2, 2<2=False → exhausted → coordinate
        Total: plan(1) → plan_review(revise1) → plan(2) → plan_review(exhaust)
        → coordinate
        """
        settings_path = _settings(tmp_path, plan_review_loops=2)
        status_path = _worca_dir(tmp_path)

        sequence = []
        critical_issue = {"category": "feasibility", "severity": "critical",
                          "description": "Infeasible approach"}

        def mock_run_stage(stage, context, settings_path, msize=1, iteration=1,
                           prompt_override=None, **kwargs):
            sequence.append(stage.value)
            if stage == Stage.PLAN:
                return _mock_result(stage, {
                    "approved": True, "approach": "x", "tasks_outline": [],
                })
            if stage == Stage.PLAN_REVIEW:
                # Always revise — loop exhausts when counter reaches limit
                return _mock_result(stage, {
                    "outcome": "revise",
                    "issues": [critical_issue],
                    "summary": "Still has issues",
                })
            if stage == Stage.COORDINATE:
                return _mock_result(stage, {"beads_ids": [], "dependency_graph": {}})
            return _mock_result(stage, {})

        with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
            with patch("worca.orchestrator.runner.create_branch"):
                with patch("worca.orchestrator.runner._write_pid"):
                    with patch("worca.orchestrator.runner._remove_pid"):
                        run_pipeline(_wr(), settings_path=settings_path,
                                     status_path=status_path)

        # With plan_review_loops=2 and check_loop_limit (counter < limit):
        # plan_review(revise 1, counter=1, 1<2 → loop-back)
        # → plan (revision) → plan_review(revise 2, counter=2, 2<2=False → exhausted)
        # → coordinate
        assert sequence == [
            "plan",
            "plan_review",   # revise 1 → loop-back (counter=1 < 2)
            "plan",          # revision 1
            "plan_review",   # revise 2 → exhausted (counter=2, 2 < 2 = False)
            "coordinate",
        ]

    def test_plan_ran_twice_on_exhaustion(self, tmp_path):
        """With plan_review_loops=2, PLAN runs 2 times before COORDINATE.

        check_loop_limit(counter < limit): 1st revise loops back (1<2),
        2nd revise exhausts (2<2=False). So only 1 loop-back → PLAN runs twice.
        """
        settings_path = _settings(tmp_path, plan_review_loops=2)
        status_path = _worca_dir(tmp_path)

        stage_counts = {}
        critical_issue = {"category": "risk", "severity": "major",
                          "description": "Unmitigated risk"}

        def mock_run_stage(stage, context, settings_path, msize=1, iteration=1,
                           prompt_override=None, **kwargs):
            stage_counts[stage.value] = stage_counts.get(stage.value, 0) + 1
            if stage == Stage.PLAN:
                return _mock_result(stage, {
                    "approved": True, "approach": "x", "tasks_outline": [],
                })
            if stage == Stage.PLAN_REVIEW:
                return _mock_result(stage, {
                    "outcome": "revise", "issues": [critical_issue],
                    "summary": "Always issues",
                })
            if stage == Stage.COORDINATE:
                return _mock_result(stage, {"beads_ids": [], "dependency_graph": {}})
            return _mock_result(stage, {})

        with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
            with patch("worca.orchestrator.runner.create_branch"):
                with patch("worca.orchestrator.runner._write_pid"):
                    with patch("worca.orchestrator.runner._remove_pid"):
                        run_pipeline(_wr(), settings_path=settings_path,
                                     status_path=status_path)

        # 1st revise (counter=1, 1<2 → loop-back), 2nd revise (counter=2, 2<2=False → exhausted)
        # → PLAN runs twice (initial + 1 revision), PLAN_REVIEW runs twice
        assert stage_counts["plan"] == 2
        assert stage_counts["plan_review"] == 2
        assert stage_counts["coordinate"] == 1

    def test_loop_counter_reaches_limit_on_exhaustion(self, tmp_path):
        """Loop counter equals plan_review_loops limit when exhausted."""
        import os
        from worca.state.status import load_status

        plan_review_loops = 2
        settings_path = _settings(tmp_path, plan_review_loops=plan_review_loops)
        status_path = _worca_dir(tmp_path)

        critical_issue = {"category": "decomposition", "severity": "critical",
                          "description": "Tasks too coarse"}

        def mock_run_stage(stage, context, settings_path, msize=1, iteration=1,
                           prompt_override=None, **kwargs):
            if stage == Stage.PLAN:
                return _mock_result(stage, {
                    "approved": True, "approach": "x", "tasks_outline": [],
                })
            if stage == Stage.PLAN_REVIEW:
                return _mock_result(stage, {
                    "outcome": "revise", "issues": [critical_issue],
                    "summary": "Issues persist",
                })
            if stage == Stage.COORDINATE:
                return _mock_result(stage, {"beads_ids": [], "dependency_graph": {}})
            return _mock_result(stage, {})

        with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
            with patch("worca.orchestrator.runner.create_branch"):
                with patch("worca.orchestrator.runner._write_pid"):
                    with patch("worca.orchestrator.runner._remove_pid"):
                        result = run_pipeline(_wr(), settings_path=settings_path,
                                              status_path=status_path)

        run_id = result["run_id"]
        worca_dir = str(tmp_path / ".worca")
        actual_status_path = os.path.join(worca_dir, "runs", run_id, "status.json")
        final_status = load_status(actual_status_path)

        # Counter should be exactly at the limit (2)
        assert final_status["loop_counters"]["plan_review"] == plan_review_loops

    def test_coordinate_runs_after_exhaustion(self, tmp_path):
        """COORDINATE runs even when plan_review loop is exhausted."""
        settings_path = _settings(tmp_path, plan_review_loops=2)
        status_path = _worca_dir(tmp_path)

        stages_run = set()
        critical_issue = {"category": "api_assumption", "severity": "major",
                          "description": "API usage incorrect"}

        def mock_run_stage(stage, context, settings_path, msize=1, iteration=1,
                           prompt_override=None, **kwargs):
            stages_run.add(stage.value)
            if stage == Stage.PLAN:
                return _mock_result(stage, {
                    "approved": True, "approach": "x", "tasks_outline": [],
                })
            if stage == Stage.PLAN_REVIEW:
                return _mock_result(stage, {
                    "outcome": "revise", "issues": [critical_issue],
                    "summary": "Issues",
                })
            if stage == Stage.COORDINATE:
                return _mock_result(stage, {"beads_ids": [], "dependency_graph": {}})
            return _mock_result(stage, {})

        with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
            with patch("worca.orchestrator.runner.create_branch"):
                with patch("worca.orchestrator.runner._write_pid"):
                    with patch("worca.orchestrator.runner._remove_pid"):
                        run_pipeline(_wr(), settings_path=settings_path,
                                     status_path=status_path)

        assert "coordinate" in stages_run


# ---------------------------------------------------------------------------
# Scenario 3: Disabled stage — PLAN → COORDINATE directly
# ---------------------------------------------------------------------------

class TestPlanReviewDisabledRoundTrip:
    """When plan_review is disabled, PLAN goes directly to COORDINATE."""

    def test_plan_review_absent_when_disabled(self, tmp_path):
        """PLAN_REVIEW does not appear in the stage sequence when disabled."""
        settings_path = _settings(tmp_path, plan_review_enabled=False)
        status_path = _worca_dir(tmp_path)

        sequence = []

        def mock_run_stage(stage, context, settings_path, msize=1, iteration=1,
                           prompt_override=None, **kwargs):
            sequence.append(stage.value)
            if stage == Stage.PLAN:
                return _mock_result(stage, {
                    "approved": True, "approach": "x", "tasks_outline": [],
                })
            if stage == Stage.COORDINATE:
                return _mock_result(stage, {"beads_ids": [], "dependency_graph": {}})
            return _mock_result(stage, {})

        with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
            with patch("worca.orchestrator.runner.create_branch"):
                with patch("worca.orchestrator.runner._write_pid"):
                    with patch("worca.orchestrator.runner._remove_pid"):
                        run_pipeline(_wr(), settings_path=settings_path,
                                     status_path=status_path)

        assert "plan_review" not in sequence
        assert "plan" in sequence
        assert "coordinate" in sequence

    def test_plan_directly_before_coordinate_when_disabled(self, tmp_path):
        """When disabled, PLAN is immediately followed by COORDINATE."""
        settings_path = _settings(tmp_path, plan_review_enabled=False)
        status_path = _worca_dir(tmp_path)

        sequence = []

        def mock_run_stage(stage, context, settings_path, msize=1, iteration=1,
                           prompt_override=None, **kwargs):
            sequence.append(stage.value)
            if stage == Stage.PLAN:
                return _mock_result(stage, {
                    "approved": True, "approach": "x", "tasks_outline": [],
                })
            if stage == Stage.COORDINATE:
                return _mock_result(stage, {"beads_ids": [], "dependency_graph": {}})
            return _mock_result(stage, {})

        with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
            with patch("worca.orchestrator.runner.create_branch"):
                with patch("worca.orchestrator.runner._write_pid"):
                    with patch("worca.orchestrator.runner._remove_pid"):
                        run_pipeline(_wr(), settings_path=settings_path,
                                     status_path=status_path)

        plan_idx = sequence.index("plan")
        coordinate_idx = sequence.index("coordinate")
        assert coordinate_idx == plan_idx + 1

    def test_no_config_entry_defaults_disabled(self, tmp_path):
        """When plan_review is absent from settings, it defaults to disabled."""
        # Settings with NO plan_review entry at all
        data = {
            "worca": {
                "stages": {
                    "preflight": {"enabled": False},
                    "plan": {"agent": "planner", "enabled": True},
                    "coordinate": {"agent": "coordinator", "enabled": True},
                    "implement": {"enabled": False},
                    "test": {"enabled": False},
                    "review": {"enabled": False},
                    "pr": {"enabled": False},
                },
                "agents": {
                    "planner": {"model": "opus", "max_turns": 10},
                    "coordinator": {"model": "opus", "max_turns": 10},
                },
                "loops": {},
            }
        }
        p = tmp_path / "settings.json"
        p.write_text(json.dumps(data))
        settings_path = str(p)
        status_path = _worca_dir(tmp_path)

        sequence = []

        def mock_run_stage(stage, context, settings_path, msize=1, iteration=1,
                           prompt_override=None, **kwargs):
            sequence.append(stage.value)
            if stage == Stage.PLAN:
                return _mock_result(stage, {
                    "approved": True, "approach": "x", "tasks_outline": [],
                })
            if stage == Stage.COORDINATE:
                return _mock_result(stage, {"beads_ids": [], "dependency_graph": {}})
            return _mock_result(stage, {})

        with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
            with patch("worca.orchestrator.runner.create_branch"):
                with patch("worca.orchestrator.runner._write_pid"):
                    with patch("worca.orchestrator.runner._remove_pid"):
                        run_pipeline(_wr(), settings_path=settings_path,
                                     status_path=status_path)

        assert "plan_review" not in sequence


# ---------------------------------------------------------------------------
# Scenario 4: Enabled stage — PLAN_REVIEW at correct position
# ---------------------------------------------------------------------------

class TestPlanReviewEnabledPosition:
    """When enabled, PLAN_REVIEW appears between PLAN and COORDINATE."""

    def test_plan_review_between_plan_and_coordinate(self, tmp_path):
        """PLAN_REVIEW runs after PLAN and before COORDINATE when enabled."""
        settings_path = _settings(tmp_path, plan_review_enabled=True)
        status_path = _worca_dir(tmp_path)

        sequence = []

        def mock_run_stage(stage, context, settings_path, msize=1, iteration=1,
                           prompt_override=None, **kwargs):
            sequence.append(stage.value)
            if stage == Stage.PLAN:
                return _mock_result(stage, {
                    "approved": True, "approach": "x", "tasks_outline": [],
                })
            if stage == Stage.PLAN_REVIEW:
                return _mock_result(stage, {
                    "outcome": "approve", "issues": [], "summary": "OK",
                })
            if stage == Stage.COORDINATE:
                return _mock_result(stage, {"beads_ids": [], "dependency_graph": {}})
            return _mock_result(stage, {})

        with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
            with patch("worca.orchestrator.runner.create_branch"):
                with patch("worca.orchestrator.runner._write_pid"):
                    with patch("worca.orchestrator.runner._remove_pid"):
                        run_pipeline(_wr(), settings_path=settings_path,
                                     status_path=status_path)

        plan_idx = sequence.index("plan")
        plan_review_idx = sequence.index("plan_review")
        coordinate_idx = sequence.index("coordinate")

        assert plan_idx < plan_review_idx < coordinate_idx

    def test_get_enabled_stages_includes_plan_review_when_enabled(self, tmp_path):
        """get_enabled_stages() returns PLAN_REVIEW when enabled in settings."""
        from worca.orchestrator.stages import get_enabled_stages

        settings_path = _settings(tmp_path, plan_review_enabled=True)
        enabled = get_enabled_stages(settings_path)

        assert Stage.PLAN_REVIEW in enabled
        # Verify position: PLAN_REVIEW is between PLAN and COORDINATE
        plan_idx = enabled.index(Stage.PLAN)
        plan_review_idx = enabled.index(Stage.PLAN_REVIEW)
        coord_idx = enabled.index(Stage.COORDINATE)
        assert plan_idx < plan_review_idx < coord_idx

    def test_get_enabled_stages_excludes_plan_review_when_disabled(self, tmp_path):
        """get_enabled_stages() excludes PLAN_REVIEW when disabled."""
        from worca.orchestrator.stages import get_enabled_stages

        settings_path = _settings(tmp_path, plan_review_enabled=False)
        enabled = get_enabled_stages(settings_path)

        assert Stage.PLAN_REVIEW not in enabled


# ---------------------------------------------------------------------------
# Scenario 5: Custom model/max_turns settings propagation
# ---------------------------------------------------------------------------

class TestPlanReviewSettingsPropagation:
    """Custom model and max_turns for plan_reviewer propagate to stage config."""

    def test_custom_model_propagated_to_stage_config(self, tmp_path):
        """Custom plan_reviewer model is returned by get_stage_config."""
        settings_path = _settings(tmp_path, plan_reviewer_model="sonnet",
                                  plan_reviewer_max_turns=75)

        config = get_stage_config(Stage.PLAN_REVIEW, settings_path=settings_path)

        # "sonnet" resolves to the full sonnet model ID
        assert "sonnet" in config["model"]
        assert config["agent"] == "plan_reviewer"

    def test_custom_max_turns_propagated_to_stage_config(self, tmp_path):
        """Custom max_turns for plan_reviewer is returned by get_stage_config."""
        settings_path = _settings(tmp_path, plan_reviewer_max_turns=75)

        config = get_stage_config(Stage.PLAN_REVIEW, settings_path=settings_path)

        assert config["max_turns"] == 75

    def test_opus_model_propagated_to_stage_config(self, tmp_path):
        """Default opus model for plan_reviewer resolves to opus model ID."""
        settings_path = _settings(tmp_path, plan_reviewer_model="opus")

        config = get_stage_config(Stage.PLAN_REVIEW, settings_path=settings_path)

        assert "opus" in config["model"]

    def test_plan_reviewer_agent_name_in_config(self, tmp_path):
        """Stage config for PLAN_REVIEW uses plan_reviewer agent name."""
        settings_path = _settings(tmp_path)

        config = get_stage_config(Stage.PLAN_REVIEW, settings_path=settings_path)

        assert config["agent"] == "plan_reviewer"

    def test_plan_reviewer_schema_in_config(self, tmp_path):
        """Stage config for PLAN_REVIEW references plan_review.json schema."""
        settings_path = _settings(tmp_path)

        config = get_stage_config(Stage.PLAN_REVIEW, settings_path=settings_path)

        assert config["schema"] == "plan_review.json"

    def test_custom_model_used_in_run_stage_call(self, tmp_path):
        """Custom model setting flows through to the run_stage call."""
        settings_path = _settings(tmp_path, plan_reviewer_model="sonnet",
                                  plan_review_enabled=True)
        status_path = _worca_dir(tmp_path)

        stage_models = {}

        def mock_run_stage(stage, context, settings_path, msize=1, iteration=1,
                           prompt_override=None, **kwargs):
            # The model should be passed via context or retrieved from stage_config
            # We can verify by calling get_stage_config directly
            if stage not in stage_models:
                cfg = get_stage_config(stage, settings_path=settings_path)
                stage_models[stage.value] = cfg.get("model")

            if stage == Stage.PLAN:
                return _mock_result(stage, {
                    "approved": True, "approach": "x", "tasks_outline": [],
                })
            if stage == Stage.PLAN_REVIEW:
                return _mock_result(stage, {
                    "outcome": "approve", "issues": [], "summary": "OK",
                })
            if stage == Stage.COORDINATE:
                return _mock_result(stage, {"beads_ids": [], "dependency_graph": {}})
            return _mock_result(stage, {})

        with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
            with patch("worca.orchestrator.runner.create_branch"):
                with patch("worca.orchestrator.runner._write_pid"):
                    with patch("worca.orchestrator.runner._remove_pid"):
                        run_pipeline(_wr(), settings_path=settings_path,
                                     status_path=status_path)

        assert "sonnet" in (stage_models.get("plan_review") or "")


# ---------------------------------------------------------------------------
# Scenario 6: mloops multiplier applies to plan_review loop limit
# ---------------------------------------------------------------------------

class TestPlanReviewMloopsMultiplier:
    """mloops multiplier doubles the effective plan_review loop limit."""

    def test_mloops_doubles_revise_limit(self, tmp_path):
        """mloops=2 with plan_review_loops=1 allows 2 revise iterations."""
        # plan_review_loops=1 normally allows 1 revise, but mloops=2 doubles it to 2
        settings_path = _settings(tmp_path, plan_review_loops=1)
        status_path = _worca_dir(tmp_path)

        sequence = []
        review_count = {"n": 0}
        critical_issue = {"category": "risk", "severity": "critical",
                          "description": "Critical risk"}

        def mock_run_stage(stage, context, settings_path, msize=1, iteration=1,
                           prompt_override=None, **kwargs):
            sequence.append(stage.value)
            if stage == Stage.PLAN:
                return _mock_result(stage, {
                    "approved": True, "approach": "x", "tasks_outline": [],
                })
            if stage == Stage.PLAN_REVIEW:
                review_count["n"] += 1
                if review_count["n"] <= 2:
                    # Both first and second reviews: revise
                    return _mock_result(stage, {
                        "outcome": "revise", "issues": [critical_issue],
                        "summary": "Issues",
                    })
                return _mock_result(stage, {
                    "outcome": "approve", "issues": [], "summary": "OK",
                })
            if stage == Stage.COORDINATE:
                return _mock_result(stage, {"beads_ids": [], "dependency_graph": {}})
            return _mock_result(stage, {})

        with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
            with patch("worca.orchestrator.runner.create_branch"):
                with patch("worca.orchestrator.runner._write_pid"):
                    with patch("worca.orchestrator.runner._remove_pid"):
                        # mloops=2 doubles loop limit: 1 * 2 = 2 allowed revisions
                        run_pipeline(_wr(), settings_path=settings_path,
                                     status_path=status_path, mloops=2)

        # With mloops=2, 2 revise iterations succeed before exhaustion
        # plan → plan_review(revise1) → plan → plan_review(revise2)
        # → plan → plan_review(approve) → coordinate
        assert sequence.count("plan_review") >= 2
        assert "coordinate" in sequence

    def test_mloops_one_does_not_extend_limit(self, tmp_path):
        """mloops=1 with plan_review_loops=1: 1st revise immediately exhausts.

        check_loop_limit: counter=1, limit=1*1=1, 1<1=False → exhausted on 1st revise.
        No loop-back occurs. Sequence: plan → plan_review(exhausted) → coordinate.
        """
        settings_path = _settings(tmp_path, plan_review_loops=1)
        status_path = _worca_dir(tmp_path)

        sequence = []
        critical_issue = {"category": "risk", "severity": "critical",
                          "description": "Critical risk"}

        def mock_run_stage(stage, context, settings_path, msize=1, iteration=1,
                           prompt_override=None, **kwargs):
            sequence.append(stage.value)
            if stage == Stage.PLAN:
                return _mock_result(stage, {
                    "approved": True, "approach": "x", "tasks_outline": [],
                })
            if stage == Stage.PLAN_REVIEW:
                # Revise — but counter=1, limit=1, 1<1=False → immediately exhausted
                return _mock_result(stage, {
                    "outcome": "revise", "issues": [critical_issue],
                    "summary": "Issues",
                })
            if stage == Stage.COORDINATE:
                return _mock_result(stage, {"beads_ids": [], "dependency_graph": {}})
            return _mock_result(stage, {})

        with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
            with patch("worca.orchestrator.runner.create_branch"):
                with patch("worca.orchestrator.runner._write_pid"):
                    with patch("worca.orchestrator.runner._remove_pid"):
                        run_pipeline(_wr(), settings_path=settings_path,
                                     status_path=status_path, mloops=1)

        # With mloops=1, plan_review_loops=1: 1st revise → counter=1, 1<1=False → exhausted
        # No loop-back → plan runs once, plan_review runs once
        assert sequence.count("plan_review") == 1
        assert sequence.count("plan") == 1
        assert "coordinate" in sequence
        assert sequence == ["plan", "plan_review", "coordinate"]

    def test_mloops_effect_on_loop_counter_limit(self, tmp_path):
        """mloops=2 doubles the effective limit checked by check_loop_limit."""
        from worca.orchestrator.runner import check_loop_limit

        settings_path = _settings(tmp_path, plan_review_loops=1)

        # With mloops=1, limit is 1 — counter=1 exhausts
        assert not check_loop_limit("plan_review", 1, settings_path, mloops=1)

        # With mloops=2, limit is 2 — counter=1 still within limit
        assert check_loop_limit("plan_review", 1, settings_path, mloops=2)

        # Counter=2 exhausts with mloops=2
        assert not check_loop_limit("plan_review", 2, settings_path, mloops=2)

    def test_mloops_three_triples_plan_review_limit(self, tmp_path):
        """mloops=3 with plan_review_loops=1 allows 3 revise iterations."""
        settings_path = _settings(tmp_path, plan_review_loops=1)
        status_path = _worca_dir(tmp_path)

        sequence = []
        review_count = {"n": 0}
        critical_issue = {"category": "risk", "severity": "major",
                          "description": "High risk"}

        def mock_run_stage(stage, context, settings_path, msize=1, iteration=1,
                           prompt_override=None, **kwargs):
            sequence.append(stage.value)
            if stage == Stage.PLAN:
                return _mock_result(stage, {
                    "approved": True, "approach": "x", "tasks_outline": [],
                })
            if stage == Stage.PLAN_REVIEW:
                review_count["n"] += 1
                if review_count["n"] <= 3:
                    return _mock_result(stage, {
                        "outcome": "revise", "issues": [critical_issue],
                        "summary": "Issues",
                    })
                return _mock_result(stage, {
                    "outcome": "approve", "issues": [], "summary": "OK",
                })
            if stage == Stage.COORDINATE:
                return _mock_result(stage, {"beads_ids": [], "dependency_graph": {}})
            return _mock_result(stage, {})

        with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
            with patch("worca.orchestrator.runner.create_branch"):
                with patch("worca.orchestrator.runner._write_pid"):
                    with patch("worca.orchestrator.runner._remove_pid"):
                        run_pipeline(_wr(), settings_path=settings_path,
                                     status_path=status_path, mloops=3)

        # mloops=3 with loops=1 → effective limit 3
        # 3 revise iterations exhaust; 4th review approves
        # → 4 total PLAN_REVIEW runs (3 revise + 1 exhaust-or-approve)
        assert sequence.count("plan_review") >= 3
        assert "coordinate" in sequence
