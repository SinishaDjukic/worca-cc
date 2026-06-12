"""Unit tests for PRVerification namedtuple and _verify_pr_stage() in runner.py.

Covers:
- success: HEAD changed, all fields present, sha matches
- no-commit: HEAD did not change from baseline
- missing-fields: commit_sha / pr_url / pr_number absent
- sha-mismatch: reported commit_sha doesn't match actual HEAD
- non-dict result: stage output is not a dict
- gh lookup: PR existence + URL match via gh pr view
- wiring: _verify_pr_stage is called inside run_pipeline with retry/halt logic
"""
import inspect

from unittest.mock import patch


from worca.orchestrator.runner import (
    PRVerification,
    _verify_pr_stage,
    _verify_pr_via_gh,
    _fetch_pr_url_via_gh,
    _revise_pr_writeback,
)


SHA_BASELINE = "aaa0000000000000000000000000000000000000"
SHA_NEW = "bbb1111111111111111111111111111111111111"


def _no_gh(_pr_number, _expected_url):
    """Stub gh_lookup that opts out of the network check."""
    return None


def _full_output():
    return {
        "outcome": "success",
        "commit_sha": SHA_NEW,
        "pr_url": "https://github.com/org/repo/pull/42",
        "pr_number": 42,
    }


class TestPRVerificationNamedtuple:
    def test_has_ok_field(self):
        v = PRVerification(ok=True, reason="all good")
        assert v.ok is True

    def test_has_reason_field(self):
        v = PRVerification(ok=False, reason="no commit")
        assert v.reason == "no commit"

    def test_is_namedtuple(self):
        assert isinstance(PRVerification(True, ""), tuple)
        assert hasattr(PRVerification, "_fields")
        assert PRVerification._fields == ("ok", "reason")


class TestVerifyPRStageSuccess:
    def test_returns_ok_true_on_success(self):
        with patch("worca.orchestrator.runner.get_current_git_head", return_value=SHA_NEW):
            result = _verify_pr_stage(_full_output(), SHA_BASELINE, gh_lookup=_no_gh)
        assert result.ok is True

    def test_reason_empty_string_on_success(self):
        with patch("worca.orchestrator.runner.get_current_git_head", return_value=SHA_NEW):
            result = _verify_pr_stage(_full_output(), SHA_BASELINE, gh_lookup=_no_gh)
        assert result.reason == ""

    def test_returns_prverification_instance(self):
        with patch("worca.orchestrator.runner.get_current_git_head", return_value=SHA_NEW):
            result = _verify_pr_stage(_full_output(), SHA_BASELINE, gh_lookup=_no_gh)
        assert isinstance(result, PRVerification)


class TestVerifyPRStageNoCommit:
    def test_ok_false_when_head_unchanged(self):
        with patch("worca.orchestrator.runner.get_current_git_head", return_value=SHA_BASELINE):
            result = _verify_pr_stage(_full_output(), SHA_BASELINE)
        assert result.ok is False

    def test_reason_mentions_no_new_commit(self):
        with patch("worca.orchestrator.runner.get_current_git_head", return_value=SHA_BASELINE):
            result = _verify_pr_stage(_full_output(), SHA_BASELINE)
        assert "commit" in result.reason.lower()


class TestVerifyPRStageMissingFields:
    def test_missing_commit_sha(self):
        output = _full_output()
        del output["commit_sha"]
        with patch("worca.orchestrator.runner.get_current_git_head", return_value=SHA_NEW):
            result = _verify_pr_stage(output, SHA_BASELINE)
        assert result.ok is False
        assert "commit_sha" in result.reason

    def test_missing_pr_url(self):
        output = _full_output()
        del output["pr_url"]
        with patch("worca.orchestrator.runner.get_current_git_head", return_value=SHA_NEW):
            result = _verify_pr_stage(output, SHA_BASELINE)
        assert result.ok is False
        assert "pr_url" in result.reason

    def test_missing_pr_number(self):
        output = _full_output()
        del output["pr_number"]
        with patch("worca.orchestrator.runner.get_current_git_head", return_value=SHA_NEW):
            result = _verify_pr_stage(output, SHA_BASELINE)
        assert result.ok is False
        assert "pr_number" in result.reason

    def test_missing_all_required_fields(self):
        output = {"outcome": "success"}
        with patch("worca.orchestrator.runner.get_current_git_head", return_value=SHA_NEW):
            result = _verify_pr_stage(output, SHA_BASELINE)
        assert result.ok is False


