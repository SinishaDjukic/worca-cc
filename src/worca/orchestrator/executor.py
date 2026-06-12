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
import time
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


# Sentinel distinguishing "pointer target absent" from a stored None value.
_POINTER_MISS = object()


def resolve_json_pointer(doc, pointer: str):
    """Resolve an RFC-6901-style JSON pointer against a dict/list document.

    Supports dict keys and numeric list indices (the subset flow output
    declarations use — see flow.json). Returns ``_POINTER_MISS`` when any
    segment is absent, so callers can skip publication for optional fields
    instead of publishing a literal None.
    """
    cur = doc
    for seg in pointer.lstrip("/").split("/"):
        seg = seg.replace("~1", "/").replace("~0", "~")
        if isinstance(cur, dict):
            if seg not in cur:
                return _POINTER_MISS
            cur = cur[seg]
        elif isinstance(cur, list) and seg.isdigit() and int(seg) < len(cur):
            cur = cur[int(seg)]
        else:
            return _POINTER_MISS
    return cur


def publish_declared_outputs(prompt_builder, flow_stage, result: dict) -> list:
    """Publish a stage's declared outputs into the namespaced context (W-072).

    Runs after schema validation, before the handler's ``post_dispatch`` —
    each declared output is extracted from the validated structured result
    via its JSON pointer and published as ``stages.<name>.<output>`` (with a
    legacy flat dual-write where an alias exists). Absent pointer targets
    (optional schema fields the agent omitted) are skipped — a missing key
    renders falsy/empty downstream, which is the contract for optionals.

    Returns the list of output names actually published.
    """
    published = []
    for name, pointer in (flow_stage.outputs or {}).items():
        value = resolve_json_pointer(result, pointer)
        if value is _POINTER_MISS:
            continue
        prompt_builder.publish_output(flow_stage.name, name, value)
        published.append(name)
    return published


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
    #: Flat context keys this handler publishes in code (transforms/filters
    #: that aren't declarative schema picks). Lint metadata only (W-072 §3) —
    #: the consumption lint treats them as declared producer outputs.
    code_outputs: tuple = ()

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
            flow_stage=rc.flow_stage,
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


class PreflightHandler(StageHandler):
    """PREFLIGHT: script-driven checks; no agent, no prompt/context build."""

    name = Stage.PREFLIGHT.value
    is_agent_stage = False
    rerun_on_resume = True

    def dispatch(self, rc):
        r = _runner()
        if rc.skip_preflight:
            r._log("PREFLIGHT skipped (--skip-preflight)", "warn")
            stage_completed = datetime.now(timezone.utc).isoformat()
            _elapsed_ms = int((time.time() - rc.t0) * 1000)
            r.complete_iteration(
                rc.status, rc.stage_name,
                status="completed",
                completed_at=stage_completed,
            )
            r.update_stage(
                rc.status, rc.stage_name,
                status="completed",
                skipped=True,
                completed_at=stage_completed,
            )
            r.save_status(rc.status, rc.actual_status_path)
            if rc.ctx:
                r.emit_event(rc.ctx, r.PREFLIGHT_SKIPPED, r.preflight_skipped_payload(
                    reason="--skip-preflight",
                ))
                r._emit_stage_completed_and_gate(
                    rc.ctx, rc.stage_name, rc.iter_num,
                    {"duration_ms": _elapsed_ms, "cost_usd": 0.0,
                     "turns": 0, "outcome": "skipped"},
                )
            return StageDecision.skip_advance()
        rc.result = r.run_preflight(rc.context, rc.settings_path, iteration=rc.iter_num)
        rc.raw_envelope = {"type": "preflight", "checks": rc.result.get("checks", [])}
        return None

    def post_dispatch(self, rc):
        r = _runner()
        result = rc.result
        status = rc.status
        iter_extras = rc.iter_extras
        preflight_skipped = result.get("status") == "skipped"
        iter_extras["outcome"] = "skipped" if preflight_skipped else "success"
        # No AI call — zero out session/api so timing bar shows this as pipeline overhead
        iter_extras.setdefault("duration_session_ms", 0)
        iter_extras.setdefault("duration_api_ms", 0)
        r.complete_iteration(status, rc.stage_name, **iter_extras)
        _pf_stage_extras = {**rc.stage_extras, "skipped": preflight_skipped}
        # Run-level graphify enablement (single source of truth for the
        # UI: drives "(disabled)" vs an integer invocation count).
        try:
            _gfx_cfg = r.effective_graphify_config(
                r.load_global_settings(), r.load_settings(rc.settings_path)
            )
            status["graphify_enabled"] = bool(_gfx_cfg.enabled)
        except Exception:
            status["graphify_enabled"] = False
        if result.get("graphify_status"):
            status["graphify_status"] = result["graphify_status"]
            _pf_stage_extras["graphify_status"] = result["graphify_status"]
        for _gfx_key in ("graphify_outcome", "graphify_mode", "graphify_reason"):
            if result.get(_gfx_key):
                status[_gfx_key] = result[_gfx_key]
                _pf_stage_extras[_gfx_key] = result[_gfx_key]
        if result.get("graphify_report_path"):
            status["graphify_report_path"] = result["graphify_report_path"]
            _pf_stage_extras["graphify_report_path"] = result["graphify_report_path"]
            _rp = result["graphify_report_path"]
            if os.path.isfile(_rp):
                # Agents query the graph on demand via GRAPHIFY_OUT; the
                # prompt only carries a per-run availability note.
                rc.graphify_out = os.path.dirname(_rp)
                rc.prompt_builder.set_graphify_available(True)
                r._log(
                    "Graphify: ready — agents query the cached graph via "
                    f"GRAPHIFY_OUT={rc.graphify_out}"
                )
        if result.get("crg_status"):
            status["crg_status"] = result["crg_status"]
            _pf_stage_extras["crg_status"] = result["crg_status"]
        if result.get("crg_outcome"):
            status["crg_outcome"] = result["crg_outcome"]
            _pf_stage_extras["crg_outcome"] = result["crg_outcome"]
        if result.get("crg_reason"):
            status["crg_reason"] = result["crg_reason"]
            _pf_stage_extras["crg_reason"] = result["crg_reason"]
        if result.get("crg_data_dir"):
            _crg_dd = result["crg_data_dir"]
            if os.path.isdir(_crg_dd):
                rc.crg_data_dir = _crg_dd
                status["crg_data_dir"] = _crg_dd
                _pf_stage_extras["crg_data_dir"] = _crg_dd
                rc.prompt_builder.set_crg_available(True)
                r._log(f"CRG: ready — agents get MCP tools via crg_data_dir={rc.crg_data_dir}")
        try:
            rc.crg_cfg = r.effective_crg_config(
                r.load_global_settings(), r.load_settings(rc.settings_path)
            )
            status["crg_enabled"] = bool(rc.crg_cfg.enabled)
        except Exception:
            status["crg_enabled"] = False
        r.update_stage(status, rc.stage_name, **_pf_stage_extras)
        r.save_status(status, rc.actual_status_path)
        if rc.ctx:
            if preflight_skipped:
                r.emit_event(rc.ctx, r.PREFLIGHT_SKIPPED, r.preflight_skipped_payload(
                    reason=result.get("summary", "preflight skipped"),
                ))
            else:
                _pf_checks = result.get("checks", [])
                _pf_all_passed = all(
                    c.get("status") in ("pass", "warn") for c in _pf_checks
                ) if _pf_checks else True
                r.emit_event(rc.ctx, r.PREFLIGHT_COMPLETED, r.preflight_completed_payload(
                    checks=_pf_checks,
                    all_passed=_pf_all_passed,
                ))
            r._emit_stage_completed_and_gate(rc.ctx, rc.stage_name, rc.iter_num, iter_extras)
        return StageDecision.advance()


