"""Tests for worca.state.status - Pipeline status tracking."""

import json

from worca.state.status import load_status, save_status, update_stage, set_milestone, init_status


# --- load_status ---

def test_load_missing_returns_empty(tmp_path):
    result = load_status(str(tmp_path / "missing.json"))
    assert result == {}


def test_load_existing_file(tmp_path):
    path = tmp_path / "status.json"
    data = {"stage": "plan", "branch": "feat/test"}
    path.write_text(json.dumps(data))
    result = load_status(str(path))
    assert result == data


# --- save_status ---

def test_save_creates_file(tmp_path):
    path = str(tmp_path / "status.json")
    status = {"stage": "plan"}
    save_status(status, path)
    with open(path) as f:
        loaded = json.load(f)
    assert loaded == status


def test_save_creates_parent_directories(tmp_path):
    path = str(tmp_path / "nested" / "deep" / "status.json")
    status = {"stage": "implement"}
    save_status(status, path)
    with open(path) as f:
        loaded = json.load(f)
    assert loaded == status


def test_save_and_load_roundtrip(tmp_path):
    path = str(tmp_path / "status.json")
    status = {"stage": "plan", "branch": "feat/test", "data": [1, 2, 3]}
    save_status(status, path)
    loaded = load_status(path)
    assert loaded == status


def test_save_writes_formatted_json(tmp_path):
    path = tmp_path / "status.json"
    status = {"a": 1, "b": 2}
    save_status(status, str(path))
    content = path.read_text()
    # Formatted JSON should have newlines (not a single line)
    assert "\n" in content


# --- update_stage ---

def test_update_stage_creates_stages_key():
    status = {}
    result = update_stage(status, "plan", status_val="complete", duration=42)
    assert result["stages"]["plan"]["status_val"] == "complete"
    assert result["stages"]["plan"]["duration"] == 42


def test_update_stage_preserves_existing():
    status = {"stages": {"plan": {"status_val": "complete"}}, "branch": "main"}
    result = update_stage(status, "implement", status_val="running")
    assert result["stages"]["plan"]["status_val"] == "complete"
    assert result["stages"]["implement"]["status_val"] == "running"
    assert result["branch"] == "main"


def test_update_stage_overwrites_existing_stage():
    status = {"stages": {"plan": {"status_val": "running"}}}
    result = update_stage(status, "plan", status_val="complete", output="done")
    assert result["stages"]["plan"]["status_val"] == "complete"
    assert result["stages"]["plan"]["output"] == "done"


def test_update_stage_returns_same_dict():
    status = {"stages": {}}
    result = update_stage(status, "test", status_val="pending")
    assert result is status  # mutates in place


# --- set_milestone ---

def test_set_milestone_creates_milestones_key():
    status = {}
    result = set_milestone(status, "tests_pass", True)
    assert result["milestones"]["tests_pass"] is True


def test_set_milestone_preserves_existing():
    status = {"milestones": {"tests_pass": True}, "branch": "main"}
    result = set_milestone(status, "lint_pass", False)
    assert result["milestones"]["tests_pass"] is True
    assert result["milestones"]["lint_pass"] is False
    assert result["branch"] == "main"


def test_set_milestone_overwrites():
    status = {"milestones": {"tests_pass": False}}
    result = set_milestone(status, "tests_pass", True)
    assert result["milestones"]["tests_pass"] is True


def test_set_milestone_returns_same_dict():
    status = {"milestones": {}}
    result = set_milestone(status, "deployed", True)
    assert result is status


# --- init_status ---

def test_init_status_has_all_stages():
    wr = {"title": "Add auth", "type": "feature"}
    result = init_status(wr, "feat/auth")
    assert "stages" in result
    for stage in ["plan", "coordinate", "implement", "test", "review"]:
        assert stage in result["stages"]
        assert result["stages"][stage]["status"] == "pending"


def test_init_status_has_work_request():
    wr = {"title": "Fix bug", "type": "bugfix"}
    result = init_status(wr, "fix/bug")
    assert result["work_request"] == wr


def test_init_status_has_branch():
    wr = {"title": "Refactor"}
    result = init_status(wr, "refactor/code")
    assert result["branch"] == "refactor/code"


def test_init_status_has_milestones():
    wr = {"title": "Task"}
    result = init_status(wr, "feat/task")
    assert "milestones" in result
    assert isinstance(result["milestones"], dict)
