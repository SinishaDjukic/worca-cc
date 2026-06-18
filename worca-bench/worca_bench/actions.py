"""Actions ledger — CLI-first lifecycle recording for the Activity dock.

Every Run/Regrade launch records its OWN lifecycle to an append-only
``<target>/actions.jsonl`` — the same ledger the dashboard reads. Because the CLI
owns this (start → progress → terminal status in a ``finally``), a run/regrade
launched from the CLI, cron, or CI shows up in the dock exactly like a UI-launched
one — and the terminal state is the *real* outcome (completed vs failed), not the
server guessing from pid liveness.

The on-disk format matches ``server/actions-store.js``: one JSON object per line,
latest-record-per-``id`` wins, so a lifecycle transition is just another append.
The server reads/reconciles/stops; it no longer writes the ledger. ``source_dir``
(the result dir) is recorded so the server can backfill ``src`` with its own
``srcHash`` — avoiding a JS/Python hash-string mismatch.

All writes are best-effort: a ledger failure must never crash or fail a run.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _file(target_dir: Path) -> Path:
    return Path(target_dir) / "actions.jsonl"


def _append(target_dir: Path, rec: dict[str, Any]) -> None:
    try:
        path = _file(target_dir)
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(rec) + "\n")
    except OSError:
        # A ledger write must never break the run it's describing.
        pass


def start(
    target_dir: Path,
    *,
    kind: str,
    profile: str,
    source_dir: Path | str | None = None,
    params: dict[str, Any] | None = None,
    started_at: str | None = None,
) -> str:
    """Record a launch as ``running`` and return its action id.

    ``kind`` is ``"run"`` or ``"regrade"``. The id embeds the pid so the server's
    in-memory spawn overlay can match this record by pid and drop its synthetic
    placeholder once the CLI takes over.
    """
    started = started_at or _now()
    pid = os.getpid()
    try:
        ms = int(datetime.fromisoformat(started).timestamp() * 1000)
    except ValueError:
        ms = 0
    aid = f"{kind}-{profile}-{pid}-{ms}"
    _append(target_dir, {
        "id": aid,
        "type": kind,
        "profile": profile,
        "source_dir": str(Path(source_dir).resolve()) if source_dir else None,
        "src": None,  # server backfills via srcHash(source_dir)
        "pid": pid,
        "params": params or {},
        "status": "running",
        "started_at": started,
        "updated_at": started,
    })
    return aid


def progress(
    target_dir: Path,
    action_id: str,
    *,
    done: int,
    total: int | None = None,
    errors: int = 0,
    unit: str = "instances",
) -> None:
    """Patch live progress for a running action."""
    if not action_id:
        return
    _append(target_dir, {
        "id": action_id,
        "progress": {"unit": unit, "done": done, "total": total, "errors": errors},
        "updated_at": _now(),
    })


def finish(
    target_dir: Path,
    action_id: str,
    *,
    status: str,
    error: str | None = None,
    progress: dict[str, Any] | None = None,
) -> None:
    """Write the terminal record (``completed`` | ``failed``) for an action."""
    if not action_id:
        return
    ended = _now()
    rec: dict[str, Any] = {
        "id": action_id,
        "status": status,
        "ended_at": ended,
        "updated_at": ended,
    }
    if error:
        rec["error"] = error[:400]
    if progress is not None:
        rec["progress"] = progress
    _append(target_dir, rec)
