"""Single work request pipeline runner.

Orchestrates the full pipeline from plan through PR.
"""

import json
import os
import re
from typing import Optional

from worca.orchestrator.stages import Stage, can_transition, get_stage_config, STAGE_AGENT_MAP
from worca.orchestrator.work_request import WorkRequest
from worca.state.status import load_status, save_status, update_stage, set_milestone, init_status
from worca.utils.claude_cli import run_agent
from worca.utils.git import create_branch


class LoopExhaustedError(Exception):
    """Raised when a loop reaches its maximum iterations."""
    pass


class PipelineError(Exception):
    """Raised when pipeline encounters an unrecoverable error."""
    pass


def _sanitize_branch_name(title: str) -> str:
    """Convert a title to a valid git branch name."""
    name = title.lower().strip()
    name = re.sub(r'[^a-z0-9\-]', '-', name)
    name = re.sub(r'-+', '-', name)
    name = name.strip('-')
    return f"worca/{name[:40]}"


def _agent_path(agent_name: str) -> str:
    """Resolve agent name to the .md definition file path."""
    return f".claude/agents/core/{agent_name}.md"


def _schema_path(schema_name: str) -> str:
    """Resolve schema filename to full path."""
    return f".claude/worca/schemas/{schema_name}"


def _save_stage_output(stage: Stage, result: dict, logs_dir: str = ".worca/logs") -> None:
    """Save stage output to a log file for resume support."""
    os.makedirs(logs_dir, exist_ok=True)
    path = os.path.join(logs_dir, f"{stage.value}.json")
    with open(path, "w") as f:
        json.dump(result, f, indent=2)


def run_stage(stage: Stage, context: dict, settings_path: str = ".claude/settings.json") -> tuple[dict, dict]:
    """Run a single pipeline stage.

    Gets stage config via get_stage_config(), calls run_agent() with the
    appropriate agent path, prompt, max_turns, and schema.

    Returns (structured_output, raw_envelope) tuple. The structured_output
    is the schema-conforming result used by pipeline logic. The raw_envelope
    is the full claude CLI JSON response for logging.
    """
    config = get_stage_config(stage, settings_path=settings_path)
    prompt = context.get("prompt", "")
    raw = run_agent(
        prompt=prompt,
        agent=_agent_path(config["agent"]),
        max_turns=config["max_turns"],
        output_format="json",
        json_schema=_schema_path(config["schema"]),
    )
    # claude CLI returns a JSON envelope; extract structured_output if present
    if isinstance(raw, dict) and "structured_output" in raw:
        return raw["structured_output"], raw
    return raw, raw


def check_loop_limit(
    loop_name: str,
    current_iteration: int,
    settings_path: str = ".claude/settings.json",
) -> bool:
    """Check if the current iteration is within the configured loop limit.

    Reads loop limits from settings.json under worca.loops namespace.
    Returns True if current_iteration < limit, False if exhausted.
    If no limit configured, defaults to 10.
    """
    default_limit = 10
    try:
        with open(settings_path) as f:
            settings = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        settings = {}

    loops = settings.get("worca", {}).get("loops", {})
    limit = loops.get(loop_name, default_limit)
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


def run_pipeline(
    work_request: WorkRequest,
    settings_path: str = ".claude/settings.json",
    status_path: str = ".worca/status.json",
) -> dict:
    """Run the full pipeline for a single work request.

    Creates branch, initializes status, then runs stages in sequence:
    PLAN -> (milestone gate) -> COORDINATE -> IMPLEMENT -> TEST -> REVIEW -> PR

    Handles loops:
    - test failure -> back to implement
    - review changes -> back to implement

    Checks loop limits, raises LoopExhaustedError when exceeded.
    Saves status after each stage transition.
    Returns final status.
    """
    logs_dir = os.path.join(os.path.dirname(status_path), "logs")

    # Check for resume
    existing = load_status(status_path)
    if existing:
        from worca.orchestrator.resume import find_resume_point
        resume_stage = find_resume_point(existing)
        if resume_stage is not None:
            status = existing
            branch_name = status.get("branch", "")
        else:
            return existing  # all done
    else:
        # Fresh start
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
        resume_stage = None

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

        # Mark stage as in_progress
        update_stage(status, current_stage.value, status="in_progress")
        save_status(status, status_path)

        # Run the stage
        result, raw_envelope = run_stage(current_stage, context, settings_path)

        # Save full envelope for resume/debugging
        _save_stage_output(current_stage, raw_envelope, logs_dir)

        # Mark stage completed
        update_stage(status, current_stage.value, status="completed")
        save_status(status, status_path)

        # Milestone gate after PLAN
        if current_stage == Stage.PLAN:
            approved = result.get("approved", True)
            set_milestone(status, "plan_approved", approved)
            save_status(status, status_path)
            if not approved:
                raise PipelineError("Plan not approved")

        # Handle test results
        if current_stage == Stage.TEST:
            passed = result.get("passed", False)
            if not passed:
                loop_key = "implement_test"
                loop_counters[loop_key] = loop_counters.get(loop_key, 0) + 1
                if not check_loop_limit(loop_key, loop_counters[loop_key], settings_path):
                    raise LoopExhaustedError(
                        f"Loop {loop_key} exhausted after {loop_counters[loop_key]} iterations"
                    )
                stage_idx = stage_order.index(Stage.IMPLEMENT)
                continue

        # Handle review results
        if current_stage == Stage.REVIEW:
            outcome = result.get("outcome", "approve")
            next_stage, status = handle_pr_review(outcome, status)
            if next_stage is None:
                if outcome == "reject":
                    raise PipelineError("PR rejected")
                # approved — continue to PR
            elif next_stage == Stage.IMPLEMENT:
                loop_key = "pr_changes"
                loop_counters[loop_key] = loop_counters.get(loop_key, 0) + 1
                if not check_loop_limit(loop_key, loop_counters[loop_key], settings_path):
                    raise LoopExhaustedError(
                        f"Loop {loop_key} exhausted after {loop_counters[loop_key]} iterations"
                    )
                stage_idx = stage_order.index(Stage.IMPLEMENT)
                continue
            elif next_stage == Stage.PLAN:
                loop_key = "restart_planning"
                loop_counters[loop_key] = loop_counters.get(loop_key, 0) + 1
                if not check_loop_limit(loop_key, loop_counters[loop_key], settings_path):
                    raise LoopExhaustedError(
                        f"Loop {loop_key} exhausted after {loop_counters[loop_key]} iterations"
                    )
                stage_idx = stage_order.index(Stage.PLAN)
                continue

        stage_idx += 1

    return status
