"""Unit tests for the stage handler protocol and registry (W-071)."""

import json

import pytest

from worca.orchestrator.executor import (
    GenericHandler,
    HANDLER_REGISTRY,
    StageDecision,
    StageHandler,
    StageRunContext,
    TestHandler,
    handler_for,
)
from worca.orchestrator.flow import FlowSpec, FlowStage, Transition
from worca.state.status import init_status, start_iteration


class FakePromptBuilder:
    """Minimal PromptBuilder stand-in: context dict + save tracking."""

    def __init__(self):
        self._context = {}
        self.saved_to = []

    def get_context(self, key, default=None):
        return self._context.get(key, default)

    def update_context(self, key, value):
        self._context[key] = value

    def pop_context(self, key):
        return self._context.pop(key, None)

    def save_context(self, path):
        self.saved_to.append(path)


def _default_like_flow():
    """A flow with the builtin test->implement loopback declared."""
    return FlowSpec([
        FlowStage(name="implement", agent="implementer", schema="implement.json",
                  prompt_block="implement"),
        FlowStage(name="test", agent="tester", schema="test_result.json",
                  prompt_block="test",
                  on={"test_failure": Transition(goto="implement", loop="implement_test")}),
        FlowStage(name="review", agent="reviewer", schema="review.json",
                  prompt_block="review"),
    ])


def _flow_without_loopback():
    """A flow where test has no test_failure transition (implement disabled)."""
    return FlowSpec([
        FlowStage(name="test", agent="tester", schema="test_result.json",
                  prompt_block="test"),
        FlowStage(name="review", agent="reviewer", schema="review.json",
                  prompt_block="review"),
    ])


def make_rc(tmp_path, flow, stage_name="test", trigger="initial",
            loop_counters=None, settings=None):
    """A StageRunContext primed for post_dispatch testing (ctx=None)."""
    settings_path = tmp_path / "settings.json"
    settings_path.write_text(json.dumps(settings or {}), encoding="utf-8")

    status = init_status({"title": "t", "description": "d"}, "branch-x")
    status["run_id"] = "run-test-1"

    rc = StageRunContext()
    rc.flow = flow
    rc.status = status
    rc.prompt_builder = FakePromptBuilder()
    rc.loop_counters = loop_counters if loop_counters is not None else {}
    rc.settings_path = str(settings_path)
    rc.actual_status_path = str(tmp_path / "status.json")
    rc.prompt_context_path = str(tmp_path / "prompt_context.json")
    rc.ctx = None  # no EventContext — event emission paths are no-ops

    flow_stage = flow.stages[flow.index_of(stage_name)]
    start_iteration(status, stage_name, agent=flow_stage.agent,
                    model="sonnet", trigger=trigger)
    rc.begin_pass(
        flow_stage=flow_stage,
        trigger=trigger,
        stage_config={"agent": flow_stage.agent, "model": "sonnet"},
        iter_num=1,
        iter_record=status["stages"][stage_name]["iterations"][-1],
    )
    rc.iter_extras = {"status": "completed", "completed_at": "now", "duration_ms": 1}
    rc.stage_extras = {"status": "completed", "completed_at": "now"}
    return rc


# ---------------------------------------------------------------------------
# Registry / protocol
# ---------------------------------------------------------------------------

class TestHandlerRegistry:
    def test_handler_registry_covers_builtin_flow(self):
        """Every default-flow stage (and learn) has a registered handler."""
        from worca.orchestrator.stages import STAGE_ORDER, Stage
        for stage in list(STAGE_ORDER) + [Stage.LEARN]:
            assert stage.value in HANDLER_REGISTRY, (
                f"builtin stage {stage.value!r} has no registered handler"
            )

    def test_runner_has_no_stage_enum_ladder(self):
        """W-071 obstacle #7 grep-gate: the per-stage enum ladder must not
        regrow in runner.py — `== Stage.` / `!= Stage.` comparisons belong in
        the handler registry (executor.py), never in the loop."""
        import pathlib
        import re

        import worca.orchestrator.runner as runner_module
        src = pathlib.Path(runner_module.__file__).read_text(encoding="utf-8")
        matches = re.findall(r".*[=!]= Stage\..*", src)
        assert matches == [], f"Stage-enum comparisons found in runner.py: {matches}"

    def test_test_stage_resolves_to_test_handler(self):
        assert isinstance(handler_for("test"), TestHandler)

    def test_unknown_stage_resolves_to_generic_handler(self):
        h = handler_for("docs_audit")
        assert isinstance(h, GenericHandler)

    def test_handler_instances_are_fresh_per_call(self):
        assert handler_for("test") is not handler_for("test")

    def test_registry_values_are_stage_handlers(self):
        for name, cls in HANDLER_REGISTRY.items():
            assert issubclass(cls, StageHandler)
            assert cls.name == name

    def test_base_handler_defaults(self):
        h = StageHandler()
        rc = StageRunContext()
        rc.loop_counters = {"test_iteration": 3}
        rc.flow_stage = FlowStage(name="test", prompt_block="test")
        rc.stage_name = "test"
        assert h.is_agent_stage is True
        assert h.rerun_on_resume is False
        assert h.iteration_kwargs(rc) == {}
        assert h.pb_iteration(rc) == 3
        assert h.block_name(rc) == "test"


