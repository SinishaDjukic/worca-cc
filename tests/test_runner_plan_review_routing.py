"""Tests for W-059-5: plan-review mode-aware template routing in runner.py.

Verifies two routing seams driven by resolve_plan_review_mode():
1. Agent .md selection: plan_editor.md in review_and_edit mode
2. Block selection: plan-edit block in review_and_edit mode
"""
import json
import os
from unittest.mock import patch

import pytest

from worca.orchestrator.flow import DEFAULT_STAGE_BLOCKS
from worca.orchestrator.runner import run_pipeline
from worca.orchestrator.stages import Stage
from worca.orchestrator.work_request import WorkRequest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _settings(tmp_path, mode=None, enforce=None, plan_review_enabled=True):
    """Write settings.json with optional plan_review mode/enforce."""
    stages = {
        "plan": {"agent": "planner", "enabled": True},
        "plan_review": {"agent": "plan_reviewer", "enabled": plan_review_enabled},
        "coordinate": {"agent": "coordinator", "enabled": True},
        "implement": {"agent": "implementer", "enabled": False},
        "test": {"agent": "tester", "enabled": False},
        "review": {"agent": "guardian", "enabled": False},
        "pr": {"agent": "guardian", "enabled": False},
    }
    if mode is not None:
        stages["plan_review"]["mode"] = mode
    data = {
        "worca": {
            "stages": stages,
            "agents": {
                "planner": {"model": "opus", "max_turns": 10},
                "plan_reviewer": {"model": "opus", "max_turns": 20},
                "coordinator": {"model": "opus", "max_turns": 10},
            },
            "loops": {"plan_review": 2},
        }
    }
    if enforce is not None:
        data["worca"]["governance"] = {"plan_review_enforce": enforce}
    f = tmp_path / "settings.json"
    f.write_text(json.dumps(data))
    return str(f)


def _worca(tmp_path):
    d = tmp_path / ".worca"
    d.mkdir()
    return str(d), str(d / "status.json")


def _wr(title="Test task"):
    return WorkRequest(source_type="prompt", title=title)


def _mock_stage(stage, result):
    return result, {"type": "result"}


def _scaffold_runtime_agents(tmp_path, monkeypatch):
    """Create a minimal ``.claude/worca/agents/core`` and chdir into it.

    The runner renders agent templates from this CWD-relative dir into
    ``run_dir/agents/`` (the source of the resolved ``agent_override`` path).
    CI runs ``pytest`` without ``worca init``, so the dir is otherwise absent —
    scaffolding it keeps the agent-template routing assertions hermetic instead
    of depending on a dogfooding runtime copy that only exists locally.
    """
    core = tmp_path / ".claude" / "worca" / "agents" / "core"
    core.mkdir(parents=True)
    for name in ("planner", "plan_reviewer", "plan_editor", "coordinator"):
        (core / f"{name}.md").write_text(f"# {name}\n\n{{{{work_request}}}}\n")
    monkeypatch.chdir(tmp_path)


@pytest.fixture(autouse=True)
def _mock_beads():
    with patch("worca.orchestrator.runner._ensure_beads_initialized"):
        yield


# ---------------------------------------------------------------------------
# Static map sanity
# ---------------------------------------------------------------------------

class TestStageBlockMapDefaults:
    # W-071: the runner-local _STAGE_BLOCK_MAP was retired; the loop consumes
    # FlowStage.prompt_block, sourced from flow.DEFAULT_STAGE_BLOCKS.

    def test_plan_review_default_block_name(self):
        assert DEFAULT_STAGE_BLOCKS[Stage.PLAN_REVIEW.value] == "plan-review"

    def test_plan_review_in_map(self):
        assert Stage.PLAN_REVIEW.value in DEFAULT_STAGE_BLOCKS


# ---------------------------------------------------------------------------
# Agent .md routing (seam 1)
# ---------------------------------------------------------------------------

class TestAgentTemplateRouting:

    def test_review_mode_uses_plan_reviewer_md(self, tmp_path, monkeypatch):
        """Default review mode loads plan_reviewer.md (via stage_config agent)."""
        settings_path = _settings(tmp_path, mode="review")
        _, status_path = _worca(tmp_path)
        _scaffold_runtime_agents(tmp_path, monkeypatch)
        wr = _wr()
        captured = {}

        def mock_run_stage(stage, context, settings_path, msize=1, iteration=1,
                           prompt_override=None, agent_override=None, **kwargs):
            if stage == Stage.PLAN_REVIEW:
                captured["agent_override"] = agent_override
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

        override = captured.get("agent_override")
        assert override is not None, "agent_override must be set for PLAN_REVIEW"
        assert "plan_reviewer" in override
        assert "plan_editor" not in override

    def test_edit_mode_uses_plan_editor_md(self, tmp_path, monkeypatch):
        """review_and_edit mode loads plan_editor.md instead of plan_reviewer.md."""
        settings_path = _settings(tmp_path, mode="review_and_edit")
        _, status_path = _worca(tmp_path)
        _scaffold_runtime_agents(tmp_path, monkeypatch)
        wr = _wr()
        captured = {}

        def mock_run_stage(stage, context, settings_path, msize=1, iteration=1,
                           prompt_override=None, agent_override=None, **kwargs):
            if stage == Stage.PLAN_REVIEW:
                captured["agent_override"] = agent_override
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

        override = captured.get("agent_override")
        assert override is not None, "agent_override must be set for PLAN_REVIEW"
        assert "plan_editor" in override, (
            f"review_and_edit mode must load plan_editor.md, got: {override}"
        )

    def test_governance_enforce_overrides_template_mode(self, tmp_path, monkeypatch):
        """governance.plan_review_enforce=review_and_edit overrides stages.mode=review."""
        settings_path = _settings(tmp_path, mode="review", enforce="review_and_edit")
        _, status_path = _worca(tmp_path)
        _scaffold_runtime_agents(tmp_path, monkeypatch)
        wr = _wr()
        captured = {}

        def mock_run_stage(stage, context, settings_path, msize=1, iteration=1,
                           prompt_override=None, agent_override=None, **kwargs):
            if stage == Stage.PLAN_REVIEW:
                captured["agent_override"] = agent_override
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

        override = captured.get("agent_override")
        assert override is not None
        assert "plan_editor" in override


