"""Extract a source-only diff + parse worca telemetry from a completed run (W-075 §2 step 5, §6).

The agent's patch is *source-only*: worca's own scaffolding (``.claude/``, ``.worca/``,
``MASTER_PLAN.md``) and any benchmark test paths are excluded, so the diff matches what
the grader expects (the harness supplies the tests). Telemetry is read from the run's
``status.json``.
"""

from __future__ import annotations

import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# worca writes these into the target tree; they must never leak into the patch.
DEFAULT_EXCLUDES = (".claude", ".worca", ".worktrees", "MASTER_PLAN.md")


def extract_diff(
    tree: Path,
    base: str,
    *,
    extra_excludes: tuple[str, ...] = (),
) -> str:
    """Return a unified diff of the working tree vs ``base``, source-only.

    Untracked files are surfaced via intent-to-add so newly created source files
    appear in the diff regardless of whether the pipeline committed them.
    """
    subprocess.run(["git", "-C", str(tree), "add", "-A", "-N"],
                   capture_output=True, text=True)
    pathspec = ["--", "."]
    for ex in DEFAULT_EXCLUDES + tuple(extra_excludes):
        pathspec.append(f":(exclude){ex}")
    proc = subprocess.run(
        ["git", "-C", str(tree), "diff", base, *pathspec],
        capture_output=True, text=True,
    )
    return proc.stdout


def diff_line_count(diff: str) -> int:
    """Count added/removed content lines (excludes diff headers)."""
    n = 0
    for line in diff.splitlines():
        if line.startswith(("+", "-")) and not line.startswith(("+++", "---")):
            n += 1
    return n


def touches_paths(diff: str, paths: tuple[str, ...]) -> list[str]:
    """Return which of ``paths`` the diff touches (used by the Commit0 leakage guard)."""
    hit: list[str] = []
    for line in diff.splitlines():
        if line.startswith("diff --git "):
            for p in paths:
                if p and p in line and p not in hit:
                    hit.append(p)
    return hit


@dataclass
class Telemetry:
    pipeline_status: str | None = None
    cost_usd: float = 0.0
    tokens: dict[str, Any] = field(default_factory=dict)
    wall_time_s: float = 0.0
    api_time_s: float = 0.0
    loop_counters: dict[str, int] = field(default_factory=dict)
    stage_outcomes: dict[str, str] = field(default_factory=dict)
    api_retries: int = 0


def _sum_stage_field(status: dict[str, Any], field_name: str) -> float:
    total = 0.0
    for stage in (status.get("stages") or {}).values():
        for it in stage.get("iterations", []) or []:
            v = it.get(field_name)
            if isinstance(v, (int, float)):
                total += v
    return total


def parse_telemetry(status: dict[str, Any]) -> Telemetry:
    """Flatten worca's status.json into the fields the results row needs (§6)."""
    top_tokens = status.get("token_usage") or {}
    tokens = {
        "input": top_tokens.get("input_tokens", 0),
        "output": top_tokens.get("output_tokens", 0),
        "total": (top_tokens.get("input_tokens", 0) or 0) + (top_tokens.get("output_tokens", 0) or 0),
        "by_stage": top_tokens.get("by_stage", {}) or {},
        "by_model": top_tokens.get("by_model", {}) or {},
    }
    cost = top_tokens.get("total_cost_usd")
    if not isinstance(cost, (int, float)) or cost == 0:
        cost = _sum_stage_field(status, "cost_usd")

    stage_outcomes: dict[str, str] = {}
    for name, stage in (status.get("stages") or {}).items():
        iters = stage.get("iterations") or []
        if iters and iters[-1].get("outcome") is not None:
            stage_outcomes[name] = iters[-1]["outcome"]
        elif stage.get("status"):
            stage_outcomes[name] = stage["status"]

    return Telemetry(
        pipeline_status=status.get("pipeline_status"),
        cost_usd=float(cost or 0.0),
        tokens=tokens,
        wall_time_s=_sum_stage_field(status, "duration_ms") / 1000.0,
        api_time_s=_sum_stage_field(status, "duration_api_ms") / 1000.0,
        loop_counters=dict(status.get("loop_counters") or {}),
        stage_outcomes=stage_outcomes,
        api_retries=int(_sum_stage_field(status, "api_retries")),
    )


def archive_artifacts(run_dir: Path | None, diff: str, dest: Path) -> None:
    """Copy status.json / events.jsonl + write diff.patch into the per-rep artifact dir."""
    dest.mkdir(parents=True, exist_ok=True)
    (dest / "diff.patch").write_text(diff, encoding="utf-8")
    if run_dir and run_dir.exists():
        for name in ("status.json", "events.jsonl"):
            src = run_dir / name
            if src.exists():
                shutil.copy2(src, dest / name)
