"""Tests for worca.utils.gh_issues - GitHub issue lifecycle helpers."""

from unittest.mock import patch, MagicMock

import subprocess

from worca.utils.gh_issues import gh_issue_number, _run_gh, _github_disabled, gh_issue_start, gh_issue_complete, gh_issue_fail


# --- gh_issue_number ---

def test_gh_issue_number_returns_number_for_github_issue():
    status = {
        "work_request": {
            "source_type": "github_issue",
            "source_ref": "gh:42",
        }
    }
    assert gh_issue_number(status) == "42"


def test_gh_issue_number_returns_none_for_prompt_source():
    status = {
        "work_request": {
            "source_type": "prompt",
            "source_ref": "",
        }
    }
    assert gh_issue_number(status) is None


def test_gh_issue_number_returns_none_for_beads_source():
    status = {
        "work_request": {
            "source_type": "beads",
            "source_ref": "bd:abc-123",
        }
    }
    assert gh_issue_number(status) is None


def test_gh_issue_number_returns_none_when_no_work_request():
    assert gh_issue_number({}) is None


def test_gh_issue_number_returns_none_for_missing_source_type():
    status = {"work_request": {"source_ref": "gh:42"}}
    assert gh_issue_number(status) is None


def test_gh_issue_number_returns_none_for_bad_ref_format():
    status = {
        "work_request": {
            "source_type": "github_issue",
            "source_ref": "not-a-gh-ref",
        }
    }
    assert gh_issue_number(status) is None


def test_gh_issue_number_handles_high_issue_numbers():
    status = {
        "work_request": {
            "source_type": "github_issue",
            "source_ref": "gh:12345",
        }
    }
    assert gh_issue_number(status) == "12345"


# --- _run_gh (error-suppression pattern) ---

def test_run_gh_success():
    mock_result = MagicMock()
    mock_result.returncode = 0
    mock_result.stdout = "ok\n"
    with patch("worca.utils.gh_issues.subprocess.run", return_value=mock_result) as mock_run:
        result = _run_gh("issue", "view", "42")
    assert result is True
    mock_run.assert_called_once_with(
        ["gh", "issue", "view", "42"],
        check=True, capture_output=True, text=True, timeout=15,
    )


def test_run_gh_suppresses_subprocess_error():
    with patch(
        "worca.utils.gh_issues.subprocess.run",
        side_effect=subprocess.CalledProcessError(1, "gh"),
    ):
        result = _run_gh("issue", "edit", "42", "--add-label", "in-progress")
    assert result is False


def test_run_gh_suppresses_timeout():
    with patch(
        "worca.utils.gh_issues.subprocess.run",
        side_effect=subprocess.TimeoutExpired("gh", 15),
    ):
        result = _run_gh("issue", "comment", "42", "--body", "hello")
    assert result is False


def test_run_gh_suppresses_file_not_found():
    with patch(
        "worca.utils.gh_issues.subprocess.run",
        side_effect=FileNotFoundError("gh not found"),
    ):
        result = _run_gh("issue", "view", "1")
    assert result is False


def test_run_gh_prints_warning_on_failure(capsys):
    with patch(
        "worca.utils.gh_issues.subprocess.run",
        side_effect=subprocess.CalledProcessError(1, "gh"),
    ):
        _run_gh("issue", "edit", "42", "--add-label", "x")
    captured = capsys.readouterr()
    assert "Warning" in captured.err
    assert "GitHub" in captured.err


# --- _github_disabled ---

def test_github_disabled_returns_false_by_default():
    with patch.dict("os.environ", {}, clear=True):
        assert _github_disabled() is False


def test_github_disabled_returns_true_when_set():
    with patch.dict("os.environ", {"WORCA_NO_GITHUB": "1"}):
        assert _github_disabled() is True


def test_github_disabled_returns_false_for_other_values():
    with patch.dict("os.environ", {"WORCA_NO_GITHUB": "0"}):
        assert _github_disabled() is False


def test_gh_issue_start_noop_when_github_disabled():
    status = {
        "work_request": {"source_type": "github_issue", "source_ref": "gh:42"},
        "run_id": "test", "branch": "test",
    }
    with patch.dict("os.environ", {"WORCA_NO_GITHUB": "1"}):
        with patch("worca.utils.gh_issues._run_gh") as mock:
            gh_issue_start(status)
        mock.assert_not_called()


