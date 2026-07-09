"""Tests for pkg_store.py — versioned package store utilities."""

import os
from unittest import mock

import pytest

from worca.utils import pkg_store


class TestVersionKeyFormat:
    """test_version_key_format: semver + short hash computed correctly."""

    def test_version_key_with_git_hash(self):
        """Version key format: <semver>-<short-hash> when git available."""
        with mock.patch("worca.utils.pkg_store._get_git_short_hash", return_value="a1b2c3d"):
            with mock.patch("worca.utils.pkg_store._get_semver", return_value="0.59.0"):
                key = pkg_store.version_key()
        assert key == "0.59.0-a1b2c3d"

    def test_version_key_without_git_hash(self):
        """Version key omits hash suffix when git unavailable."""
        with mock.patch("worca.utils.pkg_store._get_git_short_hash", return_value=None):
            with mock.patch("worca.utils.pkg_store._get_semver", return_value="0.59.0"):
                key = pkg_store.version_key()
        assert key == "0.59.0"

    def test_version_key_hash_length(self):
        """Git short hash must be 7 characters."""
        with mock.patch("worca.utils.pkg_store._get_git_short_hash", return_value="abc1234"):
            with mock.patch("worca.utils.pkg_store._get_semver", return_value="1.0.0"):
                key = pkg_store.version_key()
        assert key == "1.0.0-abc1234"
        parts = key.split("-")
        assert len(parts[-1]) == 7

    def test_get_semver_reads_from_init(self):
        """_get_semver reads from worca.__version__."""
        semver = pkg_store._get_semver()
        import worca
        assert semver == worca.__version__

    def test_get_git_short_hash_returns_7_chars_or_none(self):
        """_get_git_short_hash returns 7-char hex string or None."""
        result = pkg_store._get_git_short_hash()
        if result is not None:
            assert len(result) == 7
            assert all(c in "0123456789abcdef" for c in result)


class TestPkgDir:
    """Tests for pkg_dir() helper in paths.py."""

    def test_pkg_dir_uses_version_key(self, tmp_path):
        """pkg_dir() returns path under ~/.worca/pkg/<version_key>/."""
        with mock.patch("worca.utils.paths.worca_home", return_value=str(tmp_path)):
            with mock.patch("worca.utils.pkg_store.version_key", return_value="0.59.0-abc1234"):
                from worca.utils import paths
                result = paths.pkg_dir()
        assert result == str(tmp_path / "pkg" / "0.59.0-abc1234")

    def test_pkg_dir_with_explicit_version_key(self, tmp_path):
        """pkg_dir(version_key=...) uses the given key."""
        with mock.patch("worca.utils.paths.worca_home", return_value=str(tmp_path)):
            from worca.utils import paths
            result = paths.pkg_dir(version_key="1.2.3-deadbee")
        assert result == str(tmp_path / "pkg" / "1.2.3-deadbee")

    def test_pkg_dir_resolves_every_call(self, tmp_path, monkeypatch):
        """pkg_dir() resolves worca_home on each call (no module-level constant)."""
        monkeypatch.setenv("WORCA_HOME", str(tmp_path / "a"))
        from worca.utils import paths
        r1 = paths.pkg_dir(version_key="0.1.0")
        monkeypatch.setenv("WORCA_HOME", str(tmp_path / "b"))
        r2 = paths.pkg_dir(version_key="0.1.0")
        assert r1 != r2


class TestProjectConfigDir:
    """Tests for project_config_dir() helper in paths.py."""

    def test_project_config_dir_path(self, tmp_path):
        """project_config_dir(slug) returns ~/.worca/projects/<slug>/."""
        with mock.patch("worca.utils.paths.worca_home", return_value=str(tmp_path)):
            from worca.utils import paths
            result = paths.project_config_dir("my-project")
        assert result == str(tmp_path / "projects" / "my-project")

    def test_project_config_dir_resolves_every_call(self, tmp_path, monkeypatch):
        """project_config_dir() re-reads env on each call."""
        monkeypatch.setenv("WORCA_HOME", str(tmp_path / "x"))
        from worca.utils import paths
        r1 = paths.project_config_dir("proj")
        monkeypatch.setenv("WORCA_HOME", str(tmp_path / "y"))
        r2 = paths.project_config_dir("proj")
        assert r1 != r2


