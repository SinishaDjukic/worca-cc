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

from worca.orchestrator.prompt_builder import PromptBuilder
from worca.orchestrator.stages import (
    Stage, can_transition, get_stage_config, get_enabled_stages, STAGE_AGENT_MAP,
)
from worca.orchestrator.work_request import WorkRequest
from worca.state.status import (
    load_status, save_status, update_stage, set_milestone, init_status,
    start_iteration, complete_iteration,
)
from worca.utils.beads import bd_ready, bd_show, bd_update, bd_close, bd_label_add
from worca.utils.claude_cli import run_agent, terminate_current
from worca.utils.git import create_branch
from worca.utils.token_usage import extract_token_usage, aggregate_token_usage, aggregate_by_model
from worca.utils.stats import update_cumulative_stats


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


def _generate_run_id(started_at_iso: str) -> str:
    """Generate a run ID in YYYYMMDD-HHMMSS format from an ISO timestamp."""
    dt = datetime.fromisoformat(started_at_iso)
    return dt.strftime("%Y%m%d-%H%M%S")


def _slugify(title: str) -> str:
    """Convert a title to a URL-safe slug for filenames."""
    slug = title.lower().strip()
    slug = re.sub(r'[^a-z0-9\-]', '-', slug)
    slug = re.sub(r'-+', '-', slug)
    return slug.strip('-')[:60]


def _resolve_plan_path(template: str, timestamp: str, title: str) -> str:
    """Resolve a plan_path_template with variable substitution."""
    return template.format(timestamp=timestamp, title_slug=_slugify(title))


def _render_agent_templates(run_dir: str, template_vars: dict) -> None:
    """Read agent .md templates from .claude/agents/core/, replace placeholders,
    write rendered versions to {run_dir}/agents/."""
    src_dir = ".claude/agents/core"
    dst_dir = os.path.join(run_dir, "agents")
    os.makedirs(dst_dir, exist_ok=True)
    if not os.path.isdir(src_dir):
        return
    for filename in os.listdir(src_dir):
        if not filename.endswith(".md"):
            continue
        with open(os.path.join(src_dir, filename)) as f:
            content = f.read()
        for key, value in template_vars.items():
            content = content.replace(f"{{{key}}}", str(value))
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
}


def _build_stage_prompt(stage: Stage, raw_prompt: str) -> str:
    """Build a role-scoped prompt that reinforces the agent's purpose."""
    template = _STAGE_PROMPT_PREFIX.get(stage)
    if template:
        return template.format(prompt=raw_prompt)
    return raw_prompt


