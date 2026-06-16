"""Aggregate ``results.jsonl`` rows into per-profile statistics.

Pure functions so both the CLI (`worca-bench stats`) and any external consumer can
reuse them. The dashboard computes the equivalent in JS from the same rows.
"""

from __future__ import annotations

from statistics import mean, median
from typing import Any, Iterable


def _graded(rows: Iterable[dict]) -> list[dict]:
    return [r for r in rows if r.get("status") == "graded"]


def aggregate(rows: list[dict]) -> dict[str, Any]:
    """Aggregate a set of rows (assumed one profile/config) into headline stats."""
    graded = _graded(rows)
    resolved = [r for r in graded if r.get("resolved") is True]
    scores = [r["score"] for r in graded if isinstance(r.get("score"), (int, float))]
    costs = [r["cost_usd"] for r in rows if isinstance(r.get("cost_usd"), (int, float))]
    walls = [r["wall_time_s"] for r in rows if isinstance(r.get("wall_time_s"), (int, float))]
    iters = [_total_iterations(r) for r in rows]
    return {
        "n": len(rows),
        "graded": len(graded),
        "errors": sum(1 for r in rows if r.get("status") == "error"),
        "skipped": sum(1 for r in rows if r.get("status") == "skipped"),
        "leaked": sum(1 for r in rows if r.get("leaked")),
        "resolved_rate": (len(resolved) / len(graded)) if graded else None,
        "mean_score": mean(scores) if scores else None,
        "mean_cost_usd": mean(costs) if costs else None,
        "median_cost_usd": median(costs) if costs else None,
        "mean_wall_s": mean(walls) if walls else None,
        "mean_iterations": mean(iters) if iters else None,
    }


def _total_iterations(row: dict) -> int:
    return sum(v for v in (row.get("loop_counters") or {}).values() if isinstance(v, int))


def aggregate_by_profile(rows: list[dict]) -> dict[str, dict[str, Any]]:
    groups: dict[str, list[dict]] = {}
    for r in rows:
        groups.setdefault(r.get("profile", "?"), []).append(r)
    return {name: aggregate(rs) for name, rs in groups.items()}
