"""GitHub issue lifecycle helpers.

Thin wrappers around `gh` CLI for updating GitHub issues during pipeline runs.
All calls are error-suppressed — GitHub being unreachable must never crash the pipeline.

Set WORCA_NO_GITHUB=1 to suppress all GitHub write-back (useful for dev/testing).
"""

import os
import subprocess
import sys
from datetime import datetime


def _github_disabled() -> bool:
    """Check if GitHub write-back is disabled via environment variable."""
    return os.environ.get("WORCA_NO_GITHUB", "") == "1"


def gh_issue_number(status: dict) -> str | None:
    """Extract the GitHub issue number from pipeline status.

    Returns the issue number string (e.g. "42") if the run was sourced from
    a GitHub issue, or None for all other source types.
    """
    wr = status.get("work_request", {})
    if wr.get("source_type") != "github_issue":
        return None
    ref = wr.get("source_ref", "")  # "gh:42"
    if not ref.startswith("gh:"):
        return None
    return ref.split(":")[-1]


def _run_gh(*args: str) -> bool:
    """Run a gh CLI command with error suppression.

    Returns True on success, False on any failure. Failures are logged
    as warnings to stderr but never raised.
    """
    try:
        subprocess.run(
            ["gh", *args],
            check=True, capture_output=True, text=True, timeout=15,
        )
        return True
    except Exception as e:
        print(f"Warning: GitHub write-back failed: {e}", file=sys.stderr)
        return False


def gh_issue_start(status: dict) -> None:
    """Add in-progress label and post start comment on the GitHub issue.

    No-op if the run is not sourced from a GitHub issue.
    No-op if WORCA_NO_GITHUB=1.
    Never raises — all errors are suppressed.
    """
    if _github_disabled():
        return
    issue = gh_issue_number(status)
    if issue is None:
        return

    run_id = status.get("run_id", "unknown")
    branch = status.get("branch", "unknown")

    # Ensure the in-progress label exists (idempotent via --force)
    _run_gh(
        "label", "create", "in-progress",
        "--color", "fbca04",
        "--description", "Pipeline is working on this issue",
        "--force",
    )

    # Add label to issue
    _run_gh("issue", "edit", issue, "--add-label", "in-progress")

    # Post start comment
    body = f"Pipeline started \u2014 run `{run_id}` on branch `{branch}`"
    _run_gh("issue", "comment", issue, "--body", body)


def _format_duration(started_at: str | None, completed_at: str | None) -> str:
    """Compute human-readable duration from ISO 8601 timestamps."""
    if not started_at or not completed_at:
        return "unknown"
    try:
        start = datetime.fromisoformat(started_at)
        end = datetime.fromisoformat(completed_at)
        total_seconds = int((end - start).total_seconds())
        if total_seconds < 0:
            return "unknown"
        hours, remainder = divmod(total_seconds, 3600)
        minutes, seconds = divmod(remainder, 60)
        if hours > 0:
            return f"{hours}h {minutes}m {seconds}s"
        if minutes > 0:
            return f"{minutes}m {seconds}s"
        return f"{seconds}s"
    except (ValueError, TypeError):
        return "unknown"


def _format_iterations(token_usage: dict) -> str:
    """Format iteration count with per-stage breakdown."""
    total = token_usage.get("iteration_count", 0)
    by_stage = token_usage.get("by_stage", {})
    if not by_stage:
        return str(total)

    # Abbreviate stage names to match plan format
    abbrev = {
        "coordinate": "coord",
        "implement": "impl",
        "test": "test",
        "review": "review",
        "pr": "pr",
        "plan": "plan",
    }
    parts = []
    for stage, data in by_stage.items():
        count = data.get("iteration_count", 0)
        if count > 0:
            name = abbrev.get(stage, stage)
            parts.append(f"{name}: {count}")

    if parts:
        return f"{total} ({', '.join(parts)})"
    return str(total)


def gh_issue_complete(status: dict) -> None:
    """Post summary comment, remove in-progress label, and close the issue.

    No-op if the run is not sourced from a GitHub issue.
    No-op if WORCA_NO_GITHUB=1.
    No-op if the run produced no meaningful work (0 turns and $0 cost).
    Never raises — all errors are suppressed.
    """
    if _github_disabled():
        return
    issue = gh_issue_number(status)
    if issue is None:
        return

    token_usage = status.get("token_usage", {})

    # Skip posting if the run did nothing meaningful
    if token_usage.get("num_turns", 0) == 0 and token_usage.get("total_cost_usd", 0) == 0:
        return
    duration = _format_duration(
        status.get("started_at"), status.get("completed_at"),
    )
    iterations = _format_iterations(token_usage)
    cost = token_usage.get("total_cost_usd", 0)
    turns = token_usage.get("num_turns", 0)
    branch = status.get("branch", "unknown")
    run_id = status.get("run_id", "unknown")

    body = (
        "## Pipeline Complete\n\n"
        "| Metric | Value |\n"
        "|--------|-------|\n"
        f"| Duration | {duration} |\n"
        f"| Iterations | {iterations} |\n"
        f"| Cost | ${cost:.2f} |\n"
        f"| Turns | {turns} |\n"
        f"| Branch | `{branch}` |\n"
        f"| Run ID | `{run_id}` |"
    )

    _run_gh("issue", "comment", issue, "--body", body)
    _run_gh("issue", "edit", issue, "--remove-label", "in-progress")
    _run_gh("issue", "close", issue)


def gh_issue_fail(status: dict, error: str) -> None:
    """Post failure comment with partial metrics and remove in-progress label.

    Does NOT close the issue — leaves it open for retry.
    No-op if the run is not sourced from a GitHub issue.
    No-op if WORCA_NO_GITHUB=1.
    Never raises — all errors are suppressed.
    """
    if _github_disabled():
        return
    issue = gh_issue_number(status)
    if issue is None:
        return

    token_usage = status.get("token_usage", {})
    cost = token_usage.get("total_cost_usd", 0)
    turns = token_usage.get("num_turns", 0)
    iterations = _format_iterations(token_usage)
    branch = status.get("branch", "unknown")
    run_id = status.get("run_id", "unknown")

    body = (
        "## Pipeline Failed\n\n"
        f"**Error:** {error}\n\n"
        "| Metric | Value |\n"
        "|--------|-------|\n"
        f"| Iterations | {iterations} |\n"
        f"| Cost | ${cost:.2f} |\n"
        f"| Turns | {turns} |\n"
        f"| Branch | `{branch}` |\n"
        f"| Run ID | `{run_id}` |"
    )

    _run_gh("issue", "comment", issue, "--body", body)
    _run_gh("issue", "edit", issue, "--remove-label", "in-progress")
