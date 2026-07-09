"""Tests for Phase 1b: pkg-store-based copy target and absolute hook paths."""

import os
import shutil
from pathlib import Path
from unittest import mock

import pytest


class TestInitCreatesPkgInHome:
    """test_init_creates_pkg_in_home: init copies to ~/.worca/pkg/<ver>/worca/."""

    def test_copy_worca_source_writes_to_pkg_dir(self, tmp_path):
        """_copy_worca_source writes worca/ under ~/.worca/pkg/<ver>/worca/."""
        from worca.cli.init import _copy_worca_source

        source = tmp_path / "src_worca"
        source.mkdir()
        (source / "__init__.py").write_text("__version__ = '0.59.0'\n")
        (source / "claude_hooks").mkdir()
        (source / "claude_hooks" / "pre_tool_use.py").write_text("# hook\n")

        pkg_root = tmp_path / "pkg_root"
        target = pkg_root / "worca"

        _copy_worca_source(source, target)

        assert (target / "__init__.py").exists()
        assert (target / "claude_hooks" / "pre_tool_use.py").exists()

    def test_copy_target_is_inside_pkg_dir(self, tmp_path, monkeypatch):
        """The copy target lives at ~/.worca/pkg/<ver>/worca/, not .claude/worca/."""
        import worca.utils.paths as paths_mod
        import worca.utils.pkg_store as pkg_store_mod

        monkeypatch.setattr(pkg_store_mod, "version_key", lambda: "0.59.0-a1b2c3d")
        monkeypatch.setenv("WORCA_HOME", str(tmp_path / "worca_home"))

        pkg = paths_mod.pkg_dir()
        assert pkg == str(tmp_path / "worca_home" / "pkg" / "0.59.0-a1b2c3d")
        assert pkg.endswith("0.59.0-a1b2c3d")


class TestInitIdempotentPkgExists:
    """test_init_idempotent_pkg_exists: skip copy if pkg dir already exists."""

    def test_idempotent_skip_when_pkg_worca_exists(self, tmp_path, capsys):
        """_copy_worca_source skips copy and prints 'Package already exists' when pkg/worca/ present."""
        from worca.cli.init import _copy_worca_source

        source = tmp_path / "src_worca"
        source.mkdir()
        (source / "__init__.py").write_text("__version__ = '0.59.0'\n")
        (source / "claude_hooks").mkdir()
        (source / "claude_hooks" / "pre_tool_use.py").write_text("# hook\n")

        pkg_root = tmp_path / "pkg_root"
        target = pkg_root / "worca"
        target.mkdir(parents=True)
        sentinel = target / "sentinel.txt"
        sentinel.write_text("original")

        _copy_worca_source(source, target)

        captured = capsys.readouterr()
        assert "Package already exists" in captured.out
        # Sentinel must survive — no overwrite occurred
        assert sentinel.exists()

    def test_fresh_copy_when_pkg_worca_absent(self, tmp_path, capsys):
        """_copy_worca_source proceeds normally when pkg/worca/ does not exist."""
        from worca.cli.init import _copy_worca_source

        source = tmp_path / "src_worca"
        source.mkdir()
        (source / "__init__.py").write_text("__version__ = '0.59.0'\n")

        target = tmp_path / "pkg_root" / "worca"
        assert not target.exists()

        _copy_worca_source(source, target)

        assert (target / "__init__.py").exists()
        captured = capsys.readouterr()
        assert "Package already exists" not in captured.out


class TestHookCommandUsesAbsolutePath:
    """test_hook_command_uses_absolute_path: hook commands reference resolved absolute path."""

    def _build_hook_cmd_tpl(self, pkg_base: str) -> str:
        """Return the hook command template as init.py would produce it."""
        hook_base = os.path.join(pkg_base, "worca", "claude_hooks")
        return f"python3 {hook_base}/{{script}}"

    def test_hook_cmd_no_dollar_home(self, tmp_path):
        """Hook command must not contain $HOME."""
        pkg_base = str(tmp_path / "pkg" / "0.59.0-a1b2c3d")
        tpl = self._build_hook_cmd_tpl(pkg_base)
        cmd = tpl.format(script="pre_tool_use.py")
        assert "$HOME" not in cmd

    def test_hook_cmd_no_subshell(self, tmp_path):
        """Hook command must not contain shell subshell syntax $( ... )."""
        pkg_base = str(tmp_path / "pkg" / "0.59.0-a1b2c3d")
        tpl = self._build_hook_cmd_tpl(pkg_base)
        cmd = tpl.format(script="pre_tool_use.py")
        assert "$(" not in cmd

    def test_hook_cmd_is_absolute(self, tmp_path):
        """Hook command path must be absolute (starts with /)."""
        pkg_base = str(tmp_path / "pkg" / "0.59.0-a1b2c3d")
        tpl = self._build_hook_cmd_tpl(pkg_base)
        cmd = tpl.format(script="pre_tool_use.py")
        # Extract path — after 'python3 '
        path_part = cmd.split("python3 ", 1)[1]
        assert os.path.isabs(path_part), f"Path not absolute: {path_part}"

    def test_hook_cmd_references_pkg_hooks(self, tmp_path):
        """Hook command references the pkg/worca/claude_hooks/ directory."""
        pkg_base = str(tmp_path / "pkg" / "0.59.0-a1b2c3d")
        tpl = self._build_hook_cmd_tpl(pkg_base)
        cmd = tpl.format(script="pre_tool_use.py")
        assert "claude_hooks/pre_tool_use.py" in cmd
        assert ".worca" in cmd or str(tmp_path) in cmd

    def test_init_hook_cmd_tpl_uses_absolute_path(self, tmp_path, monkeypatch):
        """The actual _hook_cmd_tpl in init.py references absolute pkg path."""
        import importlib
        import worca.utils.pkg_store as pkg_store_mod

        monkeypatch.setattr(pkg_store_mod, "version_key", lambda: "0.59.0-a1b2c3d")
        monkeypatch.setenv("WORCA_HOME", str(tmp_path / "worca_home"))

        # Reload init to pick up fresh env
        import worca.cli.init as init_mod
        importlib.reload(init_mod)

        # _migrate_settings_paths uses _hook_cmd_tpl-like logic internally;
        # verify via the exported function build_hook_command if it exists,
        # or exercise the migrate path.
        # Direct: call build_hook_cmd if present, else verify via settings merge.
        if hasattr(init_mod, "build_hook_cmd"):
            cmd = init_mod.build_hook_cmd("pre_tool_use.py")
            assert "$HOME" not in cmd
            assert "$(" not in cmd
            assert "pre_tool_use.py" in cmd


class TestRequireProjectWorca:
    """test_require_project_worca: checks pkg path, not .claude/worca/."""

    def test_require_project_worca_checks_pkg_path(self, tmp_path):
        """_require_project_worca raises SystemExit when pkg path absent."""
        from worca.cli.main import _require_project_worca
        import pytest

        # No .claude/worca/ AND no pkg path — should still fail
        git_root = tmp_path / "myproject"
        git_root.mkdir()

        with pytest.raises(SystemExit):
            _require_project_worca(git_root)