def test_gh_issue_complete_noop_when_github_disabled():
    status = _make_complete_status()
    with patch.dict("os.environ", {"WORCA_NO_GITHUB": "1"}):
        with patch("worca.utils.gh_issues._run_gh") as mock:
            gh_issue_complete(status)
        mock.assert_not_called()


def test_gh_issue_fail_noop_when_github_disabled():
    status = {
        "work_request": {"source_type": "github_issue", "source_ref": "gh:42"},
        "run_id": "test", "branch": "test",
        "token_usage": {"total_cost_usd": 5.0, "num_turns": 100},
    }
    with patch.dict("os.environ", {"WORCA_NO_GITHUB": "1"}):
        with patch("worca.utils.gh_issues._run_gh") as mock:
            gh_issue_fail(status, error="test")
        mock.assert_not_called()


# --- empty-run guard ---

def test_gh_issue_complete_noop_for_empty_run():
    """Runs with 0 turns and $0 cost should not post to GitHub."""
    status = {
        "work_request": {"source_type": "github_issue", "source_ref": "gh:42"},
        "run_id": "20260319-092300", "branch": "worca/fix-the-bug-9b7",
        "token_usage": {"total_cost_usd": 0, "num_turns": 0, "iteration_count": 1},
    }
    with patch("worca.utils.gh_issues._run_gh") as mock:
        gh_issue_complete(status)
    mock.assert_not_called()


def test_gh_issue_complete_noop_for_missing_token_usage():
    """Runs with no token_usage at all should not post to GitHub."""
    status = {
        "work_request": {"source_type": "github_issue", "source_ref": "gh:42"},
        "run_id": "20260319-092300", "branch": "worca/fix-the-bug",
    }
    with patch("worca.utils.gh_issues._run_gh") as mock:
        gh_issue_complete(status)
    mock.assert_not_called()


def test_gh_issue_complete_posts_when_turns_nonzero():
    """Runs with actual turns should still post normally."""
    status = _make_complete_status(num_turns=10, total_cost_usd=0.50)
    with patch("worca.utils.gh_issues._run_gh", return_value=True) as mock:
        gh_issue_complete(status)
    assert mock.call_count == 3


def test_gh_issue_complete_posts_when_cost_nonzero_but_turns_zero():
    """Edge case: cost tracked but 0 turns — still post."""
    status = _make_complete_status(num_turns=0, total_cost_usd=1.50)
    with patch("worca.utils.gh_issues._run_gh", return_value=True) as mock:
        gh_issue_complete(status)
    assert mock.call_count == 3


# --- gh_issue_start ---

def _make_status(issue_num="42", run_id="20260318-120000", branch="worca/my-branch"):
    """Helper to build a typical github_issue status dict."""
    return {
        "work_request": {
            "source_type": "github_issue",
            "source_ref": f"gh:{issue_num}",
        },
        "run_id": run_id,
        "branch": branch,
    }


def test_gh_issue_start_adds_label_and_posts_comment():
    status = _make_status()
    with patch("worca.utils.gh_issues._run_gh", return_value=True) as mock:
        gh_issue_start(status)
    # Should ensure label exists, add it, and post comment
    assert mock.call_count == 3
    mock.assert_any_call(
        "label", "create", "in-progress",
        "--color", "fbca04",
        "--description", "Pipeline is working on this issue",
        "--force",
    )
    mock.assert_any_call("issue", "edit", "42", "--add-label", "in-progress")
    # Check comment body contains run_id and branch
    comment_call = [c for c in mock.call_args_list if c[0][0:2] == ("issue", "comment")][0]
    body = comment_call[0][4]  # positional arg: ("issue", "comment", "42", "--body", body)
    assert "20260318-120000" in body
    assert "worca/my-branch" in body


def test_gh_issue_start_noop_for_non_github_source():
    status = {
        "work_request": {"source_type": "prompt", "source_ref": ""},
        "run_id": "20260318-120000",
        "branch": "main",
    }
    with patch("worca.utils.gh_issues._run_gh") as mock:
        gh_issue_start(status)
    mock.assert_not_called()


def test_gh_issue_start_noop_for_empty_status():
    with patch("worca.utils.gh_issues._run_gh") as mock:
        gh_issue_start({})
    mock.assert_not_called()


