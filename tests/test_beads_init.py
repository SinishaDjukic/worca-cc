"""Tests for bd_init (beads.py) and init_worktree_beads (git.py)."""

import os
import subprocess
import tempfile

from unittest.mock import patch, MagicMock

from worca.utils.beads import bd_init
from worca.utils.git import init_worktree_beads


# ---------------------------------------------------------------------------
# bd_init
# ---------------------------------------------------------------------------


class TestBdInit:

    def test_returns_true_on_success(self):
        mock_result = MagicMock()
        mock_result.returncode = 0
        with patch("worca.utils.beads.subprocess.run", return_value=mock_result) as mock_run:
            result = bd_init("/some/path")
        assert result is True
        # Verify bd init was called with the correct cwd
        _, kwargs = mock_run.call_args
        assert kwargs["cwd"] == "/some/path"
        args = mock_run.call_args[0][0]
        assert args[0] == "bd"
        assert args[1] == "init"

    def test_returns_true_with_no_cwd(self):
        mock_result = MagicMock()
        mock_result.returncode = 0
        with patch("worca.utils.beads.subprocess.run", return_value=mock_result) as mock_run:
            result = bd_init()
        assert result is True
        _, kwargs = mock_run.call_args
        assert kwargs["cwd"] is None

    def test_returns_false_on_nonzero_exit(self):
        mock_result = MagicMock()
        mock_result.returncode = 1
        mock_result.stderr = "Error: not a git repo"
        with patch("worca.utils.beads.subprocess.run", return_value=mock_result):
            result = bd_init("/invalid/path")
        assert result is False

    def test_returns_false_on_subprocess_error(self):
        with patch("worca.utils.beads.subprocess.run", side_effect=subprocess.SubprocessError("cmd failed")):
            result = bd_init("/some/path")
        assert result is False

    def test_returns_false_on_os_error(self):
        """OSError covers cases like bd not found or invalid cwd."""
        with patch("worca.utils.beads.subprocess.run", side_effect=OSError("No such file or directory")):
            result = bd_init("/nonexistent/dir")
        assert result is False

    def test_creates_beads_dir_in_temp_directory(self):
        """Integration-style test: if bd is available, verify it actually creates .beads."""
        import shutil
        if not shutil.which("bd"):
            # bd not on PATH -- skip gracefully
            import pytest
            pytest.skip("bd CLI not available")

        with tempfile.TemporaryDirectory() as tmpdir:
            # bd init requires a git repo
            subprocess.run(["git", "init"], cwd=tmpdir, check=True, capture_output=True)
            result = bd_init(cwd=tmpdir)
            assert result is True
            assert os.path.isdir(os.path.join(tmpdir, ".beads"))


# ---------------------------------------------------------------------------
# init_worktree_beads
# ---------------------------------------------------------------------------


class TestInitWorktreeBeads:

    def test_delegates_to_bd_init(self):
        mock_result = MagicMock()
        mock_result.returncode = 0
        with patch("worca.utils.beads.subprocess.run", return_value=mock_result) as mock_run:
            result = init_worktree_beads("/my/worktree")
        assert result is True
        _, kwargs = mock_run.call_args
        assert kwargs["cwd"] == "/my/worktree"

    def test_returns_false_on_failure(self):
        mock_result = MagicMock()
        mock_result.returncode = 1
        with patch("worca.utils.beads.subprocess.run", return_value=mock_result):
            result = init_worktree_beads("/bad/path")
        assert result is False

    def test_works_in_temp_directory(self):
        """Integration-style test with a real temp directory and mocked bd."""
        with tempfile.TemporaryDirectory() as tmpdir:
            mock_result = MagicMock()
            mock_result.returncode = 0
            with patch("worca.utils.beads.subprocess.run", return_value=mock_result) as mock_run:
                result = init_worktree_beads(tmpdir)
            assert result is True
            _, kwargs = mock_run.call_args
            assert kwargs["cwd"] == tmpdir