class PlanHandler(StageHandler):
    """PLAN: plan-file materialization guard + plan_approved milestone gate."""

    name = Stage.PLAN.value

    def post_dispatch(self, rc):
        r = _runner()
        result = rc.result
        status = rc.status
        iter_extras = rc.iter_extras
        r._aggregate_file_access_into_extras(
            iter_extras, rc.settings_path, status, rc.stage_name, rc.iter_num,
            bead_id=rc.assigned_bead,
        )

        # Resilience guard: the planner is expected to Write its plan to
        # status["plan_file"], but agents occasionally return a complete
        # structured plan (+ prose) while skipping the file Write. The
        # stage still "succeeds" (valid structured output), yet the plan
        # file never lands on disk — so the coordinator has nothing to
        # read and the UI "View plan" button 404s ("No plan file found").
        # Materialize the structured output to the plan file so the run
        # owns a real artifact. No-op when the planner wrote the file.
        _plan_file = status.get("plan_file")
        if _plan_file and isinstance(result, dict) and not os.path.exists(_plan_file):
            try:
                _pdir = os.path.dirname(_plan_file)
                if _pdir:
                    os.makedirs(_pdir, exist_ok=True)
                with open(_plan_file, "w", encoding="utf-8") as _pf:
                    _pf.write(r._materialize_plan_markdown(result, rc.work_request))
                iter_extras["plan_materialized"] = True
                r._log(
                    "Planner produced no plan file; materialized "
                    f"{_plan_file} from structured output",
                    "warn",
                )
            except OSError as _e:
                r._log(f"Failed to materialize plan file {_plan_file}: {_e}", "err")

        # Plan approval is a webhook-controlled gate, not a planner
        # self-assessment. Default to approved; the webhook (when
        # plan_approval is enabled and a subscriber is connected) can
        # override below via "reject".
        approved = True
        iter_extras["outcome"] = "success" if approved else "rejected"
        r.complete_iteration(status, rc.stage_name, **iter_extras)
        r._emit_iteration_access_event(rc.ctx, status, rc.stage_name, status["run_id"])
        r.update_stage(status, rc.stage_name, **rc.stage_extras)
        r.set_milestone(status, "plan_approved", approved)
        _gate_action = r._emit_milestone_and_gate(
            rc.ctx, "plan_approved", approved, rc.stage_name,
        )
        if _gate_action == "approve":
            approved = True
            r.set_milestone(status, "plan_approved", True)
            iter_extras["outcome"] = "success"
        elif _gate_action == "reject":
            approved = False
            r.set_milestone(status, "plan_approved", False)
            iter_extras["outcome"] = "rejected"
        r.save_status(status, rc.actual_status_path)
        if rc.ctx:
            r._emit_stage_completed_and_gate(rc.ctx, rc.stage_name, rc.iter_num, iter_extras)
        if not approved:
            r._log("PLAN not approved — stopping", "err")
            raise r.PipelineError("Plan not approved")
        r._log("PLAN approved", "ok")
        r._emit_guide_conflicts(rc.ctx, "plan", result)
        # approach/tasks_outline are declared flow outputs (W-072) — the
        # runner loop auto-published them as stages.plan.* (with legacy flat
        # dual-writes) before this hook ran. Only the transform remains here:
        # Read plan file content now so plan_review has it immediately
        # (avoids race where plan_review starts before the file is flushed)
        _plan_path = status.get("plan_file")
        if _plan_path and os.path.exists(_plan_path):
            with open(_plan_path, encoding="utf-8") as _pf:
                _plan_text = _pf.read().strip()
            if _plan_text:
                rc.prompt_builder.update_context("plan_file_content", _plan_text)
        return StageDecision.advance()