class TestGCRemovesUnreferencedVersions:
    """test_gc_removes_unreferenced_versions: orphan pkg dirs are deleted."""

    def _make_pkg_store(self, tmp_path, versions):
        pkg_dir = tmp_path / "pkg"
        pkg_dir.mkdir(parents=True)
        for v in versions:
            (pkg_dir / v).mkdir()
        return pkg_dir

    def _make_projects_d(self, tmp_path, referenced_versions):
        projects_d = tmp_path / "projects.d"
        projects_d.mkdir(parents=True)
        for i, ver in enumerate(referenced_versions):
            entry = {"name": f"proj{i}", "path": f"/proj{i}", "worcaPkgVersion": ver}
            (projects_d / f"proj{i}.json").write_text(
                __import__("json").dumps(entry), encoding="utf-8"
            )
        return projects_d

    def test_gc_removes_unreferenced_versions(self, tmp_path, monkeypatch):
        """GC deletes pkg dirs not referenced by any projects.d entry."""
        import json
        monkeypatch.setenv("WORCA_HOME", str(tmp_path))
        pkg_dir = self._make_pkg_store(tmp_path, ["0.59.0-aaa1111", "0.58.0-bbb2222"])
        self._make_projects_d(tmp_path, ["0.59.0-aaa1111"])  # 0.58.0 is orphan

        result = pkg_store.gc_pkg_store(dry_run=False)

        assert not (pkg_dir / "0.58.0-bbb2222").exists()
        assert (pkg_dir / "0.59.0-aaa1111").exists()
        assert "0.58.0-bbb2222" in result["removed"]

    def test_gc_keeps_referenced_versions(self, tmp_path, monkeypatch):
        """GC does not delete pkg dirs that are referenced by any project."""
        import json
        monkeypatch.setenv("WORCA_HOME", str(tmp_path))
        pkg_dir = self._make_pkg_store(tmp_path, ["0.59.0-aaa1111", "0.60.0-ccc3333"])
        self._make_projects_d(tmp_path, ["0.59.0-aaa1111", "0.60.0-ccc3333"])

        result = pkg_store.gc_pkg_store(dry_run=False)

        assert (pkg_dir / "0.59.0-aaa1111").exists()
        assert (pkg_dir / "0.60.0-ccc3333").exists()
        assert result["removed"] == []

    def test_gc_skips_running_pipeline_versions(self, tmp_path, monkeypatch):
        """GC must not remove pkg versions referenced by a running pipeline."""
        import json
        monkeypatch.setenv("WORCA_HOME", str(tmp_path))
        # 0.58.0 is unreferenced by registry, but a running pipeline uses it
        pkg_dir = self._make_pkg_store(tmp_path, ["0.59.0-aaa1111", "0.58.0-bbb2222"])
        # projects.d only references 0.59.0
        self._make_projects_d(tmp_path, ["0.59.0-aaa1111"])

        # Simulate a running pipeline in a project that uses 0.58.0
        proj_dir = tmp_path / "myproject"
        proj_dir.mkdir()
        pipelines_d = proj_dir / ".worca" / "multi" / "pipelines.d"
        pipelines_d.mkdir(parents=True)
        pipeline_entry = {
            "run_id": "run-001",
            "status": "running",
            "worcaPkgVersion": "0.58.0-bbb2222",
        }
        (pipelines_d / "run-001.json").write_text(json.dumps(pipeline_entry))

        # Register that project so GC scans it
        projects_d = tmp_path / "projects.d"
        proj_reg = {
            "name": "myproject",
            "path": str(proj_dir),
            "worcaDir": str(proj_dir / ".worca"),
            "worcaPkgVersion": "0.59.0-aaa1111",
        }
        (projects_d / "myproject.json").write_text(json.dumps(proj_reg))

        result = pkg_store.gc_pkg_store(dry_run=False)

        # 0.58.0 must be preserved because of the running pipeline
        assert (pkg_dir / "0.58.0-bbb2222").exists()
        assert "0.58.0-bbb2222" not in result["removed"]

    def test_gc_dry_run(self, tmp_path, monkeypatch):
        """GC dry_run lists orphans but does not delete anything."""
        monkeypatch.setenv("WORCA_HOME", str(tmp_path))
        pkg_dir = self._make_pkg_store(tmp_path, ["0.59.0-aaa1111", "0.58.0-bbb2222"])
        self._make_projects_d(tmp_path, ["0.59.0-aaa1111"])

        result = pkg_store.gc_pkg_store(dry_run=True)

        # Directory must still exist
        assert (pkg_dir / "0.58.0-bbb2222").exists()
        assert "0.58.0-bbb2222" in result["would_remove"]
        assert result["removed"] == []

    def test_gc_keep_latest_n(self, tmp_path, monkeypatch):
        """GC keep_latest=N preserves the N most recent pkg dirs regardless of references."""
        import json
        monkeypatch.setenv("WORCA_HOME", str(tmp_path))
        # Alphabetically sorted: older versions come first
        versions = ["0.57.0-aaa0000", "0.58.0-bbb1111", "0.59.0-ccc2222"]
        pkg_dir = self._make_pkg_store(tmp_path, versions)
        self._make_projects_d(tmp_path, [])  # nothing referenced

        result = pkg_store.gc_pkg_store(dry_run=False, keep_latest=2)

        # The 2 most recent (by sorted order) must survive
        assert (pkg_dir / "0.58.0-bbb1111").exists()
        assert (pkg_dir / "0.59.0-ccc2222").exists()
        # The oldest is removed
        assert not (pkg_dir / "0.57.0-aaa0000").exists()
        assert "0.57.0-aaa0000" in result["removed"]