class TestStageDecision:
    def test_factories(self):
        assert StageDecision.advance().action == StageDecision.ADVANCE
        j = StageDecision.jump("test_failure", "implement")
        assert (j.action, j.trigger, j.goto) == (StageDecision.JUMP, "test_failure", "implement")
        assert StageDecision.repeat().action == StageDecision.REPEAT
        assert StageDecision.pause_return().action == StageDecision.PAUSE_RETURN
        assert StageDecision.skip_advance().action == StageDecision.SKIP_ADVANCE


class TestStageRunContext:
    def test_slots_reject_unknown_fields(self):
        rc = StageRunContext()
        with pytest.raises(AttributeError):
            rc.no_such_field = 1

    def test_stage_arg_maps_builtin_names_to_enum(self):
        from worca.orchestrator.stages import Stage
        rc = StageRunContext()
        rc.stage_name = "test"
        assert rc.stage_arg is Stage.TEST
        rc.stage_name = "docs_audit"
        assert rc.stage_arg == "docs_audit"

    def test_begin_pass_resets_per_pass_fields(self):
        rc = StageRunContext()
        rc.result = {"stale": True}
        rc.assigned_bead = "bead-1"
        rc.begin_pass(flow_stage=FlowStage(name="test"), trigger="initial",
                      stage_config={"agent": "tester"})
        assert rc.result is None
        assert rc.assigned_bead is None
        assert rc.stage_name == "test"
        assert rc.agent_name == "tester"
        assert rc.effort_env_overrides == {}


# ---------------------------------------------------------------------------
# TestHandler decision mapping
# ---------------------------------------------------------------------------

class TestTestHandlerPostDispatch:
    def test_passed_advances(self, tmp_path):
        rc = make_rc(tmp_path, _default_like_flow())
        rc.result = {"passed": True, "coverage_pct": 90}
        decision = TestHandler().post_dispatch(rc)
        assert decision.action == StageDecision.ADVANCE
        assert rc.iter_extras["outcome"] == "success"
        assert rc.prompt_builder.get_context("test_passed") is True
        assert rc.prompt_builder.get_context("test_coverage") == 90

    def test_failure_within_limit_jumps_to_goto(self, tmp_path):
        rc = make_rc(tmp_path, _default_like_flow())
        rc.result = {"passed": False, "failures": [{"test": "t1"}]}
        decision = TestHandler().post_dispatch(rc)
        assert decision.action == StageDecision.JUMP
        assert decision.trigger == "test_failure"
        assert decision.goto == "implement"
        assert rc.loop_counters["implement_test"] == 1
        assert rc.iter_extras["outcome"] == "test_failure"
        # failure history + fix-mode context threaded
        assert rc.prompt_builder.get_context("test_failures") == [{"test": "t1"}]
        assert rc.prompt_builder.get_context("bead_prompt_iteration") == 1
        # context persisted before the jump
        assert rc.prompt_context_path in rc.prompt_builder.saved_to

    def test_failure_without_transition_advances(self, tmp_path):
        rc = make_rc(tmp_path, _flow_without_loopback())
        rc.result = {"passed": False, "failures": []}
        decision = TestHandler().post_dispatch(rc)
        assert decision.action == StageDecision.ADVANCE
        # no loop counter touched — there is no transition to count against
        assert "implement_test" not in rc.loop_counters

    def test_failure_exhausted_advances(self, tmp_path):
        # default limit is 5; counter at 5 means the increment lands at 6 > limit
        rc = make_rc(tmp_path, _default_like_flow(),
                     loop_counters={"implement_test": 5})
        rc.result = {"passed": False, "failures": [{"test": "t1"}]}
        decision = TestHandler().post_dispatch(rc)
        assert decision.action == StageDecision.ADVANCE
        assert rc.loop_counters["implement_test"] == 6

    def test_failure_respects_custom_loop_key(self, tmp_path):
        flow = FlowSpec([
            FlowStage(name="implement", agent="implementer"),
            FlowStage(name="test", agent="tester",
                      on={"test_failure": Transition(goto="implement", loop="my_loop")}),
        ])
        rc = make_rc(tmp_path, flow)
        rc.result = {"passed": False, "failures": [{"test": "t1"}]}
        decision = TestHandler().post_dispatch(rc)
        assert decision.action == StageDecision.JUMP
        assert rc.loop_counters["my_loop"] == 1

    def test_failure_clears_review_context(self, tmp_path):
        rc = make_rc(tmp_path, _default_like_flow())
        rc.prompt_builder.update_context("review_issues", ["x"])
        rc.prompt_builder.update_context("review_history", ["y"])
        rc.result = {"passed": False, "failures": [{"test": "t1"}]}
        TestHandler().post_dispatch(rc)
        assert rc.prompt_builder.get_context("review_issues") is None
        assert rc.prompt_builder.get_context("review_history") is None


