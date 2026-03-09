"""Single work request pipeline runner.

Orchestrates the full pipeline from plan through PR.
"""

import json
import os
import re
import signal
import subprocess
import sys
import time
from datetime import datetime, timezone
from typing import Optional

from worca.orchestrator.stages import Stage, can_transition, get_stage_config, STAGE_AGENT_MAP
from worca.orchestrator.work_request import WorkRequest
from worca.state.status import load_status, save_status, update_stage, set_milestone, init_status
from worca.utils.claude_cli import run_agent, terminate_current
from worca.utils.git import create_branch


class LoopExhaustedError(Exception):
    """Raised when a loop reaches its maximum iterations."""
    pass


class PipelineError(Exception):
    """Raised when pipeline encounters an unrecoverable error."""
    pass


class PipelineInterrupted(Exception):
    """Raised when the pipeline is interrupted by a signal."""
    pass


# Shutdown flag set by signal handlers
_shutdown_requested = False


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


def _agent_path(agent_name: str) -> str:
    """Resolve agent name to the .md definition file path."""
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
    """Move a status.json to the results directory as a completed/abandoned run."""
    import hashlib
    import shutil
    results_dir = os.path.join(os.path.dirname(status_path), "results")
    os.makedirs(results_dir, exist_ok=True)
    # Generate a deterministic ID from started_at + title
    # Uses SHA256 with ":" separator to match watcher.js createRunId()
    key = f"{status.get('started_at', '')}:{status.get('work_request', {}).get('title', '')}"
    run_id = hashlib.sha256(key.encode()).hexdigest()[:12]
    result_path = os.path.join(results_dir, f"{run_id}.json")
    with open(result_path, "w") as f:
        json.dump(status, f, indent=2)
    os.remove(status_path)
    # Move logs into results/{run_id}/ for archived viewing
    logs_dir = os.path.join(os.path.dirname(status_path), "logs")
    if os.path.isdir(logs_dir):
        archived_logs_dir = os.path.join(results_dir, run_id)
        shutil.move(logs_dir, archived_logs_dir)


def _pid_path(status_path: str) -> str:
    """Return the path to the PID file for this pipeline."""
    return os.path.join(os.path.dirname(status_path), "pipeline.pid")


def _write_pid(status_path: str) -> None:
    """Write our PID to the PID file. Checks for stale PID first."""
    path = _pid_path(status_path)
    if os.path.exists(path):
        try:
            old_pid = int(open(path).read().strip())
            os.kill(old_pid, 0)  # Check if alive
            raise PipelineError(f"Pipeline already running (PID {old_pid})")
        except (ProcessLookupError, ValueError, OSError):
            pass  # Stale PID, safe to overwrite
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

    signal.signal(signal.SIGTERM, _handler)
    signal.signal(signal.SIGINT, _handler)


def _restore_signal_handlers():
    """Restore default signal handlers."""
    signal.signal(signal.SIGTERM, signal.SIG_DFL)
    signal.signal(signal.SIGINT, signal.SIG_DFL)


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


def _save_stage_output(stage: Stage, result: dict, logs_dir: str = ".worca/logs") -> None:
    """Save stage output to a log file for resume support."""
    os.makedirs(logs_dir, exist_ok=True)
    path = os.path.join(logs_dir, f"{stage.value}.json")
    with open(path, "w") as f:
        json.dump(result, f, indent=2)