class PlanReviewHandler(StageHandler):
    """PLAN_REVIEW: review/edit mode resolution, W-061 plan-edit minting,
    audit-trail normalization, and the plan_review_revise loop."""

    name = Stage.PLAN_REVIEW.value

    def __init__(self):
        self.mode = None
        self.mode_reason = None

    def post_build_context(self, rc):
        r = _runner()
        status = rc.status
        self.mode, self.mode_reason = r.resolve_plan_review_mode(
            r.load_settings(rc.settings_path)
        )
        r.update_stage(status, rc.stage_name, mode=self.mode, mode_reason=self.mode_reason)
        r.save_status(status, rc.actual_status_path)
        if self.mode == "review_and_edit":
            rc.agent_name = "plan_editor"
            rc.effort_env_overrides["WORCA_PLAN_REVIEWER_CAN_EDIT"] = "1"
            # W-061 reconciliation: the editor rewrites the *next*
            # numbered revision in place (plan-(N+1).md); the pre-edit
            # plan-N.md is the retained original (append-only history).
            # Copy forward, then re-point every consumer (status,
            # WORCA_PLAN_FILE, {{plan_file}}) and re-render so the
            # editor's writable-path matches the guard carve-out.
            # Idempotent across crash/resume via the plan_edit_target
            # marker (cleared in post_dispatch).
            _pre_edit_plan = status.get("plan_file", "")
            _already_minted = (
                bool(_pre_edit_plan)
                and status.get("plan_edit_target") == _pre_edit_plan
                and os.path.isfile(_pre_edit_plan)
            )
            if not _already_minted:
                _edit_target = r._mint_plan_edit_target(rc.run_dir, _pre_edit_plan)
                if _edit_target:
                    status["plan_file"] = _edit_target
                    status["plan_edit_target"] = _edit_target
                    status["plan_pre_edit_file"] = _pre_edit_plan
                    os.environ["WORCA_PLAN_FILE"] = _edit_target
                    rc.prompt_builder.update_context("plan_file", _edit_target)
                    if rc.prompt_context_path:
                        rc.prompt_builder.save_context(rc.prompt_context_path)
                    r.save_status(status, rc.actual_status_path)
                    _em_worca = r.load_settings(rc.settings_path).get("worca", {})
                    r._render_agent_templates(rc.run_dir, {
                        "plan_file": status["plan_file"],
                        "run_id": status.get("run_id", ""),
                        "branch": rc.branch_name,
                        "title": rc.work_request.title,
                    }, overrides_dir=_em_worca.get(
                           "agent_overrides_dir", ".claude/agents"),
                       template_agents_dir=_em_worca.get("_template_agents_dir"))
                    # Rebuild ctx so {{plan_content}} reflects the copy.
                    rc.ctx_dict = rc.prompt_builder.build_context(
                        rc.stage_name, self.pb_iteration(rc))
                    r._log(f"Plan edit -> {_edit_target} "
                           f"(original retained: {_pre_edit_plan})", "ok")

    def block_name(self, rc):
        if self.mode == "review_and_edit":
            return "plan-edit"
        return super().block_name(rc)

    def post_dispatch(self, rc):
        r = _runner()
        result = rc.result
        status = rc.status
        iter_extras = rc.iter_extras
        outcome = result.get("outcome", "revise")  # fail-closed default
        issues = result.get("issues", [])
        critical_issues = [i for i in issues if i.get("severity") in ("critical", "major")]

        # Audit-trail integrity: normalize the agent's self-reported
        # outcome and per-issue resolution to match what was physically
        # possible, BEFORE recording the iteration / emitting events.
        #
        # - Edit mode (`review_and_edit`): the editor was given a fresh
        #   plan-(N+1).md copy and may write to it. We determine the
        #   honest outcome from the actual file content (W-061
        #   reconciliation), not the editor's verdict — the model has
        #   been observed to return "revise" without editing or to
        #   claim resolution=edited without writing. When unchanged,
        #   downgrade outcome → approve and resolution=edited →
        #   deferred, and collapse the speculative copy so the
        #   numbered sequence stays meaningful in the W-061 viewer.
        # - Review mode (or any non-edit mode): plan_reviewer is in
        #   read_only_agents and the guard blocks Write/Edit, so the
        #   reviewer can NEVER edit the plan. Any "approve_with_edits"
        #   or per-issue resolution value is a contract violation by
        #   the agent. Strip them so the audit trail is honest.
        _plan_actually_edited = False
        if self.mode == "review_and_edit":
            _pre = status.get("plan_pre_edit_file")
            _post = status.get("plan_file")
            if _pre and _post and os.path.isfile(_pre) and os.path.isfile(_post):
                try:
                    with open(_pre, "rb") as _a, open(_post, "rb") as _b:
                        _plan_actually_edited = _a.read() != _b.read()
                except OSError:
                    _plan_actually_edited = False
            if _plan_actually_edited:
                outcome = "approve_with_edits"
            else:
                outcome = "approve"
                if isinstance(result, dict):
                    for _iss in result.get("issues") or []:
                        if isinstance(_iss, dict) and _iss.get("resolution") == "edited":
                            _iss["resolution"] = "deferred"
                if (rc.run_dir and _pre and _post and _post != _pre
                        and os.path.isfile(_post)):
                    try:
                        os.remove(_post)
                    except OSError:
                        pass
                    status["plan_file"] = _pre
                    os.environ["WORCA_PLAN_FILE"] = _pre
                    rc.prompt_builder.update_context("plan_file", _pre)
        else:
            # Review mode: read-only reviewer cannot edit, so any
            # "approve_with_edits" or per-issue resolution claim is
            # categorically impossible. Downgrade outcome and strip
            # the resolution field — the schema permits these values
            # because it is shared with edit mode, but in review mode
            # they are fabrications. "revise" / "approve" outcomes
            # flow through unchanged.
            if outcome == "approve_with_edits":
                outcome = "approve"
            if isinstance(result, dict):
                for _iss in result.get("issues") or []:
                    if isinstance(_iss, dict):
                        _iss.pop("resolution", None)

        iter_extras["outcome"] = outcome
        r.complete_iteration(status, rc.stage_name, **iter_extras)
        r.update_stage(status, rc.stage_name, **rc.stage_extras)
        r.save_status(status, rc.actual_status_path)
        if rc.ctx:
            r._emit_stage_completed_and_gate(rc.ctx, rc.stage_name, rc.iter_num, iter_extras)

        # Revise gate: outcome == "revise" AND (critical issues present OR issues list empty)
        # Minor/suggestion-only issues are treated as approve.
        # Empty issues list with revise outcome is fail-closed — still revise.
        should_revise = (outcome == "revise") and bool(critical_issues or not issues)

        if self.mode == "review_and_edit":
            # Edit mode: the plan editor rewrote the next numbered
            # revision (plan-(N+1).md) in place — or produced a clean
            # approve with no edits (the speculative copy was collapsed
            # above). Either way, no loopback is needed.
            r.set_milestone(status, "plan_approved", True)
            # The pre-edit plan-N.md is the retained original (W-061).
            _orig_path = status.get("plan_pre_edit_file") or None
            # Clear edit markers so a later restart_planning re-entry
            # mints a fresh revision instead of reusing this one.
            status.pop("plan_edit_target", None)
            status.pop("plan_pre_edit_file", None)
            rc.prompt_builder.pop_context("plan_review_issues")
            rc.prompt_builder.pop_context("plan_revision_mode")
            rc.prompt_builder.pop_context("plan_review_history")
            if rc.prompt_context_path:
                rc.prompt_builder.save_context(rc.prompt_context_path)
            r.save_status(status, rc.actual_status_path)
            r._log("Plan approved by editor (no edits needed)"
                   if outcome == "approve"
                   else "Plan approved with edits", "ok")
            # PLAN_EDITED only fires when the plan was actually rewritten —
            # claiming edits we didn't make would inflate the audit trail.
            if rc.ctx and _plan_actually_edited:
                _severity_counts = {"critical": 0, "major": 0, "minor": 0, "suggestion": 0}
                for _iss in issues:
                    _sev = _iss.get("severity", "")
                    if _sev in _severity_counts:
                        _severity_counts[_sev] += 1
                r.emit_event(rc.ctx, r.PLAN_EDITED, r.plan_edited_payload(
                    stage=rc.stage_name,
                    mode=self.mode,
                    mode_reason=self.mode_reason,
                    issue_counts=_severity_counts,
                    original_plan_path=_orig_path,
                ))

        elif should_revise:
            # Thread review feedback — only critical/major issues to limit context growth
            prev_history = list(rc.prompt_builder.get_context("plan_review_history") or [])
            prev_history.append({"attempt": len(prev_history) + 1, "issues": list(critical_issues)})
            # Cap history to most recent 50 entries to bound context growth
            if len(prev_history) > 50:
                prev_history = prev_history[-50:]
            rc.prompt_builder.update_context("plan_review_history", prev_history)
            rc.prompt_builder.update_context("plan_review_issues", list(critical_issues))
            rc.prompt_builder.update_context("plan_revision_mode", True)

            # Declarative jump (W-070). No plan_review_revise
            # transition (PLAN disabled in the flow) falls through to
            # the exhausted path: unresolved issues carry forward to
            # COORDINATE instead of crashing on a missing stage.
            _prv_tr = rc.flow.transition_for(rc.stage_name, "plan_review_revise")
            _prv_loop = (_prv_tr.loop if _prv_tr else None) or "plan_review"

            # Update ALL counters before saving — single save to avoid inconsistent state
            rc.loop_counters[_prv_loop] = rc.loop_counters.get(_prv_loop, 0) + 1
            rc.loop_counters[f"{rc.stage_name}_iteration"] = (
                rc.loop_counters.get(f"{rc.stage_name}_iteration", 0) + 1
            )
            status["loop_counters"] = dict(rc.loop_counters)

            if _prv_tr is not None and r.check_loop_limit(
                    _prv_loop, rc.loop_counters[_prv_loop],
                    rc.settings_path, mloops=rc.mloops):
                if rc.ctx:
                    r._emit_loop_triggered_and_gate(
                        rc.ctx, _prv_loop, rc.loop_counters[_prv_loop],
                        rc.stage_name, _prv_tr.goto, "plan_review_revise",
                    )

                # --- Atomic loop-back sequence ---
                # 1. Reset PLAN stage status and clear plan_approved milestone
                r.update_stage(status, Stage.PLAN.value, status="pending", skipped=False)
                status.get("milestones", {}).pop("plan_approved", None)
                # 1a. Append-only plan revision (W-061): preserve the current
                # plan as the revision *source* (threaded into plan_file_content
                # so the revision Planner reads it regardless of the re-pointed
                # path), then mint the next numbered plan file as the *target*
                # and re-point every consumer. The prior plan-00N.md is left
                # intact as audit history; the Planner is restricted to
                # WORCA_PLAN_FILE, so older revisions are immutable.
                if rc.run_dir:
                    _cur_plan_path = status.get("plan_file")
                    _cur_plan_text = ""
                    if _cur_plan_path and os.path.exists(_cur_plan_path):
                        with open(_cur_plan_path, encoding="utf-8") as _cpf:
                            _cur_plan_text = _cpf.read().strip()
                    if _cur_plan_text:
                        rc.prompt_builder.update_context("plan_file_content", _cur_plan_text)
                    _rev_plan_path = r._next_plan_path(rc.run_dir)
                    status["plan_file"] = _rev_plan_path
                    os.environ["WORCA_PLAN_FILE"] = _rev_plan_path
                    rc.prompt_builder.update_context("plan_file", _rev_plan_path)
                    r._log(f"Plan revision -> {_rev_plan_path} (revising {_cur_plan_path})", "ok")
                # 2. Persist context + status before any in-memory transitions
                if rc.prompt_context_path:
                    rc.prompt_builder.save_context(rc.prompt_context_path)
                r.save_status(status, rc.actual_status_path)
                # 2a. Re-render agent templates so planner.md stays consistent
                # with the current plan_file path (defensive: prevents stale
                # template instructions if plan_file ever changes mid-revision).
                if rc.run_dir:
                    _lb_settings = r.load_settings(rc.settings_path)
                    _lb_worca = _lb_settings.get("worca", {})
                    _lb_overrides_dir = _lb_worca.get(
                        "agent_overrides_dir", ".claude/agents"
                    )
                    _lb_template_agents_dir = _lb_worca.get("_template_agents_dir")
                    r._render_agent_templates(rc.run_dir, {
                        "plan_file": status["plan_file"],
                        "run_id": status.get("run_id", ""),
                        "branch": rc.branch_name,
                        "title": rc.work_request.title,
                    }, overrides_dir=_lb_overrides_dir,
                       template_agents_dir=_lb_template_agents_dir)
                # 3. In-memory transitions (context keys drive behavior on crash/resume)
                return StageDecision.jump("plan_review_revise", _prv_tr.goto)
            else:
                if critical_issues:
                    rc.prompt_builder.update_context("unresolved_plan_issues", list(critical_issues))
                rc.prompt_builder.pop_context("plan_review_issues")
                rc.prompt_builder.pop_context("plan_revision_mode")
                rc.prompt_builder.pop_context("plan_review_history")
                if rc.prompt_context_path:
                    rc.prompt_builder.save_context(rc.prompt_context_path)
                r.save_status(status, rc.actual_status_path)
                if rc.ctx:
                    r.emit_event(rc.ctx, r.LOOP_EXHAUSTED, r.loop_exhausted_payload(
                        loop_key=_prv_loop,
                        iteration=rc.loop_counters[_prv_loop],
                        limit=r._get_loop_limit(_prv_loop, rc.settings_path, rc.mloops),
                    ))
                n_carried = len(critical_issues) if critical_issues else 0
                r._log(f"Plan review loop exhausted — {n_carried} unresolved issues carried to COORDINATE", "warn")
        else:
            # Approve path — pop cross-context keys to prevent leaking
            rc.prompt_builder.pop_context("plan_review_issues")
            rc.prompt_builder.pop_context("plan_revision_mode")
            rc.prompt_builder.pop_context("plan_review_history")
            if rc.prompt_context_path:
                rc.prompt_builder.save_context(rc.prompt_context_path)

            if outcome == "revise" and not critical_issues and issues:
                r._log(f"Plan approved with {len(issues)} minor issues (logged)", "ok")
            elif issues:
                r._log(f"Plan approved with {len(issues)} minor issues (logged)", "ok")
            else:
                r._log("Plan approved by reviewer", "ok")
        return StageDecision.advance()


