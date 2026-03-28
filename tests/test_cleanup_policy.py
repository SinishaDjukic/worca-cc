"""Tests for worca.orchestrator.cleanup — worktree cleanup policy enforcement."""

from unittest.mock import patch

import pytest

from worca.orchestrator.cleanup import apply_cleanup, VALID_POLICIES


# --- policy validation ---


def test_valid_policies_tuple():
    """VALID_POLICIES contains exactly the three expected values."""
    assert VALID_POLICIES == ("on-success", "always", "never")


def test_invalid_policy_raises_value_error():
    """An unrecognized policy string should raise ValueError."""
    with pytest.raises(ValueError, match="Invalid cleanup policy"):
        apply_cleanup([], policy="sometimes")


def test_invalid_policy_error_message_includes_policy():
    """The error message should include the bad policy value."""
    with pytest.raises(ValueError, match="bogus"):
        apply_cleanup([], policy="bogus")


# --- empty results ---


@patch("worca.orchestrator.cleanup.remove_pipeline_worktree")
def test_empty_results_on_success(mock_remove):
    """Empty results list returns [] for on-success policy."""
    removed = apply_cleanup([], policy="on-success")
    assert removed == []
    mock_remove.assert_not_called()


@patch("worca.orchestrator.cleanup.remove_pipeline_worktree")
def test_empty_results_always(mock_remove):
    """Empty results list returns [] for always policy."""
    removed = apply_cleanup([], policy="always")
    assert removed == []
    mock_remove.assert_not_called()


@patch("worca.orchestrator.cleanup.remove_pipeline_worktree")
def test_empty_results_never(mock_remove):
    """Empty results list returns [] for never policy."""
    removed = apply_cleanup([], policy="never")
    assert removed == []
    mock_remove.assert_not_called()


# --- on-success policy ---


@patch("worca.orchestrator.cleanup.remove_pipeline_worktree", return_value=True)
def test_on_success_removes_successful_worktrees(mock_remove):
    """on-success removes worktrees where returncode == 0."""
    results = [
        {"worktree_path": "/tmp/wt-1", "returncode": 0},
        {"worktree_path": "/tmp/wt-2", "returncode": 0},
    ]
    removed = apply_cleanup(results, policy="on-success")
    assert removed == ["/tmp/wt-1", "/tmp/wt-2"]
    assert mock_remove.call_count == 2


@patch("worca.orchestrator.cleanup.remove_pipeline_worktree", return_value=True)
def test_on_success_keeps_failed_worktrees(mock_remove):
    """on-success does NOT remove worktrees where returncode != 0."""
    results = [
        {"worktree_path": "/tmp/wt-fail", "returncode": 1},
        {"worktree_path": "/tmp/wt-crash", "returncode": -9},
    ]
    removed = apply_cleanup(results, policy="on-success")
    assert removed == []
    mock_remove.assert_not_called()


@patch("worca.orchestrator.cleanup.remove_pipeline_worktree", return_value=True)
def test_on_success_mixed_results(mock_remove):
    """on-success removes only the successful ones from a mixed set."""
    results = [
        {"worktree_path": "/tmp/wt-ok", "returncode": 0},
        {"worktree_path": "/tmp/wt-fail", "returncode": 1},
        {"worktree_path": "/tmp/wt-ok2", "returncode": 0},
    ]
    removed = apply_cleanup(results, policy="on-success")
    assert removed == ["/tmp/wt-ok", "/tmp/wt-ok2"]
    assert mock_remove.call_count == 2


@patch("worca.orchestrator.cleanup.remove_pipeline_worktree", return_value=True)
def test_on_success_is_default_policy(mock_remove):
    """on-success is the default policy when none is specified."""
    results = [
        {"worktree_path": "/tmp/wt-ok", "returncode": 0},
        {"worktree_path": "/tmp/wt-fail", "returncode": 1},
    ]
    removed = apply_cleanup(results)
    assert removed == ["/tmp/wt-ok"]


# --- always policy ---


@patch("worca.orchestrator.cleanup.remove_pipeline_worktree", return_value=True)
def test_always_removes_all_worktrees(mock_remove):
    """always removes every worktree regardless of returncode."""
    results = [
        {"worktree_path": "/tmp/wt-ok", "returncode": 0},
        {"worktree_path": "/tmp/wt-fail", "returncode": 1},
        {"worktree_path": "/tmp/wt-crash", "returncode": -9},
    ]
    removed = apply_cleanup(results, policy="always")
    assert removed == ["/tmp/wt-ok", "/tmp/wt-fail", "/tmp/wt-crash"]
    assert mock_remove.call_count == 3


