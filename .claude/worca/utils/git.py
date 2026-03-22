"""Git and worktree operations. All functions run git as a subprocess."""

import subprocess

from worca.utils.env import get_env


def _run_git(*args: str) -> subprocess.CompletedProcess:
    """Run a git command and return the CompletedProcess."""
    return subprocess.run(["git", *args], capture_output=True, text=True, env=get_env())


def create_branch(name: str) -> bool:
    """Create and switch to a new branch.

    Runs: git checkout -b {name}
    Returns True on success, False on failure.
    """
    result = _run_git("checkout", "-b", name)
    return result.returncode == 0


def create_worktree(path: str, branch: str) -> bool:
    """Create a new git worktree with a new branch.

    Runs: git worktree add {path} -b {branch}
    Returns True on success, False on failure.
    """
    result = _run_git("worktree", "add", path, "-b", branch)
    return result.returncode == 0


def remove_worktree(path: str) -> bool:
    """Remove a git worktree.

    Runs: git worktree remove {path}
    Returns True on success, False on failure.
    """
    result = _run_git("worktree", "remove", path)
    return result.returncode == 0


def current_branch() -> str:
    """Get the current branch name.

    Runs: git rev-parse --abbrev-ref HEAD
    Returns the branch name string.
    """
    result = _run_git("rev-parse", "--abbrev-ref", "HEAD")
    return result.stdout.strip()


def get_current_git_head() -> str:
    """Get the current git HEAD commit SHA.

    Runs: git rev-parse HEAD
    Returns the full SHA string, or empty string on failure.
    """
    result = _run_git("rev-parse", "HEAD")
    if result.returncode != 0:
        return ""
    return result.stdout.strip()


def diff_stat(base: str = "main") -> str:
    """Get diff stat between base branch and HEAD.

    Runs: git diff --stat {base}..HEAD
    Returns the diff stat output string.
    """
    result = _run_git("diff", "--stat", f"{base}..HEAD")
    return result.stdout
