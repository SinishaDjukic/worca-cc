"""Tests for agent dispatch rules and Beads task sync hooks."""

from unittest.mock import patch
from worca.hooks.tracking import check_dispatch, handle_agent_stop


# --- check_dispatch tests ---


def test_blocks_implementer_dispatching_planner():
    code, reason = check_dispatch("implementer", "planner")
    assert code == 2
    assert "Blocked" in reason


def test_allows_planner_dispatching_explore():
    code, reason = check_dispatch("planner", "explore")
    assert code == 0
    assert reason == ""


def test_allows_implementer_dispatching_explore():
    code, reason = check_dispatch("implementer", "explore")
    assert code == 0


def test_blocks_coordinator_dispatching_anything():
    code, reason = check_dispatch("coordinator", "explore")
    assert code == 2


def test_blocks_tester_dispatching_anything():
    code, reason = check_dispatch("tester", "explore")
    assert code == 2


def test_allows_guardian_dispatching_explore():
    code, reason = check_dispatch("guardian", "explore")
    assert code == 0


def test_blocks_guardian_dispatching_implementer():
    code, reason = check_dispatch("guardian", "implementer")
    assert code == 2


def test_allows_all_in_interactive_mode():
    code, reason = check_dispatch("", "planner")
    assert code == 0


def test_allows_all_in_interactive_mode_any_agent():
    code, reason = check_dispatch("", "implementer")
    assert code == 0


def test_blocks_unknown_parent_dispatching():
    code, reason = check_dispatch("unknown_agent", "explore")
    assert code == 2


def test_plan_reviewer_in_dispatch_rules():
    """plan_reviewer must appear in DISPATCH_RULES (even with empty allowed set)."""
    from worca.hooks.tracking import DISPATCH_RULES
    assert "plan_reviewer" in DISPATCH_RULES


def test_plan_reviewer_dispatch_rules_is_empty_set():
    """plan_reviewer must have an empty set — no subagent dispatch allowed."""
    from worca.hooks.tracking import DISPATCH_RULES
    assert DISPATCH_RULES["plan_reviewer"] == set()


def test_blocks_plan_reviewer_dispatching_anything():
    """plan_reviewer cannot dispatch any subagent."""
    code, reason = check_dispatch("plan_reviewer", "explore")
    assert code == 2
    assert "Blocked" in reason


def test_blocks_plan_reviewer_dispatching_implementer():
    code, reason = check_dispatch("plan_reviewer", "implementer")
    assert code == 2


# --- handle_agent_stop tests ---


def test_closes_bead_on_success():
    with patch("worca.utils.beads.bd_close") as mock_close:
        handle_agent_stop("implementer", "bd-123", True)
    mock_close.assert_called_once_with("bd-123")


def test_no_close_on_failure():
    with patch("worca.utils.beads.bd_close") as mock_close:
        handle_agent_stop("implementer", "bd-123", False)
    mock_close.assert_not_called()


def test_no_close_when_no_bead_id():
    with patch("worca.utils.beads.bd_close") as mock_close:
        handle_agent_stop("implementer", None, True)
    mock_close.assert_not_called()


def test_no_close_on_failure_without_bead():
    with patch("worca.utils.beads.bd_close") as mock_close:
        handle_agent_stop("tester", None, False)
    mock_close.assert_not_called()
