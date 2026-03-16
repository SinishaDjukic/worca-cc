"""Input normalization - converts various input sources into a WorkRequest dataclass."""
import json
import os
import re
import subprocess
from dataclasses import dataclass, field
from typing import Optional

from worca.utils.env import get_env

# Matches markdown links to plan files: [text](docs/plans/something.md)
_PLAN_LINK_RE = re.compile(r"\[.*?\]\((docs/plans/[^\)]+\.md)\)")


@dataclass
class WorkRequest:
    """Normalized work request from any input source."""
    source_type: str  # "github_issue", "beads", "prompt", "spec_file"
    title: str
    description: str = ""
    source_ref: Optional[str] = None
    priority: int = 2
    plan_path: Optional[str] = None


def normalize_prompt(text: str) -> WorkRequest:
    """Create a WorkRequest from a plain text prompt."""
    return WorkRequest(source_type="prompt", title=text)


def normalize_spec_file(path: str) -> WorkRequest:
    """Create a WorkRequest from a spec file, extracting title from first markdown heading."""
    with open(path, "r") as f:
        content = f.read()
    title = ""
    for line in content.splitlines():
        if line.startswith("#"):
            title = line.lstrip("#").strip()
            break
    if not title:
        title = os.path.basename(path)
    return WorkRequest(
        source_type="spec_file",
        title=title,
        description=content,
        source_ref=path,
    )


def _extract_plan_path(body: str) -> Optional[str]:
    """Extract a plan file path from a GitHub issue body.

    Looks for markdown links to docs/plans/*.md. Returns the path if the
    file exists on disk, None otherwise (lets the Planner run normally).
    """
    match = _PLAN_LINK_RE.search(body or "")
    if match:
        path = match.group(1)
        if os.path.isfile(path):
            return path
    return None


def normalize_github_issue(ref: str) -> WorkRequest:
    """Create a WorkRequest from a GitHub issue reference like 'gh:issue:42'."""
    parts = ref.split(":")
    issue_num = parts[-1]
    result = subprocess.run(
        ["gh", "issue", "view", issue_num, "--json", "title,body"],
        capture_output=True,
        text=True,
        env=get_env(),
    )
    if result.returncode != 0:
        raise RuntimeError(f"Failed to fetch issue {issue_num}: {result.stderr}")
    data = json.loads(result.stdout)
    body = data.get("body", "")
    return WorkRequest(
        source_type="github_issue",
        title=data["title"],
        description=body,
        source_ref=f"gh:{issue_num}",
        plan_path=_extract_plan_path(body),
    )


def normalize_beads_task(ref: str) -> WorkRequest:
    """Create a WorkRequest from a beads task reference like 'bd:bd-a1b2'."""
    parts = ref.split(":", 1)
    task_id = parts[-1]
    result = subprocess.run(
        ["bd", "show", task_id],
        capture_output=True,
        text=True,
        env=get_env(),
    )
    if result.returncode != 0:
        raise RuntimeError(f"Failed to fetch beads task {task_id}: {result.stderr}")
    # Parse title from output (first line with the title)
    title = ""
    for line in result.stdout.splitlines():
        line = line.strip()
        if "\u00b7" in line and task_id in line:
            # Format: "\u25cb bd-a1b2 \u00b7 Task Title   [\u25cf P1 \u00b7 OPEN]"
            parts = line.split("\u00b7")
            if len(parts) >= 2:
                title = parts[1].strip().split("[")[0].strip()
                break
    if not title:
        title = task_id
    return WorkRequest(
        source_type="beads",
        title=title,
        source_ref=f"bd:{task_id}",
    )


def normalize(source_type: str, source_value: str) -> WorkRequest:
    """Dispatch to the appropriate normalize_* function.

    source_type can be "prompt", "spec", or "source" (auto-detect from value).
    For "source", the value is sniffed: gh:issue:N → GitHub, bd:ID → Beads.
    """
    if source_type == "prompt":
        return normalize_prompt(source_value)
    elif source_type == "spec":
        return normalize_spec_file(source_value)
    elif source_type == "source" or source_value.startswith(("gh:", "bd:")):
        if source_value.startswith("gh:issue:"):
            return normalize_github_issue(source_value)
        elif source_value.startswith("bd:"):
            return normalize_beads_task(source_value)
        else:
            raise ValueError(f"Unknown source reference format: {source_value}")
    else:
        raise ValueError(f"Unknown source type: {source_type}={source_value}")
