"""Tests for worca.utils.beads - bd CLI wrapper."""

from unittest.mock import patch, MagicMock

from worca.utils.beads import bd_create, bd_ready, bd_close, bd_update, bd_dep_add


# --- bd_create ---

def test_bd_create_returns_id():
    mock_result = MagicMock()
    mock_result.returncode = 0
    mock_result.stdout = "Created ccexperiments-abc: My task\n"
    with patch("worca.utils.beads.subprocess.run", return_value=mock_result):
        result = bd_create("My task")
    assert result == "ccexperiments-abc"


def test_bd_create_with_custom_type_and_priority():
    mock_result = MagicMock()
    mock_result.returncode = 0
    mock_result.stdout = "Created proj-123: Bug fix\n"
    with patch("worca.utils.beads.subprocess.run", return_value=mock_result) as mock_run:
        result = bd_create("Bug fix", task_type="bug", priority=1)
    assert result == "proj-123"
    args = mock_run.call_args[0][0]
    assert "--type=bug" in args
    assert "--priority=1" in args


def test_bd_create_raises_on_failure():
    mock_result = MagicMock()
    mock_result.returncode = 1
    mock_result.stderr = "Error: something went wrong"
    with patch("worca.utils.beads.subprocess.run", return_value=mock_result):
        try:
            bd_create("Fail task")
            assert False, "Should have raised"
        except RuntimeError as e:
            assert "something went wrong" in str(e)


# --- bd_ready ---

def test_bd_ready_parses_output():
    mock_result = MagicMock()
    mock_result.returncode = 0
    mock_result.stdout = (
        "ID            Title                Priority\n"
        "proj-001      Fix login bug        1\n"
        "proj-002      Add search           2\n"
    )
    with patch("worca.utils.beads.subprocess.run", return_value=mock_result):
        result = bd_ready()
    assert len(result) == 2
    assert result[0]["id"] == "proj-001"
    assert result[0]["title"] == "Fix login bug"
    assert result[0]["priority"] == "1"
    assert result[1]["id"] == "proj-002"


def test_bd_ready_empty_output():
    mock_result = MagicMock()
    mock_result.returncode = 0
    mock_result.stdout = ""
    with patch("worca.utils.beads.subprocess.run", return_value=mock_result):
        result = bd_ready()
    assert result == []


# --- bd_close ---

def test_bd_close_success():
    mock_result = MagicMock()
    mock_result.returncode = 0
    with patch("worca.utils.beads.subprocess.run", return_value=mock_result) as mock_run:
        result = bd_close("proj-001")
    assert result is True
    args = mock_run.call_args[0][0]
    assert "close" in args
    assert "proj-001" in args


def test_bd_close_with_reason():
    mock_result = MagicMock()
    mock_result.returncode = 0
    with patch("worca.utils.beads.subprocess.run", return_value=mock_result) as mock_run:
        result = bd_close("proj-001", reason="Completed")
    assert result is True
    args = mock_run.call_args[0][0]
    assert '--reason=Completed' in args


def test_bd_close_failure():
    mock_result = MagicMock()
    mock_result.returncode = 1
    with patch("worca.utils.beads.subprocess.run", return_value=mock_result):
        result = bd_close("proj-999")
    assert result is False


# --- bd_update ---

def test_bd_update_success():
    mock_result = MagicMock()
    mock_result.returncode = 0
    with patch("worca.utils.beads.subprocess.run", return_value=mock_result) as mock_run:
        result = bd_update("proj-001", status="in-progress", title="New title")
    assert result is True
    args = mock_run.call_args[0][0]
    assert "--status=in-progress" in args
    assert "--title=New title" in args


def test_bd_update_failure():
    mock_result = MagicMock()
    mock_result.returncode = 1
    with patch("worca.utils.beads.subprocess.run", return_value=mock_result):
        result = bd_update("proj-001", status="done")
    assert result is False


# --- bd_dep_add ---

def test_bd_dep_add_success():
    mock_result = MagicMock()
    mock_result.returncode = 0
    with patch("worca.utils.beads.subprocess.run", return_value=mock_result) as mock_run:
        result = bd_dep_add("proj-001", "proj-002")
    assert result is True
    args = mock_run.call_args[0][0]
    assert "dep" in args
    assert "add" in args
    assert "proj-001" in args
    assert "proj-002" in args


def test_bd_dep_add_failure():
    mock_result = MagicMock()
    mock_result.returncode = 1
    with patch("worca.utils.beads.subprocess.run", return_value=mock_result):
        result = bd_dep_add("proj-001", "proj-999")
    assert result is False