def run_stage(
    stage: Stage,
    context: dict,
    settings_path: str = ".claude/settings.json",
    msize: int = 1,
) -> tuple[dict, dict]:
    """Run a single pipeline stage.

    Gets stage config via get_stage_config(), calls run_agent() with the
    appropriate agent path, prompt, max_turns, and schema.

    Args:
        msize: Multiplier for max_turns (1-10). E.g. msize=2 doubles turns.

    Returns (structured_output, raw_envelope) tuple. The structured_output
    is the schema-conforming result used by pipeline logic. The raw_envelope
    is the full claude CLI JSON response for logging.
    """
    config = get_stage_config(stage, settings_path=settings_path)
    max_turns = config["max_turns"] * msize
    prompt = context.get("prompt", "")
    log_path = os.path.join(".worca/logs", f"{stage.value}.log")
    raw = run_agent(
        prompt=prompt,
        agent=_agent_path(config["agent"]),
        max_turns=max_turns,
        output_format="json",
        json_schema=_schema_path(config["schema"]),
        log_path=log_path,
    )
    # claude CLI returns a JSON envelope; extract structured_output if present
    if isinstance(raw, dict) and "structured_output" in raw:
        return raw["structured_output"], raw
    return raw, raw


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
    default_limit = 10
    try:
        with open(settings_path) as f:
            settings = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        settings = {}

    loops = settings.get("worca", {}).get("loops", {})
    limit = loops.get(loop_name, default_limit) * mloops
    return current_iteration < limit


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
        raise PipelineError(f"Unknown PR review outcome: {outcome}")


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
    settings_path: str = ".claude/settings.json",
    status_path: str = ".worca/status.json",
    msize: int = 1,
    mloops: int = 1,
) -> dict:
    """Run the full pipeline for a single work request.

    Creates branch, initializes status, then runs stages in sequence:
    PLAN -> (milestone gate) -> COORDINATE -> IMPLEMENT -> TEST -> REVIEW -> PR

    Handles loops:
    - test failure -> back to implement
    - review changes -> back to implement

    Args:
        msize: Multiplier for max_turns per stage (1-10).
        mloops: Multiplier for max loop iterations (1-10).

    Checks loop limits, raises LoopExhaustedError when exceeded.
    Saves status after each stage transition.
    Returns final status.
    """
    global _shutdown_requested
    _shutdown_requested = False

    logs_dir = os.path.join(os.path.dirname(status_path), "logs")

    # PID file and signal handlers
    _write_pid(status_path)
    _install_signal_handlers()

    # Check for resume vs fresh start
    existing = load_status(status_path)
    resume_stage = None

    if existing and _is_same_work_request(existing.get("work_request", {}), work_request):
        # Same work request — try to resume
        from worca.orchestrator.resume import find_resume_point
        resume_stage = find_resume_point(existing)
        if resume_stage is not None:
            _log(f"Resuming from {resume_stage.value.upper()}")
            status = existing
            branch_name = status.get("branch", "")
        else:
            _log("Pipeline already completed", "ok")
            return existing  # all done
    else:
        # Different work request or no existing run — archive and start fresh
        if existing:
            old_title = existing.get("work_request", {}).get("title", "unknown")
            _log(f"Archiving previous run: {old_title}")
            _archive_run(existing, status_path)

        branch_name = _sanitize_branch_name(work_request.title)
        create_branch(branch_name)

        wr_dict = {
            "source_type": work_request.source_type,
            "title": work_request.title,
            "description": work_request.description,
            "source_ref": work_request.source_ref,
            "priority": work_request.priority,
        }
        status = init_status(wr_dict, branch_name)
        save_status(status, status_path)

    _init_orchestrator_log(logs_dir)

    try:
        _log(f"Pipeline: {work_request.title}")
        _log(f"Branch: {branch_name}")
        pipeline_t0 = time.time()

        context = {"prompt": work_request.description or work_request.title}
        loop_counters = {}

        stage_order = [Stage.PLAN, Stage.COORDINATE, Stage.IMPLEMENT, Stage.TEST, Stage.REVIEW, Stage.PR]

        # Determine starting index
        if resume_stage:
            stage_idx = stage_order.index(resume_stage)
        else:
            stage_idx = 0

        while stage_idx < len(stage_order):
            current_stage = stage_order[stage_idx]

            # Update current stage tracker
            status["stage"] = current_stage.value

            # Reset stage data and mark as in_progress
            # Clear all previous loop data (completed_at, turns, cost_usd, error, etc.)
            stage_config = get_stage_config(current_stage, settings_path=settings_path)
            stage_started = datetime.now(timezone.utc).isoformat()
            prev_iteration = status.get("stages", {}).get(current_stage.value, {}).get("iteration")
            status["stages"][current_stage.value] = {
                "status": "in_progress",
                "started_at": stage_started,
                "agent": stage_config["agent"],
                "model": stage_config["model"],
            }
            if prev_iteration:
                status["stages"][current_stage.value]["iteration"] = prev_iteration
            save_status(status, status_path)

            stage_label = current_stage.value.upper()
            _log(f"{stage_label} starting...")
            t0 = time.time()

            # Check shutdown flag between stages
            if _shutdown_requested:
                update_stage(status, current_stage.value, status="interrupted")
                save_status(status, status_path)
                raise PipelineInterrupted("Pipeline interrupted before stage start")

            # Run the stage
            try:
                # Ensure beads is initialized before coordinate stage
                if current_stage == Stage.COORDINATE:
                    _ensure_beads_initialized()

                result, raw_envelope = run_stage(current_stage, context, settings_path, msize=msize)
            except InterruptedError:
                stage_completed = datetime.now(timezone.utc).isoformat()
                update_stage(
                    status, current_stage.value,
                    status="interrupted",
                    completed_at=stage_completed,
                )
                save_status(status, status_path)
                raise PipelineInterrupted(f"Pipeline interrupted during {current_stage.value}")
            except Exception as e:
                stage_completed = datetime.now(timezone.utc).isoformat()
                update_stage(
                    status, current_stage.value,
                    status="error",
                    completed_at=stage_completed,
                    error=str(e),
                )
                save_status(status, status_path)
                raise

            elapsed = time.time() - t0
            _log(f"{stage_label} completed ({_format_duration(elapsed)})", "ok")

            # Log detailed metrics
            if isinstance(raw_envelope, dict):
                _log_stage_metrics(stage_label, result, raw_envelope)

            # Save full envelope for resume/debugging
            _save_stage_output(current_stage, raw_envelope, logs_dir)

            # Mark stage completed with timing and metrics
            stage_completed = datetime.now(timezone.utc).isoformat()
            stage_extras = {"status": "completed", "completed_at": stage_completed}
            if isinstance(raw_envelope, dict):
                if raw_envelope.get("num_turns"):
                    stage_extras["turns"] = raw_envelope["num_turns"]
                if raw_envelope.get("total_cost_usd"):
                    stage_extras["cost_usd"] = raw_envelope["total_cost_usd"]
            update_stage(status, current_stage.value, **stage_extras)
            save_status(status, status_path)

            # Milestone gate after PLAN
            if current_stage == Stage.PLAN:
                approved = result.get("approved", True)
                set_milestone(status, "plan_approved", approved)
                save_status(status, status_path)
                if not approved:
                    _log("PLAN not approved — stopping", "err")
                    raise PipelineError("Plan not approved")
                _log("PLAN approved", "ok")

            # Handle test results
            if current_stage == Stage.TEST:
                passed = result.get("passed", False)
                if not passed:
                    loop_key = "implement_test"
                    loop_counters[loop_key] = loop_counters.get(loop_key, 0) + 1
                    _log(f"Tests failed — looping back to IMPLEMENT (iteration {loop_counters[loop_key]})", "warn")
                    if not check_loop_limit(loop_key, loop_counters[loop_key], settings_path, mloops=mloops):
                        _log(f"Loop {loop_key} exhausted after {loop_counters[loop_key]} iterations", "err")
                        raise LoopExhaustedError(
                            f"Loop {loop_key} exhausted after {loop_counters[loop_key]} iterations"
                        )
                    update_stage(status, Stage.IMPLEMENT.value, iteration=loop_counters[loop_key])
                    save_status(status, status_path)
                    stage_idx = stage_order.index(Stage.IMPLEMENT)
                    continue
                _log(f"Tests passed", "ok")

            # Handle review results
            if current_stage == Stage.REVIEW:
                outcome = result.get("outcome", "approve")
                _log(f"Review outcome: {outcome}")
                next_stage, status = handle_pr_review(outcome, status)
                if next_stage is None:
                    if outcome == "reject":
                        _log("PR rejected — stopping", "err")
                        raise PipelineError("PR rejected")
                    _log("Review approved", "ok")
                elif next_stage == Stage.IMPLEMENT:
                    loop_key = "pr_changes"
                    loop_counters[loop_key] = loop_counters.get(loop_key, 0) + 1
                    _log(f"Changes requested — looping back to IMPLEMENT (iteration {loop_counters[loop_key]})", "warn")
                    if not check_loop_limit(loop_key, loop_counters[loop_key], settings_path, mloops=mloops):
                        _log(f"Loop {loop_key} exhausted after {loop_counters[loop_key]} iterations", "err")
                        raise LoopExhaustedError(
                            f"Loop {loop_key} exhausted after {loop_counters[loop_key]} iterations"
                        )
                    update_stage(status, Stage.IMPLEMENT.value, iteration=loop_counters[loop_key])
                    save_status(status, status_path)
                    stage_idx = stage_order.index(Stage.IMPLEMENT)
                    continue
                elif next_stage == Stage.PLAN:
                    loop_key = "restart_planning"
                    loop_counters[loop_key] = loop_counters.get(loop_key, 0) + 1
                    _log(f"Restart planning requested (iteration {loop_counters[loop_key]})", "warn")
                    if not check_loop_limit(loop_key, loop_counters[loop_key], settings_path, mloops=mloops):
                        raise LoopExhaustedError(
                            f"Loop {loop_key} exhausted after {loop_counters[loop_key]} iterations"
                        )
                    update_stage(status, Stage.PLAN.value, iteration=loop_counters[loop_key])
                    save_status(status, status_path)
                    stage_idx = stage_order.index(Stage.PLAN)
                    continue

            stage_idx += 1

        total_elapsed = time.time() - pipeline_t0

        # Pipeline summary
        total_cost = 0
        total_turns = 0
        for stage_file in ["plan", "coordinate", "implement", "test", "review", "pr"]:
            log_path = os.path.join(logs_dir, f"{stage_file}.json")
            if os.path.exists(log_path):
                try:
                    with open(log_path) as f:
                        env = json.load(f)
                    total_cost += env.get("total_cost_usd", 0) or 0
                    total_turns += env.get("num_turns", 0) or 0
                except (json.JSONDecodeError, OSError):
                    pass

        # Mark pipeline as completed with timestamp
        status["completed_at"] = datetime.now(timezone.utc).isoformat()
        save_status(status, status_path)

        _log(f"Pipeline completed in {_format_duration(total_elapsed)}", "ok")
        summary_parts = []
        if total_turns:
            summary_parts.append(f"turns={total_turns}")
        if total_cost:
            summary_parts.append(f"cost=${total_cost:.2f}")
        if summary_parts:
            _log(f"Totals: {' | '.join(summary_parts)}")

        return status
    finally:
        _restore_signal_handlers()
        _remove_pid(status_path)
        _close_orchestrator_log()
