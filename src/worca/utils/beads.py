"""Wrapper for the bd (beads) CLI. All functions run bd as a subprocess."""

import re
import subprocess
from typing import Optional

from worca.utils.env import get_env


def _run_bd(*args: str, beads_dir: Optional[str] = None, cwd: Optional[str] = None) -> subprocess.CompletedProcess:
    """Run a bd CLI command and return the CompletedProcess."""
    overrides = {"BEADS_DIR": beads_dir} if beads_dir else {}
    return subprocess.run(["bd", *args], capture_output=True, text=True, env=get_env(**overrides), cwd=cwd)


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

    Parses numbered-list output like:
        📋 Ready work (1 issues with no blockers):
        1. [● P4] [task] worca-cc-a27: test parsing output

    Returns list of dicts with id, title, priority, type.
    """
    result = _run_bd("ready")
    if not result.stdout.strip():
        return []
    items = []
    # Match lines like: 1. [● P2] [task] worca-cc-744: Server: add queries
    pattern = re.compile(
        r'^\s*\d+\.\s+'           # row number: "1. "
        r'\[[^\]]*P(\d+)\]\s+'    # priority bracket: "[● P2] "
        r'\[(\w+)\]\s+'           # type bracket: "[task] "
        r'(\S+?):\s+'             # bead ID up to colon: "worca-cc-a27: "
        r'(.+)$'                  # title (rest of line)
    )
    for line in result.stdout.strip().split("\n"):
        m = pattern.match(line)
        if m:
            items.append({
                "id": m.group(3),
                "title": m.group(4).strip(),
                "priority": m.group(1),
                "type": m.group(2),
            })
    return items


def bd_show(issue_id: str) -> dict:
    """Fetch full details for a bead via bd show.

    Parses bd show output to extract title, description, priority, type, and status.
    Returns a dict with those fields. Raises RuntimeError on failure.
    """
    result = _run_bd("show", issue_id)
    if result.returncode != 0:
        raise RuntimeError(f"bd show failed for {issue_id}: {result.stderr}")
    output = result.stdout
    info: dict = {"id": issue_id, "title": "", "description": "", "priority": "", "type": "", "status": ""}

    # Parse title from header line like: "○ worca-cc-a27 · test parsing output   [● P4 · OPEN]"
    header_match = re.search(r'·\s+(.+?)\s+\[', output)
    if header_match:
        info["title"] = header_match.group(1).strip()

    # Parse priority from bracket like "[● P2 · OPEN]"
    prio_match = re.search(r'\[.*?P(\d+).*?\]', output)
    if prio_match:
        info["priority"] = prio_match.group(1)

    # Parse status from bracket like "[● P2 · OPEN]" or "[● P2 · IN_PROGRESS]"
    status_match = re.search(r'·\s+(\w+)\s*\]', output)
    if status_match:
        info["status"] = status_match.group(1).lower()

    # Parse DESCRIPTION section: everything between "DESCRIPTION" line and next section header or end
    desc_match = re.search(r'^DESCRIPTION\s*\n(.*?)(?=^[A-Z]{2,}\s*$|\Z)', output, re.DOTALL | re.MULTILINE)
    if desc_match:
        info["description"] = desc_match.group(1).strip()

    return info


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


def bd_label_add(issue_ids: list[str], label: str) -> bool:
    """Add a label to one or more issues via bd label add.

    Returns True on success, False on failure.
    """
    if not issue_ids:
        return True
    result = _run_bd("label", "add", *issue_ids, label)
    return result.returncode == 0


def bd_dep_add(issue_id: str, depends_on: str) -> bool:
    """Add a dependency via bd dep add.

    Returns True on success, False on failure.
    """
    result = _run_bd("dep", "add", issue_id, depends_on)
    return result.returncode == 0


def bd_init(cwd: Optional[str] = None) -> bool:
    """Initialize beads in a directory via bd init.

    Runs `bd init` in the specified working directory (or current dir if None).
    Returns True on success, False on failure.
    Catches subprocess errors gracefully (e.g. bd not on PATH, invalid cwd).
    """
    try:
        result = _run_bd("init", cwd=cwd)
        return result.returncode == 0
    except (subprocess.SubprocessError, OSError):
        return False
