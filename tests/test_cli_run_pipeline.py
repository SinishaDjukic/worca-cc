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
    def test_returns_path_when_exists(self, tmp_path, monkeypatch):
        monkeypatch.setenv("WORCA_HOME", str(tmp_path / "wh"))
        from worca.utils.paths import pkg_dir
        from pathlib import Path
        pkg_worca = Path(pkg_dir()) / "worca"
        pkg_worca.mkdir(parents=True)
        result = _require_project_worca(tmp_path)
        assert result == pkg_worca

    def test_fails_when_missing(self, tmp_path, monkeypatch):
        monkeypatch.setenv("WORCA_HOME", str(tmp_path / "wh"))
        with pytest.raises(SystemExit):
            _require_project_worca(tmp_path)


class TestCmdRun:
    def test_run_builds_correct_command(self, tmp_path, monkeypatch):
        """worca run delegates to pkg scripts/run_pipeline.py in the shared pkg dir."""
        (tmp_path / ".git").mkdir()
        monkeypatch.setenv("WORCA_HOME", str(tmp_path / "wh"))
        monkeypatch.chdir(tmp_path)
        from worca.utils.paths import pkg_dir
        from pathlib import Path
        pkg_scripts = Path(pkg_dir()) / "worca" / "scripts"
        pkg_scripts.mkdir(parents=True)
        (pkg_scripts / "run_pipeline.py").write_text("")

        with patch("subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0)
            from worca.cli.main import main
            with pytest.raises(SystemExit) as exc_info:
                main(["run", "--prompt", "hello"])

            assert exc_info.value.code == 0
            call_args = mock_run.call_args[0][0]
            assert "run_pipeline.py" in call_args[1]
            assert str(pkg_scripts) in call_args[1], (
                f"Script path {call_args[1]!r} should be under pkg dir {pkg_scripts}"
            )
            assert ".claude" not in call_args[1], (
                "Script path must not reference old .claude/worca/scripts layout"
            )
            assert "--prompt" in call_args
            assert "hello" in call_args

    def test_run_fails_without_worca(self, tmp_path, monkeypatch):
        """worca run fails if pkg worca dir doesn't exist."""
        (tmp_path / ".git").mkdir()
        monkeypatch.setenv("WORCA_HOME", str(tmp_path / "wh"))
        monkeypatch.chdir(tmp_path)
        from worca.cli.main import main
        with pytest.raises(SystemExit):
            main(["run", "--prompt", "hello"])


class TestCmdRunWorktree:
    """`worca run --worktree` dispatch + validation."""

    def _scaffold(self, tmp_path, monkeypatch, *, with_worktree_script: bool = True):
        (tmp_path / ".git").mkdir()
        monkeypatch.setenv("WORCA_HOME", str(tmp_path / "wh"))
        monkeypatch.chdir(tmp_path)
        from worca.utils.paths import pkg_dir
        from pathlib import Path
        scripts = Path(pkg_dir()) / "worca" / "scripts"
        scripts.mkdir(parents=True)
        (scripts / "run_pipeline.py").write_text("")
        if with_worktree_script:
            (scripts / "run_worktree.py").write_text("")

    def test_worktree_dispatches_to_run_worktree_script(self, tmp_path, monkeypatch):
        """--worktree picks run_worktree.py when present and forwards core args."""
        self._scaffold(tmp_path, monkeypatch)
        with patch("subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0)
            from worca.cli.main import main
            with pytest.raises(SystemExit) as exc_info:
                main(["run", "--worktree", "--source", "gh:issue:127",
                      "--template", "bugfix"])
        assert exc_info.value.code == 0
        argv = mock_run.call_args[0][0]
        assert "run_worktree.py" in argv[1]
        assert "run_pipeline.py" not in argv[1]
        assert "--source" in argv and "gh:issue:127" in argv
        assert "--template" in argv and "bugfix" in argv

    def test_worktree_forwards_branch_and_guide(self, tmp_path, monkeypatch):
        """--branch and --guide are only forwarded under --worktree."""
        self._scaffold(tmp_path, monkeypatch)
        with patch("subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0)
            from worca.cli.main import main
            with pytest.raises(SystemExit):
                main(["run", "--worktree", "--prompt", "x",
                      "--branch", "develop", "--guide", "spec.md", "--guide", "notes.md"])
        argv = mock_run.call_args[0][0]
        assert argv[argv.index("--branch") + 1] == "develop"
        guides = [argv[i + 1] for i, a in enumerate(argv) if a == "--guide"]
        assert guides == ["spec.md", "notes.md"]

    def test_worktree_falls_back_when_script_missing(self, tmp_path, monkeypatch, capsys):
        """If run_worktree.py is absent, fall back to in-place run_pipeline.py with a warning."""
        self._scaffold(tmp_path, monkeypatch, with_worktree_script=False)
        with patch("subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0)
            from worca.cli.main import main
            with pytest.raises(SystemExit):
                main(["run", "--worktree", "--prompt", "x"])
        argv = mock_run.call_args[0][0]
        assert "run_pipeline.py" in argv[1]
        assert "falling back" in capsys.readouterr().err.lower()

    def test_branch_without_worktree_rejected(self, tmp_path, monkeypatch, capsys):
        """--branch without --worktree exits 2 with a clear error."""
        self._scaffold(tmp_path, monkeypatch)
        from worca.cli.main import main
        with pytest.raises(SystemExit) as exc_info:
            main(["run", "--prompt", "x", "--branch", "develop"])
        assert exc_info.value.code == 2
        assert "--branch requires --worktree" in capsys.readouterr().err

    def test_guide_without_worktree_forwarded(self, tmp_path, monkeypatch):
        """--guide without --worktree is forwarded to the in-place script."""
        self._scaffold(tmp_path, monkeypatch)
        with patch("subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0)
            from worca.cli.main import main
            with pytest.raises(SystemExit):
                main(["run", "--prompt", "x", "--guide", "spec.md", "--guide", "notes.md"])
        argv = mock_run.call_args[0][0]
        assert "run_pipeline.py" in argv[1]
        guides = [argv[i + 1] for i, a in enumerate(argv) if a == "--guide"]
        assert guides == ["spec.md", "notes.md"]

    def test_guide_help_text_no_worktree_only(self):
        """--guide help string should not say '--worktree only'."""
        from worca.cli.main import create_parser
        parser = create_parser()
        run_parser = parser._subparsers._group_actions[0].choices["run"]
        guide_action = [a for a in run_parser._actions if "--guide" in a.option_strings][0]
        assert "--worktree only" not in guide_action.help

    def test_worktree_with_resume_rejected(self, tmp_path, monkeypatch, capsys):
        """--worktree + --resume is nonsensical (resume must use original tree)."""
        self._scaffold(tmp_path, monkeypatch)
        from worca.cli.main import main
        with pytest.raises(SystemExit) as exc_info:
            main(["run", "--worktree", "--resume"])
        assert exc_info.value.code == 2
        assert "resume" in capsys.readouterr().err.lower()

    def test_guide_with_resume_warns(self, tmp_path, monkeypatch, capsys):
        """--guide + --resume warns it is ignored (guide is restored from state)."""
        self._scaffold(tmp_path, monkeypatch)
        with patch("subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0)
            from worca.cli.main import main
            with pytest.raises(SystemExit):
                main(["run", "--resume", "--guide", "spec.md"])
        assert "--guide is ignored with --resume" in capsys.readouterr().err
        argv = mock_run.call_args[0][0]
        assert "run_pipeline.py" in argv[1]

    def test_no_worktree_flag_still_uses_run_pipeline(self, tmp_path, monkeypatch):
        """Default behaviour unchanged when --worktree is absent."""
        self._scaffold(tmp_path, monkeypatch)
        with patch("subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0)
            from worca.cli.main import main
            with pytest.raises(SystemExit):
                main(["run", "--prompt", "hello"])
        argv = mock_run.call_args[0][0]
        assert "run_pipeline.py" in argv[1]
        assert "run_worktree.py" not in argv[1]


class TestForceTemplateChangeFlag:
    """--force-template-change is accepted and forwarded to the subprocess."""

    def _scaffold(self, tmp_path, monkeypatch):
        (tmp_path / ".git").mkdir()
        monkeypatch.setenv("WORCA_HOME", str(tmp_path / "wh"))
        monkeypatch.chdir(tmp_path)
        from worca.utils.paths import pkg_dir
        from pathlib import Path
        scripts = Path(pkg_dir()) / "worca" / "scripts"
        scripts.mkdir(parents=True)
        (scripts / "run_pipeline.py").write_text("")

    def test_force_template_change_accepted_by_parser(self):
        from worca.cli.main import create_parser
        parser = create_parser()
        args = parser.parse_args(["run", "--template", "t1", "--force-template-change"])
        assert args.force_template_change is True

    def test_force_template_change_defaults_false(self):
        from worca.cli.main import create_parser
        parser = create_parser()
        args = parser.parse_args(["run", "--template", "t1"])
        assert args.force_template_change is False

    def test_force_template_change_forwarded_to_subprocess(self, tmp_path, monkeypatch):
        self._scaffold(tmp_path, monkeypatch)
        with patch("subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0)
            from worca.cli.main import main
            with pytest.raises(SystemExit):
                main(["run", "--template", "t1", "--force-template-change"])
        argv = mock_run.call_args[0][0]
        assert "--force-template-change" in argv

    def test_force_template_change_not_forwarded_when_absent(self, tmp_path, monkeypatch):
        self._scaffold(tmp_path, monkeypatch)
        with patch("subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0)
            from worca.cli.main import main
            with pytest.raises(SystemExit):
                main(["run", "--template", "t1"])
        argv = mock_run.call_args[0][0]
        assert "--force-template-change" not in argv

    def test_template_still_forwarded_alongside_force_flag(self, tmp_path, monkeypatch):
        self._scaffold(tmp_path, monkeypatch)
        with patch("subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0)
            from worca.cli.main import main
            with pytest.raises(SystemExit):
                main(["run", "--template", "bugfix", "--force-template-change"])
        argv = mock_run.call_args[0][0]
        assert "--template" in argv
        assert argv[argv.index("--template") + 1] == "bugfix"
        assert "--force-template-change" in argv
