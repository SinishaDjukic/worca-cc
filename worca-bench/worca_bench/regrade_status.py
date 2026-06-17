"""Regrade progress heartbeat (W-075 usability).

A regrade sweep is a long, detached process whose only previous side effect was a
single ``results.jsonl`` rewrite at the very end — so the dashboard had no way to
show that a sweep was running, how far along it was, or whether it finished.

This writes a tiny, atomically-updated status file per profile that the server
reads to surface live progress (X/N, current instance, counts) and completion:

    <target>/runs/<profile>/regrade-status.json

The file carries the runner ``pid`` so the server can tell a genuinely-running
sweep (``status: running`` + live pid) from a crashed one (running + dead pid).
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any


def status_path(target_dir: Path, profile: str) -> Path:
    return Path(target_dir) / "runs" / profile / "regrade-status.json"


def write_status(
    target_dir: Path,
    profile: str,
    *,
    mode: str,
    total: int,
    done: int,
    current: str | None,
    counts: dict[str, int],
    status: str,
    started_at: str,
    updated_at: str,
) -> None:
    """Atomically (temp + replace) write the heartbeat for one profile."""
    path = status_path(target_dir, profile)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload: dict[str, Any] = {
        "profile": profile,
        "mode": mode,
        "pid": os.getpid(),
        "total": total,
        "done": done,
        "current": current,
        "counts": dict(counts),
        "status": status,  # running | done | error
        "started_at": started_at,
        "updated_at": updated_at,
    }
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload), encoding="utf-8")
    tmp.replace(path)