class TestVerifyPRStageDeferred:
    """Deferred case: workspace child guardian short-circuits PR creation.

    The runner must accept a stage_output that carries `deferred: true` and
    `commit_sha` but is missing `pr_number` / `pr_url`, since the parent
    workspace orchestrator creates the PR centrally after integration tests.
    """

    def _deferred_output(self):
        return {
            "outcome": "success",
            "deferred": True,
            "commit_sha": SHA_NEW,
        }

    def test_deferred_output_passes_with_only_commit_sha(self):
        with patch("worca.orchestrator.runner.get_current_git_head", return_value=SHA_NEW):
            result = _verify_pr_stage(self._deferred_output(), SHA_BASELINE)
        assert result.ok is True
        assert result.reason == ""

    def test_deferred_output_still_requires_commit_sha(self):
        output = self._deferred_output()
        del output["commit_sha"]
        with patch("worca.orchestrator.runner.get_current_git_head", return_value=SHA_NEW):
            result = _verify_pr_stage(output, SHA_BASELINE)
        assert result.ok is False
        assert "commit_sha" in result.reason

    def test_deferred_output_still_requires_head_to_move(self):
        with patch("worca.orchestrator.runner.get_current_git_head", return_value=SHA_BASELINE):
            result = _verify_pr_stage(self._deferred_output(), SHA_BASELINE)
        assert result.ok is False
        assert "commit" in result.reason.lower()

    def test_deferred_output_still_verifies_sha_matches_head(self):
        output = self._deferred_output()
        output["commit_sha"] = "ccc2222222"
        with patch("worca.orchestrator.runner.get_current_git_head", return_value=SHA_NEW):
            result = _verify_pr_stage(output, SHA_BASELINE)
        assert result.ok is False

    def test_deferred_output_does_not_call_gh(self):
        """gh_lookup must never be invoked for deferred outputs — no PR exists
        yet for `gh pr view` to find."""
        gh_calls = []

        def _record_gh(pr_number, expected_url):
            gh_calls.append((pr_number, expected_url))
            return PRVerification(ok=True, reason="")

        with patch("worca.orchestrator.runner.get_current_git_head", return_value=SHA_NEW):
            result = _verify_pr_stage(self._deferred_output(), SHA_BASELINE, gh_lookup=_record_gh)
        assert result.ok is True
        assert gh_calls == []

    def test_deferred_false_is_treated_as_non_deferred(self):
        """`deferred: false` must require pr_number/pr_url just like an
        absent `deferred` field — only `deferred: true` opts into the
        relaxed contract."""
        output = {
            "outcome": "success",
            "deferred": False,
            "commit_sha": SHA_NEW,
        }
        with patch("worca.orchestrator.runner.get_current_git_head", return_value=SHA_NEW):
            result = _verify_pr_stage(output, SHA_BASELINE)
        assert result.ok is False
        assert "pr_url" in result.reason or "pr_number" in result.reason

    def test_deferred_truthy_non_bool_does_not_relax_contract(self):
        """Only the literal `True` opts in. `deferred: 1` or `deferred: "yes"`
        must NOT relax the contract — keeps the discriminator
        unambiguous."""
        for truthy in (1, "yes", "true", "1"):
            output = {
                "outcome": "success",
                "deferred": truthy,
                "commit_sha": SHA_NEW,
            }
            with patch("worca.orchestrator.runner.get_current_git_head", return_value=SHA_NEW):
                result = _verify_pr_stage(output, SHA_BASELINE)
            assert result.ok is False, (
                f"deferred={truthy!r} must NOT bypass pr_number/pr_url requirement"
            )


