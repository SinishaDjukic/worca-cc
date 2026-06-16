"""Shared test helpers for worca-bench."""

from __future__ import annotations

import subprocess
from pathlib import Path


def git(args: list[str], cwd: Path) -> str:
    return subprocess.run(
        ["git", "-C", str(cwd), *args],
        capture_output=True, text=True, check=True,
    ).stdout.strip()


def make_git_repo(path: Path, files: dict[str, str] | None = None) -> str:
    """Create a git repo with initial files. Returns the initial commit sha."""
    path.mkdir(parents=True, exist_ok=True)
    files = files or {"README.md": "base\n"}
    for rel, content in files.items():
        f = path / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(content, encoding="utf-8")
    git(["init"], path)
    git(["config", "user.email", "test@test.com"], path)
    git(["config", "user.name", "Test"], path)
    git(["add", "-A"], path)
    git(["commit", "-m", "init"], path)
    return git(["rev-parse", "HEAD"], path)
