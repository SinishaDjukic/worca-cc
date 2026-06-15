"""Runtime provenance — read the manifest written at `worca init` time.

`load_provenance` is on the hot path (called once per run start). It reads
a tiny JSON file from the runtime dir and returns its content, falling back
gracefully to a version-only block when the file is missing or malformed.
Never raises.

`_fmt_provenance` produces the one-line string for orchestrator.log:
  git:      "worca 0.57.0 (src worca-cc@ba1795b8 [foo])"
  dirty:    "worca 0.57.0 (src worca-cc@ba1795b8 [foo], dirty)"
  pip:      "worca 0.57.0 (pip)"
  degraded: "worca 0.57.0"  or  "worca unknown"
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Optional


_MANIFEST_NAME = "provenance.json"


def _live_version() -> Optional[str]:
    """Return the installed worca.__version__, or None if import fails."""
    try:
        import worca  # noqa: PLC0415
        return worca.__version__
    except Exception:
        return None


def load_provenance(worca_runtime_dir: Path) -> dict:
    """Read .claude/worca/provenance.json; return a synthesized fallback on any error."""
    manifest = worca_runtime_dir / _MANIFEST_NAME
    try:
        content = manifest.read_text(encoding="utf-8")
        block = json.loads(content)
        if isinstance(block, dict):
            return block
    except Exception:
        pass

    version = _live_version() or "unknown"
    return {"worca_version": version, "runtime_source": None}


def _fmt_provenance(block: Optional[dict]) -> str:
    """Format a provenance block as a one-line log string."""
    if not block:
        return "worca unknown"

    version = block.get("worca_version", "unknown")
    rs = block.get("runtime_source")

    if not rs:
        return f"worca {version}"

    source = rs.get("source")

    if source == "pip":
        return f"worca {version} (pip)"

    if source == "git":
        repo = rs.get("repo", "")
        commit = rs.get("commit", "")
        branch = rs.get("branch")
        dirty = rs.get("dirty", False)

        short_commit = commit[:8] if commit else ""
        parts = f"{repo}@{short_commit}"
        if branch:
            parts = f"{parts} [{branch}]"
        if dirty:
            parts = f"{parts}, dirty"
        return f"worca {version} (src {parts})"

    return f"worca {version}"
