"""Stage handler protocol, registry, and builtin handlers (W-071).

Extracts the per-stage bespoke logic from the runner's main loop into
``StageHandler`` classes so the loop body becomes a generic dispatch path:
resolve handler -> hooks -> dispatch -> ``post_dispatch`` -> apply the
returned :class:`StageDecision`. Builtin stages keep their bespoke logic as
registered handlers (pure code motion from ``runner.py``); a stage named in
the flow with no registered handler falls back to :class:`GenericHandler`,
which is what user-defined stages take.

Design notes (deviations from the W-071 sketch, both deliberate):

- The protocol carries more hooks than the sketch's three
  (``pre_dispatch``/``dispatch``/``post_dispatch``) because the bespoke
  blocks were interleaved with the shared scaffolding at several distinct
  points (effort resolution, iteration start, context build, prompt-block
  selection). Each hook maps to exactly one such interleaving point; the
  shared scaffolding stays in the runner loop.
- Handlers resolve every runner symbol dynamically through the module object
  (``_runner().<name>``) instead of importing names. This keeps the existing
  unit tests working — they patch ``worca.orchestrator.runner.<symbol>``
  (``run_stage``, ``emit_event``, ``_log``, …) and expect the pipeline to see
  the patch. It also breaks the runner<->executor import cycle (the runner
  imports this module at top level).

State contract: :class:`StageRunContext` is the single mutable bag shared
between the loop and the handlers. Run-level fields are set once before the
loop; per-pass fields are reset by ``begin_pass`` each iteration. Handler
instances are created fresh per loop pass, so instance attributes may carry
intra-pass state between hooks (e.g. the plan-review mode), never cross-pass
state — cross-pass state lives on the context (``created_bead_count``,
``pr_baseline_head``, …) or in ``status``/``prompt_builder`` as before.
"""

import os
from datetime import datetime, timezone

from worca.orchestrator.stages import Stage


def _runner():
    """The runner module, resolved lazily.

    Late import avoids the circular import (runner imports this module), and
    attribute access at call time keeps ``unittest.mock.patch`` on
    ``worca.orchestrator.runner.*`` effective inside handlers.
    """
    from worca.orchestrator import runner
    return runner


class StageDecision:
    """What the loop should do after a stage's ``post_dispatch``.

    - ``advance``: fall through to the bottom-of-loop persist and move to the
      next stage (``stage_idx + 1``).
    - ``jump``: an outcome-driven transition — the loop records the trigger
      for the target stage and jumps via ``flow.next_index``.
    - ``repeat``: re-enter the same stage without recording a trigger
      (PR verification retry).
    - ``pause_return``: return from ``run_pipeline`` leaving the run paused
      (PR approval gate).
    - ``skip_advance``: stage short-circuited during dispatch (preflight
      ``--skip-preflight``); advance without the bottom-of-loop persist.
    """

    ADVANCE = "advance"
    JUMP = "jump"
    REPEAT = "repeat"
    PAUSE_RETURN = "pause_return"
    SKIP_ADVANCE = "skip_advance"

    __slots__ = ("action", "trigger", "goto")

    def __init__(self, action, trigger=None, goto=None):
        self.action = action
        self.trigger = trigger
        self.goto = goto

    def __repr__(self):
        extra = f", trigger={self.trigger!r}, goto={self.goto!r}" if self.trigger else ""
        return f"StageDecision({self.action!r}{extra})"

    @classmethod
    def advance(cls):
        return cls(cls.ADVANCE)

    @classmethod
    def jump(cls, trigger, goto):
        return cls(cls.JUMP, trigger=trigger, goto=goto)

    @classmethod
    def repeat(cls):
        return cls(cls.REPEAT)

    @classmethod
    def pause_return(cls):
        return cls(cls.PAUSE_RETURN)

    @classmethod
    def skip_advance(cls):
        return cls(cls.SKIP_ADVANCE)


