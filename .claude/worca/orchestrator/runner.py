"""Single work request pipeline runner.

Orchestrates the full pipeline from plan through PR.
"""

import atexit
import json
import os
import re
import signal
import subprocess
import sys
import time
from datetime import datetime, timezone
from typing import Optional

from worca.orchestrator.error_classifier import (
    classify_error, record_failure, record_success,
    should_halt, get_retry_delay, get_circuit_breaker_state,
    CATEGORY_TRANSIENT,
)
from worca.orchestrator.registry import update_pipeline
from worca.orchestrator.control import read_control, delete_control
from worca.orchestrator.overlay import OverlayResolver
from worca.orchestrator.prompt_builder import PromptBuilder
from worca.orchestrator.stages import (
    Stage, get_stage_config, get_enabled_stages, STAGE_AGENT_MAP,
    is_learn_enabled,
)
from worca.orchestrator.work_request import WorkRequest
from worca.state.status import (
    load_status, save_status, update_stage, set_milestone, init_status,
    start_iteration, complete_iteration,
)
from worca.utils.beads import bd_ready, bd_show, bd_update, bd_close, bd_label_add
from worca.utils.gh_issues import gh_issue_start, gh_issue_complete
from worca.utils.claude_cli import run_agent, terminate_current
from worca.utils.git import create_branch, current_branch, get_current_git_head
from worca.utils.settings import load_settings
from worca.utils.token_usage import extract_token_usage, aggregate_token_usage, aggregate_by_model
from worca.utils.stats import update_cumulative_stats
from worca.events.emitter import EventContext, emit_event, _check_control_response
from worca.events.types import (
    RUN_STARTED, RUN_COMPLETED, RUN_FAILED, RUN_INTERRUPTED,
    RUN_RESUMED, RUN_PAUSED, RUN_RESUMED_FROM_PAUSE,
    run_started_payload, run_completed_payload, run_failed_payload, run_interrupted_payload,
    run_resumed_payload, run_paused_payload, run_resumed_from_pause_payload,
    STAGE_STARTED, STAGE_COMPLETED, STAGE_FAILED, STAGE_INTERRUPTED,
    stage_started_payload, stage_completed_payload,
    stage_failed_payload, stage_interrupted_payload,
    AGENT_SPAWNED, AGENT_TOOL_USE, AGENT_TOOL_RESULT, AGENT_TEXT, AGENT_COMPLETED,
    agent_spawned_payload, agent_tool_use_payload, agent_tool_result_payload,
    agent_text_payload, agent_completed_payload,
    BEAD_ASSIGNED, BEAD_COMPLETED, BEAD_FAILED, BEAD_LABELED, BEAD_NEXT,
    bead_assigned_payload, bead_completed_payload, bead_failed_payload,
    bead_labeled_payload, bead_next_payload,
    TEST_SUITE_STARTED, TEST_SUITE_PASSED, TEST_SUITE_FAILED, TEST_FIX_ATTEMPT,
    test_suite_started_payload, test_suite_passed_payload, test_suite_failed_payload, test_fix_attempt_payload,
    REVIEW_STARTED, REVIEW_VERDICT, REVIEW_FIX_ATTEMPT,
    review_started_payload, review_verdict_payload, review_fix_attempt_payload,
    MILESTONE_SET, LOOP_TRIGGERED, LOOP_EXHAUSTED,
    milestone_set_payload, loop_triggered_payload, loop_exhausted_payload,
    CB_FAILURE_RECORDED, CB_RETRY, CB_TRIPPED, CB_RESET,
    cb_failure_recorded_payload, cb_retry_payload, cb_tripped_payload, cb_reset_payload,
    COST_STAGE_TOTAL, COST_RUNNING_TOTAL, COST_BUDGET_WARNING,
    cost_stage_total_payload, cost_running_total_payload, cost_budget_warning_payload,
    GIT_BRANCH_CREATED, GIT_PR_CREATED,
    git_branch_created_payload, git_pr_created_payload,
    PREFLIGHT_COMPLETED, PREFLIGHT_SKIPPED,
    preflight_completed_payload, preflight_skipped_payload,
    LEARN_COMPLETED, LEARN_FAILED,
    learn_completed_payload, learn_failed_payload,
)


class LoopExhaustedError(Exception):
    """Raised when a loop reaches its maximum iterations."""
    pass


class PipelineError(Exception):
    """Raised when pipeline encounters an unrecoverable error."""
    pass


class CircuitBreakerTripped(PipelineError):
    """Raised when the circuit breaker halts the pipeline."""
    pass


class PipelineInterrupted(Exception):
    """Raised when the pipeline is interrupted by a signal."""
    pass


# Shutdown flag set by signal handlers
_shutdown_requested = False

# Signal/atexit status refs for crash safety (Layers 1 & 4)
_signal_status = None
_signal_status_path = None


def _check_control_file(
    run_id: Optional[str],
    worca_dir: str,
    status: dict,
    status_path: str,
    ctx,
) -> None:
    """Poll the control file for pause/stop actions.

    Reads .worca/runs/{run_id}/control.json at the top of each iteration.
    Deletes the file after reading.

    On pause: sets pipeline_status=paused, saves status, exits 0.
    On stop: SIGTERMs the Claude subprocess, sets pipeline_status=failed
             with stop_reason=stopped, saves status, raises PipelineInterrupted.
    """
    if not run_id:
        return

    ctrl = read_control(run_id, base=worca_dir)
    if ctrl is None:
        return

    delete_control(run_id, base=worca_dir)

    action = ctrl["action"]

    if action == "pause":
        status["pipeline_status"] = "paused"
        save_status(status, status_path)
        if ctx is not None:
            emit_event(ctx, RUN_PAUSED, run_paused_payload(reason="control_file"))
        _log("Pipeline paused by control file", "warn")
        sys.exit(0)

    elif action == "stop":
        terminate_current()
        status["pipeline_status"] = "failed"
        status["stop_reason"] = "stopped"
        save_status(status, status_path)
        _log("Pipeline stopped by control file", "warn")
        raise PipelineInterrupted("Pipeline stopped via control file")


def _handle_pause(ctx: EventContext, reason: str) -> None:
    """Enter a pause polling loop until a control webhook returns resume or abort.

    Emits pipeline.run.paused on entry and on each poll tick (30s interval).
    On "resume": emits pipeline.run.resumed_from_pause and returns.
    On "abort": raises PipelineInterrupted.
    On timeout/no response: continues polling.
    """
    pause_event = emit_event(ctx, RUN_PAUSED, run_paused_payload(reason=reason))
    _log(f"Pipeline paused: {reason}", "warn")
    while True:
        for _ in range(30):
            if _shutdown_requested:
                raise PipelineInterrupted("Interrupted by signal during pause")
            time.sleep(1)
        poll_event = emit_event(ctx, RUN_PAUSED, run_paused_payload(reason=reason, waiting=True))
        action = _check_control_response(ctx, poll_event or pause_event)
        if action == "resume":
            emit_event(ctx, RUN_RESUMED_FROM_PAUSE, run_resumed_from_pause_payload(
                reason="control webhook",
            ))
            _log("Pipeline resumed by control webhook", "ok")
            return
        elif action == "abort":
            raise PipelineInterrupted(f"Aborted via control webhook: {reason}")


def _base62(n: int, length: int = 3) -> str:
    """Encode an integer as a base62 string of fixed length."""
    chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
    result = []
    for _ in range(length):
        result.append(chars[n % 62])
        n //= 62
    return "".join(reversed(result))


def _sanitize_branch_name(title: str) -> str:
    """Convert a title to a valid git branch name with a unique suffix."""
    name = title.lower().strip()
    name = re.sub(r'[^a-z0-9\-]', '-', name)
    name = re.sub(r'-+', '-', name)
    name = name.strip('-')
    suffix = _base62(int(time.time()) % (62 ** 3))
    return f"worca/{name[:40]}-{suffix}"


def _generate_run_id(started_at_iso: str) -> str:
    """Generate a unique run ID from an ISO timestamp.

    Format: YYYYMMDD-HHMMSS-mmm-xxxx
      - mmm  = milliseconds (3 digits, zero-padded)
      - xxxx = 4 random hex characters

    Example: 20260323-143052-847-a1b2
    """
    import secrets

    dt = datetime.fromisoformat(started_at_iso)
    millis = dt.microsecond // 1000
    suffix = secrets.token_hex(2)  # 2 bytes = 4 hex chars
    return f"{dt.strftime('%Y%m%d-%H%M%S')}-{millis:03d}-{suffix}"


def _slugify(title: str) -> str:
    """Convert a title to a URL-safe slug for filenames."""
    slug = title.lower().strip()
    slug = re.sub(r'[^a-z0-9\-]', '-', slug)
    slug = re.sub(r'-+', '-', slug)
    return slug.strip('-')[:60]


def _next_plan_path(run_dir: str) -> str:
    """Return the next sequential plan file path inside run_dir.

    Scans for existing ``plan-NNN.md`` files and returns the path for the
    next number in sequence (e.g. ``plan-001.md`` when none exist).
    Always uses 3-digit zero-padded format (max plan-999.md).
    """
    import glob as _glob

    existing = _glob.glob(os.path.join(run_dir, "plan-[0-9][0-9][0-9].md"))
    if not existing:
        return os.path.join(run_dir, "plan-001.md")

    # Extract the numeric parts and find the max
    nums = []
    for path in existing:
        m = re.search(r'plan-(\d{3})\.md$', path)
        if m:
            nums.append(int(m.group(1)))
    next_num = max(nums) + 1 if nums else 1
    if next_num > 999:
        next_num = 999  # Cap at plan-999.md to stay within 3-digit format
    return os.path.join(run_dir, f"plan-{next_num:03d}.md")


def _resolve_plan_path(template: str, timestamp: str, title: str) -> str:
    """Resolve a plan_path_template with variable substitution."""
    return template.format(timestamp=timestamp, title_slug=_slugify(title))


def _render_agent_templates(run_dir: str, template_vars: dict,
                            overrides_dir: str = ".claude/agents/overrides") -> None:
    """Read agent .md templates from .claude/agents/core/, replace placeholders,
    apply project overlays from overrides_dir, write results to {run_dir}/agents/."""
    src_dir = ".claude/agents/core"
    dst_dir = os.path.join(run_dir, "agents")
    os.makedirs(dst_dir, exist_ok=True)
    if not os.path.isdir(src_dir):
        return

    resolver = OverlayResolver(overrides_dir=overrides_dir)

    for filename in os.listdir(src_dir):
        if not filename.endswith(".md"):
            continue
        with open(os.path.join(src_dir, filename)) as f:
            content = f.read()
        for key, value in template_vars.items():
            content = content.replace(f"{{{key}}}", str(value))
        agent_name = filename[:-3]  # strip .md
        content = resolver.resolve(agent_name, content)
        with open(os.path.join(dst_dir, filename), "w") as f:
            f.write(content)


def _agent_path(agent_name: str, run_dir: str = None) -> str:
    """Resolve agent name to the .md definition file path.

    If run_dir is provided, checks for a rendered template there first.
    Falls back to the static template in .claude/agents/core/.
    """
    if run_dir:
        rendered = os.path.join(run_dir, "agents", f"{agent_name}.md")
        if os.path.exists(rendered):
            return rendered
    return f".claude/agents/core/{agent_name}.md"


def _schema_path(schema_name: str) -> str:
    """Resolve schema filename to full path."""
    return f".claude/worca/schemas/{schema_name}"


def _is_same_work_request(existing_wr: dict, new_wr: WorkRequest) -> bool:
    """Check if the existing status file is for the same work request."""
    # Match on source_ref first (most reliable), fall back to title
    if existing_wr.get("source_ref") and new_wr.source_ref:
        return existing_wr["source_ref"] == new_wr.source_ref
    return existing_wr.get("title", "") == new_wr.title


