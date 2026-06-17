"""Benchmark plugin interface (W-075 §3).

Unifying principle: the agent's patch is **source-only**; the harness supplies the
tests. Each plugin: loads instances, gives a prompt, materializes the base tree,
optionally hides benchmark tests during the run (Commit0), and grades the diff.
"""

from __future__ import annotations

import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from ..config import GradeConfig, Profile


@dataclass
class Instance:
    """One benchmark task."""

    id: str
    prompt: str
    repo: str | None = None
    base_commit: str | None = None
    # Local source repo (a path). When set, materialize copies from here instead of
    # cloning over the network — used by tests and offline runs.
    local_repo: str | None = None
    extra: dict[str, Any] = field(default_factory=dict)


@dataclass
class Prepared:
    """Result of pre-run preparation: paths to exclude from the diff + a restore hook."""

    base_commit: str
    extra_excludes: tuple[str, ...] = ()
    restore: Callable[[], None] | None = None
    gold_test_paths: tuple[str, ...] = ()


@dataclass
class GradeResult:
    status: str  # graded | ran | error
    resolved: bool | None = None
    score: float | None = None
    report_path: str | None = None
    detail: str = ""
    # Fine-grained test counts when the grader runs a real suite (Commit0:
    # held-out tests passed / total). ``None`` for pass/fail-only graders
    # (SWE-bench resolved boolean, stub). ``score`` == passed / total.
    tests_passed: int | None = None
    tests_total: int | None = None


class BenchmarkPlugin:
    name: str = "base"

    def load_instances(self, profile: Profile) -> list[Instance]:
        raise NotImplementedError

    def prompt_for(self, instance: Instance) -> str:
        return instance.prompt

    def materialize(self, instance: Instance, dest: Path) -> str:  # returns base_commit
        raise NotImplementedError

    def prepare(self, instance: Instance, tree: Path) -> Prepared:
        """Default: nothing to hide; diff against the materialized base_commit."""
        base = _git_head(tree)
        return Prepared(base_commit=base)

    def grade(
        self,
        instance: Instance,
        diff: str,
        tree: Path,
        target_dir: Path,
        grade: GradeConfig,
        *,
        prepared: Prepared,
        secret_env: dict[str, str] | None = None,
    ) -> GradeResult:
        raise NotImplementedError


# ----------------------------- shared helpers ------------------------------ #

def grade_env(secret_env: dict[str, str] | None) -> dict[str, str]:
    """Subprocess environment for grader shell-outs: os.environ + grader secrets.

    sb-cli (``SWEBENCH_API_KEY``) and Modal (``MODAL_TOKEN_*``) credentials live
    in worca-bench's secret env, not the ambient shell — merge them in so the
    grader subprocess can authenticate.
    """
    import os

    return {**os.environ, **(secret_env or {})}


def _git(cmd: list[str], cwd: Path) -> str:
    return subprocess.run(["git", "-C", str(cwd), *cmd],
                          capture_output=True, text=True, check=True).stdout.strip()


def _git_head(tree: Path) -> str:
    return _git(["rev-parse", "HEAD"], tree)


def init_repo_from_local(src: str | Path, dest: Path, base_commit: str | None) -> str:
    """Copy a local source repo into ``dest`` as a git repo at ``base_commit`` (or HEAD).

    Used for offline/test materialization. Returns the base commit sha.
    """
    import shutil

    src = Path(src)
    if dest.exists():
        shutil.rmtree(dest)
    shutil.copytree(src, dest)
    if not (dest / ".git").exists():
        _git(["init"], dest)
        _git(["add", "-A"], dest)
        _git(["-c", "user.email=bench@worca.dev", "-c", "user.name=bench",
              "commit", "-m", "base"], dest)
    if base_commit:
        _git(["checkout", base_commit], dest)
    return _git_head(dest)


def stub_grade(diff: str, instance: Instance) -> GradeResult:
    """Plumbing-only grader: no real test execution.

    Resolves on the instance's ``expect_resolved`` override if present, else on
    whether the agent produced a non-empty diff. Powers free e2e tests and a
    user dry-run before paying for real grading.
    """
    expect = instance.extra.get("expect_resolved")
    if expect is not None:
        resolved = bool(expect)
    else:
        resolved = bool(diff.strip())
    return GradeResult(
        status="graded",
        resolved=resolved,
        score=1.0 if resolved else 0.0,
        detail="stub grade (no test execution)",
    )
