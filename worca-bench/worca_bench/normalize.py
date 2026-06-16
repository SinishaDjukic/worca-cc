"""Normalize a completed rep into a single ``results.jsonl`` row (W-075 §6).

``results.jsonl`` is append-only and is the dashboard's source of truth. One row
per (profile, instance, rep), joining worca telemetry with the grader verdict.
"""

from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any

from . import RESULTS_SCHEMA_VERSION
from .harvest import Telemetry, diff_line_count

_WRITE_LOCK = threading.Lock()


def build_row(
    *,
    profile_name: str,
    benchmark: str,
    instance_id: str,
    worca_ref: str,
    template: str,
    rep: int,
    run_id: str,
    status: str,
    resolved: bool | None,
    score: float | None,
    telemetry: Telemetry,
    diff: str,
    leaked: bool,
    error: str | None,
    started_at: str | None,
    completed_at: str | None,
    artifacts_dir: str,
    worca_version: str | None = None,
    grade_mode: str | None = None,
    graphify: str | None = None,
    code_review_graph: str | None = None,
) -> dict[str, Any]:
    return {
        "schema_version": RESULTS_SCHEMA_VERSION,
        "profile": profile_name,
        "benchmark": benchmark,
        "instance_id": instance_id,
        "worca_ref": worca_ref,
        "worca_version": worca_version,
        "template": template,
        "grade_mode": grade_mode,
        "graphify": graphify,
        "code_review_graph": code_review_graph,
        "rep": rep,
        "run_id": run_id,
        "status": status,
        "resolved": resolved,
        "score": score,
        "cost_usd": round(telemetry.cost_usd, 6),
        "tokens": telemetry.tokens,
        "wall_time_s": round(telemetry.wall_time_s, 3),
        "api_time_s": round(telemetry.api_time_s, 3),
        "pipeline_status": telemetry.pipeline_status,
        "loop_counters": telemetry.loop_counters,
        "stage_outcomes": telemetry.stage_outcomes,
        "api_retries": telemetry.api_retries,
        "diff_lines": diff_line_count(diff),
        "leaked": leaked,
        "error": error,
        "started_at": started_at,
        "completed_at": completed_at,
        "artifacts_dir": artifacts_dir,
    }


def append_row(target_dir: Path, row: dict[str, Any]) -> None:
    """Append one row to ``<target_dir>/results.jsonl`` (thread-safe)."""
    path = target_dir / "results.jsonl"
    line = json.dumps(row) + "\n"
    with _WRITE_LOCK:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as fh:
            fh.write(line)


def read_rows(target_dir: Path) -> list[dict[str, Any]]:
    """Read all rows from ``results.jsonl`` (tolerant of partial last lines)."""
    path = target_dir / "results.jsonl"
    if not path.exists():
        return []
    rows: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return rows