def _archive_run(status: dict, status_path: str) -> None:
    """Move a completed/abandoned run to the results directory.

    If status has a run_id (new format), moves the entire run dir.
    Otherwise (legacy), archives as hash-based .json + logs dir.
    Always cleans up the active_run pointer.
    """
    import hashlib
    import shutil
    worca_dir = os.path.dirname(status_path)
    # For per-run dirs, worca_dir is .worca/runs/{id} — go up two levels
    if "/runs/" in status_path:
        worca_dir = os.path.dirname(os.path.dirname(os.path.dirname(status_path)))
    results_dir = os.path.join(worca_dir, "results")
    os.makedirs(results_dir, exist_ok=True)

    run_id = status.get("run_id")
    if run_id:
        # New format: move entire run dir to results/
        run_dir = os.path.join(worca_dir, "runs", run_id)
        dest = os.path.join(results_dir, run_id)
        if os.path.isdir(run_dir):
            # events.jsonl is co-located in run_dir; it is archived automatically.
            # Graceful skip: if events.jsonl is absent (events disabled), no action needed.
            shutil.move(run_dir, dest)
        elif os.path.exists(status_path):
            # Run dir missing but status exists — save status to results
            os.makedirs(dest, exist_ok=True)
            shutil.move(status_path, os.path.join(dest, "status.json"))
    else:
        # Legacy format: hash-based .json file + logs dir
        key = f"{status.get('started_at', '')}:{status.get('work_request', {}).get('title', '')}"
        legacy_id = hashlib.sha256(key.encode()).hexdigest()[:12]
        result_path = os.path.join(results_dir, f"{legacy_id}.json")
        with open(result_path, "w") as f:
            json.dump(status, f, indent=2)
        try:
            os.remove(status_path)
        except FileNotFoundError:
            pass
        logs_dir = os.path.join(worca_dir, "logs")
        if os.path.isdir(logs_dir):
            shutil.move(logs_dir, os.path.join(results_dir, legacy_id))

    # Clean up active_run pointer
    active_run_path = os.path.join(worca_dir, "active_run")
    try:
        os.remove(active_run_path)
    except FileNotFoundError:
        pass


def _pid_path(status_path: str) -> str:
    """Return the path to the PID file for this pipeline."""
    return os.path.join(os.path.dirname(status_path), "pipeline.pid")


def _write_pid(status_path: str) -> None:
    """Write our PID to the PID file."""
    path = _pid_path(status_path)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(str(os.getpid()))


def _remove_pid(status_path: str) -> None:
    """Remove the PID file."""
    path = _pid_path(status_path)
    try:
        os.remove(path)
    except FileNotFoundError:
        pass


def _install_signal_handlers():
    """Install SIGTERM/SIGINT handlers that set the shutdown flag and kill the subprocess."""
    global _shutdown_requested

    def _handler(signum, frame):
        global _shutdown_requested
        _shutdown_requested = True
        terminate_current()
        # Layer 1: immediately persist failed status on signal
        if _signal_status is not None and _signal_status_path is not None:
            try:
                _signal_status["pipeline_status"] = "failed"
                if not _signal_status.get("stop_reason"):
                    _signal_status["stop_reason"] = "signal"
                save_status(_signal_status, _signal_status_path)
            except Exception:
                pass

    signal.signal(signal.SIGTERM, _handler)
    signal.signal(signal.SIGINT, _handler)


def _restore_signal_handlers():
    """Restore default signal handlers."""
    signal.signal(signal.SIGTERM, signal.SIG_DFL)
    signal.signal(signal.SIGINT, signal.SIG_DFL)


def _atexit_cleanup():
    """Layer 4: fix stale 'running' status on normal Python exit.

    Covers cases where the finally block doesn't run (e.g. os._exit).
    Does NOT run on SIGKILL — that's covered by Node Layers 2-3.
    """
    if _signal_status is not None and _signal_status_path is not None:
        try:
            if _signal_status.get("pipeline_status") == "running":
                _signal_status["pipeline_status"] = "failed"
                if not _signal_status.get("stop_reason"):
                    _signal_status["stop_reason"] = "unexpected_exit"
                save_status(_signal_status, _signal_status_path)
        except Exception:
            pass


_orchestrator_log = None


def _init_orchestrator_log(logs_dir: str) -> None:
    """Open the orchestrator log file for appending."""
    global _orchestrator_log
    os.makedirs(logs_dir, exist_ok=True)
    _orchestrator_log = open(os.path.join(logs_dir, "orchestrator.log"), "a")


def _close_orchestrator_log() -> None:
    """Close the orchestrator log file."""
    global _orchestrator_log
    if _orchestrator_log:
        _orchestrator_log.close()
        _orchestrator_log = None


def _log(msg: str, level: str = "info") -> None:
    """Print a timestamped progress message to stderr and log file."""
    ts = time.strftime("%H:%M:%S")
    prefix = {"info": "  ", "ok": "  \u2713", "err": "  \u2717", "warn": "  !"}
    line = f"[{ts}] {prefix.get(level, '  ')} {msg}"
    print(line, file=sys.stderr, flush=True)
    if _orchestrator_log:
        _orchestrator_log.write(line + "\n")
        _orchestrator_log.flush()


def _format_duration(seconds: float) -> str:
    """Format seconds into a human-readable duration."""
    if seconds < 60:
        return f"{seconds:.0f}s"
    m, s = divmod(int(seconds), 60)
    if m < 60:
        return f"{m}m {s}s"
    h, m = divmod(m, 60)
    return f"{h}h {m}m {s}s"


def _log_stage_metrics(stage_label: str, result: dict, raw_envelope: dict) -> None:
    """Log detailed metrics from a completed stage."""
    parts = []

    # Duration from envelope (more accurate than wall clock for agent time)
    duration_ms = raw_envelope.get("duration_ms")
    if duration_ms:
        parts.append(f"time={_format_duration(duration_ms / 1000)}")

    # Turns
    turns = raw_envelope.get("num_turns")
    if turns:
        parts.append(f"turns={turns}")

    # Cost
    cost = raw_envelope.get("total_cost_usd")
    if cost:
        parts.append(f"cost=${cost:.2f}")

    # Tokens
    usage = raw_envelope.get("usage", {})
    out_tokens = usage.get("output_tokens", 0)
    if out_tokens:
        parts.append(f"output={out_tokens:,}tok")

    if parts:
        _log(f"{stage_label} metrics: {' | '.join(parts)}")

    # Stage-specific details
    if isinstance(result, dict):
        # Implement: files changed
        files = result.get("files_changed", [])
        if files:
            _log(f"{stage_label} files: {len(files)} changed")

        # Test: pass/fail
        if "passed" in result:
            failures = result.get("failures", [])
            if result["passed"]:
                _log(f"{stage_label} result: all tests passed", "ok")
            else:
                _log(f"{stage_label} result: {len(failures)} failure(s)", "err")

        # Review: outcome
        outcome = result.get("outcome")
        if outcome:
            level = "ok" if outcome == "approve" else "warn"
            _log(f"{stage_label} verdict: {outcome}", level)


def _save_stage_output(stage: Stage, result: dict, logs_dir: str = ".worca/logs", iteration: int = 1) -> None:
    """Save stage output to a per-iteration log file for resume support."""
    stage_dir = os.path.join(logs_dir, stage.value)
    os.makedirs(stage_dir, exist_ok=True)
    path = os.path.join(stage_dir, f"iter-{iteration}.json")
    with open(path, "w") as f:
        json.dump(result, f, indent=2)


_STAGE_PROMPT_PREFIX = {
    Stage.PLAN: (
        "Create a detailed implementation plan for the following work request. "
        "Write the plan to the designated plan file.\n\n"
        "Work request: {prompt}"
    ),
    Stage.COORDINATE: (
        "Decompose the following work request into Beads tasks with dependencies. "
        "Do NOT implement anything — only create tasks using `bd create`.\n\n"
        "Work request: {prompt}"
    ),
    Stage.IMPLEMENT: (
        "Implement the code changes described in the work request. "
        "Follow the plan and complete the tasks assigned to you.\n\n"
        "Work request: {prompt}"
    ),
    Stage.TEST: (
        "Review and test the implementation for the following work request. "
        "Run tests and report results. Do NOT modify code.\n\n"
        "Work request: {prompt}"
    ),
    Stage.REVIEW: (
        "Review the code changes for the following work request. "
        "Check for correctness, style, and adherence to the plan. Do NOT modify code.\n\n"
        "Work request: {prompt}"
    ),
    Stage.PR: (
        "Create a pull request for the following work request. "
        "Summarize the changes and ensure the commit history is clean.\n\n"
        "Work request: {prompt}"
    ),
    Stage.PLAN_REVIEW: (
        "Review the implementation plan for the following work request. "
        "Validate completeness, feasibility, and quality. Do NOT modify the plan.\n\n"
        "Work request: {prompt}"
    ),
    Stage.LEARN: (
        "Analyze the completed pipeline run and produce a retrospective report. "
        "Identify patterns, recurring issues, and improvement suggestions.\n\n"
        "Run data: {prompt}"
    ),
}


def _build_stage_prompt(stage: Stage, raw_prompt: str) -> str:
    """Build a role-scoped prompt that reinforces the agent's purpose."""
    template = _STAGE_PROMPT_PREFIX.get(stage)
    if template:
        return template.format(prompt=raw_prompt)
    return raw_prompt


def _run_learn_stage(status, prompt_builder, settings_path, run_dir,
                     termination_type, termination_reason, msize, logs_dir,
                     force=False, ctx=None):
    """Run the LEARN stage if enabled (or forced). Called after pipeline termination.

    Non-fatal: any exception is logged but not propagated.

    Args:
        force: If True, skip the is_learn_enabled() check. Used by the
               manual trigger (run_learn.py / UI button) so that learning
               analysis runs even when learn.enabled is false.
        ctx: Optional EventContext for emitting learn events.
    """
    if not force and not is_learn_enabled(settings_path):
        return
    _log("Running learn stage...", "info")
    actual_status_path = os.path.join(run_dir, "status.json") if run_dir else ".worca/status.json"
    learn_start = time.monotonic()
    try:
        # Feed context
        prompt_builder.update_context("full_status", status)
        prompt_builder.update_context("termination_type", termination_type)
        prompt_builder.update_context("termination_reason", termination_reason or "")
        plan_path = status.get("plan_file")
        if plan_path and os.path.exists(plan_path):
            with open(plan_path) as f:
                prompt_builder.update_context("plan_file_content", f.read())

        # Initialize learn stage in status
        status["stages"]["learn"] = {"status": "pending"}
        start_iteration(status, "learn", agent="learner",
                        model="sonnet", trigger="initial")
        # Persist to disk so the UI sees learn as in_progress (not skipped)
        save_status(status, actual_status_path)

        if ctx:
            emit_event(ctx, STAGE_STARTED, stage_started_payload(
                stage="learn", iteration=1, agent="learner",
                model="sonnet", trigger="initial", max_turns=0,
            ))

        rendered = prompt_builder.build("learn", 0)
        result, raw = run_stage(Stage.LEARN, {}, settings_path, msize=msize,
                                prompt_override=rendered)

        # Complete iteration
        complete_iteration(status, "learn", status="completed", outcome="success",
                           completed_at=datetime.now(timezone.utc).isoformat(),
                           output=result)
        update_stage(status, "learn", status="completed")

        # Save standalone learnings file
        learnings_path = None
        if run_dir:
            learnings_path = os.path.join(run_dir, "learnings.json")
            with open(learnings_path, "w") as f:
                json.dump(result, f, indent=2)
        save_status(status, actual_status_path)
        _log("Learnings saved", "ok")
        if ctx:
            duration_ms = int((time.monotonic() - learn_start) * 1000)
            emit_event(ctx, STAGE_COMPLETED, stage_completed_payload(
                stage="learn", iteration=1, duration_ms=duration_ms,
                cost_usd=0.0, turns=0, outcome="success",
            ))
            emit_event(ctx, LEARN_COMPLETED, learn_completed_payload(
                termination_type=termination_type,
                duration_ms=duration_ms,
                learnings_path=learnings_path,
            ))
    except Exception as e:
        _log(f"Learn stage failed (non-fatal): {e}", "warn")
        if ctx:
            try:
                elapsed_ms = int((time.monotonic() - learn_start) * 1000)
                emit_event(ctx, STAGE_FAILED, stage_failed_payload(
                    stage="learn", iteration=1, error=str(e),
                    error_type=type(e).__name__, elapsed_ms=elapsed_ms,
                ))
                emit_event(ctx, LEARN_FAILED, learn_failed_payload(
                    error=str(e),
                    duration_ms=elapsed_ms,
                    error_type=type(e).__name__,
                ))
            except Exception:
                pass
        try:
            complete_iteration(status, "learn", status="error", error=str(e),
                               completed_at=datetime.now(timezone.utc).isoformat())
            update_stage(status, "learn", status="error", error=str(e))
            save_status(status, actual_status_path)
        except Exception:
            pass