class TestVerifyPRStageShaMismatch:
    def test_ok_false_when_reported_sha_differs_from_head(self):
        output = _full_output()
        output["commit_sha"] = "ccc2222222"  # not SHA_NEW
        with patch("worca.orchestrator.runner.get_current_git_head", return_value=SHA_NEW):
            result = _verify_pr_stage(output, SHA_BASELINE)
        assert result.ok is False

    def test_reason_mentions_sha_mismatch(self):
        output = _full_output()
        output["commit_sha"] = "ccc2222222"
        with patch("worca.orchestrator.runner.get_current_git_head", return_value=SHA_NEW):
            result = _verify_pr_stage(output, SHA_BASELINE)
        assert "sha" in result.reason.lower() or "commit" in result.reason.lower()

    def test_sha_prefix_match_accepted(self):
        """Reported SHA may be a 7+ char prefix of the full 40-char HEAD SHA."""
        output = _full_output()
        output["commit_sha"] = SHA_NEW[:12]
        with patch("worca.orchestrator.runner.get_current_git_head", return_value=SHA_NEW):
            result = _verify_pr_stage(output, SHA_BASELINE, gh_lookup=_no_gh)
        assert result.ok is True


class TestVerifyPRStageGhLookup:
    """Defense-in-depth: gh pr view confirms PR exists and URL matches."""

    def test_gh_failure_propagates_as_verification_failure(self):
        def gh_says_mismatch(_n, _u):
            return PRVerification(ok=False, reason="PR URL mismatch: gh has 'X', guardian reported 'Y'")
        with patch("worca.orchestrator.runner.get_current_git_head", return_value=SHA_NEW):
            result = _verify_pr_stage(_full_output(), SHA_BASELINE, gh_lookup=gh_says_mismatch)
        assert result.ok is False
        assert "mismatch" in result.reason.lower()

    def test_gh_success_keeps_overall_ok(self):
        def gh_ok(_n, _u):
            return PRVerification(ok=True, reason="")
        with patch("worca.orchestrator.runner.get_current_git_head", return_value=SHA_NEW):
            result = _verify_pr_stage(_full_output(), SHA_BASELINE, gh_lookup=gh_ok)
        assert result.ok is True

    def test_gh_none_means_skip_check(self):
        """Returning None (transport failure / unavailable) does not fail verification."""
        with patch("worca.orchestrator.runner.get_current_git_head", return_value=SHA_NEW):
            result = _verify_pr_stage(_full_output(), SHA_BASELINE, gh_lookup=lambda n, u: None)
        assert result.ok is True

    def test_gh_lookup_called_with_pr_number_and_url(self):
        captured = {}
        def capture(n, u):
            captured["n"] = n
            captured["u"] = u
            return None
        with patch("worca.orchestrator.runner.get_current_git_head", return_value=SHA_NEW):
            _verify_pr_stage(_full_output(), SHA_BASELINE, gh_lookup=capture)
        assert captured["n"] == 42
        assert captured["u"] == "https://github.com/org/repo/pull/42"