def test_gh_issue_start_uses_correct_issue_number():
    status = _make_status(issue_num="99")
    with patch("worca.utils.gh_issues._run_gh", return_value=True) as mock:
        gh_issue_start(status)
    # All gh calls should reference issue 99
    edit_call = [c for c in mock.call_args_list if c[0][0:2] == ("issue", "edit")][0]
    assert edit_call[0][2] == "99"
    comment_call = [c for c in mock.call_args_list if c[0][0:2] == ("issue", "comment")][0]
    assert comment_call[0][2] == "99"


def test_gh_issue_start_handles_missing_run_id_and_branch():
    status = {
        "work_request": {
            "source_type": "github_issue",
            "source_ref": "gh:7",
        },
    }
    with patch("worca.utils.gh_issues._run_gh", return_value=True) as mock:
        gh_issue_start(status)
    # Should still work, using fallback values
    assert mock.call_count == 3
    comment_call = [c for c in mock.call_args_list if c[0][0:2] == ("issue", "comment")][0]
    body = comment_call[0][4]
    assert "unknown" in body.lower() or body  # Should not crash


def test_gh_issue_start_survives_gh_failure():
    """gh_issue_start must never raise even if all gh calls fail."""
    status = _make_status()
    with patch("worca.utils.gh_issues._run_gh", return_value=False):
        # Should not raise
        gh_issue_start(status)


# --- gh_issue_complete ---

def _make_complete_status(
    issue_num="42",
    run_id="20260318-120000",
    branch="worca/my-branch",
    started_at="2026-03-18T12:00:00+00:00",
    completed_at="2026-03-18T12:31:07+00:00",
    total_cost_usd=14.62,
    num_turns=322,
    iteration_count=13,
    by_stage=None,
):
    """Helper to build a status dict with completion metrics."""
    if by_stage is None:
        by_stage = {
            "coordinate": {"iteration_count": 1},
            "implement": {"iteration_count": 4},
            "test": {"iteration_count": 4},
            "review": {"iteration_count": 3},
            "pr": {"iteration_count": 1},
        }
    return {
        "work_request": {
            "source_type": "github_issue",
            "source_ref": f"gh:{issue_num}",
        },
        "run_id": run_id,
        "branch": branch,
        "started_at": started_at,
        "completed_at": completed_at,
        "token_usage": {
            "total_cost_usd": total_cost_usd,
            "num_turns": num_turns,
            "iteration_count": iteration_count,
            "by_stage": by_stage,
        },
    }


def test_gh_issue_complete_posts_comment_removes_label_closes():
    status = _make_complete_status()
    with patch("worca.utils.gh_issues._run_gh", return_value=True) as mock:
        gh_issue_complete(status)
    # Should: post comment, remove label, close issue = 3 calls
    assert mock.call_count == 3
    calls = mock.call_args_list
    # First call: post summary comment
    assert calls[0][0][0:2] == ("issue", "comment")
    assert calls[0][0][2] == "42"
    # Second call: remove label
    mock.assert_any_call("issue", "edit", "42", "--remove-label", "in-progress")
    # Third call: close issue
    mock.assert_any_call("issue", "close", "42")


def test_gh_issue_complete_summary_contains_metrics():
    status = _make_complete_status()
    with patch("worca.utils.gh_issues._run_gh", return_value=True) as mock:
        gh_issue_complete(status)
    comment_call = [c for c in mock.call_args_list if c[0][0:2] == ("issue", "comment")][0]
    body = comment_call[0][4]
    assert "Pipeline Complete" in body
    assert "31m 7s" in body
    assert "14.62" in body
    assert "322" in body
    assert "worca/my-branch" in body
    assert "20260318-120000" in body


def test_gh_issue_complete_summary_contains_iteration_breakdown():
    status = _make_complete_status()
    with patch("worca.utils.gh_issues._run_gh", return_value=True) as mock:
        gh_issue_complete(status)
    comment_call = [c for c in mock.call_args_list if c[0][0:2] == ("issue", "comment")][0]
    body = comment_call[0][4]
    # Should show total + breakdown
    assert "13" in body
    assert "coord: 1" in body
    assert "impl: 4" in body
    assert "test: 4" in body
    assert "review: 3" in body
    assert "pr: 1" in body


def test_gh_issue_complete_noop_for_non_github_source():
    status = {
        "work_request": {"source_type": "prompt", "source_ref": ""},
        "run_id": "20260318-120000",
        "branch": "main",
    }
    with patch("worca.utils.gh_issues._run_gh") as mock:
        gh_issue_complete(status)
    mock.assert_not_called()