class CoordinateHandler(StageHandler):
    """COORDINATE: bead decomposition, run labeling, effort label backfill."""

    name = Stage.COORDINATE.value

    def pre_build_context(self, rc):
        # Thread max_beads cap into prompt_builder before building COORDINATE context
        rc.prompt_builder.update_context("max_beads_override", rc.max_beads_override)
        rc.prompt_builder.update_context("max_beads_config", rc.stage_config["max_beads"])

    def post_build_context(self, rc):
        r = _runner()
        # W-069: persist the resolved coordinator bead cap + its source so
        # the UI preflight row can surface the EFFECTIVE cap (not just the
        # launch override). Written before COORDINATE executes, so it's
        # visible even if the stage later fails.
        rc.status.update(r.effective_bead_cap_status(
            int(rc.ctx_dict.get("max_beads", 0) or 0),
            rc.max_beads_override,
            bool(rc.ctx_dict.get("has_review_comments")),
        ))
        r.save_status(rc.status, rc.actual_status_path)

    def pre_dispatch(self, rc):
        # Ensure beads is initialized before coordinate stage
        _runner()._ensure_beads_initialized()

    def post_dispatch(self, rc):
        r = _runner()
        result = rc.result
        status = rc.status
        iter_extras = rc.iter_extras
        r._aggregate_file_access_into_extras(
            iter_extras, rc.settings_path, status, rc.stage_name, rc.iter_num,
            bead_id=rc.assigned_bead,
        )

        iter_extras["outcome"] = "success"
        r.complete_iteration(status, rc.stage_name, **iter_extras)
        r._emit_iteration_access_event(rc.ctx, status, rc.stage_name, status["run_id"])
        r.update_stage(status, rc.stage_name, **rc.stage_extras)
        r.save_status(status, rc.actual_status_path)
        if rc.ctx:
            r._emit_stage_completed_and_gate(rc.ctx, rc.stage_name, rc.iter_num, iter_extras)
        # beads_ids/dependency_graph are declared flow outputs (W-072) —
        # already auto-published as stages.coordinate.* with flat dual-writes.
        beads_ids = result.get("beads_ids", [])
        rc.created_bead_count = len(beads_ids)
        r._warn_if_cap_deviation(
            rc.ctx_dict.get("max_beads", 0),
            rc.created_bead_count,
            bool(rc.prompt_builder.get_context("review_comments")),
        )
        rc.prompt_builder.pop_context("unresolved_plan_issues")
        # Link beads to this run via label
        if beads_ids:
            run_label = f"run:{status['run_id']}"
            if r.bd_label_add(beads_ids, run_label):
                r._log(f"Labeled {len(beads_ids)} beads with {run_label}", "ok")
                if rc.ctx:
                    r.emit_event(rc.ctx, r.BEAD_LABELED, r.bead_labeled_payload(
                        bead_ids=beads_ids,
                        label=run_label,
                    ))
            else:
                r._log(f"Failed to label beads with {run_label}", "warn")
        # Effort label backfill from structured output
        _effort_backfilled = set()
        effort_map = result.get("effort", {})
        if beads_ids and effort_map:
            beads_set = set(beads_ids)
            for bid, level in effort_map.items():
                if bid not in beads_set:
                    r._log(f"Effort backfill: skip unknown bead {bid}", "warn")
                    continue
                if level not in r.EFFORT_LEVELS:
                    r._log(f"Effort backfill: skip invalid level '{level}' for {bid}", "warn")
                    continue
                if r.bd_get_effort_label(bid):
                    continue
                if r.bd_label_add([bid], f"worca-effort:{level}"):
                    _effort_backfilled.add(bid)
            if _effort_backfilled:
                r._log(f"Effort backfill: labeled {len(_effort_backfilled)} bead(s) from structured output", "ok")
        # Best-effort check: warn about beads missing worca-effort:* labels
        if beads_ids:
            _unlabeled = [
                bid for bid in beads_ids
                if bid not in _effort_backfilled and not r.bd_get_effort_label(bid)
            ]
            if _unlabeled:
                r._log(f"{len(_unlabeled)} bead(s) missing worca-effort label: {', '.join(_unlabeled)}", "warn")
        return StageDecision.advance()


