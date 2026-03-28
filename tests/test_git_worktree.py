"""Tests for pipeline worktree lifecycle helpers in worca.utils.git.

Uses real temporary git repos to exercise actual worktree creation/removal.
"""

import os
import subprocess
import tempfile

import pytest


# ---------------------------------------------------------------------------
# Fixture: a disposable git repository with one commit
# ---------------------------------------------------------------------------

@pytest.fixture()
def git_repo(tmp_path, monkeypatch):
    """Create a minimal git repo with one commit and cd into it."""
    repo = tmp_path / "repo"
    repo.mkdir()
    monkeypatch.chdir(repo)
    subprocess.run(["git", "init"], cwd=str(repo), check=True, capture_output=True)
    subprocess.run(["git", "checkout", "-b", "main"], cwd=str(repo), check=True, capture_output=True)
    # Need at least one commit so HEAD exists
    (repo / "README.md").write_text("init")
    subprocess.run(["git", "add", "."], cwd=str(repo), check=True, capture_output=True)
    subprocess.run(
        ["git", "commit", "-m", "initial"],
        cwd=str(repo), check=True, capture_output=True,
        env={**os.environ, "GIT_AUTHOR_NAME": "test", "GIT_AUTHOR_EMAIL": "t@t",
             "GIT_COMMITTER_NAME": "test", "GIT_COMMITTER_EMAIL": "t@t"},
    )
    return repo


# ---------------------------------------------------------------------------
# create_pipeline_worktree
# ---------------------------------------------------------------------------

class TestCreatePipelineWorktree:

    def test_creates_directory_and_branch(self, git_repo):
        from worca.utils.git import create_pipeline_worktree

        result = create_pipeline_worktree("abc123", "my-feature")

        # Returns an absolute path
        assert os.path.isabs(result)
        # Directory exists
        assert os.path.isdir(result)
        # Path ends with the expected directory name
        assert result.endswith(os.path.join(".worktrees", "pipeline-abc123"))
        # The branch was created
        branches = subprocess.run(
            ["git", "branch", "--list", "worca/my-feature-abc123"],
            cwd=str(git_repo), capture_output=True, text=True,
        )
        assert "worca/my-feature-abc123" in branches.stdout

    def test_uses_custom_base_branch(self, git_repo):
        from worca.utils.git import create_pipeline_worktree

        # Create a second branch and add a commit
        subprocess.run(["git", "checkout", "-b", "develop"], cwd=str(git_repo), check=True, capture_output=True)
        (git_repo / "extra.txt").write_text("extra")
        subprocess.run(["git", "add", "."], cwd=str(git_repo), check=True, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "develop commit"],
            cwd=str(git_repo), check=True, capture_output=True,
            env={**os.environ, "GIT_AUTHOR_NAME": "test", "GIT_AUTHOR_EMAIL": "t@t",
                 "GIT_COMMITTER_NAME": "test", "GIT_COMMITTER_EMAIL": "t@t"},
        )
        develop_sha = subprocess.run(
            ["git", "rev-parse", "develop"],
            cwd=str(git_repo), capture_output=True, text=True,
        ).stdout.strip()
        subprocess.run(["git", "checkout", "main"], cwd=str(git_repo), check=True, capture_output=True)

        wt_path = create_pipeline_worktree("run2", "dev-feat", base_branch="develop")
        assert os.path.isdir(wt_path)

        # The worktree HEAD should match develop's SHA
        wt_sha = subprocess.run(
            ["git", "-C", wt_path, "rev-parse", "HEAD"],
            capture_output=True, text=True,
        ).stdout.strip()
        assert wt_sha == develop_sha

    def test_returns_empty_on_failure(self, git_repo):
        from worca.utils.git import create_pipeline_worktree

        # Create the first worktree so the run_id is taken
        create_pipeline_worktree("dup", "slug")
        # Second call with same run_id should fail (path already exists)
        result = create_pipeline_worktree("dup", "slug2")
        assert result == ""


# ---------------------------------------------------------------------------
# remove_pipeline_worktree
# ---------------------------------------------------------------------------

class TestRemovePipelineWorktree:

    def test_removes_worktree_and_branch(self, git_repo):
        from worca.utils.git import create_pipeline_worktree, remove_pipeline_worktree

        wt_path = create_pipeline_worktree("rm1", "cleanup")
        assert os.path.isdir(wt_path)

        ok = remove_pipeline_worktree(wt_path)
        assert ok is True

        # Directory should be gone
        assert not os.path.isdir(wt_path)
        # Branch should be deleted
        branches = subprocess.run(
            ["git", "branch", "--list", "worca/cleanup-rm1"],
            cwd=str(git_repo), capture_output=True, text=True,
        )
        assert "worca/cleanup-rm1" not in branches.stdout

    def test_returns_false_for_nonexistent_path(self, git_repo):
        from worca.utils.git import remove_pipeline_worktree

        ok = remove_pipeline_worktree("/tmp/nonexistent-worktree-xyz")
        assert ok is False


# ---------------------------------------------------------------------------
# list_pipeline_worktrees
# ---------------------------------------------------------------------------

class TestListPipelineWorktrees:

    def test_returns_correct_entries(self, git_repo):
        from worca.utils.git import create_pipeline_worktree, list_pipeline_worktrees

        create_pipeline_worktree("list1", "feat-a")
        create_pipeline_worktree("list2", "feat-b")

        entries = list_pipeline_worktrees()
        assert len(entries) == 2

        paths = {e["path"] for e in entries}
        branches = {e["branch"] for e in entries}

        # Each entry has the three required keys
        for entry in entries:
            assert "path" in entry
            assert "branch" in entry
            assert "commit" in entry

        assert any("pipeline-list1" in p for p in paths)
        assert any("pipeline-list2" in p for p in paths)
        assert "worca/feat-a-list1" in branches
        assert "worca/feat-b-list2" in branches

    def test_filters_non_pipeline_worktrees(self, git_repo):
        from worca.utils.git import create_pipeline_worktree, list_pipeline_worktrees

        # Create one pipeline worktree
        create_pipeline_worktree("only1", "only")

        # Create a non-pipeline worktree manually
        non_pipeline_path = os.path.join(str(git_repo), "other-worktree")
        subprocess.run(
            ["git", "worktree", "add", "-b", "other-branch", non_pipeline_path, "HEAD"],
            cwd=str(git_repo), check=True, capture_output=True,
        )

        entries = list_pipeline_worktrees()
        # Should only contain the pipeline worktree, not the other one
        assert len(entries) == 1
        assert "pipeline-only1" in entries[0]["path"]

    def test_returns_empty_when_no_worktrees(self, git_repo):
        from worca.utils.git import list_pipeline_worktrees

        entries = list_pipeline_worktrees()
        assert entries == []
