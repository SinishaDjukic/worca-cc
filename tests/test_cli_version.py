"""Tests for worca version handling."""

import worca
from worca.cli.init import _read_version
from pathlib import Path


def test_package_has_version():
    """worca package exposes __version__."""
    assert hasattr(worca, "__version__")
    assert isinstance(worca.__version__, str)
    assert "." in worca.__version__


def test_version_matches_src():
    """Version in src/worca/__init__.py matches the importable version."""
    src_dir = Path(__file__).parent.parent / "src" / "worca"
    file_version = _read_version(src_dir)
    assert file_version == worca.__version__


def test_version_format():
    """Version follows semver-ish format (X.Y.Z)."""
    parts = worca.__version__.split(".")
    assert len(parts) >= 2
    assert all(p.isdigit() for p in parts[:2])
