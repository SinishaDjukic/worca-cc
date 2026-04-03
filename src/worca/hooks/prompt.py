"""UserPromptSubmit hook: Milestone approval gates.

Checks pipeline status to determine if approval is needed before proceeding.
Reads status from WORCA_STATUS_FILE env var (default: .worca/status.json).
Exit code 0 = pass through. Prints approval prompt to stdout when gate is active.
"""
import json
import sys
import os


def load_status() -> dict | None:
    """Load pipeline status from the status file.

    Checks active_run pointer first for per-run status, then falls back
    to WORCA_STATUS_FILE env var or .worca/status.json.
    Returns the parsed status dict, or None if the file doesn't exist.
    """
    # Try active_run pointer first
    active_run_path = ".worca/active_run"
    if os.path.exists(active_run_path):
        try:
            run_id = open(active_run_path).read().strip()
            candidate = os.path.join(".worca", "runs", run_id, "status.json")
            if os.path.exists(candidate):
                with open(candidate) as f:
                    return json.load(f)
        except (OSError, json.JSONDecodeError):
            pass

    # Fall back to env var or default
    status_file = os.environ.get("WORCA_STATUS_FILE", ".worca/status.json")
    if not os.path.exists(status_file):
        return None
    try:
        with open(status_file, "r") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return None


def check_milestone(status: dict | None) -> tuple:
    """Check if a milestone gate should inject an approval prompt.

    Returns (exit_code, message). exit_code is always 0.
    message is non-empty when a gate is active.
    """
    if status is None:
        return (0, "")

    stage = status.get("stage", "")
    milestones = status.get("milestones", {})

    if stage == "plan" and milestones.get("plan_approved") is None:
        plan_file = status.get("plan_file", "MASTER_PLAN.md")
        return (0, "MILESTONE GATE: Review {} and approve the plan before implementation begins.".format(plan_file))

    if stage == "review" and milestones.get("pr_approved") is None:
        return (0, "MILESTONE GATE: Review the PR and approve before merge.")

    return (0, "")


def main():
    status = load_status()
    code, message = check_milestone(status)
    if message:
        print(message)
    sys.exit(code)


if __name__ == "__main__":
    main()