class TestVerifyPrViaGh:
    """Direct unit tests for the default gh_lookup implementation."""

    def _stub_run(self, returncode=0, stdout="", stderr=""):
        class _R:
            def __init__(self, rc, out, err):
                self.returncode = rc
                self.stdout = out
                self.stderr = err
        return _R(returncode, stdout, stderr)

    def test_gh_not_installed_returns_none(self):
        with patch("worca.orchestrator.runner.subprocess.run", side_effect=FileNotFoundError()):
            assert _verify_pr_via_gh(42, "https://github.com/org/repo/pull/42") is None

    def test_gh_timeout_returns_none(self):
        import subprocess as _sp
        with patch(
            "worca.orchestrator.runner.subprocess.run",
            side_effect=_sp.TimeoutExpired(cmd="gh", timeout=10),
        ):
            assert _verify_pr_via_gh(42, "https://github.com/org/repo/pull/42") is None

    def test_gh_no_auth_returns_none(self):
        r = self._stub_run(returncode=1, stderr="To authenticate, please run: gh auth login")
        with patch("worca.orchestrator.runner.subprocess.run", return_value=r):
            assert _verify_pr_via_gh(42, "https://github.com/org/repo/pull/42") is None

    def test_gh_no_remote_returns_none(self):
        r = self._stub_run(returncode=1, stderr="no default remote repository is set")
        with patch("worca.orchestrator.runner.subprocess.run", return_value=r):
            assert _verify_pr_via_gh(42, "https://github.com/org/repo/pull/42") is None

    def test_gh_returns_matching_pr(self):
        r = self._stub_run(
            returncode=0,
            stdout='{"number": 42, "url": "https://github.com/org/repo/pull/42"}',
        )
        with patch("worca.orchestrator.runner.subprocess.run", return_value=r):
            result = _verify_pr_via_gh(42, "https://github.com/org/repo/pull/42")
        assert result is not None
        assert result.ok is True

    def test_gh_returns_url_mismatch(self):
        r = self._stub_run(
            returncode=0,
            stdout='{"number": 42, "url": "https://github.com/org/repo/pull/99"}',
        )
        with patch("worca.orchestrator.runner.subprocess.run", return_value=r):
            result = _verify_pr_via_gh(42, "https://github.com/org/repo/pull/42")
        assert result is not None
        assert result.ok is False
        assert "mismatch" in result.reason.lower()

    def test_gh_returns_different_pr_number(self):
        r = self._stub_run(
            returncode=0,
            stdout='{"number": 7, "url": "https://github.com/org/repo/pull/7"}',
        )
        with patch("worca.orchestrator.runner.subprocess.run", return_value=r):
            result = _verify_pr_via_gh(42, "https://github.com/org/repo/pull/42")
        assert result is not None
        assert result.ok is False
        assert "#7" in result.reason or "#42" in result.reason

    def test_gh_pr_not_found_is_real_failure(self):
        r = self._stub_run(
            returncode=1,
            stderr="GraphQL: Could not resolve to a PullRequest with the number of 42",
        )
        with patch("worca.orchestrator.runner.subprocess.run", return_value=r):
            result = _verify_pr_via_gh(42, "https://github.com/org/repo/pull/42")
        assert result is not None
        assert result.ok is False

    def test_gh_invalid_json_returns_none(self):
        r = self._stub_run(returncode=0, stdout="not json")
        with patch("worca.orchestrator.runner.subprocess.run", return_value=r):
            assert _verify_pr_via_gh(42, "https://github.com/org/repo/pull/42") is None


class TestVerifyPRStageNonDictResult:
    def test_ok_false_when_result_is_none(self):
        with patch("worca.orchestrator.runner.get_current_git_head", return_value=SHA_NEW):
            result = _verify_pr_stage(None, SHA_BASELINE)
        assert result.ok is False

    def test_ok_false_when_result_is_string(self):
        with patch("worca.orchestrator.runner.get_current_git_head", return_value=SHA_NEW):
            result = _verify_pr_stage("some prose", SHA_BASELINE)
        assert result.ok is False

    def test_reason_mentions_structured_output(self):
        with patch("worca.orchestrator.runner.get_current_git_head", return_value=SHA_NEW):
            result = _verify_pr_stage("prose", SHA_BASELINE)
        assert "structured" in result.reason.lower() or "dict" in result.reason.lower()

    def test_ok_false_when_result_is_list(self):
        with patch("worca.orchestrator.runner.get_current_git_head", return_value=SHA_NEW):
            result = _verify_pr_stage([], SHA_BASELINE)
        assert result.ok is False


