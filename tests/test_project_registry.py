"""Tests for worca.utils.project_registry (slugify + auto_register_project)."""

import json
import os
import sys
from unittest.mock import patch

import pytest

# Add the .claude directory to sys.path so we can import worca modules
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '.claude'))
from worca.utils.project_registry import auto_register_project, slugify


# ---------------------------------------------------------------------------
# TestSlugify
# ---------------------------------------------------------------------------


class TestSlugify:
    def test_spaces_become_hyphens(self):
        assert slugify("My Project") == "my-project"

    def test_underscores_preserved(self):
        assert slugify("foo_bar") == "foo_bar"

    def test_uppercase_lowered(self):
        assert slugify("CAPS") == "caps"

    def test_collapses_consecutive_hyphens(self):
        assert slugify("a--b--c") == "a-b-c"

    def test_long_name_truncated_to_64(self):
        long_name = "a" * 200
        result = slugify(long_name)
        assert len(result) == 64
        assert result == "a" * 64


# ---------------------------------------------------------------------------
# TestAutoRegisterProject
# ---------------------------------------------------------------------------


class TestAutoRegisterProject:
    def test_creates_projects_d_directory(self, tmp_path):
        """projects.d/ directory is created when it does not exist."""
        prefs = tmp_path / "prefs"
        project = tmp_path / "my-app"
        project.mkdir()

        auto_register_project(str(project), prefs_dir=str(prefs))

        assert (prefs / "projects.d").is_dir()

    def test_writes_json_with_correct_fields(self, tmp_path):
        """The written JSON contains name, path, worcaDir, settingsPath."""
        prefs = tmp_path / "prefs"
        project = tmp_path / "my-app"
        project.mkdir()

        auto_register_project(str(project), prefs_dir=str(prefs))

        entry_path = prefs / "projects.d" / "my-app.json"
        assert entry_path.exists()

        data = json.loads(entry_path.read_text())
        abs_project = str(project.resolve())
        assert data["name"] == "my-app"
        assert data["path"] == abs_project
        assert data["worcaDir"] == os.path.join(abs_project, ".worca")
        assert data["settingsPath"] == os.path.join(
            abs_project, ".claude", "settings.json"
        )

    def test_skips_if_already_registered(self, tmp_path):
        """If the entry file already exists, auto_register_project is a no-op."""
        prefs = tmp_path / "prefs"
        project = tmp_path / "my-app"
        project.mkdir()

        # First registration
        auto_register_project(str(project), prefs_dir=str(prefs))
        entry_path = prefs / "projects.d" / "my-app.json"
        first_mtime = entry_path.stat().st_mtime_ns

        # Second registration should skip
        auto_register_project(str(project), prefs_dir=str(prefs))
        assert entry_path.stat().st_mtime_ns == first_mtime

    def test_non_fatal_on_permission_error(self, tmp_path):
        """Permission errors are swallowed — function must not raise."""
        project = tmp_path / "my-app"
        project.mkdir()

        with patch("worca.utils.project_registry.os.makedirs") as mock_mkdirs:
            mock_mkdirs.side_effect = PermissionError("denied")
            # Must not raise
            auto_register_project(str(project), prefs_dir="/no/such/dir")

    def test_atomic_write_uses_temp_then_rename(self, tmp_path):
        """Verify the write goes through tempfile.mkstemp + os.replace (atomic)."""
        prefs = tmp_path / "prefs"
        project = tmp_path / "my-app"
        project.mkdir()

        with patch("worca.utils.project_registry.os.replace", wraps=os.replace) as mock_replace:
            auto_register_project(str(project), prefs_dir=str(prefs))
            assert mock_replace.call_count == 1

            args = mock_replace.call_args[0]
            tmp_src, final_dst = args[0], args[1]
            # The destination should be the final .json path
            assert final_dst.endswith("my-app.json")
            # The source should have been a .tmp file in the same directory
            assert tmp_src.endswith(".tmp")
