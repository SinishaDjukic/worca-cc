"""Tests for worca.utils.git - Git and worktree operations."""

from unittest.mock import patch, MagicMock

from worca.utils.git import create_branch, create_worktree, remove_worktree, current_branch, diff_stat, get_current_git_head


# --- create_branch ---

def test_create_branch_success():
    mock_result = MagicMock()
    mock_result.returncode = 0
    with patch("worca.utils.git.subprocess.run", return_value=mock_result) as mock_run:
        result = create_branch("feat/new-feature")
    assert result is True
    args = mock_run.call_args[0][0]
    assert args == ["git", "checkout", "-b", "feat/new-feature"]


def test_create_branch_failure():
    mock_result = MagicMock()
    mock_result.returncode = 1
    with patch("worca.utils.git.subprocess.run", return_value=mock_result):
        result = create_branch("feat/existing")
    assert result is False


# --- create_worktree ---

def test_create_worktree_success():
    mock_result = MagicMock()
    mock_result.returncode = 0
    with patch("worca.utils.git.subprocess.run", return_value=mock_result) as mock_run:
        result = create_worktree("/tmp/wt", "feat/wt-branch")
    assert result is True
    args = mock_run.call_args[0][0]
    assert args == ["git", "worktree", "add", "/tmp/wt", "-b", "feat/wt-branch"]


def test_create_worktree_failure():
    mock_result = MagicMock()
    mock_result.returncode = 128
    with patch("worca.utils.git.subprocess.run", return_value=mock_result):
        result = create_worktree("/tmp/wt", "feat/bad")
    assert result is False


# --- remove_worktree ---

def test_remove_worktree_success():
    mock_result = MagicMock()
    mock_result.returncode = 0
    with patch("worca.utils.git.subprocess.run", return_value=mock_result) as mock_run:
        result = remove_worktree("/tmp/wt")
    assert result is True
    args = mock_run.call_args[0][0]
    assert args == ["git", "worktree", "remove", "/tmp/wt"]


def test_remove_worktree_failure():
    mock_result = MagicMock()
    mock_result.returncode = 1
    with patch("worca.utils.git.subprocess.run", return_value=mock_result):
        result = remove_worktree("/tmp/nonexistent")
    assert result is False


# --- current_branch ---

def test_current_branch_returns_name():
    mock_result = MagicMock()
    mock_result.returncode = 0
    mock_result.stdout = "feat/my-branch\n"
    with patch("worca.utils.git.subprocess.run", return_value=mock_result):
        result = current_branch()
    assert result == "feat/my-branch"


def test_current_branch_strips_whitespace():
    mock_result = MagicMock()
    mock_result.returncode = 0
    mock_result.stdout = "  main  \n"
    with patch("worca.utils.git.subprocess.run", return_value=mock_result):
        result = current_branch()
    assert result == "main"


# --- diff_stat ---

def test_diff_stat_default_base():
    mock_result = MagicMock()
    mock_result.returncode = 0
    mock_result.stdout = " src/app.py | 10 +++++++---\n 1 file changed\n"
    with patch("worca.utils.git.subprocess.run", return_value=mock_result) as mock_run:
        result = diff_stat()
    assert "src/app.py" in result
    args = mock_run.call_args[0][0]
    assert "main..HEAD" in args


def test_diff_stat_custom_base():
    mock_result = MagicMock()
    mock_result.returncode = 0
    mock_result.stdout = " README.md | 2 +-\n"
    with patch("worca.utils.git.subprocess.run", return_value=mock_result) as mock_run:
        result = diff_stat(base="develop")
    assert "README.md" in result
    args = mock_run.call_args[0][0]
    assert "develop..HEAD" in args


def test_diff_stat_empty():
    mock_result = MagicMock()
    mock_result.returncode = 0
    mock_result.stdout = ""
    with patch("worca.utils.git.subprocess.run", return_value=mock_result):
        result = diff_stat()
    assert result == ""


# --- get_current_git_head ---

def test_get_current_git_head_returns_sha():
    mock_result = MagicMock()
    mock_result.returncode = 0
    mock_result.stdout = "abc1234def5678901234567890123456789012345\n"
    with patch("worca.utils.git.subprocess.run", return_value=mock_result) as mock_run:
        result = get_current_git_head()
    assert result == "abc1234def5678901234567890123456789012345"
    args = mock_run.call_args[0][0]
    assert args == ["git", "rev-parse", "HEAD"]


def test_get_current_git_head_strips_whitespace():
    mock_result = MagicMock()
    mock_result.returncode = 0
    mock_result.stdout = "  deadbeefcafe1234  \n"
    with patch("worca.utils.git.subprocess.run", return_value=mock_result):
        result = get_current_git_head()
    assert result == "deadbeefcafe1234"


def test_get_current_git_head_returns_empty_on_failure():
    mock_result = MagicMock()
    mock_result.returncode = 128
    mock_result.stdout = ""
    with patch("worca.utils.git.subprocess.run", return_value=mock_result):
        result = get_current_git_head()
    assert result == ""