class TestFetchPrUrlViaGh:
    """Unit tests for _fetch_pr_url_via_gh helper."""

    def test_returns_url_on_success(self):
        payload = '{"url": "https://github.com/org/repo/pull/42", "number": 42}'
        with patch("subprocess.run") as mock_run:
            mock_run.return_value.returncode = 0
            mock_run.return_value.stdout = payload
            result = _fetch_pr_url_via_gh(42)
        assert result == "https://github.com/org/repo/pull/42"

    def test_returns_none_when_gh_missing(self):
        with patch("subprocess.run", side_effect=FileNotFoundError):
            result = _fetch_pr_url_via_gh(42)
        assert result is None

    def test_returns_none_on_nonzero_returncode(self):
        with patch("subprocess.run") as mock_run:
            mock_run.return_value.returncode = 1
            mock_run.return_value.stdout = ""
            mock_run.return_value.stderr = "not found"
            result = _fetch_pr_url_via_gh(42)
        assert result is None

    def test_returns_none_on_invalid_json(self):
        with patch("subprocess.run") as mock_run:
            mock_run.return_value.returncode = 0
            mock_run.return_value.stdout = "not-json"
            result = _fetch_pr_url_via_gh(42)
        assert result is None

    def test_returns_none_when_url_missing_from_response(self):
        with patch("subprocess.run") as mock_run:
            mock_run.return_value.returncode = 0
            mock_run.return_value.stdout = '{"number": 42}'
            result = _fetch_pr_url_via_gh(42)
        assert result is None

    def test_returns_none_on_timeout(self):
        import subprocess
        with patch("subprocess.run", side_effect=subprocess.TimeoutExpired("gh", 10)):
            result = _fetch_pr_url_via_gh(42)
        assert result is None


class TestReviseModeEnvWiring:
    """Sentinel tests: WORCA_REVISE_PR is wired into agent subprocess env.

    W-071 moved the PR stage's bespoke logic from run_pipeline into
    executor.PrHandler — the sentinels now inspect the handler source.
    """

    def _pipeline_source(self):
        from worca.orchestrator.executor import PrHandler
        return inspect.getsource(PrHandler)

    def test_worca_revise_pr_injected_when_revises_pr_set(self):
        src = self._pipeline_source()
        assert "WORCA_REVISE_PR" in src, (
            "WORCA_REVISE_PR not found in PrHandler — env wiring missing"
        )

    def test_revises_pr_read_from_status_for_env_injection(self):
        src = self._pipeline_source()
        assert "revises_pr" in src, (
            "revises_pr not read from status in PrHandler — env wiring missing"
        )

    def test_fetch_pr_url_called_in_revise_fallback(self):
        src = self._pipeline_source()
        assert "_fetch_pr_url_via_gh" in src, (
            "_fetch_pr_url_via_gh not called in PrHandler — revise fallback missing"
        )


class TestPRStageHandlerWiring:
    """Sentinel tests: _verify_pr_stage wiring lives in executor.PrHandler (W-071)."""

    def _pipeline_source(self):
        from worca.orchestrator.executor import PrHandler
        return inspect.getsource(PrHandler)

    def test_verify_pr_stage_called_inside_run_pipeline(self):
        assert "_verify_pr_stage(" in self._pipeline_source(), (
            "_verify_pr_stage is not called inside PrHandler — wiring missing"
        )

    def test_pr_verification_retry_counter_in_run_pipeline(self):
        assert "pr_verification_retry" in self._pipeline_source(), (
            "Loop counter 'pr_verification_retry' not found in PrHandler — wiring missing"
        )

    def test_pr_verified_milestone_set_in_run_pipeline(self):
        assert '"pr_verified"' in self._pipeline_source(), (
            "Milestone 'pr_verified' is not set inside PrHandler — wiring missing"
        )

    def test_pr_baseline_captured_once_per_stage(self):
        """Baseline must be captured only when pr_baseline_head is None.

        Recapturing per-iteration would let a partial commit on iter_1 corrupt
        the baseline that iter_2 verifies against.
        """
        src = self._pipeline_source()
        assert "pr_baseline_head is None" in src, (
            "Baseline guard 'is None' missing — capture would happen every iteration"
        )


