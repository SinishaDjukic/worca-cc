"""Tests for session lifecycle hooks: SessionStart, PreCompact, SessionEnd."""

from unittest.mock import patch, MagicMock
from worca.hooks.session import handle_session_start, handle_pre_compact, handle_session_end


def test_session_start_returns_branch():
    mock_results = [
        MagicMock(returncode=0, stdout="feature/auth\n"),  # git branch
        MagicMock(returncode=0, stdout="M src/app.py\n"),  # git status
        MagicMock(returncode=0, stdout=""),  # bd prime
    ]
    with patch("worca.hooks.session.subprocess.run", side_effect=mock_results):
        result = handle_session_start()
    assert "feature/auth" in result


def test_session_start_includes_modified_files():
    mock_results = [
        MagicMock(returncode=0, stdout="feature/auth\n"),
        MagicMock(returncode=0, stdout="M src/app.py\n"),
        MagicMock(returncode=0, stdout=""),
    ]
    with patch("worca.hooks.session.subprocess.run", side_effect=mock_results):
        result = handle_session_start()
    assert "M src/app.py" in result


def test_session_start_no_status():
    mock_results = [
        MagicMock(returncode=0, stdout="main\n"),
        MagicMock(returncode=0, stdout=""),
        MagicMock(returncode=0, stdout=""),
    ]
    with patch("worca.hooks.session.subprocess.run", side_effect=mock_results):
        result = handle_session_start()
    assert "main" in result
    assert "Modified" not in result


def test_session_start_unknown_branch():
    mock_results = [
        MagicMock(returncode=1, stdout="", stderr="not a git repo"),
        MagicMock(returncode=1, stdout=""),
        MagicMock(returncode=0, stdout=""),
    ]
    with patch("worca.hooks.session.subprocess.run", side_effect=mock_results):
        result = handle_session_start()
    assert "unknown" in result


def test_session_start_runs_bd_prime():
    mock_results = [
        MagicMock(returncode=0, stdout="main\n"),
        MagicMock(returncode=0, stdout=""),
        MagicMock(returncode=0, stdout=""),
    ]
    with patch("worca.hooks.session.subprocess.run", side_effect=mock_results) as mock_run:
        handle_session_start()
    # Check that bd prime was called (3rd call), ignoring env kwarg
    assert any(
        c[0][0] == ["bd", "prime"]
        for c in mock_run.call_args_list
    )


def test_pre_compact_runs_bd_prime():
    mock_result = MagicMock(returncode=0, stdout="primed\n")
    with patch("worca.hooks.session.subprocess.run", return_value=mock_result):
        result = handle_pre_compact()
    assert result == "primed"


def test_pre_compact_returns_empty_on_failure():
    mock_result = MagicMock(returncode=1, stdout="", stderr="error")
    with patch("worca.hooks.session.subprocess.run", return_value=mock_result):
        result = handle_pre_compact()
    assert result == ""


def test_session_end_cleans_tmp(tmp_path):
    import os

    tmp_dir = str(tmp_path / ".worca" / "tmp")
    os.makedirs(tmp_dir)
    open(os.path.join(tmp_dir, "test.txt"), "w").close()
    with patch("worca.hooks.session.os.path.isdir", return_value=True):
        with patch("worca.hooks.session.shutil.rmtree") as mock_rm:
            handle_session_end()
    mock_rm.assert_called_once()


def test_session_end_no_tmp_dir():
    with patch("worca.hooks.session.os.path.isdir", return_value=False):
        with patch("worca.hooks.session.shutil.rmtree") as mock_rm:
            handle_session_end()
    mock_rm.assert_not_called()


def test_session_end_prints_to_stderr(capsys):
    with patch("worca.hooks.session.os.path.isdir", return_value=False):
        handle_session_end()
    captured = capsys.readouterr()
    assert "Session ended" in captured.err