def test_gh_issue_complete_noop_for_empty_status():
    with patch("worca.utils.gh_issues._run_gh") as mock:
        gh_issue_complete({})
    mock.assert_not_called()


def test_gh_issue_complete_uses_correct_issue_number():
    status = _make_complete_status(issue_num="99")
    with patch("worca.utils.gh_issues._run_gh", return_value=True) as mock:
        gh_issue_complete(status)
    # All gh calls should reference issue 99
    for c in mock.call_args_list:
        if c[0][0] == "issue":
            assert c[0][2] == "99"


def test_gh_issue_complete_handles_missing_token_usage():
    """Missing token_usage means 0 turns/0 cost — empty-run guard triggers."""
    status = {
        "work_request": {
            "source_type": "github_issue",
            "source_ref": "gh:42",
        },
        "run_id": "20260318-120000",
        "branch": "worca/my-branch",
        "started_at": "2026-03-18T12:00:00+00:00",
        "completed_at": "2026-03-18T12:05:30+00:00",
    }
    with patch("worca.utils.gh_issues._run_gh", return_value=True) as mock:
        gh_issue_complete(status)
    mock.assert_not_called()


def test_gh_issue_complete_handles_missing_timestamps():
    """Should still work when timestamps are missing."""
    status = {
        "work_request": {
            "source_type": "github_issue",
            "source_ref": "gh:42",
        },
        "run_id": "20260318-120000",
        "branch": "worca/my-branch",
        "token_usage": {"total_cost_usd": 5.0, "num_turns": 100},
    }
    with patch("worca.utils.gh_issues._run_gh", return_value=True) as mock:
        gh_issue_complete(status)
    assert mock.call_count == 3
    comment_call = [c for c in mock.call_args_list if c[0][0:2] == ("issue", "comment")][0]
    body = comment_call[0][4]
    assert "Pipeline Complete" in body


def test_gh_issue_complete_duration_formatting():
    """Test various duration edge cases."""
    # Exactly 1 hour
    status = _make_complete_status(
        started_at="2026-03-18T12:00:00+00:00",
        completed_at="2026-03-18T13:00:00+00:00",
    )
    with patch("worca.utils.gh_issues._run_gh", return_value=True) as mock:
        gh_issue_complete(status)
    comment_call = [c for c in mock.call_args_list if c[0][0:2] == ("issue", "comment")][0]
    body = comment_call[0][4]
    assert "1h 0m 0s" in body


def test_gh_issue_complete_duration_short():
    """Duration under 1 minute."""
    status = _make_complete_status(
        started_at="2026-03-18T12:00:00+00:00",
        completed_at="2026-03-18T12:00:45+00:00",
    )
    with patch("worca.utils.gh_issues._run_gh", return_value=True) as mock:
        gh_issue_complete(status)
    comment_call = [c for c in mock.call_args_list if c[0][0:2] == ("issue", "comment")][0]
    body = comment_call[0][4]
    assert "45s" in body


def test_gh_issue_complete_survives_gh_failure():
    """gh_issue_complete must never raise even if all gh calls fail."""
    status = _make_complete_status()
    with patch("worca.utils.gh_issues._run_gh", return_value=False):
        gh_issue_complete(status)


def test_gh_issue_complete_empty_by_stage():
    """Iteration breakdown should handle empty by_stage gracefully."""
    status = _make_complete_status(by_stage={}, iteration_count=5)
    with patch("worca.utils.gh_issues._run_gh", return_value=True) as mock:
        gh_issue_complete(status)
    comment_call = [c for c in mock.call_args_list if c[0][0:2] == ("issue", "comment")][0]
    body = comment_call[0][4]
    assert "5" in body


# --- gh_issue_fail ---

def _make_fail_status(
    issue_num="42",
    run_id="20260318-120000",
    branch="worca/my-branch",
    started_at="2026-03-18T12:00:00+00:00",
    total_cost_usd=7.50,
    num_turns=150,
    iteration_count=6,
    by_stage=None,
):
    """Helper to build a status dict for a failed pipeline run."""
    if by_stage is None:
        by_stage = {
            "coordinate": {"iteration_count": 1},
            "implement": {"iteration_count": 3},
            "test": {"iteration_count": 2},
        }
    return {
        "work_request": {
            "source_type": "github_issue",
            "source_ref": f"gh:{issue_num}",
        },
        "run_id": run_id,
        "branch": branch,
        "started_at": started_at,
        "token_usage": {
            "total_cost_usd": total_cost_usd,
            "num_turns": num_turns,
            "iteration_count": iteration_count,
            "by_stage": by_stage,
        },
    }