class StageRunContext:
    """Mutable state shared between the runner loop and stage handlers.

    Exactly the loop-local state the bespoke per-stage blocks already touched,
    passed as one object. ``__slots__`` guards against typo'd field names.
    """

    __slots__ = (
        # --- run-level (set once, before the loop) ---
        "flow", "status", "prompt_builder", "loop_counters", "next_trigger",
        "settings_path", "actual_status_path", "status_path",
        "worca_dir", "registry_dir", "run_dir", "logs_dir",
        "prompt_context_path", "ctx", "work_request", "branch_name",
        "msize", "mloops", "max_beads_override", "skip_preflight",
        "context", "run_id_param", "project_root",
        # --- cross-stage mutable (set by handlers / resume restore) ---
        "created_bead_count", "pr_baseline_head",
        "graphify_out", "crg_data_dir", "crg_cfg",
        # --- per-pass (reset by begin_pass) ---
        "flow_stage", "stage_name", "trigger", "stage_config", "agent_name",
        "iter_num", "iter_record", "effort_env_overrides", "effort_dict",
        "assigned_bead", "ctx_dict", "rendered_prompt", "agent_override",
        "result", "raw_envelope", "usage", "iter_extras", "stage_extras",
        "t0",
    )

    def __init__(self):
        for name in self.__slots__:
            setattr(self, name, None)
        self.loop_counters = {}
        self.next_trigger = {}
        self.created_bead_count = 0
        self.msize = 1
        self.mloops = 1

    def begin_pass(self, *, flow_stage, trigger, stage_config, iter_num=None,
                   iter_record=None):
        """Reset per-pass fields at the top of a loop iteration."""
        self.flow_stage = flow_stage
        self.stage_name = flow_stage.name if flow_stage is not None else None
        self.trigger = trigger
        self.stage_config = stage_config
        self.agent_name = (stage_config or {}).get("agent")
        self.iter_num = iter_num
        self.iter_record = iter_record
        self.effort_env_overrides = {}
        self.effort_dict = None
        self.assigned_bead = None
        self.ctx_dict = None
        self.rendered_prompt = None
        self.agent_override = None
        self.result = None
        self.raw_envelope = None
        self.usage = None
        self.iter_extras = None
        self.stage_extras = None
        self.t0 = None

    @property
    def stage_arg(self):
        """The ``stage`` argument passed to ``run_stage``.

        Builtin stage names map back to their :class:`Stage` enum member
        (keeps existing call-signature expectations stable); custom stage
        names pass through as strings.
        """
        try:
            return Stage(self.stage_name)
        except ValueError:
            return self.stage_name


