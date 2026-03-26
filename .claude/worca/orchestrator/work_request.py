"""Input normalization - converts various input sources into a WorkRequest dataclass."""
import json
import os
import re
import subprocess
from dataclasses import dataclass
from typing import Optional

from worca.utils.env import get_env

# Matches markdown links to plan files: [text](docs/plans/something.md)
_PLAN_LINK_RE = re.compile(r"\[.*?\]\((docs/plans/[^\)]+\.md)\)")
# Matches GitHub issue URLs: https://github.com/owner/repo/issues/42
_GH_ISSUE_URL_RE = re.compile(r"https?://github\.com/[^/]+/[^/]+/issues/(\d+)$")


_SMART_TITLE_PROMPT = (
    "Extract a concise 5-8 word title summarizing this content. "
    "Return ONLY the title, no quotes, no punctuation at the end, no explanation."
)


def generate_smart_title(content: str, source_hint: str = "") -> str:
    """Use LLM to extract a short title from content.

    Calls claude with haiku model, 30s timeout. Returns empty string on any
    failure. Sanity checks: non-empty, <100 chars, no newlines.
    """
    if not content or not content.strip():
        return ""

    truncated = content[:10_000]
    prompt = _SMART_TITLE_PROMPT
    if source_hint:
        prompt += f"\n\nSource: {source_hint}"
    prompt += f"\n\nContent:\n{truncated}"

    try:
        result = subprocess.run(
            ["claude", "-p", prompt, "--output-format", "text", "--model", "haiku"],
            capture_output=True,
            text=True,
            timeout=30,
            env=get_env(),
        )
    except (subprocess.TimeoutExpired, OSError):
        return ""

    if result.returncode != 0:
        return ""

    title = result.stdout.strip()

    # Sanity checks
    if not title or len(title) > 100 or "\n" in title:
        return ""

    return title


@dataclass
class WorkRequest:
    """Normalized work request from any input source."""
    source_type: str  # "github_issue", "beads", "prompt", "spec_file"
    title: str
    description: str = ""
    source_ref: Optional[str] = None
    priority: int = 2
    plan_path: Optional[str] = None


def normalize_plan_file(path: str, content: str = None) -> WorkRequest:
    """Create a WorkRequest from a plan file.

    Reads file if content not provided. Title priority:
    generate_smart_title() → first # heading fallback → filename fallback.
    """
    if content is None:
        with open(path, "r") as f:
            content = f.read()

    # Title priority: smart title → heading → filename
    title = generate_smart_title(content, source_hint=f"plan file: {os.path.basename(path)}")

    if not title:
        for line in content.splitlines():
            if line.startswith("#"):
                title = line.lstrip("#").strip()
                break

    if not title:
        title = os.path.basename(path)

    return WorkRequest(
        source_type="plan_file",
        title=title,
        description=content,
        source_ref=path,
        plan_path=path,
    )


def normalize_prompt(text: str) -> WorkRequest:
    """Create a WorkRequest from a plain text prompt."""
    return WorkRequest(source_type="prompt", title=text)


def normalize_spec_file(path: str) -> WorkRequest:
    """Create a WorkRequest from a spec file.

    Title priority: generate_smart_title() → first # heading fallback → filename fallback.
    """
    with open(path, "r") as f:
        content = f.read()

    # Title priority: smart title → heading → filename
    title = generate_smart_title(content, source_hint=f"spec file: {os.path.basename(path)}")

    if not title:
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


def normalize(source_type: str, source_value: str, **kwargs) -> WorkRequest:
    """Dispatch to the appropriate normalize_* function.

    source_type can be "prompt", "spec", "plan", or "source" (auto-detect from value).
    For "source", the value is sniffed: gh:issue:N → GitHub, bd:ID → Beads.
    Extra kwargs are forwarded to the dispatch function (e.g. content for plan).
    """
    if source_type == "prompt":
        return normalize_prompt(source_value)
    elif source_type == "plan":
        return normalize_plan_file(source_value, **kwargs)
    elif source_type == "spec":
        return normalize_spec_file(source_value)
    elif source_type == "source" or source_value.startswith(("gh:", "bd:")):
        # Convert GitHub URLs to gh:issue:N format
        gh_url_match = _GH_ISSUE_URL_RE.match(source_value)
        if gh_url_match:
            source_value = f"gh:issue:{gh_url_match.group(1)}"
        if source_value.startswith("gh:issue:"):
            return normalize_github_issue(source_value)
        elif source_value.startswith("bd:"):
            return normalize_beads_task(source_value)
        else:
            raise ValueError(f"Unknown source reference format: {source_value}")
    else:
        raise ValueError(f"Unknown source type: {source_type}={source_value}")