class ImplementHandler(StageHandler):
    """IMPLEMENT: per-bead fan-out (claim → implement → close → next_bead loop)
    plus test-failure / review-changes fix mode."""

    name = Stage.IMPLEMENT.value
    code_outputs = (
        "files_changed", "tests_added", "all_files_changed", "all_tests_added",
    )

    def __init__(self):
        self._run_bead_ids = None

    def pre_iteration(self, rc):
        _assigned = rc.prompt_builder.get_context("assigned_bead_id")
        if _assigned is None:
            _bead_ids = rc.prompt_builder.get_context("beads_ids") or []
            if _bead_ids:
                _assigned = _bead_ids[0]
        rc.assigned_bead = _assigned

    def iteration_kwargs(self, rc):
        # Bead linkage on implement iterations only — rc.assigned_bead is
        # resolved in pre_iteration (claimed bead, or beads_ids[0] fallback).
        # Title is cached when the bead is claimed via _query_ready_bead;
        # absent on the beads_ids[0] fallback, which keeps it null on disk.
        out = {}
        if rc.assigned_bead:
            out["bead_id"] = rc.assigned_bead
            _bead_title = rc.prompt_builder.get_context("assigned_bead_title")
            if _bead_title:
                out["bead_title"] = _bead_title
        return out

    def pb_iteration(self, rc):
        return rc.prompt_builder.get_context("bead_prompt_iteration") or 0

    def assign_work(self, rc):
        r = _runner()
        if rc.trigger in ("initial", "next_bead"):
            # Phase 1: implement all beads sequentially
            self._run_bead_ids = rc.prompt_builder.get_context("beads_ids")
            bead = r._query_ready_bead(allowed_ids=self._run_bead_ids, run_id=rc.status.get("run_id"))
            if bead:
                bead_id = bead["id"]
                r._claim_bead(bead_id)
                if rc.ctx:
                    r.emit_event(rc.ctx, r.BEAD_ASSIGNED, r.bead_assigned_payload(
                        bead_id=bead_id,
                        title=bead["title"],
                        iteration=rc.loop_counters.get("bead_iteration", 0) + 1,
                    ))
                rc.prompt_builder.update_context("assigned_bead_id", bead_id)
                rc.prompt_builder.update_context("assigned_bead_title", bead["title"])
                try:
                    details = r.bd_show(bead_id)
                    rc.prompt_builder.update_context("assigned_bead_description", details.get("description", ""))
                except Exception:
                    rc.prompt_builder.update_context("assigned_bead_description", "")
        elif rc.trigger in ("test_failure", "review_changes"):
            rc.prompt_builder.update_context("assigned_bead_title", None)
            rc.prompt_builder.update_context("assigned_bead_description", None)

    def post_dispatch(self, rc):
        r = _runner()
        result = rc.result
        status = rc.status
        iter_extras = rc.iter_extras
        iter_extras["outcome"] = "success"
        r._aggregate_file_access_into_extras(
            iter_extras, rc.settings_path, status, rc.stage_name, rc.iter_num,
            bead_id=rc.assigned_bead,
        )
        r.complete_iteration(status, rc.stage_name, **iter_extras)
        r._emit_iteration_access_event(rc.ctx, status, rc.stage_name, status["run_id"])

        # Thread implement outputs into PromptBuilder
        new_files = result.get("files_changed", [])
        new_tests = result.get("tests_added", [])
        rc.prompt_builder.update_context("files_changed", new_files)
        rc.prompt_builder.update_context("tests_added", new_tests)

        impl_trigger = rc.trigger
        r._accumulate_design_note(rc.prompt_builder, result, impl_trigger)
        if impl_trigger in ("initial", "next_bead"):
            # Phase 1: close the bead we just implemented
            claimed_bead = rc.prompt_builder.get_context("assigned_bead_id")
            if claimed_bead:
                if r.bd_close(claimed_bead, reason="implemented"):
                    r._log(f"Closed bead {claimed_bead}", "ok")
                    if rc.ctx:
                        r.emit_event(rc.ctx, r.BEAD_COMPLETED, r.bead_completed_payload(
                            bead_id=claimed_bead,
                            reason="implemented",
                        ))
                else:
                    r._log(f"Failed to close bead {claimed_bead}", "warn")
                    if rc.ctx:
                        r.emit_event(rc.ctx, r.BEAD_FAILED, r.bead_failed_payload(
                            bead_id=claimed_bead,
                            error="bd_close failed",
                        ))
                # Record the bead as processed regardless of bd_close
                # outcome — implementation is the expensive step and
                # must not be retried on the same bead. Persisting here
                # (via save_context below) lets resume skip it too.
                _implemented = rc.prompt_builder.get_context("implemented_bead_ids") or []
                if claimed_bead not in _implemented:
                    _implemented.append(claimed_bead)
                    rc.prompt_builder.update_context("implemented_bead_ids", _implemented)

            # Accumulate files across all beads
            all_files = rc.prompt_builder.get_context("all_files_changed") or []
            all_files.extend(new_files)
            rc.prompt_builder.update_context("all_files_changed", all_files)
            all_tests = rc.prompt_builder.get_context("all_tests_added") or []
            all_tests.extend(new_tests)
            rc.prompt_builder.update_context("all_tests_added", all_tests)

            rc.loop_counters["bead_iteration"] = rc.loop_counters.get("bead_iteration", 0) + 1
            status["loop_counters"] = dict(rc.loop_counters)

            # Check for more beads (scoped to this run)
            # NOTE: Do NOT mark IMPLEMENT "completed" yet — if the pipeline
            # is stopped between bead iterations, resume must re-enter
            # IMPLEMENT to process remaining beads.
            next_bead = r._query_ready_bead(allowed_ids=self._run_bead_ids, run_id=status.get("run_id"))
            # Drain when bd_ready re-surfaces an already-implemented
            # bead. Happens when the bead store doesn't reflect our
            # closure yet (slow daemon, stateless test stub, or a
            # bd_close failure). Re-implementing is never the right
            # answer — advance instead.
            if next_bead:
                _impl_set = set(rc.prompt_builder.get_context("implemented_bead_ids") or [])
                if next_bead["id"] in _impl_set:
                    r._log(
                        f"bd ready returned already-implemented bead {next_bead['id']} "
                        f"— treating bead queue as drained",
                        "warn",
                    )
                    next_bead = None
            # Declarative jump (W-070): the bead self-loop is declared
            # on the implement stage. bead_iteration's cap is dynamic
            # (depends on created bead count) — runtime-provided, not
            # from worca.loops.
            _nb_tr = rc.flow.transition_for(rc.stage_name, "next_bead")
            if next_bead and _nb_tr is not None:
                safety_cap = max(rc.created_bead_count, len(self._run_bead_ids or [])) + 3
                if rc.loop_counters["bead_iteration"] < safety_cap:
                    # Keep stage in_progress between beads so resume works
                    if rc.prompt_context_path:
                        rc.prompt_builder.save_context(rc.prompt_context_path)
                    r.save_status(status, rc.actual_status_path)
                    r._log(f"Next bead available — looping back to {_nb_tr.goto.upper()} (bead {rc.loop_counters['bead_iteration']})", "ok")
                    if rc.ctx:
                        r.emit_event(rc.ctx, r.BEAD_NEXT, r.bead_next_payload(
                            next_bead_id=next_bead["id"],
                            bead_iteration=rc.loop_counters["bead_iteration"],
                            max_beads=rc.created_bead_count,
                        ))
                    return StageDecision.jump("next_bead", _nb_tr.goto)
                else:
                    r._log(f"Safety cap reached ({safety_cap}) but bd ready still has "
                           f"run-scoped beads — halting to prevent partial implementation", "err")
                    raise r.PipelineInterrupted(
                        f"implement_incomplete: bead {next_bead['id']} and possibly more still unstarted",
                        stop_reason="implement_incomplete",
                    )

            # All beads done — NOW mark IMPLEMENT completed
            rc.prompt_builder.update_context("files_changed", list(set(all_files)))
            rc.prompt_builder.update_context("tests_added", list(set(all_tests)))
            r._log("All beads implemented — advancing to TEST", "ok")
        # Phase 3 (fix mode): just fall through to TEST with current files

        # Mark IMPLEMENT completed only when all beads are done (or fix mode)
        r.update_stage(status, rc.stage_name, **rc.stage_extras)

        if rc.crg_data_dir and rc.crg_cfg and rc.crg_cfg.update_on_post_implement:
            _crg_ok = r._crg_post_implement_refresh(rc.crg_data_dir, rc.project_root, timeout=30)
            if not _crg_ok:
                iter_extras["crg_refresh_failed"] = True
                r._log("CRG post-implement refresh failed or timed out — tester proceeds with stale graph", "warn")

        r.save_status(status, rc.actual_status_path)
        if rc.ctx:
            _bead_kwargs = {}
            if rc.created_bead_count:
                _bead_kwargs["beads_done"] = rc.loop_counters.get("bead_iteration", 0)
                _bead_kwargs["beads_total"] = rc.created_bead_count
            r._emit_stage_completed_and_gate(
                rc.ctx, rc.stage_name, rc.iter_num, iter_extras,
                **_bead_kwargs,
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
        # passed/coverage_pct/proof_artifacts are declared flow outputs
        # (W-072) — already auto-published as stages.test.* with flat
        # dual-writes. Only the fix-loop transforms are threaded below.
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


class ReviewHandler(StageHandler):
    """REVIEW: verdict routing (approve/changes/reject/restart_planning)."""

    name = Stage.REVIEW.value
    code_outputs = ("review_issues", "review_history")

    def on_stage_started(self, rc):
        r = _runner()
        if rc.ctx:
            r.emit_event(rc.ctx, r.REVIEW_STARTED, r.review_started_payload(
                iteration=rc.iter_num,
                files_under_review=rc.prompt_builder.get_context("files_changed"),
            ))

    def post_dispatch(self, rc):
        r = _runner()
        result = rc.result
        status = rc.status
        iter_extras = rc.iter_extras
        r._aggregate_file_access_into_extras(
            iter_extras, rc.settings_path, status, rc.stage_name, rc.iter_num,
            bead_id=rc.assigned_bead,
        )

        outcome = result.get("outcome", "approve")
        r._log(f"Review outcome: {outcome}")
        r._emit_guide_conflicts(rc.ctx, "review", result)
        # Persist observations across iterations (non-blocking, best-effort)
        r._persist_observations(status, rc.loop_counters, result, rc.prompt_builder, rc.run_id_param)
        next_stage, status = r.handle_pr_review(outcome, status)
        _all_issues = result.get("issues", [])
        _critical_count = sum(
            1 for i in _all_issues if i.get("severity") in ("critical", "major")
        )
        if rc.ctx:
            r.emit_event(rc.ctx, r.REVIEW_VERDICT, r.review_verdict_payload(
                outcome=outcome,
                issue_count=len(_all_issues),
                critical_count=_critical_count,
            ))
        iter_extras["outcome"] = outcome
        r.complete_iteration(status, rc.stage_name, **iter_extras)
        r._emit_iteration_access_event(rc.ctx, status, rc.stage_name, status["run_id"])
        r.update_stage(status, rc.stage_name, **rc.stage_extras)
        r.save_status(status, rc.actual_status_path)
        if rc.ctx:
            r._emit_stage_completed_and_gate(rc.ctx, rc.stage_name, rc.iter_num, iter_extras)
        if next_stage is None:
            if outcome == "reject":
                r._log("PR rejected — stopping", "err")
                raise r.PipelineError("PR rejected")
            r._log("Review approved", "ok")

        elif next_stage == Stage.IMPLEMENT:
            new_issues = result.get("issues", [])

            # Severity-gate: only loop back for critical/major issues
            critical_issues = [i for i in new_issues if i.get("severity") in ("critical", "major")]
            if not critical_issues:
                r._log("Only minor/suggestion issues — treating as approve", "ok")
            else:
                # Accumulate review history
                prev_history = rc.prompt_builder.get_context("review_history") or []
                prev_history.append({"attempt": len(prev_history) + 1, "issues": new_issues})
                rc.prompt_builder.update_context("review_history", prev_history)
                rc.prompt_builder.update_context("review_issues", critical_issues)
                rc.prompt_builder.update_context("test_failures", None)
                rc.prompt_builder.update_context("test_failure_history", None)

                # Declarative jump (W-070): no review_changes
                # transition = the legacy "IMPLEMENT disabled" case.
                _rc_tr = rc.flow.transition_for(rc.stage_name, "review_changes")
                if _rc_tr is None:
                    r._log("Changes requested but the flow has no review_changes loop (IMPLEMENT stage disabled) — skipping loop", "warn")
                else:
                    _rc_loop = _rc_tr.loop or "pr_changes"
                    # Flat review-fix counter (not per-bead)
                    rc.loop_counters[_rc_loop] = rc.loop_counters.get(_rc_loop, 0) + 1
                    status["loop_counters"] = dict(rc.loop_counters)
                    bead_prompt_iter = rc.prompt_builder.get_context("bead_prompt_iteration") or 0
                    rc.prompt_builder.update_context("bead_prompt_iteration", bead_prompt_iter + 1)
                    r._log(f"Changes requested — looping back to {_rc_tr.goto.upper()} fix mode (attempt {rc.loop_counters[_rc_loop]})", "warn")
                    if r.check_loop_limit(_rc_loop, rc.loop_counters[_rc_loop], rc.settings_path, mloops=rc.mloops):
                        if rc.ctx:
                            r.emit_event(rc.ctx, r.REVIEW_FIX_ATTEMPT, r.review_fix_attempt_payload(
                                attempt=rc.loop_counters[_rc_loop],
                                limit=r._get_loop_limit(_rc_loop, rc.settings_path, rc.mloops),
                                critical_issues=critical_issues,
                            ))
                            r._emit_loop_triggered_and_gate(
                                rc.ctx, _rc_loop, rc.loop_counters[_rc_loop],
                                rc.stage_name, _rc_tr.goto, "review_changes",
                            )
                        if rc.prompt_context_path:
                            rc.prompt_builder.save_context(rc.prompt_context_path)
                        r.save_status(status, rc.actual_status_path)
                        return StageDecision.jump("review_changes", _rc_tr.goto)
                    else:
                        r._log(f"Review fix limit exhausted after {rc.loop_counters[_rc_loop]} attempts — finishing", "warn")
                        if rc.ctx:
                            r.emit_event(rc.ctx, r.LOOP_EXHAUSTED, r.loop_exhausted_payload(
                                loop_key=_rc_loop,
                                iteration=rc.loop_counters[_rc_loop],
                                limit=r._get_loop_limit(_rc_loop, rc.settings_path, rc.mloops),
                            ))

        elif next_stage == Stage.PLAN:
            # Declarative jump (W-070): no restart_planning
            # transition = the legacy "PLAN disabled" case.
            _rp_tr = rc.flow.transition_for(rc.stage_name, "restart_planning")
            if _rp_tr is None:
                r._log("Restart planning requested but the flow has no restart_planning loop (PLAN stage disabled) — skipping loop", "warn")
            else:
                loop_key = _rp_tr.loop or "restart_planning"
                rc.loop_counters[loop_key] = rc.loop_counters.get(loop_key, 0) + 1
                status["loop_counters"] = dict(rc.loop_counters)
                r._log(f"Restart planning requested (iteration {rc.loop_counters[loop_key]})", "warn")
                if not r.check_loop_limit(loop_key, rc.loop_counters[loop_key], rc.settings_path, mloops=rc.mloops):
                    if rc.ctx:
                        r.emit_event(rc.ctx, r.LOOP_EXHAUSTED, r.loop_exhausted_payload(
                            loop_key=loop_key,
                            iteration=rc.loop_counters[loop_key],
                            limit=r._get_loop_limit(loop_key, rc.settings_path, rc.mloops),
                        ))
                    raise r.LoopExhaustedError(
                        f"Loop {loop_key} exhausted after {rc.loop_counters[loop_key]} iterations"
                    )
                if rc.ctx:
                    r._emit_loop_triggered_and_gate(
                        rc.ctx, loop_key, rc.loop_counters[loop_key],
                        rc.stage_name, _rp_tr.goto, "restart_planning",
                    )
                return StageDecision.jump("restart_planning", _rp_tr.goto)
        return StageDecision.advance()


class PrHandler(StageHandler):
    """PR: approval gate, post-condition verification, PR metadata lift,
    revise-mode writeback, post-guardian graph refreshes."""

    name = Stage.PR.value

    def pre_iteration(self, rc):
        _revises_pr_num = rc.status.get("revises_pr")
        if _revises_pr_num is not None:
            rc.effort_env_overrides["WORCA_REVISE_PR"] = str(_revises_pr_num)

    def dispatch(self, rc):
        r = _runner()
        if r._shutdown_requested:
            raise InterruptedError("Pipeline shutdown requested before stage execution")
        # Captured once on first entry to the PR stage; preserved across
        # PR-stage retries so iter_2 verification compares against the same
        # pre-stage HEAD as iter_1.
        if rc.pr_baseline_head is None:
            rc.pr_baseline_head = r.get_current_git_head()
        return super().dispatch(rc)

    def post_dispatch(self, rc):
        r = _runner()
        result = rc.result
        status = rc.status
        iter_extras = rc.iter_extras
        # Milestone semantics intentionally asymmetric across approval gates:
        #   - plan_approval: default-true (opt-out). Already in production at this default;
        #     flipping it would silently disable an existing gate on every upgraded project.
        #   - pr_approval:   default-false (opt-in). New in W-049; default-true would hang
        #     every autonomous run waiting for an approval event nobody sends.
        _ms_cfg = r.load_settings(rc.settings_path).get("worca", {}).get("milestones", {})
        if _ms_cfg.get("pr_approval") is not True:
            pr_approved = True
        else:
            r.set_milestone(status, "pr_approved", False)
            status["pipeline_status"] = r.PipelineStatus.PAUSED
            r.save_status(status, rc.actual_status_path)
            pr_approved = False
            if rc.ctx:
                _ms_event = r.emit_event(rc.ctx, r.MILESTONE_SET, r.milestone_set_payload(
                    milestone="pr_approved", value=False, stage=rc.stage_name,
                ))
                if _ms_event:
                    _action = r._check_control_response_with_timeout(
                        rc.ctx, _ms_event,
                        timeout_seconds=_ms_cfg.get("pr_approval_timeout_seconds", 3600),
                        timeout_default="approve",
                    )
                    if _action == "approve":
                        pr_approved = True
                        r.set_milestone(status, "pr_approved", True)
                        status["pipeline_status"] = r.PipelineStatus.RUNNING
                    elif _action == "reject":
                        raise r.PipelineInterrupted("PR creation rejected by user", stop_reason="pr_rejected")
                    elif _action == "pause":
                        r._handle_pause(rc.ctx, "pr_approved milestone")
                    elif _action == "abort":
                        raise r.PipelineInterrupted("Aborted via control webhook", stop_reason="control_webhook")
            else:
                pr_approved = True
                r.set_milestone(status, "pr_approved", True)
                status["pipeline_status"] = r.PipelineStatus.RUNNING

        if not pr_approved:
            r.save_status(status, rc.actual_status_path)
            # Mirror paused into the multi-pipeline registry before
            # returning — otherwise the entry stays "running" while
            # this process exits at the PR-approval gate, and
            # reconcile_stale() / fleet status derivation misread it.
            if status.get("worktree") and status.get("run_id"):
                try:
                    r.update_pipeline(
                        status["run_id"], status="paused", base=rc.registry_dir
                    )
                except Exception:
                    pass  # registry mirror is best-effort
            return StageDecision.pause_return()

        # Post-condition verification: only when guardian explicitly
        # declares outcome=success (prose-fallback and partial outputs
        # bypass this gate — they already recovered what they can).
        _pr_verification_passed = False
        if isinstance(result, dict) and result.get("outcome") == "success":
            _vr = r._verify_pr_stage(result, rc.pr_baseline_head)
            if not _vr.ok:
                r._log(f"PR stage verification failed: {_vr.reason}", "warn")
                rc.loop_counters["pr_verification_retry"] = (
                    rc.loop_counters.get("pr_verification_retry", 0) + 1
                )
                status["loop_counters"] = dict(rc.loop_counters)
                iter_extras["outcome"] = "reject"
                r.complete_iteration(status, rc.stage_name, **iter_extras)
                if rc.loop_counters["pr_verification_retry"] > 1:
                    r.set_milestone(status, "pr_verified", False)
                    if rc.ctx:
                        r.emit_event(rc.ctx, r.MILESTONE_SET, r.milestone_set_payload(
                            milestone="pr_verified", value=False,
                            stage=rc.stage_name,
                        ))
                    raise r.PipelineError(
                        f"PR verification failed after retry: {_vr.reason}"
                    )
                r.save_status(status, rc.actual_status_path)
                return StageDecision.repeat()
            _pr_verification_passed = True

        iter_extras["outcome"] = "success"
        r.complete_iteration(status, rc.stage_name, **iter_extras)
        r.update_stage(status, rc.stage_name, **rc.stage_extras)
        r.save_status(status, rc.actual_status_path)
        if rc.ctx:
            r._emit_stage_completed_and_gate(rc.ctx, rc.stage_name, rc.iter_num, iter_extras)
        if _pr_verification_passed:
            r.set_milestone(status, "pr_verified", True)
            r.save_status(status, rc.actual_status_path)
            if rc.ctx:
                r.emit_event(rc.ctx, r.MILESTONE_SET, r.milestone_set_payload(
                    milestone="pr_verified", value=True,
                    stage=rc.stage_name,
                ))
        if isinstance(result, dict):
            r._lift_pr_deferred_to_status(result, status)
            if result.get("deferred") is True:
                # Lift deferred fields to stages.pr so worca pr create
                # can read them without traversing iterations.
                r.update_stage(status, rc.stage_name,
                    deferred=True,
                    pr_title=result.get("pr_title", ""),
                    pr_body=result.get("pr_body", ""),
                    base_branch=(
                        result.get("base_branch")
                        or result.get("target_branch") or ""
                    ),
                    source_branch=(
                        result.get("source_branch")
                        or status.get("branch") or ""
                    ),
                )
                r.save_status(status, rc.actual_status_path)
                if rc.ctx:
                    r.emit_event(rc.ctx, r.GIT_PR_DEFERRED, r.git_pr_deferred_payload(
                        pr_title=result.get("pr_title", ""),
                        base_branch=result.get("base_branch") or result.get("target_branch") or "",
                        head_branch=result.get("source_branch") or status.get("branch") or "",
                        commit_sha=result.get("commit_sha"),
                    ))
            _pr_url = result.get("pr_url")
            _pr_number = result.get("pr_number")
            # In revise mode, if the agent's prose fallback didn't carry
            # pr_url/pr_number, re-read the existing PR via gh so
            # status["pr"] still populates with the correct number/url.
            _revises_pr = status.get("revises_pr")
            if _revises_pr is not None and (not _pr_url or _pr_number is None):
                _fetched_url = r._fetch_pr_url_via_gh(_revises_pr)
                if _fetched_url and not _pr_url:
                    _pr_url = _fetched_url
                if _pr_number is None:
                    _pr_number = _revises_pr
            if _pr_url and _pr_number is not None:
                _commit_sha = result.get("commit_sha")
                # Branches: prefer agent value, fall back to runner state.
                # The orchestrator already knows both — no reason to
                # require the agent to re-emit them.
                _source_branch = (
                    result.get("source_branch")
                    or status.get("branch")
                )
                _target_branch = (
                    result.get("target_branch")
                    or status.get("target_branch")
                )
                # Provider: agent may emit it, but verify/fill from URL.
                _provider = result.get("provider")
                if not _provider or _provider == "other":
                    _parsed = r.parse_pr_url(_pr_url)
                    if _parsed["provider"] != "other":
                        _provider = _parsed["provider"]
                    elif not _provider:
                        _provider = "other"
                _review_status = result.get("review_status")
                status["pr"] = {
                    "url": _pr_url,
                    "number": _pr_number,
                    "commit_sha": _commit_sha,
                    "source_branch": _source_branch,
                    "target_branch": _target_branch,
                    "provider": _provider,
                    "review_status": _review_status,
                }
                r.save_status(status, rc.actual_status_path)
                if rc.ctx:
                    r.emit_event(rc.ctx, r.GIT_PR_CREATED, r.git_pr_created_payload(
                        pr_url=_pr_url,
                        pr_number=_pr_number,
                        title=rc.work_request.title,
                        commit_sha=_commit_sha,
                        source_branch=_source_branch,
                        target_branch=_target_branch,
                        provider=_provider,
                    ))

                # Revise mode: worca owns the PR writeback (summary
                # comment + per-thread replies). The guardian only
                # pushes the head branch; doing the writeback here keeps
                # it off the agent tool path and reliable (D3 — replies
                # only, never resolve).
                if _revises_pr is not None:
                    r._revise_pr_writeback(
                        _pr_number,
                        _commit_sha,
                        status.get("review_feedback", []),
                    )

            r._maybe_graphify_post_guardian(
                settings_path=rc.settings_path,
                is_worktree=bool(status.get("worktree")),
            )
            r._maybe_crg_post_guardian(
                settings_path=rc.settings_path,
                is_worktree=bool(status.get("worktree")),
            )
        return StageDecision.advance()


class LearnHandler(StageHandler):
    """LEARN runs as a post-pipeline stage via runner._run_learn_stage, never
    through the main loop — registered for registry completeness only."""

    name = Stage.LEARN.value


class GenericHandler(StageHandler):
    """Fallback for stages with no registered handler — user-defined stages.

    Outcome contract (W-071 §2, convention over configuration). The stage's
    structured output may carry an ``outcome`` string:

    * missing / ``"success"`` → advance
    * declared in the flow's ``on:`` map → the outcome IS the trigger; jump
      per the flow spec (loop-keyed transitions consume their ``worca.loops``
      budget; an exhausted loop advances instead of jumping)
    * ``"reject"`` (undeclared) → stage failure via the existing failure path
    * anything else → advance with a warning (flow validation cross-checks
      custom schema outcome enums against declared triggers at launch, so
      this is the enum-less escape hatch, not the normal path)
    """

    def post_dispatch(self, rc):
        r = _runner()
        result = rc.result if isinstance(rc.result, dict) else {}
        outcome = result.get("outcome") or "success"
        iter_extras = rc.iter_extras
        r._aggregate_file_access_into_extras(
            iter_extras, rc.settings_path, rc.status, rc.stage_name, rc.iter_num,
            bead_id=rc.assigned_bead,
        )
        iter_extras["outcome"] = outcome
        r.complete_iteration(rc.status, rc.stage_name, **iter_extras)
        r._emit_iteration_access_event(rc.ctx, rc.status, rc.stage_name, rc.status["run_id"])
        r.update_stage(rc.status, rc.stage_name, **rc.stage_extras)
        r.save_status(rc.status, rc.actual_status_path)
        if rc.ctx:
            r._emit_stage_completed_and_gate(rc.ctx, rc.stage_name, rc.iter_num, iter_extras)

        # Declared outcome → flow-driven jump. Declared transitions win over
        # the reject convention, so a flow may route "reject" somewhere.
        tr = rc.flow_stage.on.get(outcome) if rc.flow_stage is not None else None
        if tr is not None:
            if tr.loop:
                rc.loop_counters[tr.loop] = rc.loop_counters.get(tr.loop, 0) + 1
                rc.status["loop_counters"] = dict(rc.loop_counters)
                if not r.check_loop_limit(tr.loop, rc.loop_counters[tr.loop],
                                          rc.settings_path, mloops=rc.mloops):
                    r._log(
                        f"{rc.stage_name.upper()} loop {tr.loop!r} exhausted after "
                        f"{rc.loop_counters[tr.loop]} attempts — advancing", "warn",
                    )
                    if rc.ctx:
                        r.emit_event(rc.ctx, r.LOOP_EXHAUSTED, r.loop_exhausted_payload(
                            loop_key=tr.loop,
                            iteration=rc.loop_counters[tr.loop],
                            limit=r._get_loop_limit(tr.loop, rc.settings_path, rc.mloops),
                        ))
                    r.save_status(rc.status, rc.actual_status_path)
                    return StageDecision.advance()
                if rc.ctx:
                    r._emit_loop_triggered_and_gate(
                        rc.ctx, tr.loop, rc.loop_counters[tr.loop],
                        rc.stage_name, tr.goto, outcome,
                    )
            if rc.prompt_context_path:
                rc.prompt_builder.save_context(rc.prompt_context_path)
            r.save_status(rc.status, rc.actual_status_path)
            r._log(f"{rc.stage_name.upper()} outcome {outcome!r} -> {tr.goto.upper()}", "ok")
            return StageDecision.jump(outcome, tr.goto)

        if outcome == "reject":
            r._log(f"{rc.stage_name.upper()} outcome 'reject' — stopping", "err")
            raise r.PipelineError(f"Stage {rc.stage_name!r} rejected")

        if outcome != "success":
            r._log(
                f"{rc.stage_name.upper()} outcome {outcome!r} has no declared "
                f"transition — advancing", "warn",
            )
        return StageDecision.advance()


#: stage key -> handler class. Stages not present here resolve to
#: :class:`GenericHandler` — the path user-defined stages take (W-071).
HANDLER_REGISTRY: dict = {
    Stage.PREFLIGHT.value: PreflightHandler,
    Stage.PLAN.value: PlanHandler,
    Stage.PLAN_REVIEW.value: PlanReviewHandler,
    Stage.COORDINATE.value: CoordinateHandler,
    Stage.IMPLEMENT.value: ImplementHandler,
    Stage.TEST.value: TestHandler,
    Stage.REVIEW.value: ReviewHandler,
    Stage.PR.value: PrHandler,
    Stage.LEARN.value: LearnHandler,
}


def handler_for(stage_name: str) -> StageHandler:
    """A fresh handler instance for a stage key (GenericHandler fallback)."""
    return HANDLER_REGISTRY.get(stage_name, GenericHandler)()