def _summarize_tool_input(block: dict) -> str:
    """Extract a short summary of a tool_use block's input for telemetry."""
    tool = block.get("name", "")
    inp = block.get("input", {})
    if tool in ("Read", "Write", "Edit"):
        return inp.get("file_path", "")
    if tool == "Bash":
        return (inp.get("command") or "")[:120]
    if tool == "Grep":
        return inp.get("pattern", "")
    if tool == "Glob":
        return inp.get("pattern", "")
    if tool == "Agent":
        return inp.get("description", "")
    return ""


def _is_agent_telemetry_enabled(settings_path: str) -> bool:
    """Check worca.events.agent_telemetry setting (defaults to True)."""
    try:
        settings = load_settings(settings_path)
        return settings.get("worca", {}).get("events", {}).get("agent_telemetry", True)
    except Exception:
        return True


def _make_agent_event_handler(
    ctx: Optional[EventContext],
    stage: Stage,
    iteration: int,
    settings_path: str,
):
    """Create an on_event callback closure for agent telemetry.

    Returns None if ctx is None or agent_telemetry is disabled.
    The returned callable translates stream-json events to pipeline events.
    """
    if ctx is None:
        return None
    if not _is_agent_telemetry_enabled(settings_path):
        return None

    turn_counter = [0]
    tool_id_to_name: dict = {}

    def handler(event: dict) -> None:
        etype = event.get("type", "")

        if etype == "system":
            if event.get("subtype") == "init":
                emit_event(ctx, AGENT_SPAWNED, agent_spawned_payload(
                    stage=stage.value,
                    iteration=iteration,
                    agent=STAGE_AGENT_MAP.get(stage, ""),
                    model=event.get("model", ""),
                    max_turns=0,
                ))
            # All other system subtypes (hook, etc.) are silently ignored.

        elif etype == "assistant":
            turn_counter[0] += 1
            turn = turn_counter[0]
            content = event.get("message", {}).get("content", [])
            for block in content:
                btype = block.get("type", "")
                if btype == "tool_use":
                    tool_name = block.get("name", "")
                    tool_id = block.get("id", "")
                    if tool_id:
                        tool_id_to_name[tool_id] = tool_name
                    emit_event(ctx, AGENT_TOOL_USE, agent_tool_use_payload(
                        stage=stage.value,
                        iteration=iteration,
                        tool=tool_name,
                        tool_input_summary=_summarize_tool_input(block),
                        turn=turn,
                    ))
                elif btype == "text":
                    text = block.get("text", "")
                    if text:
                        emit_event(ctx, AGENT_TEXT, agent_text_payload(
                            stage=stage.value,
                            iteration=iteration,
                            text_length=len(text),
                            turn=turn,
                        ))

        elif etype == "user":
            content = event.get("content", [])
            if isinstance(content, list):
                for block in content:
                    if isinstance(block, dict) and block.get("type") == "tool_result":
                        tool_id = block.get("tool_use_id", "")
                        tool_name = tool_id_to_name.get(tool_id, "")
                        emit_event(ctx, AGENT_TOOL_RESULT, agent_tool_result_payload(
                            stage=stage.value,
                            iteration=iteration,
                            tool=tool_name,
                            is_error=block.get("is_error", False),
                            turn=turn_counter[0],
                        ))

        elif etype == "result":
            emit_event(ctx, AGENT_COMPLETED, agent_completed_payload(
                stage=stage.value,
                iteration=iteration,
                turns=event.get("num_turns", 0),
                cost_usd=event.get("total_cost_usd", 0.0),
                duration_ms=event.get("duration_ms", 0),
                exit_code=0,
            ))

    return handler


def run_stage(
    stage: Stage,
    context: dict,
    settings_path: str = ".claude/settings.json",
    msize: int = 1,
    iteration: int = 1,
    prompt_override: str = None,
    ctx: Optional[EventContext] = None,
) -> tuple[dict, dict]:
    """Run a single pipeline stage.

    Gets stage config via get_stage_config(), calls run_agent() with the
    appropriate agent path, prompt, max_turns, and schema.

    Args:
        context: Dict with 'prompt', '_run_dir', '_logs_dir' keys.
        msize: Multiplier for max_turns (1-10). E.g. msize=2 doubles turns.
        iteration: Current iteration number (1-indexed). Controls log file path.
        prompt_override: When provided, used instead of context["prompt"].
            This allows PromptBuilder output to reach the agent directly.

    Returns (structured_output, raw_envelope) tuple. The structured_output
    is the schema-conforming result used by pipeline logic. The raw_envelope
    is the full claude CLI JSON response for logging.
    """
    config = get_stage_config(stage, settings_path=settings_path)
    max_turns = config["max_turns"] * msize
    raw_prompt = context.get("prompt", "")
    prompt = prompt_override if prompt_override is not None else _build_stage_prompt(stage, raw_prompt)
    logs_dir = context.get("_logs_dir", ".worca/logs")
    run_dir = context.get("_run_dir")
    log_dir = os.path.join(logs_dir, stage.value)
    os.makedirs(log_dir, exist_ok=True)
    log_path = os.path.join(log_dir, f"iter-{iteration}.log")
    on_event = _make_agent_event_handler(ctx, stage, iteration, settings_path)
    raw = run_agent(
        prompt=prompt,
        agent=_agent_path(config["agent"], run_dir=run_dir),
        max_turns=max_turns,
        output_format="stream-json",
        json_schema=_schema_path(config["schema"]),
        model=config.get("model"),
        log_path=log_path,
        on_event=on_event,
    )
    # claude CLI returns a JSON envelope; extract structured_output if present
    if isinstance(raw, dict) and "structured_output" in raw:
        return raw["structured_output"], raw
    return raw, raw