# --- never policy ---


@patch("worca.orchestrator.cleanup.remove_pipeline_worktree")
def test_never_removes_no_worktrees(mock_remove):
    """never policy does not remove any worktrees."""
    results = [
        {"worktree_path": "/tmp/wt-ok", "returncode": 0},
        {"worktree_path": "/tmp/wt-fail", "returncode": 1},
    ]
    removed = apply_cleanup(results, policy="never")
    assert removed == []
    mock_remove.assert_not_called()


# --- graceful error handling ---


@patch("worca.orchestrator.cleanup.remove_pipeline_worktree")
def test_removal_failure_returns_false_not_in_removed(mock_remove):
    """When remove_pipeline_worktree returns False, path is not in removed list."""
    mock_remove.return_value = False
    results = [{"worktree_path": "/tmp/wt-stubborn", "returncode": 0}]
    removed = apply_cleanup(results, policy="on-success")
    assert removed == []
    mock_remove.assert_called_once_with("/tmp/wt-stubborn")


@patch("worca.orchestrator.cleanup.remove_pipeline_worktree")
def test_removal_exception_does_not_crash(mock_remove):
    """An exception from remove_pipeline_worktree is caught gracefully."""
    mock_remove.side_effect = OSError("disk exploded")
    results = [{"worktree_path": "/tmp/wt-boom", "returncode": 0}]
    removed = apply_cleanup(results, policy="on-success")
    assert removed == []


@patch("worca.orchestrator.cleanup.remove_pipeline_worktree")
def test_removal_exception_partial_success(mock_remove):
    """If one removal fails, other successful removals are still returned."""
    def side_effect(path):
        if "boom" in path:
            raise OSError("disk exploded")
        return True

    mock_remove.side_effect = side_effect
    results = [
        {"worktree_path": "/tmp/wt-ok", "returncode": 0},
        {"worktree_path": "/tmp/wt-boom", "returncode": 0},
        {"worktree_path": "/tmp/wt-ok2", "returncode": 0},
    ]
    removed = apply_cleanup(results, policy="always")
    assert removed == ["/tmp/wt-ok", "/tmp/wt-ok2"]


# --- edge cases ---


@patch("worca.orchestrator.cleanup.remove_pipeline_worktree", return_value=True)
def test_entry_missing_worktree_path_is_skipped(mock_remove):
    """Entries without a worktree_path key are silently skipped."""
    results = [
        {"returncode": 0},  # no worktree_path
        {"worktree_path": "/tmp/wt-ok", "returncode": 0},
    ]
    removed = apply_cleanup(results, policy="on-success")
    assert removed == ["/tmp/wt-ok"]
    mock_remove.assert_called_once_with("/tmp/wt-ok")


@patch("worca.orchestrator.cleanup.remove_pipeline_worktree", return_value=True)
def test_entry_empty_worktree_path_is_skipped(mock_remove):
    """Entries with an empty worktree_path string are silently skipped."""
    results = [
        {"worktree_path": "", "returncode": 0},
        {"worktree_path": "/tmp/wt-ok", "returncode": 0},
    ]
    removed = apply_cleanup(results, policy="always")
    assert removed == ["/tmp/wt-ok"]
    mock_remove.assert_called_once_with("/tmp/wt-ok")


@patch("worca.orchestrator.cleanup.remove_pipeline_worktree", return_value=True)
def test_entry_missing_returncode_not_removed_on_success(mock_remove):
    """Entry without returncode is not removed under on-success (rc != 0)."""
    results = [{"worktree_path": "/tmp/wt-no-rc"}]
    removed = apply_cleanup(results, policy="on-success")
    assert removed == []
    mock_remove.assert_not_called()


@patch("worca.orchestrator.cleanup.remove_pipeline_worktree", return_value=True)
def test_entry_missing_returncode_removed_on_always(mock_remove):
    """Entry without returncode IS removed under always policy."""
    results = [{"worktree_path": "/tmp/wt-no-rc"}]
    removed = apply_cleanup(results, policy="always")
    assert removed == ["/tmp/wt-no-rc"]
    mock_remove.assert_called_once()