# ---------------------------------------------------------------------------
# Block selection (seam 2)
# ---------------------------------------------------------------------------

class TestBlockRouting:

    def test_review_mode_uses_plan_review_block(self, tmp_path):
        """Default review mode resolves the plan-review block."""
        settings_path = _settings(tmp_path, mode="review")
        _, status_path = _worca(tmp_path)
        wr = _wr()
        captured = {}

        def mock_run_stage(stage, context, settings_path, msize=1, iteration=1,
                           prompt_override=None, agent_override=None, **kwargs):
            if stage == Stage.PLAN_REVIEW:
                captured["prompt_override"] = prompt_override
            if stage == Stage.PLAN:
                return _mock_stage(stage, {"approved": True, "approach": "x", "tasks_outline": []})
            if stage == Stage.PLAN_REVIEW:
                return _mock_stage(stage, {"outcome": "approve", "issues": [], "summary": "Good"})
            if stage == Stage.COORDINATE:
                return _mock_stage(stage, {"beads_ids": [], "dependency_graph": {}})
            return _mock_stage(stage, {})

        block_calls = []
        original_resolve_block = None
        dispatch_started = []

        def gated_run_stage(*args, **kwargs):
            dispatch_started.append(True)
            return mock_run_stage(*args, **kwargs)

        def tracking_resolve_block(self, block_name, *args, **kwargs):
            # Only dispatch-time routing matters here — the W-072 launch-time
            # consumption lint also resolves blocks, before any stage runs.
            if dispatch_started:
                block_calls.append(block_name)
            return original_resolve_block(self, block_name, *args, **kwargs)

        from worca.orchestrator.overlay import OverlayResolver
        original_resolve_block = OverlayResolver.resolve_block

        with patch.object(OverlayResolver, "resolve_block", tracking_resolve_block):
            with patch("worca.orchestrator.runner.run_stage", side_effect=gated_run_stage):
                with patch("worca.orchestrator.runner.create_branch"):
                    with patch("worca.orchestrator.runner._write_pid"):
                        with patch("worca.orchestrator.runner._remove_pid"):
                            run_pipeline(wr, settings_path=settings_path, status_path=status_path)

        assert "plan-review" in block_calls, (
            f"review mode must resolve plan-review block, got: {block_calls}"
        )
        assert "plan-edit" not in block_calls

    def test_edit_mode_uses_plan_edit_block(self, tmp_path):
        """review_and_edit mode resolves the plan-edit block instead of plan-review."""
        settings_path = _settings(tmp_path, mode="review_and_edit")
        _, status_path = _worca(tmp_path)
        wr = _wr()

        block_calls = []
        original_resolve_block = None
        dispatch_started = []

        def tracking_resolve_block(self, block_name, *args, **kwargs):
            # Only dispatch-time routing matters here — the W-072 launch-time
            # consumption lint also resolves blocks, before any stage runs.
            if dispatch_started:
                block_calls.append(block_name)
            return original_resolve_block(self, block_name, *args, **kwargs)

        from worca.orchestrator.overlay import OverlayResolver
        original_resolve_block = OverlayResolver.resolve_block

        def mock_run_stage(stage, context, settings_path, msize=1, iteration=1,
                           prompt_override=None, agent_override=None, **kwargs):
            if stage == Stage.PLAN:
                return _mock_stage(stage, {"approved": True, "approach": "x", "tasks_outline": []})
            if stage == Stage.PLAN_REVIEW:
                return _mock_stage(stage, {"outcome": "approve", "issues": [], "summary": "Good"})
            if stage == Stage.COORDINATE:
                return _mock_stage(stage, {"beads_ids": [], "dependency_graph": {}})
            return _mock_stage(stage, {})

        def gated_run_stage(*args, **kwargs):
            dispatch_started.append(True)
            return mock_run_stage(*args, **kwargs)

        with patch.object(OverlayResolver, "resolve_block", tracking_resolve_block):
            with patch("worca.orchestrator.runner.run_stage", side_effect=gated_run_stage):
                with patch("worca.orchestrator.runner.create_branch"):
                    with patch("worca.orchestrator.runner._write_pid"):
                        with patch("worca.orchestrator.runner._remove_pid"):
                            run_pipeline(wr, settings_path=settings_path, status_path=status_path)

        assert "plan-edit" in block_calls, (
            f"review_and_edit mode must resolve plan-edit block, got: {block_calls}"
        )
        assert "plan-review" not in block_calls


# ---------------------------------------------------------------------------
# Env flag: WORCA_PLAN_REVIEWER_CAN_EDIT (seam 3)
# ---------------------------------------------------------------------------