class StageHandler:
    """Base handler: the generic dispatch path every stage shares.

    Subclasses override only the hooks where the legacy loop had bespoke
    logic for their stage. Each hook corresponds to one interleaving point in
    the loop; see the module docstring.
    """

    #: stage key this handler serves (status.json ``stages.*`` key)
    name: str = ""
    #: False only for preflight — gates effort resolution, context/prompt
    #: build, circuit-breaker accounting, and agent-metric extras.
    is_agent_stage = True
    #: True only for preflight — it always re-runs on resume.
    rerun_on_resume = False

    # --- pre-iteration hooks -------------------------------------------------

    def pre_iteration(self, rc: StageRunContext) -> None:
        """Before effort resolution / ``start_iteration``.

        May set ``rc.assigned_bead`` (implement) and seed
        ``rc.effort_env_overrides`` (pr revise mode).
        """

    def iteration_kwargs(self, rc: StageRunContext) -> dict:
        """Extra kwargs merged into ``start_iteration`` (implement bead linkage)."""
        return {}

    def on_stage_started(self, rc: StageRunContext) -> None:
        """After the STAGE_STARTED event (test/review suite-started events)."""

    # --- context/prompt hooks ------------------------------------------------

    def assign_work(self, rc: StageRunContext) -> None:
        """Before context build: claim work units (implement bead claim)."""

    def pb_iteration(self, rc: StageRunContext) -> int:
        """Iteration number passed to ``prompt_builder.build_context``."""
        return rc.loop_counters.get(f"{rc.stage_name}_iteration", 0)

    def pre_build_context(self, rc: StageRunContext) -> None:
        """Right before ``build_context`` (coordinate max-beads threading)."""

    def post_build_context(self, rc: StageRunContext) -> None:
        """Right after ``build_context``.

        May mutate ``rc.ctx_dict``, ``rc.agent_name``, and
        ``rc.effort_env_overrides`` (plan-review edit-mode minting,
        coordinate effective-cap persistence).
        """

    def block_name(self, rc: StageRunContext):
        """The ``.block.md`` name routed to the -p user message."""
        return rc.flow_stage.prompt_block if rc.flow_stage is not None else None

    # --- dispatch ------------------------------------------------------------

    def pre_dispatch(self, rc: StageRunContext) -> None:
        """First thing inside the dispatch ``try`` (beads init, PR baseline)."""

    def dispatch(self, rc: StageRunContext):
        """Run the stage; set ``rc.result`` and ``rc.raw_envelope``.

        Returning a :class:`StageDecision` short-circuits the pass (the
        preflight ``--skip-preflight`` path); returning None continues into
        the shared completion bookkeeping.
        """
        r = _runner()
        # Re-check shutdown flag before spawning a subprocess. The loop's
        # earlier check runs before context building; a signal arriving in
        # that gap would set the flag but miss the earlier guard.
        if r._shutdown_requested:
            raise InterruptedError("Pipeline shutdown requested before stage execution")
        rc.result, rc.raw_envelope = r.run_stage(
            rc.stage_arg, rc.context, rc.settings_path,
            msize=rc.msize, iteration=rc.iter_num,
            prompt_override=rc.rendered_prompt,
            agent_override=rc.agent_override,
            ctx=rc.ctx,
            env_overrides=rc.effort_env_overrides,
            graphify_out=rc.graphify_out,
            crg_data_dir=rc.crg_data_dir,
            bead_id=rc.assigned_bead,
        )
        return None

    # --- completion ----------------------------------------------------------

    def post_dispatch(self, rc: StageRunContext) -> StageDecision:
        """Stage-specific completion: outcome mapping, loop-backs, milestones.

        The base implementation is the legacy loop's default arm: mark the
        iteration successful and advance.
        """
        r = _runner()
        rc.iter_extras["outcome"] = "success"
        r.complete_iteration(rc.status, rc.stage_name, **rc.iter_extras)
        r.update_stage(rc.status, rc.stage_name, **rc.stage_extras)
        r.save_status(rc.status, rc.actual_status_path)
        if rc.ctx:
            r._emit_stage_completed_and_gate(
                rc.ctx, rc.stage_name, rc.iter_num, rc.iter_extras,
            )
        return StageDecision.advance()


