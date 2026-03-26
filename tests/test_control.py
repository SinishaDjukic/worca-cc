"""Tests for worca.orchestrator.control — control file protocol utilities."""

import json
from datetime import datetime

import pytest

from worca.orchestrator.control import (
    read_control,
    write_control,
    delete_control,
    control_path,
    VALID_ACTIONS,
)


# --- control_path ---


def test_control_path_returns_correct_path():
    path = control_path("run-abc")
    assert path == ".worca/runs/run-abc/control.json"


def test_control_path_custom_base(tmp_path):
    path = control_path("run-abc", base=str(tmp_path))
    assert path == str(tmp_path / "runs" / "run-abc" / "control.json")


# --- write_control ---


def test_write_control_creates_file(tmp_path):
    write_control("run-1", "pause", source="ui", base=str(tmp_path))
    p = tmp_path / "runs" / "run-1" / "control.json"
    assert p.exists()


def test_write_control_correct_action(tmp_path):
    write_control("run-1", "pause", source="cli", base=str(tmp_path))
    p = tmp_path / "runs" / "run-1" / "control.json"
    data = json.loads(p.read_text())
    assert data["action"] == "pause"


def test_write_control_includes_source(tmp_path):
    write_control("run-1", "stop", source="webhook", base=str(tmp_path))
    p = tmp_path / "runs" / "run-1" / "control.json"
    data = json.loads(p.read_text())
    assert data["source"] == "webhook"


def test_write_control_includes_requested_at(tmp_path):
    write_control("run-1", "pause", base=str(tmp_path))
    p = tmp_path / "runs" / "run-1" / "control.json"
    data = json.loads(p.read_text())
    assert "requested_at" in data
    # Should be a valid ISO timestamp
    datetime.fromisoformat(data["requested_at"].replace("Z", "+00:00"))


def test_write_control_default_source_is_cli(tmp_path):
    write_control("run-1", "pause", base=str(tmp_path))
    p = tmp_path / "runs" / "run-1" / "control.json"
    data = json.loads(p.read_text())
    assert data["source"] == "cli"


def test_write_control_invalid_action_raises(tmp_path):
    with pytest.raises(ValueError, match="invalid action"):
        write_control("run-1", "unknown", base=str(tmp_path))


def test_write_control_creates_parent_dirs(tmp_path):
    write_control("new-run", "stop", base=str(tmp_path))
    p = tmp_path / "runs" / "new-run" / "control.json"
    assert p.exists()


def test_write_control_overwrites_existing(tmp_path):
    write_control("run-1", "pause", base=str(tmp_path))
    write_control("run-1", "stop", base=str(tmp_path))
    p = tmp_path / "runs" / "run-1" / "control.json"
    data = json.loads(p.read_text())
    assert data["action"] == "stop"


# --- read_control ---


def test_read_control_returns_none_when_missing(tmp_path):
    result = read_control("no-such-run", base=str(tmp_path))
    assert result is None


def test_read_control_returns_dict_when_present(tmp_path):
    write_control("run-2", "pause", source="ui", base=str(tmp_path))
    result = read_control("run-2", base=str(tmp_path))
    assert isinstance(result, dict)
    assert result["action"] == "pause"


def test_read_control_validates_action_field(tmp_path):
    # Write a control file with an invalid action manually
    p = tmp_path / "runs" / "run-bad" / "control.json"
    p.parent.mkdir(parents=True)
    p.write_text(json.dumps({"action": "explode", "requested_at": "2026-01-01T00:00:00Z"}))
    with pytest.raises(ValueError, match="invalid action"):
        read_control("run-bad", base=str(tmp_path))


def test_read_control_validates_requested_at_present(tmp_path):
    p = tmp_path / "runs" / "run-bad" / "control.json"
    p.parent.mkdir(parents=True)
    p.write_text(json.dumps({"action": "pause"}))
    with pytest.raises(ValueError, match="requested_at"):
        read_control("run-bad", base=str(tmp_path))


def test_read_control_validates_action_present(tmp_path):
    p = tmp_path / "runs" / "run-bad" / "control.json"
    p.parent.mkdir(parents=True)
    p.write_text(json.dumps({"requested_at": "2026-01-01T00:00:00Z"}))
    with pytest.raises(ValueError, match="action"):
        read_control("run-bad", base=str(tmp_path))


# --- delete_control ---


def test_delete_control_removes_file(tmp_path):
    write_control("run-3", "pause", base=str(tmp_path))
    delete_control("run-3", base=str(tmp_path))
    p = tmp_path / "runs" / "run-3" / "control.json"
    assert not p.exists()


def test_delete_control_no_error_when_missing(tmp_path):
    # Should not raise
    delete_control("no-such-run", base=str(tmp_path))


# --- VALID_ACTIONS ---


def test_valid_actions_contains_pause():
    assert "pause" in VALID_ACTIONS


def test_valid_actions_contains_stop():
    assert "stop" in VALID_ACTIONS
