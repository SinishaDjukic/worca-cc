"""Git and worktree operations. All functions run git as a subprocess."""

import os
import subprocess

from worca.utils.beads import bd_init
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


def create_pipeline_worktree(run_id: str, slug: str, base_branch: str = "HEAD") -> str:
    """Create a worktree for a pipeline run.

    Creates worktree at .worktrees/pipeline-{run_id} with branch
    worca/{slug}-{run_id}, based on the given base_branch.

    Runs: git worktree add -b worca/{slug}-{run_id} .worktrees/pipeline-{run_id} {base_branch}
    Returns the absolute worktree path on success, empty string on failure.
    """
    branch = f"worca/{slug}-{run_id}"
    path = os.path.join(".worktrees", f"pipeline-{run_id}")
    result = _run_git("worktree", "add", "-b", branch, path, base_branch)
    if result.returncode != 0:
        return ""
    return os.path.abspath(path)


def remove_pipeline_worktree(worktree_path: str) -> bool:
    """Remove a pipeline worktree and delete its associated branch.

    Detects the branch from the worktree, removes the worktree with --force,
    then deletes the branch with git branch -D.

    Returns True if both operations succeed, False otherwise.
    """
    # Detect branch from worktree HEAD before removal
    branch = ""
    head_path = os.path.join(worktree_path, ".git")
    if os.path.isfile(head_path):
        # Worktree .git is a file pointing to the main repo's worktree dir.
        # Use rev-parse inside the worktree to find the branch.
        rev_result = subprocess.run(
            ["git", "-C", worktree_path, "rev-parse", "--abbrev-ref", "HEAD"],
            capture_output=True, text=True, env=get_env(),
        )
        if rev_result.returncode == 0:
            branch = rev_result.stdout.strip()

    # Remove the worktree
    result = _run_git("worktree", "remove", "--force", worktree_path)
    if result.returncode != 0:
        return False

    # Delete the branch
    if branch and branch != "HEAD":
        br_result = _run_git("branch", "-D", branch)
        if br_result.returncode != 0:
            return False

    return True


def list_pipeline_worktrees() -> list[dict]:
    """List pipeline worktrees from git worktree list --porcelain.

    Returns a list of dicts with keys: path, branch, commit.
    Only includes worktrees whose path contains '.worktrees/pipeline-'.
    """
    result = _run_git("worktree", "list", "--porcelain")
    if result.returncode != 0:
        return []

    worktrees: list[dict] = []
    current: dict = {}
    for line in result.stdout.splitlines():
        if line.startswith("worktree "):
            current = {"path": line[len("worktree "):]}
        elif line.startswith("HEAD "):
            current["commit"] = line[len("HEAD "):]
        elif line.startswith("branch "):
            # refs/heads/worca/slug-runid -> worca/slug-runid
            ref = line[len("branch "):]
            if ref.startswith("refs/heads/"):
                ref = ref[len("refs/heads/"):]
            current["branch"] = ref
        elif line == "":
            if current and "path" in current:
                # Filter to pipeline worktrees only
                if f".worktrees{os.sep}pipeline-" in current["path"] or ".worktrees/pipeline-" in current["path"]:
                    worktrees.append(current)
            current = {}
    # Handle trailing entry without final blank line
    if current and "path" in current:
        if f".worktrees{os.sep}pipeline-" in current["path"] or ".worktrees/pipeline-" in current["path"]:
            worktrees.append(current)

    return worktrees


def diff_stat(base: str = "main") -> str:
    """Get diff stat between base branch and HEAD.

    Runs: git diff --stat {base}..HEAD
    Returns the diff stat output string.
    """
    result = _run_git("diff", "--stat", f"{base}..HEAD")
    return result.stdout


def init_worktree_beads(worktree_path: str) -> bool:
    """Initialize beads in a worktree directory.

    Convenience function that runs `bd init` inside the given worktree path.
    Intended to be called after worktree creation to set up per-worktree
    beads tracking.

    Returns True on success, False on failure.
    """
    return bd_init(cwd=worktree_path)