def test_gh_issue_fail_posts_comment_and_removes_label():
    status = _make_fail_status()
    with patch("worca.utils.gh_issues._run_gh", return_value=True) as mock:
        gh_issue_fail(status, error="Test stage failed after 3 attempts")
    # Should: post comment, remove label = 2 calls (NO close)
    assert mock.call_count == 2
    mock.assert_any_call("issue", "edit", "42", "--remove-label", "in-progress")
    comment_call = [c for c in mock.call_args_list if c[0][0:2] == ("issue", "comment")][0]
    body = comment_call[0][4]
    assert "Pipeline Failed" in body


def test_gh_issue_fail_does_not_close_issue():
    """Failure must NOT close the issue — leave open for retry."""
    status = _make_fail_status()
    with patch("worca.utils.gh_issues._run_gh", return_value=True) as mock:
        gh_issue_fail(status, error="LoopExhaustedError")
    # Verify no close call was made
    for c in mock.call_args_list:
        assert c[0][0:2] != ("issue", "close"), "gh_issue_fail must NOT close the issue"


def test_gh_issue_fail_comment_contains_error_reason():
    status = _make_fail_status()
    error_msg = "PipelineError: Guardian rejected changes after 3 review cycles"
    with patch("worca.utils.gh_issues._run_gh", return_value=True) as mock:
        gh_issue_fail(status, error=error_msg)
    comment_call = [c for c in mock.call_args_list if c[0][0:2] == ("issue", "comment")][0]
    body = comment_call[0][4]
    assert error_msg in body


def test_gh_issue_fail_comment_contains_partial_metrics():
    status = _make_fail_status()
    with patch("worca.utils.gh_issues._run_gh", return_value=True) as mock:
        gh_issue_fail(status, error="some error")
    comment_call = [c for c in mock.call_args_list if c[0][0:2] == ("issue", "comment")][0]
    body = comment_call[0][4]
    assert "7.50" in body
    assert "150" in body
    assert "worca/my-branch" in body
    assert "20260318-120000" in body


def test_gh_issue_fail_noop_for_non_github_source():
    status = {
        "work_request": {"source_type": "prompt", "source_ref": ""},
        "run_id": "20260318-120000",
        "branch": "main",
    }
    with patch("worca.utils.gh_issues._run_gh") as mock:
        gh_issue_fail(status, error="some error")
    mock.assert_not_called()


def test_gh_issue_fail_noop_for_empty_status():
    with patch("worca.utils.gh_issues._run_gh") as mock:
        gh_issue_fail({}, error="some error")
    mock.assert_not_called()


def test_gh_issue_fail_uses_correct_issue_number():
    status = _make_fail_status(issue_num="77")
    with patch("worca.utils.gh_issues._run_gh", return_value=True) as mock:
        gh_issue_fail(status, error="some error")
    for c in mock.call_args_list:
        if c[0][0] == "issue":
            assert c[0][2] == "77"


def test_gh_issue_fail_handles_missing_token_usage():
    """Should still work when token_usage is missing."""
    status = {
        "work_request": {
            "source_type": "github_issue",
            "source_ref": "gh:42",
        },
        "run_id": "20260318-120000",
        "branch": "worca/my-branch",
        "started_at": "2026-03-18T12:00:00+00:00",
    }
    with patch("worca.utils.gh_issues._run_gh", return_value=True) as mock:
        gh_issue_fail(status, error="timeout")
    assert mock.call_count == 2


def test_gh_issue_fail_handles_missing_started_at():
    """Should still work when started_at is missing."""
    status = {
        "work_request": {
            "source_type": "github_issue",
            "source_ref": "gh:42",
        },
        "run_id": "20260318-120000",
        "branch": "worca/my-branch",
    }
    with patch("worca.utils.gh_issues._run_gh", return_value=True) as mock:
        gh_issue_fail(status, error="crash")
    assert mock.call_count == 2
    comment_call = [c for c in mock.call_args_list if c[0][0:2] == ("issue", "comment")][0]
    body = comment_call[0][4]
    assert "Pipeline Failed" in body


def test_gh_issue_fail_survives_gh_failure():
    """gh_issue_fail must never raise even if all gh calls fail."""
    status = _make_fail_status()
    with patch("worca.utils.gh_issues._run_gh", return_value=False):
        gh_issue_fail(status, error="some error")