# ---------------------------------------------------------------------------
# Generic completion path — outcome→trigger mapping (W-071 §2)
# ---------------------------------------------------------------------------

def _custom_flow():
    """implement + a docs_audit custom stage with a needs_rework loopback."""
    return FlowSpec([
        FlowStage(name="implement", agent="implementer", schema="implement.json"),
        FlowStage(name="docs_audit", agent="docs_auditor", schema="docs_audit.json",
                  on={"needs_rework": Transition(goto="implement", loop="docs_rework"),
                      "extra_pass": Transition(goto="docs_audit", loop="extra_pass_loop")}),
    ])


class TestGenericHandlerPostDispatch:
    def test_marks_success_and_advances(self, tmp_path):
        flow = FlowSpec([FlowStage(name="test", agent="tester")])
        rc = make_rc(tmp_path, flow)
        rc.result = {"anything": True}
        decision = GenericHandler().post_dispatch(rc)
        assert decision.action == StageDecision.ADVANCE
        assert rc.iter_extras["outcome"] == "success"
        assert rc.status["stages"]["test"]["status"] == "completed"

    def test_missing_outcome_advances(self, tmp_path):
        rc = make_rc(tmp_path, _custom_flow(), stage_name="docs_audit")
        rc.result = {"summary": "no outcome field"}
        decision = GenericHandler().post_dispatch(rc)
        assert decision.action == StageDecision.ADVANCE
        assert rc.iter_extras["outcome"] == "success"

    def test_declared_outcome_jumps_with_outcome_as_trigger(self, tmp_path):
        rc = make_rc(tmp_path, _custom_flow(), stage_name="docs_audit")
        rc.result = {"outcome": "needs_rework"}
        decision = GenericHandler().post_dispatch(rc)
        assert decision.action == StageDecision.JUMP
        assert decision.trigger == "needs_rework"
        assert decision.goto == "implement"
        assert rc.loop_counters["docs_rework"] == 1
        assert rc.iter_extras["outcome"] == "needs_rework"
        # context persisted before the jump
        assert rc.prompt_context_path in rc.prompt_builder.saved_to

    def test_declared_outcome_exhausted_loop_advances(self, tmp_path):
        rc = make_rc(tmp_path, _custom_flow(), stage_name="docs_audit",
                     loop_counters={"docs_rework": 5})  # default limit 5
        rc.result = {"outcome": "needs_rework"}
        decision = GenericHandler().post_dispatch(rc)
        assert decision.action == StageDecision.ADVANCE
        assert rc.loop_counters["docs_rework"] == 6

    def test_reject_outcome_raises_stage_failure(self, tmp_path):
        from worca.orchestrator.runner import PipelineError
        rc = make_rc(tmp_path, _custom_flow(), stage_name="docs_audit")
        rc.result = {"outcome": "reject"}
        with pytest.raises(PipelineError):
            GenericHandler().post_dispatch(rc)
        # the iteration was still recorded with the reject outcome
        assert rc.iter_extras["outcome"] == "reject"

    def test_declared_reject_transition_wins_over_failure(self, tmp_path):
        """A flow that declares on.reject gets a jump, not a stage failure."""
        flow = FlowSpec([
            FlowStage(name="implement", agent="implementer"),
            FlowStage(name="docs_audit", agent="docs_auditor",
                      on={"reject": Transition(goto="implement", loop="rework")}),
        ])
        rc = make_rc(tmp_path, flow, stage_name="docs_audit")
        rc.result = {"outcome": "reject"}
        decision = GenericHandler().post_dispatch(rc)
        assert decision.action == StageDecision.JUMP
        assert decision.goto == "implement"

    def test_undeclared_outcome_advances_with_warning(self, tmp_path):
        from unittest.mock import patch
        rc = make_rc(tmp_path, _custom_flow(), stage_name="docs_audit")
        rc.result = {"outcome": "mystery"}
        with patch("worca.orchestrator.runner._log") as mock_log:
            decision = GenericHandler().post_dispatch(rc)
        assert decision.action == StageDecision.ADVANCE
        assert any("mystery" in str(c.args[0]) for c in mock_log.call_args_list)

    def test_forward_jump_without_loop_key(self, tmp_path):
        """A declared forward transition with no loop key jumps unconditionally."""
        flow = FlowSpec([
            FlowStage(name="docs_audit", agent="docs_auditor",
                      on={"escalate": Transition(goto="final_check")}),
            FlowStage(name="final_check", agent="final_checker"),
        ])
        rc = make_rc(tmp_path, flow, stage_name="docs_audit")
        rc.result = {"outcome": "escalate"}
        decision = GenericHandler().post_dispatch(rc)
        assert decision.action == StageDecision.JUMP
        assert decision.goto == "final_check"
        assert rc.loop_counters == {}