class TestHandler(StageHandler):
    """TEST stage: suite events, failure history threading, test-fix loop."""

    name = Stage.TEST.value

    def on_stage_started(self, rc):
        r = _runner()
        if rc.ctx:
            r.emit_event(rc.ctx, r.TEST_SUITE_STARTED, r.test_suite_started_payload(
                stage=rc.stage_name,
                iteration=rc.iter_num,
                trigger=rc.trigger,
            ))

    def post_dispatch(self, rc):
        r = _runner()
        result = rc.result
        iter_extras = rc.iter_extras
        r._aggregate_file_access_into_extras(
            iter_extras, rc.settings_path, rc.status, rc.stage_name, rc.iter_num,
            bead_id=rc.assigned_bead,
        )

        passed = result.get("passed", False)
        r._emit_guide_conflicts(rc.ctx, "test", result)
        # Thread test outputs into PromptBuilder
        rc.prompt_builder.update_context("test_passed", passed)
        rc.prompt_builder.update_context("test_coverage", result.get("coverage_pct"))
        rc.prompt_builder.update_context("proof_artifacts", result.get("proof_artifacts", []))
        if not passed:
            new_failures = result.get("failures", [])
            # Accumulate test failure history
            prev_history = rc.prompt_builder.get_context("test_failure_history") or []
            prev_history.append({"attempt": len(prev_history) + 1, "failures": new_failures})
            rc.prompt_builder.update_context("test_failure_history", prev_history)
            rc.prompt_builder.update_context("test_failures", new_failures)
            rc.prompt_builder.update_context("review_issues", None)
            rc.prompt_builder.update_context("review_history", None)
            iter_extras["outcome"] = "test_failure"
            r.complete_iteration(rc.status, rc.stage_name, **iter_extras)
            r._emit_iteration_access_event(rc.ctx, rc.status, rc.stage_name, rc.status["run_id"])
            r.update_stage(rc.status, rc.stage_name, **rc.stage_extras)
            r.save_status(rc.status, rc.actual_status_path)
            if rc.ctx:
                r.emit_event(rc.ctx, r.TEST_SUITE_FAILED, r.test_suite_failed_payload(
                    iteration=rc.iter_num,
                    failure_count=len(new_failures),
                    failures=new_failures,
                ))
                r._emit_stage_completed_and_gate(rc.ctx, rc.stage_name, rc.iter_num, iter_extras)
            # Declarative jump (W-070): the flow declares whether (and
            # where) test_failure loops back. No transition = the
            # legacy "IMPLEMENT stage is disabled" case.
            _tf_tr = rc.flow.transition_for(rc.stage_name, "test_failure")
            if _tf_tr is None:
                r._log("Tests failed but the flow has no test_failure loop (IMPLEMENT stage disabled) — treating as pass", "warn")
            else:
                _tf_loop = _tf_tr.loop or "implement_test"
                # Flat test-fix counter (not per-bead)
                rc.loop_counters[_tf_loop] = rc.loop_counters.get(_tf_loop, 0) + 1
                rc.status["loop_counters"] = dict(rc.loop_counters)
                bead_prompt_iter = rc.prompt_builder.get_context("bead_prompt_iteration") or 0
                rc.prompt_builder.update_context("bead_prompt_iteration", bead_prompt_iter + 1)
                r._log(f"Tests failed — looping back to {_tf_tr.goto.upper()} fix mode (attempt {rc.loop_counters[_tf_loop]})", "warn")
                if r.check_loop_limit(_tf_loop, rc.loop_counters[_tf_loop], rc.settings_path, mloops=rc.mloops):
                    if rc.ctx:
                        r.emit_event(rc.ctx, r.TEST_FIX_ATTEMPT, r.test_fix_attempt_payload(
                            attempt=rc.loop_counters[_tf_loop],
                            limit=r._get_loop_limit(_tf_loop, rc.settings_path, rc.mloops),
                            failures_summary=str(new_failures[:3]),
                        ))
                        r._emit_loop_triggered_and_gate(
                            rc.ctx, _tf_loop, rc.loop_counters[_tf_loop],
                            rc.stage_name, _tf_tr.goto, "test_failure",
                        )
                    if rc.prompt_context_path:
                        rc.prompt_builder.save_context(rc.prompt_context_path)
                    r.save_status(rc.status, rc.actual_status_path)
                    return StageDecision.jump("test_failure", _tf_tr.goto)
                else:
                    r._log(f"Test fix limit exhausted after {rc.loop_counters[_tf_loop]} attempts — finishing", "warn")
                    if rc.ctx:
                        r.emit_event(rc.ctx, r.LOOP_EXHAUSTED, r.loop_exhausted_payload(
                            loop_key=_tf_loop,
                            iteration=rc.loop_counters[_tf_loop],
                            limit=r._get_loop_limit(_tf_loop, rc.settings_path, rc.mloops),
                        ))
        else:
            iter_extras["outcome"] = "success"
            r.complete_iteration(rc.status, rc.stage_name, **iter_extras)
            r._emit_iteration_access_event(rc.ctx, rc.status, rc.stage_name, rc.status["run_id"])
            r.update_stage(rc.status, rc.stage_name, **rc.stage_extras)
            r.save_status(rc.status, rc.actual_status_path)
            if rc.ctx:
                r.emit_event(rc.ctx, r.TEST_SUITE_PASSED, r.test_suite_passed_payload(
                    iteration=rc.iter_num,
                    coverage_pct=result.get("coverage_pct"),
                    proof_artifacts=result.get("proof_artifacts"),
                ))
                r._emit_stage_completed_and_gate(rc.ctx, rc.stage_name, rc.iter_num, iter_extras)
            r._log("Tests passed", "ok")
        return StageDecision.advance()


class GenericHandler(StageHandler):
    """Fallback for stages with no registered handler — user-defined stages.

    Phase 1 note: outcome→trigger mapping (W-071 §2) lands with Phase 3;
    until then this is the plain generic completion path.
    """


#: stage key -> handler class. Grows per stage move (W-071 Phase 1-2);
#: stages not present here resolve to :class:`GenericHandler`.
HANDLER_REGISTRY: dict = {
    Stage.TEST.value: TestHandler,
}


def handler_for(stage_name: str) -> StageHandler:
    """A fresh handler instance for a stage key (GenericHandler fallback)."""
    return HANDLER_REGISTRY.get(stage_name, GenericHandler)()