class TestRevisePrWriteback:
    """Runner-side PR writeback for revise mode (W-067) — summary + replies."""

    _FEEDBACK = [
        {"thread_id": "PRRT_a", "path": "src/x.py", "line": 1, "body": "fix a"},
        {"thread_id": "PRRT_b", "path": "src/y.py", "line": 2, "body": "fix b"},
        # review_summary item: no thread_id → no reply, counts as PR-level only
        {"thread_id": "", "path": "", "line": None, "body": "add a test"},
    ]

    def _patches(self, nwo="owner/repo"):
        return (
            patch("worca.orchestrator.runner.current_repo_nwo", return_value=nwo),
            patch("worca.orchestrator.runner.post_revision_summary", return_value=True),
            patch("worca.orchestrator.runner.reply_to_thread", return_value=True),
        )

    def test_posts_summary_and_replies_to_threads_with_ids(self):
        p_nwo, p_sum, p_reply = self._patches()
        with p_nwo, p_sum as mock_sum, p_reply as mock_reply:
            _revise_pr_writeback(42, "abc1234", self._FEEDBACK)

        mock_sum.assert_called_once()
        # summary args: (nwo, pr_number, body)
        nwo_arg, pr_arg, body_arg = mock_sum.call_args[0]
        assert nwo_arg == "owner/repo"
        assert pr_arg == 42
        assert "abc1234" in body_arg
        # two threads have thread_ids → two replies; the review_summary is skipped
        assert mock_reply.call_count == 2
        replied_threads = {c.args[1] for c in mock_reply.call_args_list}
        assert replied_threads == {"PRRT_a", "PRRT_b"}

    def test_reply_body_includes_commit_sha(self):
        p_nwo, p_sum, p_reply = self._patches()
        with p_nwo, p_sum, p_reply as mock_reply:
            _revise_pr_writeback(7, "deadbee", self._FEEDBACK)
        for call in mock_reply.call_args_list:
            assert "deadbee" in call.args[2]

    def test_writeback_text_carries_worca_marker(self):
        """Summary + every reply start with WORCA_COMMENT_MARKER so a later
        revise run recognises and skips worca's own writeback (L1)."""
        from worca.utils.gh_pr import WORCA_COMMENT_MARKER

        p_nwo, p_sum, p_reply = self._patches()
        with p_nwo, p_sum as mock_sum, p_reply as mock_reply:
            _revise_pr_writeback(7, "abc1234", self._FEEDBACK)
        assert mock_sum.call_args[0][2].startswith(WORCA_COMMENT_MARKER)
        for call in mock_reply.call_args_list:
            assert call.args[2].startswith(WORCA_COMMENT_MARKER)

    def test_dedups_repeated_thread_ids(self):
        feedback = [
            {"thread_id": "PRRT_a", "body": "first"},
            {"thread_id": "PRRT_a", "body": "second comment, same thread"},
        ]
        p_nwo, p_sum, p_reply = self._patches()
        with p_nwo, p_sum, p_reply as mock_reply:
            _revise_pr_writeback(1, "sha", feedback)
        assert mock_reply.call_count == 1

    def test_no_nwo_skips_summary_but_still_replies(self):
        p_nwo, p_sum, p_reply = self._patches(nwo="")
        with p_nwo, p_sum as mock_sum, p_reply as mock_reply:
            _revise_pr_writeback(5, "sha", self._FEEDBACK)
        mock_sum.assert_not_called()
        assert mock_reply.call_count == 2

    def test_missing_commit_sha_omits_commit_phrase(self):
        p_nwo, p_sum, p_reply = self._patches()
        with p_nwo, p_sum as mock_sum, p_reply as mock_reply:
            _revise_pr_writeback(9, None, self._FEEDBACK)
        body_arg = mock_sum.call_args[0][2]
        assert "commit" not in body_arg
        for call in mock_reply.call_args_list:
            assert "commit" not in call.args[2]

    def test_empty_feedback_posts_summary_no_replies(self):
        p_nwo, p_sum, p_reply = self._patches()
        with p_nwo, p_sum as mock_sum, p_reply as mock_reply:
            _revise_pr_writeback(3, "sha", [])
        mock_sum.assert_called_once()
        mock_reply.assert_not_called()

    def test_wired_into_run_pipeline_revise_branch(self):
        """Sentinel: the PR stage handler calls _revise_pr_writeback in revise mode."""
        from worca.orchestrator.executor import PrHandler
        src = inspect.getsource(PrHandler)
        assert "_revise_pr_writeback" in src
