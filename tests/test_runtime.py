"""Tests for worca.utils.runtime — validate_runtime helper."""
import os

import pytest


def test_validate_runtime_success_via_pkg_store(tmp_path, monkeypatch):
    """validate_runtime passes when the shared pkg store worca/ dir exists (W-077)."""
    monkeypatch.setenv("WORCA_HOME", str(tmp_path / "wh"))
    monkeypatch.chdir(tmp_path)
    from worca.utils.paths import pkg_dir
    from pathlib import Path

    pkg_worca = Path(pkg_dir()) / "worca"
    pkg_worca.mkdir(parents=True)

    from worca.utils.runtime import validate_runtime

    validate_runtime()  # must not raise


def test_validate_runtime_success_legacy_claude_worca(tmp_path, monkeypatch):
    """validate_runtime still passes when the legacy .claude/worca/ dir exists."""
    monkeypatch.setenv("WORCA_HOME", str(tmp_path / "wh"))  # empty pkg store
    (tmp_path / ".claude" / "worca").mkdir(parents=True)
    monkeypatch.chdir(tmp_path)

    from worca.utils.runtime import validate_runtime

    validate_runtime()  # must not raise


def test_validate_runtime_missing_raises_systemexit(tmp_path, monkeypatch):
    """validate_runtime raises SystemExit(1) when neither pkg store nor .claude/worca/ exists."""
    monkeypatch.setenv("WORCA_HOME", str(tmp_path / "wh"))  # empty pkg store
    monkeypatch.chdir(tmp_path)

    from worca.utils.runtime import validate_runtime

    with pytest.raises(SystemExit) as exc_info:
        validate_runtime()
    assert exc_info.value.code == 1


def test_validate_runtime_error_message_on_stderr(tmp_path, monkeypatch, capsys):
    """The error message names the missing path and the fix command."""
    monkeypatch.setenv("WORCA_HOME", str(tmp_path / "wh"))  # empty pkg store
    monkeypatch.chdir(tmp_path)

    from worca.utils.runtime import validate_runtime

    with pytest.raises(SystemExit):
        validate_runtime()

    err = capsys.readouterr().err
    assert "worca runtime not found" in err
    assert os.path.join(".claude", "worca") in err
    assert "worca init" in err


# ---------------------------------------------------------------------------
# copy_claude_config — worca/ runtime always overwrites; everything else
# keeps tracked-files-win
# ---------------------------------------------------------------------------


def _write(path, text):
    import os
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as fh:
        fh.write(text)


def test_copy_claude_config_overwrites_worca_runtime(tmp_path):
    """A stale committed `.claude/worca/` file in the worktree must be
    overwritten by the project's current runtime — otherwise the spawned
    run_pipeline.py is a different version than the launcher."""
    from worca.utils.runtime import copy_claude_config

    src = tmp_path / "project" / ".claude"
    dst = tmp_path / "worktree" / ".claude"
    _write(str(src / "worca" / "scripts" / "run_pipeline.py"), "NEW runtime")
    # Worktree already has a stale committed copy (git placed it).
    _write(str(dst / "worca" / "scripts" / "run_pipeline.py"), "STALE committed")

    copy_claude_config(str(src), str(dst))

    with open(dst / "worca" / "scripts" / "run_pipeline.py") as fh:
        assert fh.read() == "NEW runtime"  # overwritten


def test_copy_claude_config_preserves_non_runtime_tracked_files(tmp_path):
    """Outside `.claude/worca/`, tracked-files-win still holds — a project
    may legitimately commit customised agents / hooks / settings.json."""
    from worca.utils.runtime import copy_claude_config

    src = tmp_path / "project" / ".claude"
    dst = tmp_path / "worktree" / ".claude"
    _write(str(src / "agents" / "planner.md"), "project default")
    _write(str(dst / "agents" / "planner.md"), "worktree-customised")

    copy_claude_config(str(src), str(dst))

    with open(dst / "agents" / "planner.md") as fh:
        assert fh.read() == "worktree-customised"  # preserved


def test_copy_claude_config_copies_missing_files(tmp_path):
    """Files absent in the worktree are copied regardless of subtree."""
    from worca.utils.runtime import copy_claude_config

    src = tmp_path / "project" / ".claude"
    dst = tmp_path / "worktree" / ".claude"
    _write(str(src / "settings.json"), "{}")
    _write(str(src / "worca" / "__init__.py"), "version")

    copy_claude_config(str(src), str(dst))

    assert (dst / "settings.json").exists()
    assert (dst / "worca" / "__init__.py").exists()