def run_preflight(
    context: dict,
    settings_path: str = ".claude/settings.json",
    iteration: int = 1,
) -> dict:
    """Run the preflight checks script.

    Reads the script path from worca.stages.preflight.script in settings.
    If the script does not exist, returns a skipped result with a warning.
    Otherwise runs the script via subprocess.Popen with sys.executable,
    captures stdout/stderr, writes to log file, parses JSON, logs each check.

    Returns:
        Parsed JSON dict from the script, or a skipped indicator dict.

    Raises:
        PipelineError: When the script exits with non-zero code or output
            is not valid JSON.
    """
    settings = load_settings(settings_path)

    default_script = ".claude/scripts/preflight_checks.py"
    script_path = (
        settings.get("worca", {})
        .get("stages", {})
        .get("preflight", {})
        .get("script", default_script)
    )

    if not os.path.exists(script_path):
        _log(f"Preflight script not found at {script_path!r}, skipping", "warn")
        return {"status": "skipped", "checks": [], "summary": "preflight skipped (script not found)"}

    logs_dir = context.get("_logs_dir", ".worca/logs")
    log_dir = os.path.join(logs_dir, "preflight")
    os.makedirs(log_dir, exist_ok=True)
    log_path = os.path.join(log_dir, f"iter-{iteration}.log")

    proc = subprocess.Popen(
        [sys.executable, script_path],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    stdout, stderr = proc.communicate()

    with open(log_path, "w") as log_file:
        log_file.write(stdout)
        if stderr:
            log_file.write("\n--- STDERR ---\n")
            log_file.write(stderr)

    try:
        result = json.loads(stdout)
    except json.JSONDecodeError:
        raise PipelineError(f"Preflight script output is not valid JSON: {stdout[:200]!r}")

    for check in result.get("checks", []):
        name = check.get("name", "?")
        check_status = check.get("status", "?")
        msg = check.get("message", "")
        level = "ok" if check_status == "pass" else "warn" if check_status == "warn" else "err"
        _log(f"  preflight/{name}: {check_status} — {msg}", level)

    summary = result.get("summary", "")
    if summary:
        _log(f"Preflight: {summary}")

    if proc.returncode != 0:
        raise PipelineError(f"Preflight failed: {summary}")

    return result


def check_loop_limit(
    loop_name: str,
    current_iteration: int,
    settings_path: str = ".claude/settings.json",
    mloops: int = 1,
) -> bool:
    """Check if the current iteration is within the configured loop limit.

    Reads loop limits from settings.json under worca.loops namespace.
    Returns True if current_iteration < limit, False if exhausted.
    If no limit configured, defaults to 10.

    Args:
        mloops: Multiplier for the loop limit (1-10). E.g. mloops=2 doubles max loops.
    """
    default_limit = 5
    settings = load_settings(settings_path)

    loops = settings.get("worca", {}).get("loops", {})
    limit = loops.get(loop_name, default_limit) * mloops
    return current_iteration < limit


def _get_loop_limit(loop_name: str, settings_path: str, mloops: int = 1, default: int = 5) -> int:
    """Return the configured loop limit for event payloads."""
    settings = load_settings(settings_path)
    return settings.get("worca", {}).get("loops", {}).get(loop_name, default) * mloops


def handle_pr_review(outcome: str, status: dict) -> tuple:
    """Handle the outcome of a PR review.

    Args:
        outcome: One of "approve", "request_changes", "reject", "restart_planning"
        status: Current pipeline status dict

    Returns:
        Tuple of (next_stage_or_None, updated_status).
        None for next_stage means pipeline is complete or stopped.
    """
    status["pr_review_outcome"] = outcome
    if outcome == "approve":
        return (None, status)
    elif outcome == "request_changes":
        return (Stage.IMPLEMENT, status)
    elif outcome == "reject":
        return (None, status)
    elif outcome == "restart_planning":
        return (Stage.PLAN, status)
    else:
        return (None, status)


def _query_ready_bead(allowed_ids: list[str] | None = None) -> dict | None:
    """Query bd ready and return the first available bead, or None.

    Args:
        allowed_ids: If provided, only return beads whose ID is in this list.
                     This prevents picking up stale beads from prior runs.
    """
    try:
        items = bd_ready()
        if allowed_ids is not None:
            allowed_set = set(allowed_ids)
            items = [b for b in items if b["id"] in allowed_set]
        if items:
            return items[0]
    except Exception:
        pass
    return None


def _claim_bead(bead_id: str) -> bool:
    """Claim a bead by setting its status to in_progress."""
    return bd_update(bead_id, status="in_progress")


def _ensure_beads_initialized() -> None:
    """Check if beads is initialized in the current project, init if not."""
    import subprocess
    from worca.utils.env import get_env
    env = get_env()
    result = subprocess.run(
        ["bd", "stats"], capture_output=True, text=True, env=env
    )
    if result.returncode != 0:
        init_result = subprocess.run(
            ["bd", "init"], capture_output=True, text=True, env=env
        )
        if init_result.returncode != 0:
            raise PipelineError(f"Failed to initialize beads: {init_result.stderr}")


def run_pipeline(
    work_request: WorkRequest,
    plan_file: Optional[str] = None,
    resume: bool = False,
    settings_path: str = ".claude/settings.json",
    status_path: str = ".worca/status.json",
    msize: int = 1,
    mloops: int = 1,
    branch: Optional[str] = None,
    skip_preflight: bool = False,
    on_git_divergence=None,
    worktree: bool = False,
) -> dict:
    """Run the full pipeline for a single work request.

    Creates branch, initializes status, then runs stages in sequence:
    PLAN -> (milestone gate) -> COORDINATE -> IMPLEMENT -> TEST -> REVIEW -> PR

    Handles loops:
    - test failure -> back to implement
    - review changes -> back to implement

    Args:
        plan_file: Path to a pre-made plan file. When provided, the PLAN
            stage is skipped and agents reference this file directly.
        resume: If True, attempt to resume a previous run for the same work
            request from status.json. If False (default), always start fresh
            and archive any existing run.
        msize: Multiplier for max_turns per stage (1-10).
        mloops: Multiplier for max loop iterations (1-10).

    Checks loop limits, raises LoopExhaustedError when exceeded.
    Saves status after each stage transition.
    Returns final status.
    """
    global _shutdown_requested, _signal_status, _signal_status_path
    _shutdown_requested = False

    worca_dir = os.path.dirname(status_path)  # e.g. ".worca"
    run_dir = None
    actual_status_path = status_path  # may be redirected to per-run dir

    # Auto-register project for global worca-ui discovery (non-fatal)
    try:
        from worca.utils.project_registry import auto_register_project
        project_root = os.path.dirname(os.path.dirname(os.path.abspath(settings_path)))
        auto_register_project(project_root)
    except Exception:
        pass

    # PID file and signal handlers
    _write_pid(status_path)
    _install_signal_handlers()

    # Check for resume via active_run pointer first, then flat status.json
    active_run_path = os.path.join(worca_dir, "active_run")
    existing = None
    if os.path.exists(active_run_path):
        active_id = open(active_run_path).read().strip()
        candidate = os.path.join(worca_dir, "runs", active_id, "status.json")
        if os.path.exists(candidate):
            existing = load_status(candidate)
            if existing:
                actual_status_path = candidate
                run_dir = os.path.join(worca_dir, "runs", active_id)
    if existing is None:
        existing = load_status(status_path)

    resume_stage = None

    _branch_just_created = False
    if resume and existing and _is_same_work_request(existing.get("work_request", {}), work_request):
        # Explicit resume requested and same work request found
        from worca.orchestrator.resume import find_resume_point, check_git_divergence, restore_loop_counters
        resume_stage = find_resume_point(existing)
        if resume_stage is not None:
            # Git divergence guard: warn if HEAD changed since pipeline start
            divergence = check_git_divergence(existing)
            if divergence["diverged"]:
                _log(
                    f"WARNING: git HEAD has changed since pipeline start "
                    f"(was {divergence['stored'][:8]}, now {divergence['current'][:8]}). "
                    "Code changes made since then are not part of this run.",
                    "warn",
                )
                if on_git_divergence is not None:
                    proceed = on_git_divergence(divergence["stored"], divergence["current"])
                    if not proceed:
                        return existing
            _log(f"Resuming from {resume_stage.value.upper()}")
            status = existing
            branch_name = status.get("branch", "")
            # Derive run_dir from status if not already set
            if not run_dir and status.get("run_id"):
                run_dir = os.path.join(worca_dir, "runs", status["run_id"])
                actual_status_path = os.path.join(run_dir, "status.json")

            # Clear stale control.json left over from a previous stop/pause that
            # killed the process before it could consume the file.  Without this,
            # the first iteration of the resumed pipeline would read the old
            # command and immediately stop/pause again.
            if status.get("run_id"):
                delete_control(status["run_id"], base=worca_dir)
        else:
            _log("Pipeline already completed", "ok")
            return existing  # all done
    else:
        # Fresh start — archive any existing run
        if existing:
            old_title = existing.get("work_request", {}).get("title", "unknown")
            _log(f"Archiving previous run: {old_title}")
            _archive_run(existing, actual_status_path)

        if branch:
            branch_name = branch
        elif worktree:
            # Worktree mode: branch already created by worktree setup, detect it
            branch_name = current_branch() or _sanitize_branch_name(work_request.title)
        else:
            branch_name = _sanitize_branch_name(work_request.title)
            create_branch(branch_name)
            _branch_just_created = True

        wr_dict = {
            "source_type": work_request.source_type,
            "title": work_request.title,
            "description": work_request.description,
            "source_ref": work_request.source_ref,
            "priority": work_request.priority,
        }
        status = init_status(wr_dict, branch_name, git_head=get_current_git_head())

        if worktree:
            status["worktree"] = True

        # Create per-run directory
        run_id = _generate_run_id(status["started_at"])
        status["run_id"] = run_id
        run_dir = os.path.join(worca_dir, "runs", run_id)
        os.makedirs(os.path.join(run_dir, "agents"), exist_ok=True)
        os.makedirs(os.path.join(run_dir, "logs"), exist_ok=True)
        actual_status_path = os.path.join(run_dir, "status.json")

        # Write active_run pointer
        os.makedirs(worca_dir, exist_ok=True)
        with open(active_run_path, "w") as f:
            f.write(run_id)

        save_status(status, actual_status_path)

        # Update multi-pipeline registry with the subprocess PID when in worktree mode.
        # Registration is done by run_multi.py; here we just update the PID so that
        # per-pipeline stop commands target the correct process.
        if worktree:
            update_pipeline(run_id, stage="starting", base=worca_dir)

        # Notify GitHub issue that pipeline has started (no-op for non-GH sources)
        gh_issue_start(status)

    logs_dir = os.path.join(run_dir, "logs") if run_dir else os.path.join(worca_dir, "logs")
    _init_orchestrator_log(logs_dir)

    # Wire up signal/atexit status refs for crash safety (Layers 1 & 4)
    _signal_status = status
    _signal_status_path = actual_status_path
    atexit.register(_atexit_cleanup)

    ctx = None
    try:
        _log(f"Pipeline: {work_request.title}")
        _log(f"Branch: {branch_name}")
        pipeline_t0 = time.time()

        # Initialize EventContext for structured event emission
        events_path = os.path.join(run_dir, "events.jsonl") if run_dir else None
        if events_path:
            ctx = EventContext(
                run_id=status.get("run_id", ""),
                branch=branch_name,
                work_request=status.get("work_request", {}),
                events_path=events_path,
                settings_path=settings_path,
            )
            os.environ["WORCA_EVENTS_PATH"] = events_path

            # Validate control webhooks: warn and skip those without a secret.
            # (control_webhooks property already enforces this, this is just logging.)
            try:
                _all_wh = load_settings(settings_path).get("worca", {}).get("webhooks", [])
                for _wh in _all_wh:
                    if _wh.get("control") and not _wh.get("secret"):
                        _log(
                            f"[webhook] Control webhook {_wh.get('url', '?')} has no "
                            "secret configured — skipping for security",
                            "warn",
                        )
            except Exception:
                pass

            if resume_stage is not None:
                previous = [
                    s for s, v in status.get("stages", {}).items()
                    if v.get("status") == "completed"
                ]
                emit_event(ctx, RUN_RESUMED, run_resumed_payload(
                    resume_stage=resume_stage.value,
                    previous_stages_completed=previous,
                ))
            else:
                emit_event(ctx, RUN_STARTED, run_started_payload(
                    resume=False,
                    started_at=status.get("started_at", ""),
                    plan_file=status.get("plan_file"),
                ))

            if _branch_just_created:
                emit_event(ctx, GIT_BRANCH_CREATED, git_branch_created_payload(
                    branch=branch_name,
                ))

        context = {
            "prompt": work_request.description or work_request.title,
            "_run_dir": run_dir,
            "_logs_dir": logs_dir,
        }
        if resume_stage:
            loop_counters = restore_loop_counters(status)
        else:
            loop_counters = {}
        max_beads = 0

        # Initialize PromptBuilder for context threading across stages
        prompt_context_path = os.path.join(run_dir, "prompt_context.json") if run_dir else None
        prompt_builder = PromptBuilder(
            work_request.title,
            work_request.description,
        )
        if resume_stage and prompt_context_path:
            prompt_builder.load_context(prompt_context_path)

        # Transition pipeline to running state
        status["pipeline_status"] = "running"
        save_status(status, actual_status_path)

        stage_order = get_enabled_stages(settings_path)

        # Handle plan file
        if not resume_stage:
            if plan_file:
                # Pre-made plan: reference directly (no copy to MASTER_PLAN.md)
                status["plan_file"] = plan_file
                # Store path in prompt context so _read_master_plan() can find
                # the plan even though MASTER_PLAN.md was not created.
                prompt_builder.update_context("plan_file_path", plan_file)
                _log(f"Pre-made plan: {plan_file}", "ok")
            else:
                # Generated plan: write to {run_dir}/plan-NNN.md
                if run_dir:
                    status["plan_file"] = _next_plan_path(run_dir)
                else:
                    # Fallback when no run_dir (legacy / tests)
                    _settings = load_settings(settings_path)
                    template = _settings.get("worca", {}).get(
                        "plan_path_template", "docs/plans/{timestamp}-{title_slug}.md"
                    )
                    status["plan_file"] = _resolve_plan_path(
                        template,
                        timestamp=status["run_id"] or datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S"),
                        title=work_request.title,
                    )

            # Set env vars for hooks
            os.environ["WORCA_PLAN_FILE"] = status["plan_file"]
            if status.get("run_id"):
                os.environ["WORCA_RUN_ID"] = status["run_id"]
            if run_dir:
                os.environ["WORCA_RUN_DIR"] = run_dir

            # Render agent templates with plan_file and other vars
            if run_dir:
                _render_settings = load_settings(settings_path)
                overrides_dir = _render_settings.get("worca", {}).get(
                    "agent_overrides_dir", ".claude/agents/overrides"
                )
                _render_agent_templates(run_dir, {
                    "plan_file": status["plan_file"],
                    "run_id": status.get("run_id", ""),
                    "branch": branch_name,
                    "title": work_request.title,
                }, overrides_dir=overrides_dir)

            save_status(status, actual_status_path)

        # Ensure hook env vars are set for both new and resumed runs
        os.environ["WORCA_PLAN_FILE"] = status.get("plan_file") or ""

        # Thread plan_file into PromptBuilder so _build_plan can reference it
        if status.get("plan_file"):
            prompt_builder.update_context("plan_file", status["plan_file"])
        if status.get("run_id"):
            os.environ["WORCA_RUN_ID"] = status["run_id"]

        # Determine starting index
        if resume_stage:
            stage_idx = stage_order.index(resume_stage)
        elif plan_file:
            # Mark PLAN stage as completed with pre-loaded status
            update_stage(status, Stage.PLAN.value,
                         status="completed", skipped=True, plan_file=plan_file)
            set_milestone(status, "plan_approved", True)
            if ctx:
                _ms_event = emit_event(ctx, MILESTONE_SET, milestone_set_payload(
                    milestone="plan_approved", value=True, stage=Stage.PLAN.value,
                ))
                if _ms_event:
                    _action = _check_control_response(ctx, _ms_event)
                    if _action == "pause":
                        _handle_pause(ctx, "plan_approved milestone")
                    elif _action == "abort":
                        raise PipelineInterrupted("Aborted via control webhook")
            save_status(status, actual_status_path)

            # Start from the beginning (includes PREFLIGHT) — PLAN will be
            # skipped in the main loop because it's already marked completed.
            stage_idx = 0
        else:
            stage_idx = 0

        # Track triggers for loop-back iterations
        _next_trigger = {}  # {stage_value: trigger_reason}

        while stage_idx < len(stage_order):
            current_stage = stage_order[stage_idx]

            # --- Control file polling ---
            _check_control_file(status.get("run_id"), worca_dir, status, actual_status_path, ctx)

            # Skip stages pre-marked as skipped (e.g. PLAN when plan_file provided)
            existing_stage = status.get("stages", {}).get(current_stage.value, {})
            if existing_stage.get("skipped"):
                _log(f"{current_stage.value.upper()} already completed — skipping")
                stage_idx += 1
                continue

            # On resume, skip stages already completed (PREFLIGHT always re-runs)
            if resume_stage and current_stage != Stage.PREFLIGHT:
                if existing_stage.get("status") == "completed":
                    _log(f"{current_stage.value.upper()} already completed — skipping on resume")
                    stage_idx += 1
                    continue

            # Update current stage tracker
            status["stage"] = current_stage.value

            # Determine iteration trigger and number
            trigger = _next_trigger.pop(current_stage.value, "initial")
            stage_config = get_stage_config(current_stage, settings_path=settings_path)

            # Preserve existing iterations but reset stage-level status
            prev_iterations = status.get("stages", {}).get(current_stage.value, {}).get("iterations", [])
            prev_iteration_count = status.get("stages", {}).get(current_stage.value, {}).get("iteration")
            stage_started = datetime.now(timezone.utc).isoformat()
            status["stages"][current_stage.value] = {
                "status": "in_progress",
                "started_at": stage_started,
                "agent": stage_config["agent"],
                "model": stage_config["model"],
            }
            if prev_iterations:
                status["stages"][current_stage.value]["iterations"] = prev_iterations
            if prev_iteration_count:
                status["stages"][current_stage.value]["iteration"] = prev_iteration_count

            # Start a new iteration record
            iter_record = start_iteration(
                status, current_stage.value,
                agent=stage_config["agent"],
                model=stage_config["model"],
                trigger=trigger,
            )
            iter_num = iter_record["number"]
            save_status(status, actual_status_path)
            if ctx:
                emit_event(ctx, STAGE_STARTED, stage_started_payload(
                    stage=current_stage.value,
                    iteration=iter_num,
                    agent=stage_config["agent"],
                    model=stage_config.get("model", ""),
                    trigger=trigger,
                    max_turns=(stage_config.get("max_turns") or 0) * msize,
                ))
                if current_stage == Stage.TEST:
                    emit_event(ctx, TEST_SUITE_STARTED, test_suite_started_payload(
                        stage=current_stage.value,
                        iteration=iter_num,
                        trigger=trigger,
                    ))
                elif current_stage == Stage.REVIEW:
                    emit_event(ctx, REVIEW_STARTED, review_started_payload(
                        iteration=iter_num,
                        files_under_review=prompt_builder.get_context("files_changed"),
                    ))

            stage_label = current_stage.value.upper()
            iter_label = f" (iter {iter_num})" if iter_num > 1 else ""
            _log(f"{stage_label}{iter_label} starting...")
            t0 = time.time()

            # Check shutdown flag between stages
            if _shutdown_requested:
                complete_iteration(status, current_stage.value, status="interrupted")
                update_stage(status, current_stage.value, status="interrupted")
                save_status(status, actual_status_path)
                if ctx:
                    emit_event(ctx, STAGE_INTERRUPTED, stage_interrupted_payload(
                        stage=current_stage.value,
                        iteration=iter_num,
                        elapsed_ms=int((time.time() - t0) * 1000),
                    ))
                raise PipelineInterrupted("Pipeline interrupted before stage start")

            # --- Phase 1 bead assignment (IMPLEMENT only) ---
            if current_stage == Stage.IMPLEMENT:
                impl_trigger = _next_trigger.get(Stage.IMPLEMENT.value, "initial")
                if impl_trigger in ("initial", "next_bead"):
                    # Phase 1: implement all beads sequentially
                    run_bead_ids = prompt_builder.get_context("beads_ids")
                    bead = _query_ready_bead(allowed_ids=run_bead_ids)
                    if bead:
                        bead_id = bead["id"]
                        _claim_bead(bead_id)
                        if ctx:
                            emit_event(ctx, BEAD_ASSIGNED, bead_assigned_payload(
                                bead_id=bead_id,
                                title=bead["title"],
                                iteration=loop_counters.get("bead_iteration", 0) + 1,
                            ))
                        prompt_builder.update_context("assigned_bead_id", bead_id)
                        prompt_builder.update_context("assigned_bead_title", bead["title"])
                        try:
                            details = bd_show(bead_id)
                            prompt_builder.update_context("assigned_bead_description", details.get("description", ""))
                        except Exception:
                            prompt_builder.update_context("assigned_bead_description", "")
                elif impl_trigger in ("test_failure", "review_changes"):
                    # Phase 3: fix mode — no bead assignment
                    prompt_builder.update_context("assigned_bead_id", None)
                    prompt_builder.update_context("assigned_bead_title", None)
                    prompt_builder.update_context("assigned_bead_description", None)

            # Build stage-specific prompt via PromptBuilder (skip for script-based stages)
            if current_stage != Stage.PREFLIGHT:
                if current_stage.value == "implement":
                    pb_iteration = prompt_builder.get_context("bead_prompt_iteration") or 0
                else:
                    pb_iteration = loop_counters.get(f"{current_stage.value}_iteration", 0)
                rendered_prompt = prompt_builder.build(current_stage.value, pb_iteration)

                # Store rendered prompt in status for UI visibility
                status["stages"][current_stage.value]["prompt"] = rendered_prompt
                iter_record["prompt"] = rendered_prompt
                save_status(status, actual_status_path)
            else:
                rendered_prompt = None

            # Run the stage
            try:
                # Ensure beads is initialized before coordinate stage
                if current_stage == Stage.COORDINATE:
                    _ensure_beads_initialized()

                if current_stage == Stage.PREFLIGHT and skip_preflight:
                    _log("PREFLIGHT skipped (--skip-preflight)", "warn")
                    stage_completed = datetime.now(timezone.utc).isoformat()
                    _elapsed_ms = int((time.time() - t0) * 1000)
                    complete_iteration(
                        status, current_stage.value,
                        status="completed",
                        completed_at=stage_completed,
                    )
                    update_stage(
                        status, current_stage.value,
                        status="completed",
                        skipped=True,
                        completed_at=stage_completed,
                    )
                    save_status(status, actual_status_path)
                    if ctx:
                        emit_event(ctx, PREFLIGHT_SKIPPED, preflight_skipped_payload(
                            reason="--skip-preflight",
                        ))
                        _sc_event = emit_event(ctx, STAGE_COMPLETED, stage_completed_payload(
                            stage=current_stage.value,
                            iteration=iter_num,
                            duration_ms=_elapsed_ms,
                            cost_usd=0.0,
                            turns=0,
                            outcome="skipped",
                        ))
                        if _sc_event:
                            _action = _check_control_response(ctx, _sc_event)
                            if _action == "pause":
                                _handle_pause(ctx, f"{current_stage.value} stage.completed")
                            elif _action == "abort":
                                raise PipelineInterrupted("Aborted via control webhook")
                    stage_idx += 1
                    continue
                elif current_stage == Stage.PREFLIGHT:
                    result = run_preflight(context, settings_path, iteration=iter_num)
                    raw_envelope = {"type": "preflight", "checks": result.get("checks", [])}
                else:
                    # Pass rendered_prompt as prompt_override so PromptBuilder
                    # output actually reaches the agent (not just stored for UI)
                    result, raw_envelope = run_stage(
                        current_stage, context, settings_path,
                        msize=msize, iteration=iter_num,
                        prompt_override=rendered_prompt,
                        ctx=ctx,
                    )
            except InterruptedError:
                stage_completed = datetime.now(timezone.utc).isoformat()
                complete_iteration(
                    status, current_stage.value,
                    status="interrupted",
                    completed_at=stage_completed,
                )
                update_stage(
                    status, current_stage.value,
                    status="interrupted",
                    completed_at=stage_completed,
                )
                save_status(status, actual_status_path)
                if ctx:
                    emit_event(ctx, STAGE_INTERRUPTED, stage_interrupted_payload(
                        stage=current_stage.value,
                        iteration=iter_num,
                        elapsed_ms=int((time.time() - t0) * 1000),
                    ))
                raise PipelineInterrupted(f"Pipeline interrupted during {current_stage.value}")
            except Exception as e:
                stage_completed = datetime.now(timezone.utc).isoformat()
                complete_iteration(
                    status, current_stage.value,
                    status="error",
                    completed_at=stage_completed,
                    error=str(e),
                )
                update_stage(
                    status, current_stage.value,
                    status="error",
                    completed_at=stage_completed,
                    error=str(e),
                )
                save_status(status, actual_status_path)
                if ctx:
                    emit_event(ctx, STAGE_FAILED, stage_failed_payload(
                        stage=current_stage.value,
                        iteration=iter_num,
                        error=str(e),
                        error_type=type(e).__name__,
                        elapsed_ms=int((time.time() - t0) * 1000),
                    ))

                # Circuit breaker integration
                try:
                    _cb_config = load_settings(settings_path).get("worca", {}).get("circuit_breaker", {})
                except Exception:
                    _cb_config = {}

                if _cb_config.get("enabled", False) and current_stage != Stage.PREFLIGHT:
                    _failure_history = get_circuit_breaker_state(status).get("failure_history", [])
                    classification = classify_error(
                        str(e), current_stage.value, _failure_history, settings_path
                    )
                    record_failure(status, current_stage.value, str(e), classification)
                    if ctx:
                        emit_event(ctx, CB_FAILURE_RECORDED, cb_failure_recorded_payload(
                            stage=current_stage.value,
                            error=str(e),
                            category=classification.get("category", "unknown"),
                            retriable=classification.get("retriable", False),
                            consecutive_failures=get_circuit_breaker_state(status)["consecutive_failures"],
                        ))
                    iter_record["classification"] = classification
                    save_status(status, actual_status_path)

                    _cat = classification.get("category", "unknown")
                    _retriable = classification.get("retriable", False)
                    _log(f"Error classified: {_cat} (retriable={_retriable})")

                    halt, reason = should_halt(status, classification, settings_path)
                    if halt:
                        status["circuit_breaker"]["tripped"] = True
                        status["circuit_breaker"]["tripped_reason"] = reason
                        save_status(status, actual_status_path)
                        if ctx:
                            emit_event(ctx, CB_TRIPPED, cb_tripped_payload(
                                reason=reason,
                                consecutive_failures=get_circuit_breaker_state(status)["consecutive_failures"],
                                category=_cat,
                            ))
                        raise CircuitBreakerTripped(reason)

                    if _retriable and _cat == CATEGORY_TRANSIENT:
                        # NOTE: consecutive_failures is pipeline-global, not per-stage.
                        # It resets on any stage success (record_success), so backoff
                        # escalates across consecutive failures regardless of which stage
                        # failed. This is intentional — repeated failures anywhere in the
                        # pipeline should escalate severity, not reset per stage.
                        _retry_attempt = get_circuit_breaker_state(status)["consecutive_failures"] - 1
                        _delay = get_retry_delay(_retry_attempt, settings_path)
                        if _delay is not None:
                            _log(f"Transient error — retrying in {_delay}s", "warn")
                            if ctx:
                                emit_event(ctx, CB_RETRY, cb_retry_payload(
                                    stage=current_stage.value,
                                    attempt=_retry_attempt + 1,
                                    delay_seconds=_delay,
                                    consecutive_failures=get_circuit_breaker_state(status)["consecutive_failures"],
                                ))
                            time.sleep(_delay)
                            continue

                raise
            else:
                _prev_consecutive = get_circuit_breaker_state(status)["consecutive_failures"]
                record_success(status)
                if ctx and _prev_consecutive > 0:
                    emit_event(ctx, CB_RESET, cb_reset_payload(
                        stage=current_stage.value,
                        previous_consecutive_failures=_prev_consecutive,
                    ))

            elapsed = time.time() - t0
            _log(f"{stage_label}{iter_label} completed ({_format_duration(elapsed)})", "ok")

            # Log detailed metrics
            if isinstance(raw_envelope, dict):
                _log_stage_metrics(stage_label, result, raw_envelope)

            # Save full envelope for resume/debugging (per-iteration)
            _save_stage_output(current_stage, raw_envelope, logs_dir, iteration=iter_num)

            # Extract token usage from the raw envelope
            usage = extract_token_usage(raw_envelope) if isinstance(raw_envelope, dict) else {}

            # Emit cost events after token extraction
            if ctx and isinstance(raw_envelope, dict):
                _stage_cost = raw_envelope.get("total_cost_usd") or 0.0
                _stage_input = usage.get("input_tokens", 0)
                _stage_output = usage.get("output_tokens", 0)
                if _stage_cost or _stage_input or _stage_output:
                    emit_event(ctx, COST_STAGE_TOTAL, cost_stage_total_payload(
                        stage=current_stage.value,
                        iteration=iter_num,
                        cost_usd=_stage_cost,
                        input_tokens=_stage_input,
                        output_tokens=_stage_output,
                        model=stage_config.get("model", ""),
                    ))
                # Running total: sum of all previously-completed stages + current
                _prev_costs = sum(
                    (v.get("cost_usd") or 0)
                    for k, v in status.get("stages", {}).items()
                    if k != current_stage.value
                )
                _running_cost = _prev_costs + _stage_cost
                _prev_input = sum(
                    (v.get("token_usage", {}).get("input_tokens") or 0)
                    for v in status.get("stages", {}).values()
                )
                _prev_output = sum(
                    (v.get("token_usage", {}).get("output_tokens") or 0)
                    for v in status.get("stages", {}).values()
                )
                emit_event(ctx, COST_RUNNING_TOTAL, cost_running_total_payload(
                    total_cost_usd=_running_cost,
                    total_input_tokens=_prev_input + _stage_input,
                    total_output_tokens=_prev_output + _stage_output,
                ))
                # Budget warning check
                try:
                    _budget_settings = load_settings(settings_path).get("worca", {}).get("budget", {})
                except Exception:
                    _budget_settings = {}
                _max_cost = _budget_settings.get("max_cost_usd")
                if _max_cost and _max_cost > 0 and _running_cost > 0:
                    _warning_pct = _budget_settings.get("warning_pct", 80.0)
                    _pct_used = (_running_cost / _max_cost) * 100.0
                    if _pct_used >= _warning_pct:
                        emit_event(ctx, COST_BUDGET_WARNING, cost_budget_warning_payload(
                            total_cost_usd=_running_cost,
                            budget_usd=_max_cost,
                            pct_used=_pct_used,
                        ))

            # Build iteration completion kwargs
            stage_completed = datetime.now(timezone.utc).isoformat()
            iter_extras = {
                "status": "completed",
                "completed_at": stage_completed,
                "duration_ms": int(elapsed * 1000),
            }
            if isinstance(raw_envelope, dict):
                if raw_envelope.get("duration_api_ms"):
                    iter_extras["duration_api_ms"] = raw_envelope["duration_api_ms"]
                if raw_envelope.get("duration_ms"):
                    iter_extras["duration_session_ms"] = raw_envelope["duration_ms"]
                if raw_envelope.get("num_turns"):
                    iter_extras["turns"] = raw_envelope["num_turns"]
                if raw_envelope.get("total_cost_usd"):
                    iter_extras["cost_usd"] = raw_envelope["total_cost_usd"]
            if usage:
                iter_extras["token_usage"] = usage
            iter_extras["prompt"] = rendered_prompt
            if isinstance(result, dict):
                iter_extras["output"] = result

            # Mark stage and iteration completed
            stage_extras = {"status": "completed", "completed_at": stage_completed}
            if isinstance(raw_envelope, dict):
                if raw_envelope.get("num_turns"):
                    stage_extras["turns"] = raw_envelope["num_turns"]
                if raw_envelope.get("total_cost_usd"):
                    stage_extras["cost_usd"] = raw_envelope["total_cost_usd"]

            # Compute stage-level token aggregate across all iterations
            all_iter_usages = []
            for it in status.get("stages", {}).get(current_stage.value, {}).get("iterations", []):
                it_usage = it.get("token_usage")
                if it_usage:
                    all_iter_usages.append(it_usage)
            if usage:
                all_iter_usages.append(usage)
            if all_iter_usages:
                stage_extras["token_usage"] = aggregate_token_usage(all_iter_usages)

            # Handle PREFLIGHT completion
            if current_stage == Stage.PREFLIGHT:
                preflight_skipped = result.get("status") == "skipped"
                iter_extras["outcome"] = "skipped" if preflight_skipped else "success"
                # No AI call — zero out session/api so timing bar shows this as pipeline overhead
                iter_extras.setdefault("duration_session_ms", 0)
                iter_extras.setdefault("duration_api_ms", 0)
                complete_iteration(status, current_stage.value, **iter_extras)
                update_stage(status, current_stage.value,
                             **{**stage_extras, "skipped": preflight_skipped})
                save_status(status, actual_status_path)
                if ctx:
                    if preflight_skipped:
                        emit_event(ctx, PREFLIGHT_SKIPPED, preflight_skipped_payload(
                            reason=result.get("summary", "preflight skipped"),
                        ))
                    else:
                        _pf_checks = result.get("checks", [])
                        _pf_all_passed = all(
                            c.get("status") in ("pass", "warn") for c in _pf_checks
                        ) if _pf_checks else True
                        emit_event(ctx, PREFLIGHT_COMPLETED, preflight_completed_payload(
                            checks=_pf_checks,
                            all_passed=_pf_all_passed,
                        ))
                    _sc_event = emit_event(ctx, STAGE_COMPLETED, stage_completed_payload(
                        stage=current_stage.value, iteration=iter_num,
                        duration_ms=iter_extras.get("duration_ms", 0),
                        cost_usd=iter_extras.get("cost_usd", 0.0),
                        turns=iter_extras.get("turns", 0),
                        outcome=iter_extras["outcome"],
                        token_usage=iter_extras.get("token_usage"),
                    ))
                    if _sc_event:
                        _action = _check_control_response(ctx, _sc_event)
                        if _action == "pause":
                            _handle_pause(ctx, f"{current_stage.value} stage.completed")
                        elif _action == "abort":
                            raise PipelineInterrupted("Aborted via control webhook")

            # Milestone gate after PLAN
            elif current_stage == Stage.PLAN:
                approved = result.get("approved", True)
                iter_extras["outcome"] = "success" if approved else "rejected"
                complete_iteration(status, current_stage.value, **iter_extras)
                update_stage(status, current_stage.value, **stage_extras)
                set_milestone(status, "plan_approved", approved)
                if ctx:
                    _ms_event = emit_event(ctx, MILESTONE_SET, milestone_set_payload(
                        milestone="plan_approved", value=approved, stage=Stage.PLAN.value,
                    ))
                    if _ms_event:
                        _action = _check_control_response(ctx, _ms_event)
                        if _action == "approve":
                            approved = True
                            set_milestone(status, "plan_approved", True)
                            iter_extras["outcome"] = "success"
                        elif _action == "reject":
                            approved = False
                            set_milestone(status, "plan_approved", False)
                            iter_extras["outcome"] = "rejected"
                        elif _action == "pause":
                            _handle_pause(ctx, "plan_approved milestone")
                        elif _action == "abort":
                            raise PipelineInterrupted("Aborted via control webhook")
                save_status(status, actual_status_path)
                if ctx:
                    _sc_event = emit_event(ctx, STAGE_COMPLETED, stage_completed_payload(
                        stage=current_stage.value, iteration=iter_num,
                        duration_ms=iter_extras.get("duration_ms", 0),
                        cost_usd=iter_extras.get("cost_usd", 0.0),
                        turns=iter_extras.get("turns", 0),
                        outcome=iter_extras["outcome"],
                        token_usage=iter_extras.get("token_usage"),
                    ))
                    if _sc_event:
                        _action = _check_control_response(ctx, _sc_event)
                        if _action == "pause":
                            _handle_pause(ctx, f"{current_stage.value} stage.completed")
                        elif _action == "abort":
                            raise PipelineInterrupted("Aborted via control webhook")
                if not approved:
                    _log("PLAN not approved — stopping", "err")
                    raise PipelineError("Plan not approved")
                _log("PLAN approved", "ok")
                # Thread plan outputs into PromptBuilder for downstream stages
                prompt_builder.update_context("plan_approach", result.get("approach", ""))
                prompt_builder.update_context("plan_tasks_outline", result.get("tasks_outline", []))

            # Handle plan review results
            elif current_stage == Stage.PLAN_REVIEW:
                outcome = result.get("outcome", "revise")  # fail-closed default
                issues = result.get("issues", [])
                critical_issues = [i for i in issues if i.get("severity") in ("critical", "major")]

                iter_extras["outcome"] = outcome
                complete_iteration(status, current_stage.value, **iter_extras)
                update_stage(status, current_stage.value, **stage_extras)
                save_status(status, actual_status_path)
                if ctx:
                    _sc_event = emit_event(ctx, STAGE_COMPLETED, stage_completed_payload(
                        stage=current_stage.value, iteration=iter_num,
                        duration_ms=iter_extras.get("duration_ms", 0),
                        cost_usd=iter_extras.get("cost_usd", 0.0),
                        turns=iter_extras.get("turns", 0),
                        outcome=iter_extras["outcome"],
                        token_usage=iter_extras.get("token_usage"),
                    ))
                    if _sc_event:
                        _action = _check_control_response(ctx, _sc_event)
                        if _action == "pause":
                            _handle_pause(ctx, f"{current_stage.value} stage.completed")
                        elif _action == "abort":
                            raise PipelineInterrupted("Aborted via control webhook")

                # Revise gate: outcome == "revise" AND (critical issues present OR issues list empty)
                # Minor/suggestion-only issues are treated as approve.
                # Empty issues list with revise outcome is fail-closed — still revise.
                should_revise = (outcome == "revise") and bool(critical_issues or not issues)

                if should_revise:
                    # Thread review feedback — only critical/major issues to limit context growth
                    prev_history = list(prompt_builder.get_context("plan_review_history") or [])
                    prev_history.append({"attempt": len(prev_history) + 1, "issues": list(critical_issues)})
                    # Cap history to most recent 50 entries to bound context growth
                    if len(prev_history) > 50:
                        prev_history = prev_history[-50:]
                    prompt_builder.update_context("plan_review_history", prev_history)
                    prompt_builder.update_context("plan_review_issues", list(critical_issues))
                    prompt_builder.update_context("plan_revision_mode", True)

                    # Update ALL counters before saving — single save to avoid inconsistent state
                    loop_counters["plan_review"] = loop_counters.get("plan_review", 0) + 1
                    loop_counters[f"{Stage.PLAN_REVIEW.value}_iteration"] = (
                        loop_counters.get(f"{Stage.PLAN_REVIEW.value}_iteration", 0) + 1
                    )
                    status["loop_counters"] = dict(loop_counters)

                    if check_loop_limit("plan_review", loop_counters["plan_review"],
                                        settings_path, mloops=mloops):
                        if ctx:
                            _lt_event = emit_event(ctx, LOOP_TRIGGERED, loop_triggered_payload(
                                loop_key="plan_review",
                                iteration=loop_counters["plan_review"],
                                from_stage=Stage.PLAN_REVIEW.value,
                                to_stage=Stage.PLAN.value,
                                trigger="plan_review_revise",
                            ))
                            if _lt_event:
                                _action = _check_control_response(ctx, _lt_event)
                                if _action == "pause":
                                    _handle_pause(ctx, "plan_review loop.triggered")
                                elif _action == "abort":
                                    raise PipelineInterrupted("Aborted via control webhook")

                        # --- Atomic loop-back sequence ---
                        # 1. Reset PLAN stage status and clear plan_approved milestone
                        update_stage(status, Stage.PLAN.value, status="pending", skipped=False)
                        status.get("milestones", {}).pop("plan_approved", None)
                        # 2. Persist context + status before any in-memory transitions
                        if prompt_context_path:
                            prompt_builder.save_context(prompt_context_path)
                        save_status(status, actual_status_path)
                        # 3. In-memory transitions (context keys drive behavior on crash/resume)
                        _next_trigger[Stage.PLAN.value] = "plan_review_revise"
                        stage_idx = stage_order.index(Stage.PLAN)
                        continue  # Loop back to PLAN
                    else:
                        # Loop exhausted — clean up revision context keys so they
                        # don't leak into COORDINATE or later PLAN re-runs.
                        prompt_builder.pop_context("plan_review_issues")
                        prompt_builder.pop_context("plan_revision_mode")
                        prompt_builder.pop_context("plan_review_history")
                        if prompt_context_path:
                            prompt_builder.save_context(prompt_context_path)
                        save_status(status, actual_status_path)
                        if ctx:
                            emit_event(ctx, LOOP_EXHAUSTED, loop_exhausted_payload(
                                loop_key="plan_review",
                                iteration=loop_counters["plan_review"],
                                limit=_get_loop_limit("plan_review", settings_path, mloops),
                            ))
                        _log("Plan review loop exhausted -- proceeding to COORDINATE", "warn")
                else:
                    # Approve path — pop cross-context keys to prevent leaking
                    prompt_builder.pop_context("plan_review_issues")
                    prompt_builder.pop_context("plan_revision_mode")
                    prompt_builder.pop_context("plan_review_history")
                    if prompt_context_path:
                        prompt_builder.save_context(prompt_context_path)

                    if outcome == "revise" and not critical_issues and issues:
                        _log(f"Plan approved with {len(issues)} minor issues (logged)", "ok")
                    elif issues:
                        _log(f"Plan approved with {len(issues)} minor issues (logged)", "ok")
                    else:
                        _log("Plan approved by reviewer", "ok")

            # Handle coordinate results
            elif current_stage == Stage.COORDINATE:
                iter_extras["outcome"] = "success"
                complete_iteration(status, current_stage.value, **iter_extras)
                update_stage(status, current_stage.value, **stage_extras)
                save_status(status, actual_status_path)
                if ctx:
                    _sc_event = emit_event(ctx, STAGE_COMPLETED, stage_completed_payload(
                        stage=current_stage.value, iteration=iter_num,
                        duration_ms=iter_extras.get("duration_ms", 0),
                        cost_usd=iter_extras.get("cost_usd", 0.0),
                        turns=iter_extras.get("turns", 0),
                        outcome=iter_extras["outcome"],
                        token_usage=iter_extras.get("token_usage"),
                    ))
                    if _sc_event:
                        _action = _check_control_response(ctx, _sc_event)
                        if _action == "pause":
                            _handle_pause(ctx, f"{current_stage.value} stage.completed")
                        elif _action == "abort":
                            raise PipelineInterrupted("Aborted via control webhook")
                # Thread coordinate outputs into PromptBuilder
                beads_ids = result.get("beads_ids", [])
                max_beads = len(beads_ids)
                prompt_builder.update_context("beads_ids", beads_ids)
                prompt_builder.update_context("dependency_graph", result.get("dependency_graph", {}))
                # Link beads to this run via label
                if beads_ids:
                    run_label = f"run:{status['run_id']}"
                    if bd_label_add(beads_ids, run_label):
                        _log(f"Labeled {len(beads_ids)} beads with {run_label}", "ok")
                        if ctx:
                            emit_event(ctx, BEAD_LABELED, bead_labeled_payload(
                                bead_ids=beads_ids,
                                label=run_label,
                            ))
                    else:
                        _log(f"Failed to label beads with {run_label}", "warn")

            # Handle implement results — batch-then-test flow
            elif current_stage == Stage.IMPLEMENT:
                iter_extras["outcome"] = "success"
                complete_iteration(status, current_stage.value, **iter_extras)
                update_stage(status, current_stage.value, **stage_extras)
                save_status(status, actual_status_path)
                if ctx:
                    _sc_event = emit_event(ctx, STAGE_COMPLETED, stage_completed_payload(
                        stage=current_stage.value, iteration=iter_num,
                        duration_ms=iter_extras.get("duration_ms", 0),
                        cost_usd=iter_extras.get("cost_usd", 0.0),
                        turns=iter_extras.get("turns", 0),
                        outcome=iter_extras["outcome"],
                        token_usage=iter_extras.get("token_usage"),
                    ))
                    if _sc_event:
                        _action = _check_control_response(ctx, _sc_event)
                        if _action == "pause":
                            _handle_pause(ctx, f"{current_stage.value} stage.completed")
                        elif _action == "abort":
                            raise PipelineInterrupted("Aborted via control webhook")

                # Thread implement outputs into PromptBuilder
                new_files = result.get("files_changed", [])
                new_tests = result.get("tests_added", [])
                prompt_builder.update_context("files_changed", new_files)
                prompt_builder.update_context("tests_added", new_tests)

                impl_trigger = trigger  # trigger was popped earlier in the loop
                if impl_trigger in ("initial", "next_bead"):
                    # Phase 1: close the bead we just implemented
                    claimed_bead = prompt_builder.get_context("assigned_bead_id")
                    if claimed_bead:
                        if bd_close(claimed_bead, reason="implemented"):
                            _log(f"Closed bead {claimed_bead}", "ok")
                            if ctx:
                                emit_event(ctx, BEAD_COMPLETED, bead_completed_payload(
                                    bead_id=claimed_bead,
                                    reason="implemented",
                                ))
                        else:
                            _log(f"Failed to close bead {claimed_bead}", "warn")
                            if ctx:
                                emit_event(ctx, BEAD_FAILED, bead_failed_payload(
                                    bead_id=claimed_bead,
                                    error="bd_close failed",
                                ))

                    # Accumulate files across all beads
                    all_files = prompt_builder.get_context("all_files_changed") or []
                    all_files.extend(new_files)
                    prompt_builder.update_context("all_files_changed", all_files)
                    all_tests = prompt_builder.get_context("all_tests_added") or []
                    all_tests.extend(new_tests)
                    prompt_builder.update_context("all_tests_added", all_tests)

                    loop_counters["bead_iteration"] = loop_counters.get("bead_iteration", 0) + 1
                    status["loop_counters"] = dict(loop_counters)

                    # Check for more beads (scoped to this run)
                    next_bead = _query_ready_bead(allowed_ids=run_bead_ids)
                    if next_bead and Stage.IMPLEMENT in stage_order:
                        if loop_counters["bead_iteration"] < max_beads:
                            _log(f"Next bead available — looping back to IMPLEMENT (bead {loop_counters['bead_iteration']})", "ok")
                            _next_trigger[Stage.IMPLEMENT.value] = "next_bead"
                            stage_idx = stage_order.index(Stage.IMPLEMENT)
                            if ctx:
                                emit_event(ctx, BEAD_NEXT, bead_next_payload(
                                    next_bead_id=next_bead["id"],
                                    bead_iteration=loop_counters["bead_iteration"],
                                    max_beads=max_beads,
                                ))
                            continue
                        else:
                            if next_bead:
                                _log(f"Bead limit reached ({max_beads}) but bd ready still has beads — possible stale beads from prior run", "warn")
                            _log(f"Bead iteration limit reached after {loop_counters['bead_iteration']} beads", "warn")

                    # All beads done — set accumulated files for TEST/REVIEW
                    prompt_builder.update_context("files_changed", list(set(all_files)))
                    prompt_builder.update_context("tests_added", list(set(all_tests)))
                    _log("All beads implemented — advancing to TEST", "ok")
                # Phase 3 (fix mode): just fall through to TEST with current files

            # Handle test results — simplified (flat counter, no per-bead logic)
            elif current_stage == Stage.TEST:
                passed = result.get("passed", False)
                # Thread test outputs into PromptBuilder
                prompt_builder.update_context("test_passed", passed)
                prompt_builder.update_context("test_coverage", result.get("coverage_pct"))
                prompt_builder.update_context("proof_artifacts", result.get("proof_artifacts", []))
                if not passed:
                    new_failures = result.get("failures", [])
                    # Accumulate test failure history
                    prev_history = prompt_builder.get_context("test_failure_history") or []
                    prev_history.append({"attempt": len(prev_history) + 1, "failures": new_failures})
                    prompt_builder.update_context("test_failure_history", prev_history)
                    prompt_builder.update_context("test_failures", new_failures)
                    prompt_builder.update_context("review_issues", None)
                    prompt_builder.update_context("review_history", None)
                    iter_extras["outcome"] = "test_failure"
                    complete_iteration(status, current_stage.value, **iter_extras)
                    update_stage(status, current_stage.value, **stage_extras)
                    save_status(status, actual_status_path)
                    if ctx:
                        emit_event(ctx, TEST_SUITE_FAILED, test_suite_failed_payload(
                            iteration=iter_num,
                            failure_count=len(new_failures),
                            failures=new_failures,
                        ))
                        _sc_event = emit_event(ctx, STAGE_COMPLETED, stage_completed_payload(
                            stage=current_stage.value, iteration=iter_num,
                            duration_ms=iter_extras.get("duration_ms", 0),
                            cost_usd=iter_extras.get("cost_usd", 0.0),
                            turns=iter_extras.get("turns", 0),
                            outcome=iter_extras["outcome"],
                            token_usage=iter_extras.get("token_usage"),
                        ))
                        if _sc_event:
                            _action = _check_control_response(ctx, _sc_event)
                            if _action == "pause":
                                _handle_pause(ctx, f"{current_stage.value} stage.completed")
                            elif _action == "abort":
                                raise PipelineInterrupted("Aborted via control webhook")
                    if Stage.IMPLEMENT not in stage_order:
                        _log("Tests failed but IMPLEMENT stage is disabled — treating as pass", "warn")
                    else:
                        # Flat test-fix counter (not per-bead)
                        loop_counters["implement_test"] = loop_counters.get("implement_test", 0) + 1
                        status["loop_counters"] = dict(loop_counters)
                        bead_prompt_iter = prompt_builder.get_context("bead_prompt_iteration") or 0
                        prompt_builder.update_context("bead_prompt_iteration", bead_prompt_iter + 1)
                        _log(f"Tests failed — looping back to IMPLEMENT fix mode (attempt {loop_counters['implement_test']})", "warn")
                        if check_loop_limit("implement_test", loop_counters["implement_test"], settings_path, mloops=mloops):
                            if ctx:
                                emit_event(ctx, TEST_FIX_ATTEMPT, test_fix_attempt_payload(
                                    attempt=loop_counters["implement_test"],
                                    limit=_get_loop_limit("implement_test", settings_path, mloops),
                                    failures_summary=str(new_failures[:3]),
                                ))
                                _lt_event = emit_event(ctx, LOOP_TRIGGERED, loop_triggered_payload(
                                    loop_key="implement_test",
                                    iteration=loop_counters["implement_test"],
                                    from_stage=Stage.TEST.value,
                                    to_stage=Stage.IMPLEMENT.value,
                                    trigger="test_failure",
                                ))
                                if _lt_event:
                                    _action = _check_control_response(ctx, _lt_event)
                                    if _action == "pause":
                                        _handle_pause(ctx, "implement_test loop.triggered")
                                    elif _action == "abort":
                                        raise PipelineInterrupted("Aborted via control webhook")
                            _next_trigger[Stage.IMPLEMENT.value] = "test_failure"
                            stage_idx = stage_order.index(Stage.IMPLEMENT)
                            continue
                        else:
                            _log(f"Test fix limit exhausted after {loop_counters['implement_test']} attempts — finishing", "warn")
                            if ctx:
                                emit_event(ctx, LOOP_EXHAUSTED, loop_exhausted_payload(
                                    loop_key="implement_test",
                                    iteration=loop_counters["implement_test"],
                                    limit=_get_loop_limit("implement_test", settings_path, mloops),
                                ))
                else:
                    iter_extras["outcome"] = "success"
                    complete_iteration(status, current_stage.value, **iter_extras)
                    update_stage(status, current_stage.value, **stage_extras)
                    save_status(status, actual_status_path)
                    if ctx:
                        emit_event(ctx, TEST_SUITE_PASSED, test_suite_passed_payload(
                            iteration=iter_num,
                            coverage_pct=result.get("coverage_pct"),
                            proof_artifacts=result.get("proof_artifacts"),
                        ))
                        _sc_event = emit_event(ctx, STAGE_COMPLETED, stage_completed_payload(
                            stage=current_stage.value, iteration=iter_num,
                            duration_ms=iter_extras.get("duration_ms", 0),
                            cost_usd=iter_extras.get("cost_usd", 0.0),
                            turns=iter_extras.get("turns", 0),
                            outcome=iter_extras["outcome"],
                            token_usage=iter_extras.get("token_usage"),
                        ))
                        if _sc_event:
                            _action = _check_control_response(ctx, _sc_event)
                            if _action == "pause":
                                _handle_pause(ctx, f"{current_stage.value} stage.completed")
                            elif _action == "abort":
                                raise PipelineInterrupted("Aborted via control webhook")
                    _log("Tests passed", "ok")

            # Handle review results — simplified (flat counter, no per-bead logic)
            elif current_stage == Stage.REVIEW:
                outcome = result.get("outcome", "approve")
                _log(f"Review outcome: {outcome}")
                next_stage, status = handle_pr_review(outcome, status)
                _all_issues = result.get("issues", [])
                _critical_count = sum(
                    1 for i in _all_issues if i.get("severity") in ("critical", "major")
                )
                if ctx:
                    emit_event(ctx, REVIEW_VERDICT, review_verdict_payload(
                        outcome=outcome,
                        issue_count=len(_all_issues),
                        critical_count=_critical_count,
                    ))
                iter_extras["outcome"] = outcome
                complete_iteration(status, current_stage.value, **iter_extras)
                update_stage(status, current_stage.value, **stage_extras)
                save_status(status, actual_status_path)
                if ctx:
                    _sc_event = emit_event(ctx, STAGE_COMPLETED, stage_completed_payload(
                        stage=current_stage.value, iteration=iter_num,
                        duration_ms=iter_extras.get("duration_ms", 0),
                        cost_usd=iter_extras.get("cost_usd", 0.0),
                        turns=iter_extras.get("turns", 0),
                        outcome=iter_extras["outcome"],
                        token_usage=iter_extras.get("token_usage"),
                    ))
                    if _sc_event:
                        _action = _check_control_response(ctx, _sc_event)
                        if _action == "pause":
                            _handle_pause(ctx, f"{current_stage.value} stage.completed")
                        elif _action == "abort":
                            raise PipelineInterrupted("Aborted via control webhook")
                if next_stage is None:
                    if outcome == "reject":
                        _log("PR rejected — stopping", "err")
                        raise PipelineError("PR rejected")
                    _log("Review approved", "ok")

                elif next_stage == Stage.IMPLEMENT:
                    new_issues = result.get("issues", [])

                    # Severity-gate: only loop back for critical/major issues
                    critical_issues = [i for i in new_issues if i.get("severity") in ("critical", "major")]
                    if not critical_issues:
                        _log("Only minor/suggestion issues — treating as approve", "ok")
                    else:
                        # Accumulate review history
                        prev_history = prompt_builder.get_context("review_history") or []
                        prev_history.append({"attempt": len(prev_history) + 1, "issues": new_issues})
                        prompt_builder.update_context("review_history", prev_history)
                        prompt_builder.update_context("review_issues", critical_issues)
                        prompt_builder.update_context("test_failures", None)
                        prompt_builder.update_context("test_failure_history", None)

                        if Stage.IMPLEMENT not in stage_order:
                            _log("Changes requested but IMPLEMENT stage is disabled — skipping loop", "warn")
                        else:
                            # Flat review-fix counter (not per-bead)
                            loop_counters["pr_changes"] = loop_counters.get("pr_changes", 0) + 1
                            status["loop_counters"] = dict(loop_counters)
                            bead_prompt_iter = prompt_builder.get_context("bead_prompt_iteration") or 0
                            prompt_builder.update_context("bead_prompt_iteration", bead_prompt_iter + 1)
                            _log(f"Changes requested — looping back to IMPLEMENT fix mode (attempt {loop_counters['pr_changes']})", "warn")
                            if check_loop_limit("pr_changes", loop_counters["pr_changes"], settings_path, mloops=mloops):
                                if ctx:
                                    emit_event(ctx, REVIEW_FIX_ATTEMPT, review_fix_attempt_payload(
                                        attempt=loop_counters["pr_changes"],
                                        limit=_get_loop_limit("pr_changes", settings_path, mloops),
                                        critical_issues=critical_issues,
                                    ))
                                    _lt_event = emit_event(ctx, LOOP_TRIGGERED, loop_triggered_payload(
                                        loop_key="pr_changes",
                                        iteration=loop_counters["pr_changes"],
                                        from_stage=Stage.REVIEW.value,
                                        to_stage=Stage.IMPLEMENT.value,
                                        trigger="review_changes",
                                    ))
                                    if _lt_event:
                                        _action = _check_control_response(ctx, _lt_event)
                                        if _action == "pause":
                                            _handle_pause(ctx, "pr_changes loop.triggered")
                                        elif _action == "abort":
                                            raise PipelineInterrupted("Aborted via control webhook")
                                _next_trigger[Stage.IMPLEMENT.value] = "review_changes"
                                stage_idx = stage_order.index(Stage.IMPLEMENT)
                                continue
                            else:
                                _log(f"Review fix limit exhausted after {loop_counters['pr_changes']} attempts — finishing", "warn")
                                if ctx:
                                    emit_event(ctx, LOOP_EXHAUSTED, loop_exhausted_payload(
                                        loop_key="pr_changes",
                                        iteration=loop_counters["pr_changes"],
                                        limit=_get_loop_limit("pr_changes", settings_path, mloops),
                                    ))

                elif next_stage == Stage.PLAN:
                    if Stage.PLAN not in stage_order:
                        _log("Restart planning requested but PLAN stage is disabled — skipping loop", "warn")
                    else:
                        loop_key = "restart_planning"
                        loop_counters[loop_key] = loop_counters.get(loop_key, 0) + 1
                        status["loop_counters"] = dict(loop_counters)
                        _log(f"Restart planning requested (iteration {loop_counters[loop_key]})", "warn")
                        if not check_loop_limit(loop_key, loop_counters[loop_key], settings_path, mloops=mloops):
                            if ctx:
                                emit_event(ctx, LOOP_EXHAUSTED, loop_exhausted_payload(
                                    loop_key=loop_key,
                                    iteration=loop_counters[loop_key],
                                    limit=_get_loop_limit(loop_key, settings_path, mloops),
                                ))
                            raise LoopExhaustedError(
                                f"Loop {loop_key} exhausted after {loop_counters[loop_key]} iterations"
                            )
                        if ctx:
                            _lt_event = emit_event(ctx, LOOP_TRIGGERED, loop_triggered_payload(
                                loop_key=loop_key,
                                iteration=loop_counters[loop_key],
                                from_stage=Stage.REVIEW.value,
                                to_stage=Stage.PLAN.value,
                                trigger="restart_planning",
                            ))
                            if _lt_event:
                                _action = _check_control_response(ctx, _lt_event)
                                if _action == "pause":
                                    _handle_pause(ctx, "restart_planning loop.triggered")
                                elif _action == "abort":
                                    raise PipelineInterrupted("Aborted via control webhook")
                        _next_trigger[Stage.PLAN.value] = "restart_planning"
                        stage_idx = stage_order.index(Stage.PLAN)
                        continue

            # Default: complete iteration for stages without special handling
            else:
                iter_extras["outcome"] = "success"
                complete_iteration(status, current_stage.value, **iter_extras)
                update_stage(status, current_stage.value, **stage_extras)
                save_status(status, actual_status_path)
                if ctx:
                    _sc_event = emit_event(ctx, STAGE_COMPLETED, stage_completed_payload(
                        stage=current_stage.value, iteration=iter_num,
                        duration_ms=iter_extras.get("duration_ms", 0),
                        cost_usd=iter_extras.get("cost_usd", 0.0),
                        turns=iter_extras.get("turns", 0),
                        outcome=iter_extras["outcome"],
                        token_usage=iter_extras.get("token_usage"),
                    ))
                    if _sc_event:
                        _action = _check_control_response(ctx, _sc_event)
                        if _action == "pause":
                            _handle_pause(ctx, f"{current_stage.value} stage.completed")
                        elif _action == "abort":
                            raise PipelineInterrupted("Aborted via control webhook")
                # PR stage: emit git.pr_created if result has pr_url
                if ctx and current_stage == Stage.PR and isinstance(result, dict):
                    _pr_url = result.get("pr_url")
                    _pr_number = result.get("pr_number")
                    if _pr_url and _pr_number is not None:
                        emit_event(ctx, GIT_PR_CREATED, git_pr_created_payload(
                            pr_url=_pr_url,
                            pr_number=_pr_number,
                            title=work_request.title,
                        ))

            # Persist context and loop counters after each completed stage
            status["loop_counters"] = dict(loop_counters)
            save_status(status, actual_status_path)
            if prompt_context_path:
                prompt_builder.save_context(prompt_context_path)

            stage_idx += 1

        total_elapsed = time.time() - pipeline_t0

        # Compute run-level token aggregate from stage data
        all_iter_usages = []
        by_stage_agg = {}
        for stage_name, stage_data in status.get("stages", {}).items():
            stage_token = stage_data.get("token_usage")
            if stage_token:
                by_stage_agg[stage_name] = stage_token
            for it in stage_data.get("iterations", []):
                it_usage = it.get("token_usage")
                if it_usage:
                    all_iter_usages.append(it_usage)

        if all_iter_usages:
            run_agg = aggregate_token_usage(all_iter_usages)
            run_agg["by_model"] = aggregate_by_model(all_iter_usages)
            run_agg["by_stage"] = by_stage_agg
            status["token_usage"] = run_agg

        # Extract totals for logging
        run_token = status.get("token_usage", {})
        total_cost = run_token.get("total_cost_usd", 0)
        total_turns = run_token.get("num_turns", 0)

        # Mark pipeline as completed with timestamp
        status["pipeline_status"] = "completed"
        status["completed_at"] = datetime.now(timezone.utc).isoformat()
        save_status(status, actual_status_path)

        # Update multi-pipeline registry on completion (worktree mode)
        if status.get("worktree") and status.get("run_id"):
            update_pipeline(status["run_id"], status="completed", base=worca_dir)

        # Update GitHub issue (post summary, remove label, close)
        gh_issue_complete(status)

        # Update cumulative stats
        stats_dir = os.path.join(os.path.dirname(actual_status_path), "..", "..", "stats")
        if run_dir:
            stats_dir = os.path.join(os.path.dirname(os.path.dirname(run_dir)), "stats")
        stats_path = os.path.join(stats_dir, "cumulative.json")
        try:
            update_cumulative_stats(status, stats_path)
        except Exception as e:
            _log(f"Warning: failed to update cumulative stats: {e}", "warn")

        _log(f"Pipeline completed in {_format_duration(total_elapsed)}", "ok")
        summary_parts = []
        if total_turns:
            summary_parts.append(f"turns={total_turns}")
        if total_cost:
            summary_parts.append(f"cost=${total_cost:.2f}")
        total_tokens = run_token.get("input_tokens", 0) + run_token.get("output_tokens", 0)
        if total_tokens:
            summary_parts.append(f"tokens={total_tokens:,}")
        if summary_parts:
            _log(f"Totals: {' | '.join(summary_parts)}")

        _run_learn_stage(status, prompt_builder, settings_path, run_dir,
                         "success", "", msize, logs_dir, ctx=ctx)

        if ctx:
            _stages_done = [s for s, d in status.get("stages", {}).items() if d.get("status") == "completed"]
            emit_event(ctx, RUN_COMPLETED, run_completed_payload(
                duration_ms=int(total_elapsed * 1000),
                total_cost_usd=total_cost,
                total_turns=total_turns,
                total_tokens=total_tokens,
                stages_completed=_stages_done,
            ))

        return status
    except PipelineInterrupted:
        status["pipeline_status"] = "failed"
        status["stop_reason"] = "stopped"
        save_status(status, actual_status_path)
        if ctx:
            emit_event(ctx, RUN_INTERRUPTED, run_interrupted_payload(
                interrupted_stage=status.get("stage", ""),
                elapsed_ms=int((time.time() - pipeline_t0) * 1000),
            ))
        raise  # Do NOT run learn on user interruption
    except LoopExhaustedError as e:
        status["pipeline_status"] = "failed"
        status["stop_reason"] = "loop_exhausted"
        save_status(status, actual_status_path)
        _run_learn_stage(status, prompt_builder, settings_path, run_dir,
                         "loop_exhausted", str(e), msize, logs_dir, ctx=ctx)
        if ctx:
            emit_event(ctx, RUN_FAILED, run_failed_payload(
                error=str(e),
                failed_stage=status.get("stage"),
                error_type="loop_exhausted",
            ))
        raise
    except PipelineError as e:
        status["pipeline_status"] = "failed"
        status["stop_reason"] = "pipeline_error"
        save_status(status, actual_status_path)
        # Skip LEARN when preflight fails — environment is broken, claude CLI unavailable
        if status.get("stage") != "preflight":
            _run_learn_stage(status, prompt_builder, settings_path, run_dir,
                             "failure", str(e), msize, logs_dir, ctx=ctx)
        if ctx:
            emit_event(ctx, RUN_FAILED, run_failed_payload(
                error=str(e),
                failed_stage=status.get("stage"),
                error_type="pipeline_error",
            ))
        raise
    except Exception as e:
        status["pipeline_status"] = "failed"
        status["stop_reason"] = type(e).__name__
        save_status(status, actual_status_path)
        _run_learn_stage(status, prompt_builder, settings_path, run_dir,
                         "failure", str(e), msize, logs_dir, ctx=ctx)
        if ctx:
            emit_event(ctx, RUN_FAILED, run_failed_payload(
                error=str(e),
                failed_stage=status.get("stage"),
                error_type=type(e).__name__,
            ))
        raise
    finally:
        if ctx is not None:
            ctx.close()
        # Safety net: ensure pipeline_status is never left as "running" on exit
        try:
            if status and status.get("pipeline_status") == "running":
                status["pipeline_status"] = "failed"
                if not status.get("stop_reason"):
                    status["stop_reason"] = "unexpected_exit"
            if prompt_context_path and prompt_builder:
                prompt_builder.save_context(prompt_context_path)
            if status:
                if loop_counters:
                    status["loop_counters"] = dict(loop_counters)
                save_status(status, actual_status_path)
        except Exception:
            pass  # Don't mask the real error
        # Update multi-pipeline registry on failure (worktree mode)
        # Success case is handled above before the except blocks.
        try:
            if (status and status.get("worktree") and status.get("run_id")
                    and status.get("pipeline_status") == "failed"):
                update_pipeline(status["run_id"], status="failed", base=worca_dir)
        except Exception:
            pass
        _restore_signal_handlers()
        # Clear signal/atexit refs — finally block already handled cleanup
        _signal_status = None
        _signal_status_path = None
        try:
            atexit.unregister(_atexit_cleanup)
        except Exception:
            pass
        _remove_pid(status_path)
        _close_orchestrator_log()
        os.environ.pop("WORCA_PLAN_FILE", None)
        os.environ.pop("WORCA_RUN_ID", None)
        os.environ.pop("WORCA_RUN_DIR", None)
        os.environ.pop("WORCA_EVENTS_PATH", None)
