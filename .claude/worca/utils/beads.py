"""Wrapper for the bd (beads) CLI. All functions run bd as a subprocess."""

import re
import subprocess
from typing import Optional


def _run_bd(*args: str, beads_dir: Optional[str] = None) -> subprocess.CompletedProcess:
    """Run a bd CLI command and return the CompletedProcess."""
    env = None
    if beads_dir:
        import os
        env = {**os.environ, "BEADS_DIR": beads_dir}
    return subprocess.run(["bd", *args], capture_output=True, text=True, env=env)


def bd_create(title: str, task_type: str = "task", priority: int = 2) -> str:
    """Create a new bead/issue via bd create.

    Returns the created issue ID parsed from stdout.
    Raises RuntimeError on failure.
    """
    result = _run_bd(
        "create",
        f"--title={title}",
        f"--type={task_type}",
        f"--priority={priority}",
    )
    if result.returncode != 0:
        raise RuntimeError(f"bd create failed: {result.stderr}")
    # Parse issue ID from output like "Created ccexperiments-abc: My task"
    match = re.search(r"Created\s+(\S+):", result.stdout)
    if not match:
        raise RuntimeError(f"Could not parse issue ID from: {result.stdout}")
    return match.group(1)


def bd_ready() -> list[dict]:
    """List ready issues via bd ready.

    Parses tabular output into list of dicts with id, title, priority.
    """
    result = _run_bd("ready")
    if not result.stdout.strip():
        return []
    lines = result.stdout.strip().split("\n")
    if len(lines) <= 1:
        # Only header or empty
        return []
    items = []
    for line in lines[1:]:  # skip header
        parts = line.split()
        if len(parts) >= 3:
            issue_id = parts[0]
            priority = parts[-1]
            title = " ".join(parts[1:-1])
            items.append({"id": issue_id, "title": title, "priority": priority})
    return items


def bd_close(issue_id: str, reason: str = "") -> bool:
    """Close an issue via bd close.

    Returns True on success, False on failure.
    """
    args = ["close", issue_id]
    if reason:
        args.append(f"--reason={reason}")
    result = _run_bd(*args)
    return result.returncode == 0


def bd_update(issue_id: str, **kwargs) -> bool:
    """Update an issue via bd update with kwargs as flags.

    Returns True on success, False on failure.
    """
    args = ["update", issue_id]
    for key, value in kwargs.items():
        args.append(f"--{key}={value}")
    result = _run_bd(*args)
    return result.returncode == 0


def bd_dep_add(issue_id: str, depends_on: str) -> bool:
    """Add a dependency via bd dep add.

    Returns True on success, False on failure.
    """
    result = _run_bd("dep", "add", issue_id, depends_on)
    return result.returncode == 0