class TestPlanReviewerCanEditEnv:

    def test_edit_mode_sets_env_flag(self, tmp_path):
        """review_and_edit mode passes WORCA_PLAN_REVIEWER_CAN_EDIT=1 in env_overrides."""
        settings_path = _settings(tmp_path, mode="review_and_edit")
        _, status_path = _worca(tmp_path)
        wr = _wr()
        captured = {}

        def mock_run_stage(stage, context, settings_path, msize=1, iteration=1,
                           prompt_override=None, agent_override=None, **kwargs):
            if stage == Stage.PLAN_REVIEW:
                captured["env_overrides"] = kwargs.get("env_overrides", {})
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

        env = captured.get("env_overrides", {})
        assert env.get("WORCA_PLAN_REVIEWER_CAN_EDIT") == "1", (
            f"review_and_edit must set WORCA_PLAN_REVIEWER_CAN_EDIT=1, got: {env}"
        )

    def test_review_mode_does_not_set_env_flag(self, tmp_path):
        """Default review mode must NOT set WORCA_PLAN_REVIEWER_CAN_EDIT."""
        settings_path = _settings(tmp_path, mode="review")
        _, status_path = _worca(tmp_path)
        wr = _wr()
        captured = {}

        def mock_run_stage(stage, context, settings_path, msize=1, iteration=1,
                           prompt_override=None, agent_override=None, **kwargs):
            if stage == Stage.PLAN_REVIEW:
                captured["env_overrides"] = kwargs.get("env_overrides", {})
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

        env = captured.get("env_overrides", {})
        assert "WORCA_PLAN_REVIEWER_CAN_EDIT" not in env, (
            f"review mode must NOT set WORCA_PLAN_REVIEWER_CAN_EDIT, got: {env}"
        )

    def test_governance_enforce_sets_env_flag(self, tmp_path):
        """governance.plan_review_enforce=review_and_edit sets the env flag."""
        settings_path = _settings(tmp_path, mode="review", enforce="review_and_edit")
        _, status_path = _worca(tmp_path)
        wr = _wr()
        captured = {}

        def mock_run_stage(stage, context, settings_path, msize=1, iteration=1,
                           prompt_override=None, agent_override=None, **kwargs):
            if stage == Stage.PLAN_REVIEW:
                captured["env_overrides"] = kwargs.get("env_overrides", {})
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

        env = captured.get("env_overrides", {})
        assert env.get("WORCA_PLAN_REVIEWER_CAN_EDIT") == "1"


# ---------------------------------------------------------------------------
# Original-plan retention (§6 audit triad)
# ---------------------------------------------------------------------------

class TestPlanEditRevision:
    """W-061 reconciliation: the editor rewrites the next numbered revision in
    place; the pre-edit plan-N.md is the retained original (no plan-original.md)."""

    def _run_dir_with_plan(self, tmp_path, name="plan-001.md", plan_content="# Original Plan\n"):
        """Set up a .worca/runs/<id>/ dir with a plan file, return (run_dir, plan_path)."""
        run_dir = tmp_path / ".worca" / "runs" / "test-run"
        run_dir.mkdir(parents=True)
        plan_path = run_dir / name
        plan_path.write_text(plan_content)
        return str(run_dir), str(plan_path)

    def test_mints_next_numbered_revision(self, tmp_path):
        """Copies plan-001.md forward to plan-002.md for in-place editing."""
        from worca.orchestrator.runner import _mint_plan_edit_target
        run_dir, plan_path = self._run_dir_with_plan(tmp_path)

        target = _mint_plan_edit_target(run_dir, plan_path)

        assert target == os.path.join(run_dir, "plan-002.md")
        assert os.path.exists(target)
        assert open(target).read() == "# Original Plan\n"

    def test_original_is_retained_untouched(self, tmp_path):
        """The pre-edit plan-N.md survives as the retained original."""
        from worca.orchestrator.runner import _mint_plan_edit_target
        run_dir, plan_path = self._run_dir_with_plan(tmp_path)

        _mint_plan_edit_target(run_dir, plan_path)

        assert os.path.exists(plan_path)
        assert open(plan_path).read() == "# Original Plan\n"
        # No bespoke plan-original.md artifact is produced.
        assert not os.path.exists(os.path.join(run_dir, "plan-original.md"))

    def test_mint_increments_from_highest_existing(self, tmp_path):
        """With plan-001 and plan-002 present, mints plan-003.md."""
        from worca.orchestrator.runner import _mint_plan_edit_target
        run_dir, _ = self._run_dir_with_plan(tmp_path, name="plan-001.md")
        plan2 = os.path.join(run_dir, "plan-002.md")
        with open(plan2, "w") as f:
            f.write("# Plan v2\n")

        target = _mint_plan_edit_target(run_dir, plan2)

        assert target == os.path.join(run_dir, "plan-003.md")
        assert open(target).read() == "# Plan v2\n"

    def test_no_mint_when_plan_file_missing(self, tmp_path):
        """Returns None and copies nothing when the source plan doesn't exist."""
        from worca.orchestrator.runner import _mint_plan_edit_target
        run_dir = str(tmp_path / "run")
        os.makedirs(run_dir)

        target = _mint_plan_edit_target(run_dir, os.path.join(run_dir, "nonexistent.md"))

        assert target is None
        assert not os.path.exists(os.path.join(run_dir, "plan-001.md"))

    def test_no_mint_when_run_dir_is_none(self):
        """Returns None without crashing when run_dir is None (legacy/test mode)."""
        from worca.orchestrator.runner import _mint_plan_edit_target
        assert _mint_plan_edit_target(None, "/some/plan.md") is None


# ---------------------------------------------------------------------------
# Edit-mode branch behavior (W-059-8)
# ---------------------------------------------------------------------------

