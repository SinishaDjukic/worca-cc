"""End-to-end test of the full runner lifecycle, driven by worca's own mock Claude.

This spawns a REAL worca pipeline (materialize → worca init → run → harvest → grade →
normalize) but points it at ``tests/mock_claude/mock_claude.py`` via ``WORCA_CLAUDE_BIN``
+ ``MOCK_CLAUDE_SCENARIO`` — so it is free and deterministic. Skipped if the worca-cc
source repo can't be located (e.g. when worca-bench is installed standalone).
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from conftest import make_git_repo

from worca_bench.config import profile_from_dict
from worca_bench.normalize import read_rows
from worca_bench.runner import run_profile
from worca_bench.venvs import find_worca_repo

pytestmark = pytest.mark.live_worca

REPO = find_worca_repo()


@pytest.mark.skipif(REPO is None, reason="worca-cc source repo not found")
def test_full_lifecycle_with_mock_claude(tmp_path: Path):
    # 1. A tiny "instance" repo to stand in for a benchmark task.
    src = tmp_path / "instance_src"
    base = make_git_repo(src, {"src/app.py": "def add(a, b):\n    return 0\n"})

    # 2. A local instances fixture (bypasses HuggingFace).
    instances = tmp_path / "instances.json"
    instances.write_text(json.dumps([
        {"instance_id": "demo__app-1", "problem_statement": "fix add()",
         "local_repo": str(src), "base_commit": base},
    ]), encoding="utf-8")

    # 3. Profile: local worca, mock Claude, stub grading.
    profile = profile_from_dict({
        "name": "e2e-mock",
        "benchmark": "swe-bench-verified",
        "worca": {"ref": "local"},
        "selection": {"instances_file": str(instances)},
        "template": "builtin:feature",
        "reps": 1,
        "grade": {"mode": "stub"},
        "mock": True,
        "claude_md_mode": "none",
    })

    target = tmp_path / "out"
    summary = run_profile(profile, target, canary_first=True)

    # Canary passed (template compatible), one rep ran.
    assert summary.incompatible_templates == {}, summary.incompatible_templates
    assert summary.reps_run == 1, summary.as_dict()

    rows = read_rows(target)
    assert len(rows) == 1
    row = rows[0]
    assert row["instance_id"] == "demo__app-1"
    assert row["status"] == "graded"
    assert row["resolved"] is True            # stub resolves on a non-empty diff
    assert row["diff_lines"] >= 1             # mock implementer created a file
    assert row["leaked"] is False
    assert row["pipeline_status"] is not None
    assert row["cost_usd"] >= 0.0
    assert "by_stage" in row["tokens"]

    # Artifacts were archived for drill-down.
    artifacts = target / row["artifacts_dir"]
    assert (artifacts / "diff.patch").exists()
    assert (artifacts / "status.json").exists()


@pytest.mark.skipif(REPO is None, reason="worca-cc source repo not found")
def test_incompatible_template_is_skipped(tmp_path: Path):
    """A template no worca version can resolve must be flagged + its reps skipped,
    not run — the canary guard (W-075 §5)."""
    src = tmp_path / "instance_src"
    base = make_git_repo(src, {"a.py": "x = 1\n"})
    instances = tmp_path / "instances.json"
    instances.write_text(json.dumps([
        {"instance_id": "demo__a-1", "problem_statement": "p",
         "local_repo": str(src), "base_commit": base},
    ]), encoding="utf-8")

    profile = profile_from_dict({
        "name": "e2e-bad-template",
        "benchmark": "swe-bench-verified",
        "worca": {"ref": "local"},
        "selection": {"instances_file": str(instances)},
        "template": "builtin:this-template-does-not-exist",
        "reps": 2,
        "grade": {"mode": "stub"},
        "mock": True,
    })

    target = tmp_path / "out"
    summary = run_profile(profile, target, canary_first=True)

    assert "builtin:this-template-does-not-exist" in summary.incompatible_templates
    assert summary.reps_run == 0
    assert summary.reps_skipped == 2
    rows = read_rows(target)
    assert all(r["status"] == "skipped" for r in rows)
