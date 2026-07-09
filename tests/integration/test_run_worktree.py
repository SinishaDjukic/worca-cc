"""W-050 Phase 3 — `run_worktree.py` integration coverage.

Drives ``python -m worca.scripts.run_worktree`` via ``pipeline_env.run_worktree``,
which spawns the script, captures the run_id + worktree path it prints, optionally
waits for the detached pipeline to reach a terminal state, and registers the
worktree for fixture-teardown cleanup (plan rule #15: ``git worktree remove
--force`` even on test failure).

Path comparisons use ``os.path.realpath`` because macOS canonicalises
``/var/...`` to ``/private/var/...`` (plan rule #15) — the worktree path
returned by run_worktree is the canonical form, while ``tmp_path`` may be the
symlink form.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest



_DEFAULT_SCENARIO = {"default": {"action": "succeed", "delay_s": 0}}


def _real(p: str | Path) -> str:
    """Canonicalise a path for cross-OS comparison."""
    return os.path.realpath(str(p))


# ---------------------------------------------------------------------------
# Worktree creation + run-dir layout
# ---------------------------------------------------------------------------


def test_run_worktree_creates_worktree_and_emits_run_id(pipeline_env):
    """Default invocation creates ``.worktrees/pipeline-<run_id>/`` and prints
    ``<run_id>\\n<worktree_path>`` on stdout. Matches the documented contract."""
    result = pipeline_env.run_worktree(_DEFAULT_SCENARIO, prompt="phase3 task")

    assert result.returncode == 0, (
        f"run_worktree should launch cleanly; stderr: {result.stderr[:500]}"
    )
    assert result.run_id, "stdout line 1 must be the run_id"
    assert result.worktree_path, "stdout line 2 must be the worktree path"

    expected_dir = pipeline_env.project / ".worktrees" / f"pipeline-{result.run_id}"
    assert _real(result.worktree_path) == _real(expected_dir), (
        f"worktree path mismatch:\n  got:      {_real(result.worktree_path)}\n"
        f"  expected: {_real(expected_dir)}"
    )
    assert Path(result.worktree_path).is_dir()


def test_run_worktree_creates_status_json_in_run_dir(pipeline_env):
    """The pipeline runner initialises status.json inside the worktree's run
    directory. We verify the file exists and is valid JSON after the pipeline
    completes."""
    result = pipeline_env.run_worktree(
        _DEFAULT_SCENARIO, prompt="status check",
    )

    assert result.returncode == 0
    status_path = (
        Path(result.worktree_path) / ".worca" / "runs" / result.run_id / "status.json"
    )
    assert status_path.exists(), (
        f"pipeline runner should have written status.json at {status_path}"
    )
    import json
    data = json.loads(status_path.read_text())
    assert isinstance(data, dict)


# ---------------------------------------------------------------------------
# --branch / base-branch resolution
# ---------------------------------------------------------------------------


def test_run_worktree_branch_argument_targets_specified_base(pipeline_env):
    """When ``--branch`` is given it's passed straight through to
    ``git worktree add``, so the new worktree's HEAD descends from the chosen
    base. We verify by creating a feature branch with a sentinel commit and
    asserting that commit is reachable in the worktree."""
    project = pipeline_env.project

    # Create a sentinel commit on a new feature branch in the parent repo.
    subprocess.run(["git", "checkout", "-b", "feature/phase3"], cwd=str(project),
                   check=True, capture_output=True)
    sentinel = project / "feature_sentinel.txt"
    sentinel.write_text("phase3 base\n")
    subprocess.run(["git", "add", "feature_sentinel.txt"], cwd=str(project),
                   check=True, capture_output=True)
    subprocess.run(["git", "commit", "-m", "feat: phase3 sentinel"],
                   cwd=str(project), check=True, capture_output=True)
    subprocess.run(["git", "checkout", "-"], cwd=str(project),
                   check=True, capture_output=True)

    result = pipeline_env.run_worktree(
        _DEFAULT_SCENARIO, prompt="branch test",
        branch="feature/phase3",
    )

    assert result.returncode == 0, f"stderr: {result.stderr[:300]}"

    # The worktree should contain the sentinel file from the feature branch.
    assert (Path(result.worktree_path) / "feature_sentinel.txt").exists(), (
        "worktree was not forked from feature/phase3 — sentinel file missing"
    )


# ---------------------------------------------------------------------------
# --guide injection
# ---------------------------------------------------------------------------


@pytest.mark.timeout(180)
def test_run_worktree_guide_argument_accepted(pipeline_env, tmp_path):
    """``--guide`` is repeatable and resolved to absolute paths before being
    forwarded to the pipeline. We assert run_worktree accepts the flag and
    reports the worktree as launched — verifying the pipeline actually picked
    up the guide is run_pipeline.py's domain (already covered by Phase 1).

    Marked ``timeout(180)`` per plan §12 — this test spawns a full pipeline
    subprocess and routinely exceeds the global 30s default in CI."""
    guide_a = tmp_path / "guide_a.md"
    guide_a.write_text("# A\n")
    guide_b = tmp_path / "guide_b.md"
    guide_b.write_text("# B\n")

    result = pipeline_env.run_worktree(
        _DEFAULT_SCENARIO, prompt="guide test",
        guide=[str(guide_a), str(guide_b)],
    )

    assert result.returncode == 0, f"stderr: {result.stderr[:300]}"
    assert result.run_id
    assert Path(result.worktree_path).is_dir()


# ---------------------------------------------------------------------------
# Runtime validation (error path)
# ---------------------------------------------------------------------------


def test_run_worktree_errors_when_runtime_missing(pipeline_env):
    """run_worktree.py validates the worca runtime exists before any side
    effect (worktree create, registry write, Popen). Without it the spawned
    pipeline crashes silently and the user sees only "started".

    W-077: the canonical runtime is now in ~/.worca/pkg/<ver>/worca/ (pkg store).
    Simulate a missing runtime by pointing WORCA_HOME at an empty directory so
    neither the pkg store nor the legacy .claude/worca/ path is present.
    """
    empty_home = pipeline_env.tmp_path / "empty_worca_home"
    empty_home.mkdir()

    cmd = [sys.executable, "-m", "worca.scripts.run_worktree",
           "--prompt", "no runtime"]
    proc = subprocess.run(
        cmd, cwd=str(pipeline_env.project),
        env={**os.environ, "WORCA_SKIP_BEADS": "1", "WORCA_HOME": str(empty_home)},
        capture_output=True, text=True, timeout=15,
    )
    assert proc.returncode == 1, (
        f"expected rc=1 for missing runtime; got {proc.returncode}\n"
        f"stderr: {proc.stderr[:400]}"
    )
    assert "worca init" in proc.stderr.lower() or "worca runtime" in proc.stderr.lower()


# ---------------------------------------------------------------------------
# Parallel isolation: two run_worktree calls don't collide
# ---------------------------------------------------------------------------


def test_two_worktree_runs_have_distinct_paths_and_run_ids(pipeline_env):
    """Two back-to-back run_worktree invocations must produce distinct
    run_ids and distinct worktree directories — the registry and disk layout
    both depend on these being unique. The W-050 plan calls this out as
    plan-rule-#15-relevant: parallel-isolated worktrees must not clobber each
    other or the parent repo."""
    result_a = pipeline_env.run_worktree(_DEFAULT_SCENARIO, prompt="task A")
    result_b = pipeline_env.run_worktree(_DEFAULT_SCENARIO, prompt="task B")

    assert result_a.returncode == 0 and result_b.returncode == 0
    assert result_a.run_id != result_b.run_id
    assert _real(result_a.worktree_path) != _real(result_b.worktree_path)
    # Both worktree dirs co-exist after the second run — first wasn't reaped.
    assert Path(result_a.worktree_path).is_dir()
    assert Path(result_b.worktree_path).is_dir()
