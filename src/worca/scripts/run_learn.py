# /// script
# requires-python = ">=3.8"
# ///
"""Run the LEARN stage for a completed pipeline run.

Standalone script invoked by the UI API endpoint. Loads status.json
for the given run, initializes a PromptBuilder, and calls
_run_learn_stage() from runner.py.
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from worca.orchestrator.prompt_builder import PromptBuilder
from worca.orchestrator.runner import _run_learn_stage
from worca.state.status import load_status
from worca.events.emitter import EventContext


def create_parser():
    """Create the argument parser for run_learn."""
    parser = argparse.ArgumentParser(description="Run LEARN stage for a completed pipeline run")
    parser.add_argument("--run-id", required=True,
                        help="Run ID to analyze (directory name under .worca/runs/)")
    parser.add_argument("--settings", default=".claude/settings.json",
                        help="Path to settings.json")
    parser.add_argument("--status-dir", default=".worca",
                        help="Directory for pipeline status files")
    parser.add_argument("--msize", type=int, default=1, choices=range(1, 11),
                        metavar="[1-10]",
                        help="Task size multiplier for max_turns (default: 1)")
    return parser


def _run_learn_stage_standalone(status, prompt_builder, settings_path,
                                run_dir, run_id, termination_type,
                                termination_reason, msize):
    """Wrapper that calls runner._run_learn_stage with a logs_dir.

    Creates the logs directory if it doesn't exist, creates an
    EventContext for webhook emission, then delegates to the same
    _run_learn_stage function used by the pipeline.
    """
    logs_dir = os.path.join(run_dir, "logs")
    os.makedirs(logs_dir, exist_ok=True)

    wr = status.get("work_request", {})
    events_path = os.path.join(run_dir, "events.jsonl")
    ctx = EventContext(
        run_id=run_id,
        branch=wr.get("branch", ""),
        work_request=wr,
        events_path=events_path,
        settings_path=settings_path,
    )

    _run_learn_stage(
        status, prompt_builder,
        settings_path, run_dir,
        termination_type, termination_reason,
        msize, logs_dir,
        force=True,
        ctx=ctx,
    )

    # Flush event log and wait for webhook daemon threads to complete
    # before the process exits (daemon threads are killed on exit).
    ctx.close()
    import threading
    for t in threading.enumerate():
        if t.daemon and t is not threading.current_thread():
            t.join(timeout=5)


def run_learn(run_id, status_dir, settings_path, msize):
    """Load a completed run's status and run the LEARN stage on it.

    Args:
        run_id: The run ID (directory name under status_dir/runs/).
        status_dir: Path to the .worca directory.
        settings_path: Path to settings.json.
        msize: Task size multiplier for max_turns.

    Raises:
        FileNotFoundError: If status.json doesn't exist for the run.
    """
    # Check both runs/ and results/ directories
    run_dir = os.path.join(status_dir, "runs", run_id)
    status_path = os.path.join(run_dir, "status.json")

    if not os.path.exists(status_path):
        run_dir = os.path.join(status_dir, "results", run_id)
        status_path = os.path.join(run_dir, "status.json")

    if not os.path.exists(status_path):
        raise FileNotFoundError(f"No status.json found for run {run_id}")

    status = load_status(status_path)

    # Build PromptBuilder from the work request stored in status
    wr = status.get("work_request", {})
    prompt_builder = PromptBuilder(
        work_request_title=wr.get("title", ""),
        work_request_description=wr.get("description", ""),
    )

    # Determine termination type from status
    result = status.get("result", "unknown")
    termination_type = result if result in ("success", "failure", "loop_exhausted", "rejected") else "failure"
    termination_reason = status.get("error", "")

    _run_learn_stage_standalone(
        status=status,
        prompt_builder=prompt_builder,
        settings_path=settings_path,
        run_dir=run_dir,
        run_id=run_id,
        termination_type=termination_type,
        termination_reason=termination_reason,
        msize=msize,
    )


def main():
    parser = create_parser()
    args = parser.parse_args()
    run_learn(
        run_id=args.run_id,
        status_dir=args.status_dir,
        settings_path=args.settings,
        msize=args.msize,
    )


if __name__ == "__main__":
    main()
