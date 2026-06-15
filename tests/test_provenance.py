"""Tests for src/worca/utils/provenance.py — load_provenance and _fmt_provenance."""

import json
from unittest.mock import patch


from worca.utils.provenance import load_provenance, _fmt_provenance


class TestLoadProvenance:
    def test_returns_block_when_file_exists(self, tmp_path):
        block = {"worca_version": "0.57.0", "runtime_source": {"source": "git", "repo": "worca-cc"}}
        (tmp_path / "provenance.json").write_text(json.dumps(block), encoding="utf-8")
        result = load_provenance(tmp_path)
        assert result == block

    def test_missing_file_returns_fallback(self, tmp_path):
        with patch("worca.utils.provenance._live_version", return_value="0.57.0"):
            result = load_provenance(tmp_path)
        assert result["worca_version"] == "0.57.0"
        assert result["runtime_source"] is None

    def test_malformed_file_returns_fallback(self, tmp_path):
        (tmp_path / "provenance.json").write_text("not json", encoding="utf-8")
        with patch("worca.utils.provenance._live_version", return_value="0.57.0"):
            result = load_provenance(tmp_path)
        assert result["worca_version"] == "0.57.0"
        assert result["runtime_source"] is None

    def test_unknown_version_when_import_fails(self, tmp_path):
        with patch("worca.utils.provenance._live_version", return_value=None):
            result = load_provenance(tmp_path)
        assert result["worca_version"] == "unknown"
        assert result["runtime_source"] is None

    def test_never_raises(self, tmp_path):
        # Write unreadable file content — should not raise
        (tmp_path / "provenance.json").write_text("{bad json}", encoding="utf-8")
        result = load_provenance(tmp_path)
        assert "worca_version" in result


class TestFmtProvenance:
    def test_git_case_clean(self):
        block = {
            "worca_version": "0.57.0",
            "runtime_source": {
                "source": "git",
                "repo": "worca-cc",
                "commit": "ba1795b8abcdef1234567890abcdef1234567890",
                "branch": "foo",
                "dirty": False,
            },
        }
        result = _fmt_provenance(block)
        assert result == "worca 0.57.0 (src worca-cc@ba1795b8 [foo])"

    def test_git_case_dirty(self):
        block = {
            "worca_version": "0.57.0",
            "runtime_source": {
                "source": "git",
                "repo": "worca-cc",
                "commit": "ba1795b8abcdef1234567890abcdef1234567890",
                "branch": "main",
                "dirty": True,
            },
        }
        result = _fmt_provenance(block)
        assert result == "worca 0.57.0 (src worca-cc@ba1795b8 [main], dirty)"

    def test_git_case_detached_head(self):
        block = {
            "worca_version": "0.57.0",
            "runtime_source": {
                "source": "git",
                "repo": "worca-cc",
                "commit": "ba1795b8abcdef1234567890abcdef1234567890",
                "branch": None,
                "dirty": False,
            },
        }
        result = _fmt_provenance(block)
        assert result == "worca 0.57.0 (src worca-cc@ba1795b8)"

    def test_pip_case(self):
        block = {
            "worca_version": "0.57.0",
            "runtime_source": {
                "source": "pip",
                "version": "0.57.0",
            },
        }
        result = _fmt_provenance(block)
        assert result == "worca 0.57.0 (pip)"

    def test_degraded_case(self):
        block = {"worca_version": "0.57.0", "runtime_source": None}
        result = _fmt_provenance(block)
        assert result == "worca 0.57.0"

    def test_degraded_unknown_version(self):
        block = {"worca_version": "unknown", "runtime_source": None}
        result = _fmt_provenance(block)
        assert result == "worca unknown"

    def test_none_block(self):
        result = _fmt_provenance(None)
        assert result == "worca unknown"