class TestEditModeBranch:
    """Verify that review_and_edit mode skips loopback, marks plan_approved,
    and sets outcome correctly in the PLAN_REVIEW handler."""

    def test_edit_mode_revise_does_not_loopback(self, tmp_path):
        """Edit mode with outcome=revise should NOT loop back to PLAN —
        it should still proceed forward (no loopback in edit mode)."""
        settings_path = _settings(tmp_path, mode="review_and_edit")
        _, status_path = _worca(tmp_path)
        wr = _wr()
        stages_visited = []

        def mock_run_stage(stage, context, settings_path, msize=1, iteration=1,
                           prompt_override=None, agent_override=None, **kwargs):
            stages_visited.append(stage)
            if stage == Stage.PLAN:
                return _mock_stage(stage, {"approved": True, "approach": "x", "tasks_outline": []})
            if stage == Stage.PLAN_REVIEW:
                return _mock_stage(stage, {
                    "outcome": "revise",
                    "issues": [{"severity": "critical", "description": "missing auth"}],
                    "summary": "Needs revision",
                })
            if stage == Stage.COORDINATE:
                return _mock_stage(stage, {"beads_ids": [], "dependency_graph": {}})
            return _mock_stage(stage, {})

        with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
            with patch("worca.orchestrator.runner.create_branch"):
                with patch("worca.orchestrator.runner._write_pid"):
                    with patch("worca.orchestrator.runner._remove_pid"):
                        run_pipeline(wr, settings_path=settings_path, status_path=status_path)

        plan_count = stages_visited.count(Stage.PLAN)
        assert plan_count == 1, (
            f"Edit mode must NOT loop back to PLAN, but PLAN ran {plan_count} times"
        )

    def test_edit_mode_proceeds_to_coordinate(self, tmp_path):
        """Edit mode reaches COORDINATE after PLAN_REVIEW (no stuck state)."""
        settings_path = _settings(tmp_path, mode="review_and_edit")
        _, status_path = _worca(tmp_path)
        wr = _wr()
        stages_visited = []

        def mock_run_stage(stage, context, settings_path, msize=1, iteration=1,
                           prompt_override=None, agent_override=None, **kwargs):
            stages_visited.append(stage)
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

        assert Stage.COORDINATE in stages_visited, "Edit mode must proceed to COORDINATE"

    def test_edit_mode_approve_with_edits_outcome_captured(self, tmp_path):
        """Edit mode preserves approve_with_edits when the editor actually edits.

        Honest outcome (W-061 reconciliation): the recorded outcome is derived
        from the file's content change, not the editor's self-report. We
        provide a plan so plan-001.md exists, then simulate the editor writing
        to the re-pointed plan-002.md — only then does the verdict survive as
        ``approve_with_edits`` through ``complete_iteration``.
        """
        settings_path = _settings(tmp_path, mode="review_and_edit")
        _, status_path = _worca(tmp_path)
        plan_md = tmp_path / "provided-plan.md"
        plan_md.write_text("# Provided Plan\n\nDo the thing.\n")
        wr = _wr()
        captured = {}

        def mock_run_stage(stage, context, settings_path, msize=1, iteration=1,
                           prompt_override=None, agent_override=None, **kwargs):
            if stage == Stage.PLAN:
                return _mock_stage(stage, {"approved": True, "approach": "x", "tasks_outline": []})
            if stage == Stage.PLAN_REVIEW:
                # Simulate the editor rewriting the re-pointed plan file in place.
                _target = os.environ.get("WORCA_PLAN_FILE")
                if _target and os.path.isfile(_target):
                    with open(_target, "a", encoding="utf-8") as _f:
                        _f.write("\n\n## Editor's revision\n- adjusted naming\n")
                return _mock_stage(stage, {
                    "outcome": "approve_with_edits",
                    "issues": [{"severity": "minor", "description": "adjusted naming"}],
                    "summary": "Approved with edits",
                })
            if stage == Stage.COORDINATE:
                captured["reached_coordinate"] = True
                return _mock_stage(stage, {"beads_ids": [], "dependency_graph": {}})
            return _mock_stage(stage, {})

        orig_complete = None
        from worca.state.status import complete_iteration as _orig_ci
        orig_complete = _orig_ci

        def tracking_complete(*args, **kwargs):
            stage_name = args[1] if len(args) > 1 else kwargs.get("stage_name")
            outcome = kwargs.get("outcome")
            if stage_name == "plan_review":
                captured["outcome"] = outcome
            return orig_complete(*args, **kwargs)

        with patch("worca.orchestrator.runner.complete_iteration", side_effect=tracking_complete):
            with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
                with patch("worca.orchestrator.runner.create_branch"):
                    with patch("worca.orchestrator.runner._write_pid"):
                        with patch("worca.orchestrator.runner._remove_pid"):
                            run_pipeline(wr, settings_path=settings_path,
                                         status_path=status_path, plan_file=str(plan_md))

        assert captured.get("outcome") == "approve_with_edits"
        assert captured.get("reached_coordinate"), "Must proceed to COORDINATE"

    def test_edit_mode_approve_maps_to_approve_outcome(self, tmp_path):
        """Edit mode with outcome=approve keeps outcome as 'approve'."""
        settings_path = _settings(tmp_path, mode="review_and_edit")
        _, status_path = _worca(tmp_path)
        wr = _wr()
        captured = {}

        from worca.state.status import complete_iteration as _orig_ci
        orig_complete = _orig_ci

        def tracking_complete(*args, **kwargs):
            stage_name = args[1] if len(args) > 1 else kwargs.get("stage_name")
            outcome = kwargs.get("outcome")
            if stage_name == "plan_review":
                captured["outcome"] = outcome
            return orig_complete(*args, **kwargs)

        def mock_run_stage(stage, context, settings_path, msize=1, iteration=1,
                           prompt_override=None, agent_override=None, **kwargs):
            if stage == Stage.PLAN:
                return _mock_stage(stage, {"approved": True, "approach": "x", "tasks_outline": []})
            if stage == Stage.PLAN_REVIEW:
                return _mock_stage(stage, {"outcome": "approve", "issues": [], "summary": "Good"})
            if stage == Stage.COORDINATE:
                return _mock_stage(stage, {"beads_ids": [], "dependency_graph": {}})
            return _mock_stage(stage, {})

        with patch("worca.orchestrator.runner.complete_iteration", side_effect=tracking_complete):
            with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
                with patch("worca.orchestrator.runner.create_branch"):
                    with patch("worca.orchestrator.runner._write_pid"):
                        with patch("worca.orchestrator.runner._remove_pid"):
                            run_pipeline(wr, settings_path=settings_path, status_path=status_path)

        assert captured.get("outcome") == "approve"

    def test_edit_mode_sets_plan_approved_milestone(self, tmp_path):
        """Edit mode sets plan_approved milestone via set_milestone."""
        settings_path = _settings(tmp_path, mode="review_and_edit")
        _, status_path = _worca(tmp_path)
        wr = _wr()
        milestone_calls = []

        from worca.state.status import set_milestone as _orig_sm
        orig_set_milestone = _orig_sm

        def tracking_set_milestone(*args, **kwargs):
            key = args[1] if len(args) > 1 else kwargs.get("key")
            value = args[2] if len(args) > 2 else kwargs.get("value")
            milestone_calls.append((key, value))
            return orig_set_milestone(*args, **kwargs)

        def mock_run_stage(stage, context, settings_path, msize=1, iteration=1,
                           prompt_override=None, agent_override=None, **kwargs):
            if stage == Stage.PLAN:
                return _mock_stage(stage, {"approved": True, "approach": "x", "tasks_outline": []})
            if stage == Stage.PLAN_REVIEW:
                return _mock_stage(stage, {"outcome": "approve", "issues": [], "summary": "Good"})
            if stage == Stage.COORDINATE:
                return _mock_stage(stage, {"beads_ids": [], "dependency_graph": {}})
            return _mock_stage(stage, {})

        with patch("worca.orchestrator.runner.set_milestone", side_effect=tracking_set_milestone):
            with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
                with patch("worca.orchestrator.runner.create_branch"):
                    with patch("worca.orchestrator.runner._write_pid"):
                        with patch("worca.orchestrator.runner._remove_pid"):
                            run_pipeline(wr, settings_path=settings_path, status_path=status_path)

        pr_milestones = [(k, v) for k, v in milestone_calls if k == "plan_approved"]
        assert any(v is True for _, v in pr_milestones), (
            f"Edit mode must call set_milestone('plan_approved', True), got: {pr_milestones}"
        )

    def test_edit_mode_emits_plan_edited_event(self, tmp_path):
        """Edit mode emits PLAN_EDITED when the editor actually rewrites the plan.

        The provided plan is ingested to plan-001.md and the runner re-points
        WORCA_PLAN_FILE to plan-002.md before the editor runs. The mock
        simulates the editor writing edits there — only then does the runner's
        content-based check treat the verdict as ``approve_with_edits`` and
        fire ``PLAN_EDITED`` with ``original_plan_path`` pointing at the
        retained plan-001.md (W-061 reconciliation).
        """
        settings_path = _settings(tmp_path, mode="review_and_edit")
        _, status_path = _worca(tmp_path)
        plan_md = tmp_path / "provided-plan.md"
        plan_md.write_text("# Provided Plan\n\nDo the thing.\n")
        wr = _wr()
        captured_events = []

        from worca.events.types import PLAN_EDITED

        original_emit = None

        def tracking_emit(ctx, event_type, payload, **kwargs):
            captured_events.append((event_type, payload))
            return original_emit(ctx, event_type, payload, **kwargs) if original_emit else None

        def mock_run_stage(stage, context, settings_path, msize=1, iteration=1,
                           prompt_override=None, agent_override=None, **kwargs):
            if stage == Stage.PLAN:
                return _mock_stage(stage, {"approved": True, "approach": "x", "tasks_outline": []})
            if stage == Stage.PLAN_REVIEW:
                # Simulate the editor rewriting the re-pointed plan file in place.
                _target = os.environ.get("WORCA_PLAN_FILE")
                if _target and os.path.isfile(_target):
                    with open(_target, "a", encoding="utf-8") as _f:
                        _f.write("\n\n## Editor's revision\n- fix wrong API\n")
                return _mock_stage(stage, {
                    "outcome": "approve_with_edits",
                    "issues": [
                        {"severity": "critical", "category": "completeness", "description": "a"},
                        {"severity": "major", "category": "feasibility", "description": "b"},
                        {"severity": "minor", "category": "risk", "description": "c"},
                    ],
                    "summary": "Approved with edits",
                })
            if stage == Stage.COORDINATE:
                return _mock_stage(stage, {"beads_ids": [], "dependency_graph": {}})
            return _mock_stage(stage, {})

        with patch("worca.orchestrator.runner.emit_event", side_effect=tracking_emit):
            with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
                with patch("worca.orchestrator.runner.create_branch"):
                    with patch("worca.orchestrator.runner._write_pid"):
                        with patch("worca.orchestrator.runner._remove_pid"):
                            run_pipeline(wr, settings_path=settings_path,
                                         status_path=status_path, plan_file=str(plan_md))

        plan_edited = [(et, p) for et, p in captured_events if et == PLAN_EDITED]
        assert len(plan_edited) == 1, f"Expected exactly 1 PLAN_EDITED event, got {len(plan_edited)}"
        payload = plan_edited[0][1]
        assert payload["stage"] == "plan_review"
        assert payload["mode"] == "review_and_edit"
        assert payload["mode_reason"] == "from template/pipeline"
        assert payload["issue_counts"] == {"critical": 1, "major": 1, "minor": 1, "suggestion": 0}
        # The retained original is the pre-edit numbered plan (plan-001.md), not
        # a bespoke plan-original.md (W-061 reconciliation).
        assert payload["original_plan_path"].endswith("plan-001.md")

    def test_edit_mode_no_edit_does_not_emit_plan_edited(self, tmp_path):
        """When the editor returns approve_with_edits but does NOT modify the
        plan file, the content-based check downgrades the outcome to
        ``approve`` and PLAN_EDITED is NOT emitted — claiming edits we did not
        make would inflate the audit trail. The speculative plan-(N+1) copy is
        also collapsed so the numbered sequence stays meaningful.
        """
        settings_path = _settings(tmp_path, mode="review_and_edit")
        _, status_path = _worca(tmp_path)
        plan_md = tmp_path / "provided-plan.md"
        plan_md.write_text("# Provided Plan\n\nDo the thing.\n")
        wr = _wr()
        captured_events = []

        from worca.events.types import PLAN_EDITED

        def tracking_emit(ctx, event_type, payload, **kwargs):
            captured_events.append(event_type)
            return None

        def mock_run_stage(stage, context, settings_path, msize=1, iteration=1,
                           prompt_override=None, agent_override=None, **kwargs):
            if stage == Stage.PLAN:
                return _mock_stage(stage, {"approved": True, "approach": "x", "tasks_outline": []})
            if stage == Stage.PLAN_REVIEW:
                # Editor self-reports edits AND tags each issue resolution as
                # "edited" — but writes nothing. The runner's content-hash
                # check should catch the lie and downgrade both the outcome
                # AND every per-issue resolution claim.
                return _mock_stage(stage, {
                    "outcome": "approve_with_edits",
                    "issues": [
                        {
                            "severity": "major",
                            "category": "feasibility",
                            "description": "b",
                            "resolution": "edited",
                        },
                    ],
                    "summary": "Claimed edits but didn't write",
                })
            if stage == Stage.COORDINATE:
                return _mock_stage(stage, {"beads_ids": [], "dependency_graph": {}})
            return _mock_stage(stage, {})

        captured_outcomes = {}
        from worca.state.status import complete_iteration as _orig_ci

        def tracking_complete(*args, **kwargs):
            stage_name = args[1] if len(args) > 1 else kwargs.get("stage_name")
            if stage_name == "plan_review":
                captured_outcomes["plan_review"] = kwargs.get("outcome")
                # Snapshot WORCA_PLAN_FILE at the moment plan_review's
                # iteration is recorded — by then the runner has collapsed
                # any no-op plan-(N+1).md and re-pointed back to the pre-edit
                # original.
                captured_outcomes["plan_file_env"] = os.environ.get("WORCA_PLAN_FILE", "")
                # Capture the per-issue resolution values from the iteration's
                # recorded output to verify the backstop downgraded them.
                output = kwargs.get("output")
                if isinstance(output, dict):
                    captured_outcomes["issue_resolutions"] = [
                        i.get("resolution") for i in (output.get("issues") or [])
                    ]
            return _orig_ci(*args, **kwargs)

        with patch("worca.orchestrator.runner.complete_iteration", side_effect=tracking_complete):
            with patch("worca.orchestrator.runner.emit_event", side_effect=tracking_emit):
                with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
                    with patch("worca.orchestrator.runner.create_branch"):
                        with patch("worca.orchestrator.runner._write_pid"):
                            with patch("worca.orchestrator.runner._remove_pid"):
                                run_pipeline(wr, settings_path=settings_path,
                                             status_path=status_path, plan_file=str(plan_md))

        assert PLAN_EDITED not in captured_events, (
            "PLAN_EDITED must NOT fire when the editor did not modify the plan"
        )
        # Content-based downgrade: editor's self-reported approve_with_edits
        # over a byte-identical file is corrected to 'approve'.
        assert captured_outcomes.get("plan_review") == "approve", (
            f"Expected 'approve', got {captured_outcomes.get('plan_review')!r}"
        )
        # The speculative plan-002.md is collapsed back; WORCA_PLAN_FILE
        # re-points to the pre-edit plan-001.md before complete_iteration runs.
        assert captured_outcomes.get("plan_file_env", "").endswith("plan-001.md"), (
            f"Expected plan_file_env to end with plan-001.md, got "
            f"{captured_outcomes.get('plan_file_env')!r}"
        )
        # Per-issue backstop: the editor's resolution='edited' claim is
        # downgraded to 'deferred' since the file wasn't actually modified.
        assert captured_outcomes.get("issue_resolutions") == ["deferred"], (
            f"Expected issue_resolutions to be ['deferred'] (backstop downgrade), "
            f"got {captured_outcomes.get('issue_resolutions')!r}"
        )

    def test_review_mode_normalizes_bogus_approve_with_edits_claim(self, tmp_path):
        """The read-only plan_reviewer cannot edit the plan, so any
        ``approve_with_edits`` outcome or per-issue ``resolution`` value is a
        contract violation. The runner downgrades the outcome to ``approve``
        and strips the resolution field from every issue, so the audit trail
        records what was physically possible rather than what was claimed.
        """
        settings_path = _settings(tmp_path, mode="review")
        _, status_path = _worca(tmp_path)
        wr = _wr()

        from worca.events.types import PLAN_EDITED

        captured_events = []

        def tracking_emit(ctx, event_type, payload, **kwargs):
            captured_events.append(event_type)
            return None

        def mock_run_stage(stage, context, settings_path, msize=1, iteration=1,
                           prompt_override=None, agent_override=None, **kwargs):
            if stage == Stage.PLAN:
                return _mock_stage(stage, {"approved": True, "approach": "x", "tasks_outline": []})
            if stage == Stage.PLAN_REVIEW:
                # Read-only reviewer fabricates an edit-mode-shaped output:
                # approve_with_edits + per-issue resolution: edited.
                return _mock_stage(stage, {
                    "outcome": "approve_with_edits",
                    "issues": [
                        {
                            "severity": "major",
                            "category": "architecture",
                            "description": "a",
                            "resolution": "edited",
                        },
                        {
                            "severity": "minor",
                            "category": "feasibility",
                            "description": "b",
                            "resolution": "deferred",
                        },
                        {
                            "severity": "suggestion",
                            "category": "test_strategy",
                            "description": "c",
                        },
                    ],
                    "summary": "Reviewer falsely claimed edits",
                })
            if stage == Stage.COORDINATE:
                return _mock_stage(stage, {"beads_ids": [], "dependency_graph": {}})
            return _mock_stage(stage, {})

        captured_outcomes = {}
        from worca.state.status import complete_iteration as _orig_ci

        def tracking_complete(*args, **kwargs):
            stage_name = args[1] if len(args) > 1 else kwargs.get("stage_name")
            if stage_name == "plan_review":
                captured_outcomes["plan_review"] = kwargs.get("outcome")
                output = kwargs.get("output")
                if isinstance(output, dict):
                    captured_outcomes["issue_resolutions_present"] = [
                        ("resolution" in i) for i in (output.get("issues") or [])
                    ]
                    captured_outcomes["issue_resolutions"] = [
                        i.get("resolution") for i in (output.get("issues") or [])
                    ]
            return _orig_ci(*args, **kwargs)

        with patch("worca.orchestrator.runner.complete_iteration", side_effect=tracking_complete):
            with patch("worca.orchestrator.runner.emit_event", side_effect=tracking_emit):
                with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
                    with patch("worca.orchestrator.runner.create_branch"):
                        with patch("worca.orchestrator.runner._write_pid"):
                            with patch("worca.orchestrator.runner._remove_pid"):
                                run_pipeline(wr, settings_path=settings_path,
                                             status_path=status_path)

        # PLAN_EDITED is review-mode-illegal — never fires in review mode
        # because the emission lives inside the edit-mode branch.
        assert PLAN_EDITED not in captured_events, (
            "PLAN_EDITED must NOT fire in review mode under any circumstances"
        )
        # The bogus approve_with_edits is downgraded to approve.
        assert captured_outcomes.get("plan_review") == "approve", (
            f"Expected outcome 'approve' (downgraded from approve_with_edits), "
            f"got {captured_outcomes.get('plan_review')!r}"
        )
        # Every issue has its resolution field stripped — review mode has no
        # business carrying that field at all.
        assert captured_outcomes.get("issue_resolutions_present") == [False, False, False], (
            f"Expected every issue's resolution to be stripped in review mode, "
            f"got presence flags {captured_outcomes.get('issue_resolutions_present')!r} "
            f"with values {captured_outcomes.get('issue_resolutions')!r}"
        )

    def test_review_mode_clean_approve_passes_through_unchanged(self, tmp_path):
        """No false positives: when the reviewer returns a clean ``approve``
        with no resolution fields, normalization is a no-op."""
        settings_path = _settings(tmp_path, mode="review")
        _, status_path = _worca(tmp_path)
        wr = _wr()

        def mock_run_stage(stage, context, settings_path, msize=1, iteration=1,
                           prompt_override=None, agent_override=None, **kwargs):
            if stage == Stage.PLAN:
                return _mock_stage(stage, {"approved": True, "approach": "x", "tasks_outline": []})
            if stage == Stage.PLAN_REVIEW:
                return _mock_stage(stage, {
                    "outcome": "approve",
                    "issues": [
                        {"severity": "minor", "category": "completeness", "description": "a"},
                    ],
                    "summary": "Approved",
                })
            if stage == Stage.COORDINATE:
                return _mock_stage(stage, {"beads_ids": [], "dependency_graph": {}})
            return _mock_stage(stage, {})

        captured_outcomes = {}
        from worca.state.status import complete_iteration as _orig_ci

        def tracking_complete(*args, **kwargs):
            stage_name = args[1] if len(args) > 1 else kwargs.get("stage_name")
            if stage_name == "plan_review":
                captured_outcomes["plan_review"] = kwargs.get("outcome")
                output = kwargs.get("output")
                if isinstance(output, dict):
                    captured_outcomes["issues"] = output.get("issues")
            return _orig_ci(*args, **kwargs)

        with patch("worca.orchestrator.runner.complete_iteration", side_effect=tracking_complete):
            with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
                with patch("worca.orchestrator.runner.create_branch"):
                    with patch("worca.orchestrator.runner._write_pid"):
                        with patch("worca.orchestrator.runner._remove_pid"):
                            run_pipeline(wr, settings_path=settings_path,
                                         status_path=status_path)

        # outcome flows through unchanged.
        assert captured_outcomes.get("plan_review") == "approve"
        # Issues without resolution stay without resolution — normalization
        # doesn't add bogus keys.
        issues = captured_outcomes.get("issues") or []
        assert len(issues) == 1
        assert "resolution" not in issues[0]

    def test_review_mode_does_not_emit_plan_edited(self, tmp_path):
        """Standard review mode must NOT emit PLAN_EDITED."""
        settings_path = _settings(tmp_path, mode="review")
        _, status_path = _worca(tmp_path)
        wr = _wr()
        captured_events = []

        from worca.events.types import PLAN_EDITED

        def tracking_emit(ctx, event_type, payload, **kwargs):
            captured_events.append(event_type)
            return None

        def mock_run_stage(stage, context, settings_path, msize=1, iteration=1,
                           prompt_override=None, agent_override=None, **kwargs):
            if stage == Stage.PLAN:
                return _mock_stage(stage, {"approved": True, "approach": "x", "tasks_outline": []})
            if stage == Stage.PLAN_REVIEW:
                return _mock_stage(stage, {"outcome": "approve", "issues": [], "summary": "Good"})
            if stage == Stage.COORDINATE:
                return _mock_stage(stage, {"beads_ids": [], "dependency_graph": {}})
            return _mock_stage(stage, {})

        with patch("worca.orchestrator.runner.emit_event", side_effect=tracking_emit):
            with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
                with patch("worca.orchestrator.runner.create_branch"):
                    with patch("worca.orchestrator.runner._write_pid"):
                        with patch("worca.orchestrator.runner._remove_pid"):
                            run_pipeline(wr, settings_path=settings_path, status_path=status_path)

        assert PLAN_EDITED not in captured_events, "Review mode must NOT emit PLAN_EDITED"

    def test_review_mode_revise_loops_back_to_plan(self, tmp_path):
        """Regression guard: review mode with revise + critical issues loops back."""
        settings_path = _settings(tmp_path, mode="review")
        _, status_path = _worca(tmp_path)
        wr = _wr()
        stages_visited = []

        def mock_run_stage(stage, context, settings_path, msize=1, iteration=1,
                           prompt_override=None, agent_override=None, **kwargs):
            stages_visited.append(stage)
            if stage == Stage.PLAN:
                return _mock_stage(stage, {"approved": True, "approach": "x", "tasks_outline": []})
            if stage == Stage.PLAN_REVIEW:
                if stages_visited.count(Stage.PLAN_REVIEW) == 1:
                    return _mock_stage(stage, {
                        "outcome": "revise",
                        "issues": [{"severity": "critical", "description": "missing auth"}],
                        "summary": "Needs revision",
                    })
                return _mock_stage(stage, {"outcome": "approve", "issues": [], "summary": "OK"})
            if stage == Stage.COORDINATE:
                return _mock_stage(stage, {"beads_ids": [], "dependency_graph": {}})
            return _mock_stage(stage, {})

        with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
            with patch("worca.orchestrator.runner.create_branch"):
                with patch("worca.orchestrator.runner._write_pid"):
                    with patch("worca.orchestrator.runner._remove_pid"):
                        run_pipeline(wr, settings_path=settings_path, status_path=status_path)

        plan_count = stages_visited.count(Stage.PLAN)
        assert plan_count == 2, (
            f"Review mode must loop back to PLAN on revise, but PLAN ran {plan_count} times"
        )

    def test_mode_and_reason_persisted_in_status(self, tmp_path):
        """Resolved mode/mode_reason are written to the plan_review stage in status.json."""
        settings_path = _settings(tmp_path, mode="review_and_edit")
        worca_dir, status_path = _worca(tmp_path)
        wr = _wr()

        def mock_run_stage(stage, context, settings_path, msize=1, iteration=1,
                           prompt_override=None, agent_override=None, **kwargs):
            if stage == Stage.PLAN:
                return _mock_stage(stage, {"approved": True, "approach": "x", "tasks_outline": []})
            if stage == Stage.PLAN_REVIEW:
                return _mock_stage(stage, {
                    "outcome": "approve_with_edits",
                    "issues": [{"severity": "minor", "description": "tweaked"}],
                    "summary": "Approved",
                })
            if stage == Stage.COORDINATE:
                return _mock_stage(stage, {"beads_ids": [], "dependency_graph": {}})
            return _mock_stage(stage, {})

        with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
            with patch("worca.orchestrator.runner.create_branch"):
                with patch("worca.orchestrator.runner._write_pid"):
                    with patch("worca.orchestrator.runner._remove_pid"):
                        run_pipeline(wr, settings_path=settings_path, status_path=status_path)

        import glob
        status_files = glob.glob(os.path.join(worca_dir, "runs", "*", "status.json"))
        assert status_files, "No status.json found in any run directory"
        with open(status_files[0]) as f:
            final_status = json.load(f)
        pr_stage = final_status["stages"]["plan_review"]
        assert pr_stage["mode"] == "review_and_edit"
        assert pr_stage["mode_reason"] == "from template/pipeline"

    def test_mode_persisted_for_default_review(self, tmp_path):
        """Default review mode also persists mode/mode_reason."""
        settings_path = _settings(tmp_path)
        worca_dir, status_path = _worca(tmp_path)
        wr = _wr()

        def mock_run_stage(stage, context, settings_path, msize=1, iteration=1,
                           prompt_override=None, agent_override=None, **kwargs):
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

        import glob
        status_files = glob.glob(os.path.join(worca_dir, "runs", "*", "status.json"))
        assert status_files, "No status.json found in any run directory"
        with open(status_files[0]) as f:
            final_status = json.load(f)
        pr_stage = final_status["stages"]["plan_review"]
        assert pr_stage["mode"] == "review"
        assert pr_stage["mode_reason"] == "default"
