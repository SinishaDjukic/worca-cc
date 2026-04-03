"""Tests for worca run thin launcher (src/worca/cli/main.py cmd_run)."""

import pytest
from unittest.mock import patch, MagicMock

from worca.cli.main import _find_git_root, _require_project_worca


class TestFindGitRoot:
    def test_finds_git_root(self, tmp_path, monkeypatch):
        (tmp_path / ".git").mkdir()
        monkeypatch.chdir(tmp_path)
        assert _find_git_root() == tmp_path.resolve()

    def test_finds_git_root_from_subdirectory(self, tmp_path, monkeypatch):
        (tmp_path / ".git").mkdir()
        subdir = tmp_path / "src" / "deep"
        subdir.mkdir(parents=True)
        monkeypatch.chdir(subdir)
        assert _find_git_root() == tmp_path.resolve()

    def test_fails_outside_git_repo(self, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        with pytest.raises(SystemExit):
            _find_git_root()


class TestRequireProjectWorca:
    def test_returns_path_when_exists(self, tmp_path):
        worca_dir = tmp_path / ".claude" / "worca"
        worca_dir.mkdir(parents=True)
        result = _require_project_worca(tmp_path)
        assert result == worca_dir

    def test_fails_when_missing(self, tmp_path):
        with pytest.raises(SystemExit):
            _require_project_worca(tmp_path)


class TestCmdRun:
    def test_run_builds_correct_command(self, tmp_path, monkeypatch):
        """worca run delegates to project's run_pipeline.py."""
        (tmp_path / ".git").mkdir()
        (tmp_path / ".claude" / "worca" / "scripts").mkdir(parents=True)
        (tmp_path / ".claude" / "worca" / "scripts" / "run_pipeline.py").write_text("")
        monkeypatch.chdir(tmp_path)

        with patch("subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0)
            from worca.cli.main import main
            with pytest.raises(SystemExit) as exc_info:
                main(["run", "--prompt", "hello"])

            assert exc_info.value.code == 0
            call_args = mock_run.call_args[0][0]
            assert "run_pipeline.py" in call_args[1]
            assert "--prompt" in call_args
            assert "hello" in call_args

    def test_run_fails_without_worca(self, tmp_path, monkeypatch):
        """worca run fails if .claude/worca/ doesn't exist."""
        (tmp_path / ".git").mkdir()
        monkeypatch.chdir(tmp_path)
        from worca.cli.main import main
        with pytest.raises(SystemExit):
            main(["run", "--prompt", "hello"])