def run_stage(
    stage: Stage,
    context: dict,
    settings_path: str = ".claude/settings.json",
    msize: int = 1,
    iteration: int = 1,
) -> tuple[dict, dict]:
    """Run a single pipeline stage.

    Gets stage config via get_stage_config(), calls run_agent() with the
    appropriate agent path, prompt, max_turns, and schema.

    Args:
        context: Dict with 'prompt', '_run_dir', '_logs_dir' keys.
        msize: Multiplier for max_turns (1-10). E.g. msize=2 doubles turns.
        iteration: Current iteration number (1-indexed). Controls log file path.

    Returns (structured_output, raw_envelope) tuple. The structured_output
    is the schema-conforming result used by pipeline logic. The raw_envelope
    is the full claude CLI JSON response for logging.
    """
    config = get_stage_config(stage, settings_path=settings_path)
    max_turns = config["max_turns"] * msize
    raw_prompt = context.get("prompt", "")
    prompt = _build_stage_prompt(stage, raw_prompt)
    logs_dir = context.get("_logs_dir", ".worca/logs")
    run_dir = context.get("_run_dir")
    log_dir = os.path.join(logs_dir, stage.value)
    os.makedirs(log_dir, exist_ok=True)
    log_path = os.path.join(log_dir, f"iter-{iteration}.log")
    raw = run_agent(
        prompt=prompt,
        agent=_agent_path(config["agent"], run_dir=run_dir),
        max_turns=max_turns,
        output_format="stream-json",
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
        return (None, status)


def _query_ready_bead() -> dict | None:
    """Query bd ready and return the first available bead, or None."""
    try:
        items = bd_ready()
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
    global _shutdown_requested
    _shutdown_requested = False

    worca_dir = os.path.dirname(status_path)  # e.g. ".worca"
    run_dir = None
    actual_status_path = status_path  # may be redirected to per-run dir

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

    if resume and existing and _is_same_work_request(existing.get("work_request", {}), work_request):
        # Explicit resume requested and same work request found
        from worca.orchestrator.resume import find_resume_point
        resume_stage = find_resume_point(existing)
        if resume_stage is not None:
            _log(f"Resuming from {resume_stage.value.upper()}")
            status = existing
            branch_name = status.get("branch", "")
            # Derive run_dir from status if not already set
            if not run_dir and status.get("run_id"):
                run_dir = os.path.join(worca_dir, "runs", status["run_id"])
                actual_status_path = os.path.join(run_dir, "status.json")
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
        else:
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

    logs_dir = os.path.join(run_dir, "logs") if run_dir else os.path.join(worca_dir, "logs")
    _init_orchestrator_log(logs_dir)

    try:
        _log(f"Pipeline: {work_request.title}")
        _log(f"Branch: {branch_name}")
        pipeline_t0 = time.time()

        context = {
            "prompt": work_request.description or work_request.title,
            "_run_dir": run_dir,
            "_logs_dir": logs_dir,
        }
        loop_counters = {}

        # Initialize PromptBuilder for context threading across stages
        prompt_builder = PromptBuilder(
            work_request.title,
            work_request.description,
        )

        stage_order = get_enabled_stages(settings_path)

        # Handle plan file
        if not resume_stage:
            if plan_file:
                # Pre-made plan: reference directly (no copy to MASTER_PLAN.md)
                status["plan_file"] = plan_file
                _log(f"Pre-made plan: {plan_file}", "ok")
            else:
                # Resolve plan path from template
                try:
                    with open(settings_path) as f:
                        _settings = json.load(f)
                    template = _settings.get("worca", {}).get(
                        "plan_path_template", "docs/plans/{timestamp}-{title_slug}.md"
                    )
                except (FileNotFoundError, json.JSONDecodeError):
                    template = "docs/plans/{timestamp}-{title_slug}.md"
                status["plan_file"] = _resolve_plan_path(
                    template,
                    timestamp=status["run_id"] or datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S"),
                    title=work_request.title,
                )

            # Set env vars for hooks
            os.environ["WORCA_PLAN_FILE"] = status["plan_file"]
            if status.get("run_id"):
                os.environ["WORCA_RUN_ID"] = status["run_id"]

            # Render agent templates with plan_file and other vars
            if run_dir:
                _render_agent_templates(run_dir, {
                    "plan_file": status["plan_file"],
                    "run_id": status.get("run_id", ""),
                    "branch": branch_name,
                    "title": work_request.title,
                })

            save_status(status, actual_status_path)

        # Determine starting index
        if resume_stage:
            stage_idx = stage_order.index(resume_stage)
        elif plan_file:
            # Mark PLAN stage as completed with pre-loaded status
            update_stage(status, Stage.PLAN.value,
                         status="completed", skipped=True, plan_file=plan_file)
            set_milestone(status, "plan_approved", True)
            save_status(status, actual_status_path)

            # Start at COORDINATE (skip PLAN)
            if Stage.COORDINATE in stage_order:
                stage_idx = stage_order.index(Stage.COORDINATE)
            elif Stage.PLAN in stage_order:
                stage_idx = stage_order.index(Stage.PLAN) + 1
            else:
                stage_idx = 0
        else:
            stage_idx = 0

        # Track triggers for loop-back iterations
        _next_trigger = {}  # {stage_value: trigger_reason}

        while stage_idx < len(stage_order):
            current_stage = stage_order[stage_idx]

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

            stage_label = current_stage.value.upper()
            iter_label = f" (iter {iter_num})" if iter_num > 1 else ""
            _log(f"{stage_label}{iter_label} starting...")
            t0 = time.time()

            # Check shutdown flag between stages
            if _shutdown_requested:
                complete_iteration(status, current_stage.value, status="interrupted")
                update_stage(status, current_stage.value, status="interrupted")
                save_status(status, actual_status_path)
                raise PipelineInterrupted("Pipeline interrupted before stage start")

            # Try to assign a specific bead before implement stage
            if current_stage == Stage.IMPLEMENT:
                bead = _query_ready_bead()
                if bead:
                    bead_id = bead["id"]
                    _claim_bead(bead_id)
                    prompt_builder.update_context("assigned_bead_id", bead_id)
                    prompt_builder.update_context("assigned_bead_title", bead["title"])
                    # Fetch full description via bd show
                    try:
                        details = bd_show(bead_id)
                        prompt_builder.update_context("assigned_bead_description", details.get("description", ""))
                    except Exception:
                        prompt_builder.update_context("assigned_bead_description", "")

            # Build stage-specific prompt via PromptBuilder
            pb_iteration = loop_counters.get(f"{current_stage.value}_iteration", 0)
            rendered_prompt = prompt_builder.build(current_stage.value, pb_iteration)

            # Store rendered prompt in status for UI visibility
            status["stages"][current_stage.value]["prompt"] = rendered_prompt
            save_status(status, actual_status_path)

            # Run the stage
            try:
                # Ensure beads is initialized before coordinate stage
                if current_stage == Stage.COORDINATE:
                    _ensure_beads_initialized()

                result, raw_envelope = run_stage(
                    current_stage, context, settings_path,
                    msize=msize, iteration=iter_num,
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
                raise

            elapsed = time.time() - t0
            _log(f"{stage_label}{iter_label} completed ({_format_duration(elapsed)})", "ok")

            # Log detailed metrics
            if isinstance(raw_envelope, dict):
                _log_stage_metrics(stage_label, result, raw_envelope)

            # Save full envelope for resume/debugging (per-iteration)
            _save_stage_output(current_stage, raw_envelope, logs_dir, iteration=iter_num)

            # Extract token usage from the raw envelope
            usage = extract_token_usage(raw_envelope) if isinstance(raw_envelope, dict) else {}

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

            # Milestone gate after PLAN
            if current_stage == Stage.PLAN:
                approved = result.get("approved", True)
                iter_extras["outcome"] = "success" if approved else "rejected"
                complete_iteration(status, current_stage.value, **iter_extras)
                update_stage(status, current_stage.value, **stage_extras)
                set_milestone(status, "plan_approved", approved)
                save_status(status, actual_status_path)
                if not approved:
                    _log("PLAN not approved — stopping", "err")
                    raise PipelineError("Plan not approved")
                _log("PLAN approved", "ok")
                # Thread plan outputs into PromptBuilder for downstream stages
                prompt_builder.update_context("plan_approach", result.get("approach", ""))
                prompt_builder.update_context("plan_tasks_outline", result.get("tasks_outline", []))

            # Handle coordinate results
            elif current_stage == Stage.COORDINATE:
                iter_extras["outcome"] = "success"
                complete_iteration(status, current_stage.value, **iter_extras)
                update_stage(status, current_stage.value, **stage_extras)
                save_status(status, actual_status_path)
                # Thread coordinate outputs into PromptBuilder
                beads_ids = result.get("beads_ids", [])
                prompt_builder.update_context("beads_ids", beads_ids)
                prompt_builder.update_context("dependency_graph", result.get("dependency_graph", {}))
                # Link beads to this run via label
                if beads_ids:
                    run_label = f"run:{status['run_id']}"
                    if bd_label_add(beads_ids, run_label):
                        _log(f"Labeled {len(beads_ids)} beads with {run_label}", "ok")
                    else:
                        _log(f"Failed to label beads with {run_label}", "warn")

            # Handle implement results
            elif current_stage == Stage.IMPLEMENT:
                iter_extras["outcome"] = "success"
                complete_iteration(status, current_stage.value, **iter_extras)
                update_stage(status, current_stage.value, **stage_extras)
                save_status(status, actual_status_path)
                # Thread implement outputs into PromptBuilder
                prompt_builder.update_context("files_changed", result.get("files_changed", []))
                prompt_builder.update_context("tests_added", result.get("tests_added", []))

            # Handle test results
            elif current_stage == Stage.TEST:
                passed = result.get("passed", False)
                # Thread test outputs into PromptBuilder
                prompt_builder.update_context("test_passed", passed)
                prompt_builder.update_context("test_coverage", result.get("coverage_pct"))
                prompt_builder.update_context("proof_artifacts", result.get("proof_artifacts", []))
                if not passed:
                    # Thread test failures for the implement retry; clear stale review context
                    prompt_builder.update_context("test_failures", result.get("failures", []))
                    prompt_builder.update_context("review_issues", None)
                    iter_extras["outcome"] = "test_failure"
                    complete_iteration(status, current_stage.value, **iter_extras)
                    update_stage(status, current_stage.value, **stage_extras)
                    save_status(status, actual_status_path)
                    if Stage.IMPLEMENT not in stage_order:
                        _log("Tests failed but IMPLEMENT stage is disabled — treating as pass", "warn")
                    else:
                        loop_key = "implement_test"
                        loop_counters[loop_key] = loop_counters.get(loop_key, 0) + 1
                        loop_counters["implement_iteration"] = loop_counters.get("implement_iteration", 0) + 1
                        _log(f"Tests failed — looping back to IMPLEMENT (iteration {loop_counters[loop_key]})", "warn")
                        if not check_loop_limit(loop_key, loop_counters[loop_key], settings_path, mloops=mloops):
                            _log(f"Loop {loop_key} exhausted after {loop_counters[loop_key]} iterations", "err")
                            raise LoopExhaustedError(
                                f"Loop {loop_key} exhausted after {loop_counters[loop_key]} iterations"
                            )
                        _next_trigger[Stage.IMPLEMENT.value] = "test_failure"
                        stage_idx = stage_order.index(Stage.IMPLEMENT)
                        continue
                else:
                    iter_extras["outcome"] = "success"
                    complete_iteration(status, current_stage.value, **iter_extras)
                    update_stage(status, current_stage.value, **stage_extras)
                    save_status(status, actual_status_path)
                _log(f"Tests passed", "ok")

            # Handle review results
            elif current_stage == Stage.REVIEW:
                outcome = result.get("outcome", "approve")
                _log(f"Review outcome: {outcome}")
                next_stage, status = handle_pr_review(outcome, status)
                iter_extras["outcome"] = outcome
                complete_iteration(status, current_stage.value, **iter_extras)
                update_stage(status, current_stage.value, **stage_extras)
                save_status(status, actual_status_path)
                if next_stage is None:
                    if outcome == "reject":
                        _log("PR rejected — stopping", "err")
                        raise PipelineError("PR rejected")
                    _log("Review approved", "ok")

                    # Close the claimed bead
                    claimed_bead = prompt_builder._context.get("assigned_bead_id")
                    if claimed_bead:
                        if bd_close(claimed_bead, reason="review approved"):
                            _log(f"Closed bead {claimed_bead}", "ok")
                        else:
                            _log(f"Failed to close bead {claimed_bead}", "warn")

                    # Check for more ready beads
                    next_bead = _query_ready_bead()
                    if next_bead and Stage.IMPLEMENT in stage_order:
                        loop_key = "bead_iteration"
                        loop_counters[loop_key] = loop_counters.get(loop_key, 0) + 1
                        loop_counters["implement_iteration"] = loop_counters.get("implement_iteration", 0) + 1
                        _log(f"Next bead available — looping back to IMPLEMENT (bead {loop_counters[loop_key]})", "ok")
                        if not check_loop_limit(loop_key, loop_counters[loop_key], settings_path, mloops=mloops):
                            _log(f"Bead iteration limit reached after {loop_counters[loop_key]} beads", "warn")
                        else:
                            # Clear stale context from previous bead's test/review cycle
                            prompt_builder.update_context("test_passed", None)
                            prompt_builder.update_context("test_coverage", None)
                            prompt_builder.update_context("proof_artifacts", None)
                            prompt_builder.update_context("test_failures", None)
                            prompt_builder.update_context("review_issues", None)
                            prompt_builder.update_context("files_changed", None)
                            _next_trigger[Stage.IMPLEMENT.value] = "next_bead"
                            stage_idx = stage_order.index(Stage.IMPLEMENT)
                            continue

                elif next_stage == Stage.IMPLEMENT:
                    # Thread review feedback for the implement retry; clear stale test context
                    prompt_builder.update_context("review_issues", result.get("issues", []))
                    prompt_builder.update_context("test_failures", None)
                    if Stage.IMPLEMENT not in stage_order:
                        _log("Changes requested but IMPLEMENT stage is disabled — skipping loop", "warn")
                    else:
                        loop_key = "pr_changes"
                        loop_counters[loop_key] = loop_counters.get(loop_key, 0) + 1
                        loop_counters["implement_iteration"] = loop_counters.get("implement_iteration", 0) + 1
                        _log(f"Changes requested — looping back to IMPLEMENT (iteration {loop_counters[loop_key]})", "warn")
                        if not check_loop_limit(loop_key, loop_counters[loop_key], settings_path, mloops=mloops):
                            _log(f"Loop {loop_key} exhausted after {loop_counters[loop_key]} iterations", "err")
                            raise LoopExhaustedError(
                                f"Loop {loop_key} exhausted after {loop_counters[loop_key]} iterations"
                            )
                        _next_trigger[Stage.IMPLEMENT.value] = "review_changes"
                        stage_idx = stage_order.index(Stage.IMPLEMENT)
                        continue
                elif next_stage == Stage.PLAN:
                    if Stage.PLAN not in stage_order:
                        _log("Restart planning requested but PLAN stage is disabled — skipping loop", "warn")
                    else:
                        loop_key = "restart_planning"
                        loop_counters[loop_key] = loop_counters.get(loop_key, 0) + 1
                        _log(f"Restart planning requested (iteration {loop_counters[loop_key]})", "warn")
                        if not check_loop_limit(loop_key, loop_counters[loop_key], settings_path, mloops=mloops):
                            raise LoopExhaustedError(
                                f"Loop {loop_key} exhausted after {loop_counters[loop_key]} iterations"
                            )
                        _next_trigger[Stage.PLAN.value] = "restart_planning"
                        stage_idx = stage_order.index(Stage.PLAN)
                        continue

            # Default: complete iteration for stages without special handling
            else:
                iter_extras["outcome"] = "success"
                complete_iteration(status, current_stage.value, **iter_extras)
                update_stage(status, current_stage.value, **stage_extras)
                save_status(status, actual_status_path)

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
        status["completed_at"] = datetime.now(timezone.utc).isoformat()
        save_status(status, actual_status_path)

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

        return status
    finally:
        _restore_signal_handlers()
        _remove_pid(status_path)
        _close_orchestrator_log()
        os.environ.pop("WORCA_PLAN_FILE", None)
        os.environ.pop("WORCA_RUN_ID", None)
