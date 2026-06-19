"""Tests for worca.orchestrator.work_request module."""
import json
import subprocess
from unittest.mock import patch, MagicMock, ANY
import pytest

from worca.orchestrator.work_request import (
    WorkRequest,
    _JIRA_URL_RE,
    _check_jtr_auth,
    _ensure_jtr_config,
    _extract_plan_path,
    generate_smart_title,
    normalize_plan_file,
    normalize_prompt,
    normalize_spec_file,
    normalize_github_issue,
    normalize_beads_task,
    normalize_jira_ticket,
    normalize_github_pr,
    normalize,
)


# --- WorkRequest dataclass ---

class TestWorkRequest:
    def test_required_fields(self):
        wr = WorkRequest(source_type="prompt", title="Do something")
        assert wr.source_type == "prompt"
        assert wr.title == "Do something"

    def test_default_values(self):
        wr = WorkRequest(source_type="prompt", title="t")
        assert wr.description == ""
        assert wr.source_ref is None
        assert wr.priority == 2
        assert wr.plan_path is None

    def test_pr_revision_fields_default(self):
        wr = WorkRequest(source_type="prompt", title="t")
        assert wr.pr_number is None
        assert wr.pr_head_branch is None
        assert wr.pr_base_branch is None
        assert wr.pr_is_cross_repo is False
        assert wr.review_comments == []

    def test_pr_revision_fields_set(self):
        wr = WorkRequest(
            source_type="github_pr",
            title="Fix review comments",
            pr_number=42,
            pr_head_branch="worca/my-feature-abc123",
            pr_base_branch="main",
            pr_is_cross_repo=True,
            review_comments=[{"id": "RC_1", "body": "Fix this", "path": "foo.py", "line": 10}],
        )
        assert wr.pr_number == 42
        assert wr.pr_head_branch == "worca/my-feature-abc123"
        assert wr.pr_base_branch == "main"
        assert wr.pr_is_cross_repo is True
        assert len(wr.review_comments) == 1
        assert wr.review_comments[0]["id"] == "RC_1"

    def test_all_fields(self):
        wr = WorkRequest(
            source_type="github_issue",
            title="Fix bug",
            description="Details here",
            source_ref="gh:42",
            priority=1,
        )
        assert wr.source_type == "github_issue"
        assert wr.title == "Fix bug"
        assert wr.description == "Details here"
        assert wr.source_ref == "gh:42"
        assert wr.priority == 1


# --- generate_smart_title ---

class TestGenerateSmartTitle:
    @patch("worca.orchestrator.work_request.subprocess.run")
    def test_returns_title_on_success(self, mock_run):
        mock_run.return_value = MagicMock(
            returncode=0, stdout="Add user authentication flow\n"
        )
        result = generate_smart_title("# Auth\n\nImplement login and signup...")
        assert result == "Add user authentication flow"
        # Verify claude was called with resolved haiku model
        args = mock_run.call_args
        cmd = args[0][0]
        assert "claude" in cmd
        assert "--model" in cmd
        idx = cmd.index("--model")
        assert "haiku" in cmd[idx + 1]

    @patch("worca.orchestrator.work_request.subprocess.run")
    def test_truncates_content_to_10k(self, mock_run):
        mock_run.return_value = MagicMock(returncode=0, stdout="Long doc title\n")
        long_content = "x" * 20_000
        generate_smart_title(long_content)
        # The prompt passed to claude should contain truncated content
        cmd = mock_run.call_args[0][0]
        prompt_arg_idx = cmd.index("-p") + 1
        assert len(cmd[prompt_arg_idx]) <= 11_000  # 10k content + prompt text

    @patch("worca.orchestrator.work_request.subprocess.run")
    def test_returns_empty_on_timeout(self, mock_run):
        mock_run.side_effect = subprocess.TimeoutExpired(cmd="claude", timeout=30)
        result = generate_smart_title("some content")
        assert result == ""

    @patch("worca.orchestrator.work_request.subprocess.run")
    def test_returns_empty_on_nonzero_exit(self, mock_run):
        mock_run.return_value = MagicMock(returncode=1, stdout="", stderr="error")
        result = generate_smart_title("some content")
        assert result == ""

    @patch("worca.orchestrator.work_request.subprocess.run")
    def test_returns_empty_on_exception(self, mock_run):
        mock_run.side_effect = OSError("command not found")
        result = generate_smart_title("some content")
        assert result == ""

    @patch("worca.orchestrator.work_request.subprocess.run")
    def test_returns_empty_for_empty_content(self, mock_run):
        result = generate_smart_title("")
        assert result == ""
        mock_run.assert_not_called()

    @patch("worca.orchestrator.work_request.subprocess.run")
    def test_strips_whitespace_from_output(self, mock_run):
        mock_run.return_value = MagicMock(
            returncode=0, stdout="  Title with spaces  \n\n"
        )
        result = generate_smart_title("content")
        assert result == "Title with spaces"

    @patch("worca.orchestrator.work_request.subprocess.run")
    def test_rejects_title_over_100_chars(self, mock_run):
        mock_run.return_value = MagicMock(
            returncode=0, stdout="A" * 101 + "\n"
        )
        result = generate_smart_title("content")
        assert result == ""

    @patch("worca.orchestrator.work_request.subprocess.run")
    def test_rejects_title_with_newlines(self, mock_run):
        mock_run.return_value = MagicMock(
            returncode=0, stdout="Line one\nLine two\n"
        )
        result = generate_smart_title("content")
        assert result == ""

    @patch("worca.orchestrator.work_request.subprocess.run")
    def test_passes_source_hint_in_prompt(self, mock_run):
        mock_run.return_value = MagicMock(returncode=0, stdout="Auth feature\n")
        generate_smart_title("content", source_hint="spec file: auth.md")
        cmd = mock_run.call_args[0][0]
        prompt_arg_idx = cmd.index("-p") + 1
        assert "auth.md" in cmd[prompt_arg_idx]

    @patch("worca.orchestrator.work_request.subprocess.run")
    @patch("worca.orchestrator.work_request.load_settings")
    def test_resolves_haiku_through_model_resolver(self, mock_load, mock_run):
        # Even with a custom haiku entry in models, generate_smart_title MUST use
        # the builtin haiku (pinned via resolve_tier_pinned('builtin:haiku', ...)).
        mock_load.return_value = {
            "worca": {
                "models": {
                    "haiku": {
                        "id": "custom-haiku-id",
                        "env": {"ANTHROPIC_BASE_URL": "http://custom"},
                    }
                }
            }
        }
        mock_run.return_value = MagicMock(returncode=0, stdout="Title\n")
        generate_smart_title("some content")
        cmd = mock_run.call_args[0][0]
        assert "--model" in cmd
        idx = cmd.index("--model")
        assert cmd[idx + 1] == "claude-haiku-4-5-20251001"

    @patch("worca.orchestrator.work_request.subprocess.run")
    @patch("worca.orchestrator.work_request.load_settings")
    def test_resolves_haiku_default_when_no_custom(self, mock_load, mock_run):
        mock_load.return_value = {}
        mock_run.return_value = MagicMock(returncode=0, stdout="Title\n")
        generate_smart_title("some content")
        cmd = mock_run.call_args[0][0]
        assert "--model" in cmd
        idx = cmd.index("--model")
        assert cmd[idx + 1] == "claude-haiku-4-5-20251001"

    @patch("worca.orchestrator.work_request.subprocess.run")
    @patch("worca.orchestrator.work_request.load_settings")
    def test_builtin_haiku_used_regardless_of_project_override(self, mock_load, mock_run):
        """D5: title gen is deterministic — builtin haiku wins even when project/user tier
        shadows the haiku alias in worca.models."""
        mock_load.return_value = {
            "worca": {
                "models": {
                    "haiku": {
                        "id": "project-shadowed-haiku",
                        "env": {"ANTHROPIC_BASE_URL": "http://custom-proxy"},
                    }
                }
            }
        }
        mock_run.return_value = MagicMock(returncode=0, stdout="Title\n")
        generate_smart_title("some content")
        cmd = mock_run.call_args[0][0]
        assert "--model" in cmd
        idx = cmd.index("--model")
        assert cmd[idx + 1] == "claude-haiku-4-5-20251001"
        # Explicitly verify the shadowed model was NOT used
        assert cmd[idx + 1] != "project-shadowed-haiku"
        env = mock_run.call_args[1]["env"]
        assert "ANTHROPIC_BASE_URL" not in env

    @patch("worca.orchestrator.work_request.subprocess.run")
    @patch("worca.orchestrator.work_request.resolve_tier_pinned")
    @patch("worca.orchestrator.work_request.load_settings")
    def test_fallback_when_builtin_pin_fails(self, mock_load, mock_pin, mock_run):
        """When resolve_tier_pinned returns an error, falls back to bare resolve_model."""
        mock_load.return_value = {
            "worca": {"models": {"haiku": "fallback-haiku-id"}}
        }
        mock_pin.return_value = (None, {}, "builtin:haiku pin failed")
        mock_run.return_value = MagicMock(returncode=0, stdout="Title\n")
        generate_smart_title("some content")
        cmd = mock_run.call_args[0][0]
        assert "--model" in cmd
        idx = cmd.index("--model")
        assert cmd[idx + 1] == "fallback-haiku-id"


# --- normalize_plan_file ---

class TestNormalizePlanFile:
    @patch("worca.orchestrator.work_request.generate_smart_title")
    def test_reads_file_and_uses_smart_title(self, mock_smart_title, tmp_path):
        mock_smart_title.return_value = "Smart LLM Generated Title"
        plan = tmp_path / "plan.md"
        plan.write_text("# Plan Heading\n\nSome plan content.")
        wr = normalize_plan_file(str(plan))
        assert wr.source_type == "plan_file"
        assert wr.title == "Smart LLM Generated Title"
        assert "Some plan content" in wr.description
        assert wr.source_ref == str(plan)
        assert wr.plan_path == str(plan)
        mock_smart_title.assert_called_once()

    @patch("worca.orchestrator.work_request.generate_smart_title")
    def test_falls_back_to_heading_when_smart_title_empty(self, mock_smart_title, tmp_path):
        mock_smart_title.return_value = ""
        plan = tmp_path / "plan.md"
        plan.write_text("# My Plan Heading\n\nDetails here.")
        wr = normalize_plan_file(str(plan))
        assert wr.title == "My Plan Heading"

    @patch("worca.orchestrator.work_request.generate_smart_title")
    def test_falls_back_to_filename_when_no_heading(self, mock_smart_title, tmp_path):
        mock_smart_title.return_value = ""
        plan = tmp_path / "my-plan.md"
        plan.write_text("No heading here, just content.")
        wr = normalize_plan_file(str(plan))
        assert wr.title == "my-plan.md"

    @patch("worca.orchestrator.work_request.generate_smart_title")
    def test_uses_provided_content_instead_of_reading_file(self, mock_smart_title, tmp_path):
        mock_smart_title.return_value = "Title From Content"
        plan = tmp_path / "plan.md"
        plan.write_text("File content on disk")
        wr = normalize_plan_file(str(plan), content="Provided content override")
        assert wr.description == "Provided content override"
        # smart_title called with provided content, not file content
        mock_smart_title.assert_called_once_with("Provided content override", source_hint=ANY)

    @patch("worca.orchestrator.work_request.generate_smart_title")
    def test_empty_file(self, mock_smart_title, tmp_path):
        mock_smart_title.return_value = ""
        plan = tmp_path / "empty.md"
        plan.write_text("")
        wr = normalize_plan_file(str(plan))
        assert wr.title == "empty.md"
        assert wr.description == ""

    @patch("worca.orchestrator.work_request.generate_smart_title")
    def test_plan_path_set_to_file_path(self, mock_smart_title, tmp_path):
        mock_smart_title.return_value = "Title"
        plan = tmp_path / "docs" / "plans" / "W-027.md"
        plan.parent.mkdir(parents=True)
        plan.write_text("# W-027\n\nPlan details.")
        wr = normalize_plan_file(str(plan))
        assert wr.plan_path == str(plan)


# --- normalize_prompt ---

class TestNormalizePrompt:
    def test_basic_prompt(self):
        wr = normalize_prompt("Add auth")
        assert wr.source_type == "prompt"
        assert wr.title == "Add auth"
        assert wr.source_ref is None

    def test_prompt_description_matches_text(self):
        wr = normalize_prompt("Refactor logging")
        assert wr.description == "Refactor logging"

    def test_prompt_default_priority(self):
        wr = normalize_prompt("task")
        assert wr.priority == 2

    def test_short_prompt_passthrough(self):
        """Short prompt (<=60 chars) is used as-is for title and description."""
        short = "Fix the login bug"
        wr = normalize_prompt(short)
        assert wr.title == short
        assert wr.description == short

    def test_threshold_boundary(self):
        """Exactly 60-char prompt passes through unchanged — no LLM call."""
        boundary = "x" * 60
        wr = normalize_prompt(boundary)
        assert wr.title == boundary
        assert wr.description == boundary

    @patch("worca.orchestrator.work_request.generate_smart_title")
    def test_long_prompt_llm_success(self, mock_smart_title):
        """Prompt >60 chars calls generate_smart_title; title=result, description=full text."""
        long_prompt = "Implement a comprehensive user authentication system with OAuth"
        assert len(long_prompt) > 60
        mock_smart_title.return_value = "Implement user authentication system"
        wr = normalize_prompt(long_prompt)
        assert wr.title == "Implement user authentication system"
        assert wr.description == long_prompt
        mock_smart_title.assert_called_once()

    @patch("worca.orchestrator.work_request.generate_smart_title")
    def test_long_prompt_llm_failure(self, mock_smart_title):
        """Prompt >60 chars with LLM failure falls back to first 60 chars + ellipsis."""
        long_prompt = "Implement a comprehensive user authentication system with OAuth and SSO support"
        assert len(long_prompt) > 60
        mock_smart_title.return_value = ""
        wr = normalize_prompt(long_prompt)
        assert wr.title == long_prompt[:60] + "…"
        assert wr.description == long_prompt

    @patch("worca.orchestrator.work_request.generate_smart_title")
    def test_description_preservation(self, mock_smart_title):
        """Description always equals the full original prompt text regardless of length."""
        long_prompt = "A" * 120
        mock_smart_title.return_value = "Some short title"
        wr = normalize_prompt(long_prompt)
        assert wr.description == long_prompt


# --- normalize_spec_file ---

class TestNormalizeSpecFile:
    @patch("worca.orchestrator.work_request.generate_smart_title")
    def test_uses_smart_title_when_available(self, mock_smart_title, tmp_path):
        mock_smart_title.return_value = "Smart Spec Title From LLM"
        spec = tmp_path / "auth.md"
        spec.write_text("# User Authentication\n\nAdd login flow.")
        wr = normalize_spec_file(str(spec))
        assert wr.source_type == "spec_file"
        assert wr.title == "Smart Spec Title From LLM"
        assert "login flow" in wr.description
        assert wr.source_ref == str(spec)
        mock_smart_title.assert_called_once()

    @patch("worca.orchestrator.work_request.generate_smart_title")
    def test_falls_back_to_heading_when_smart_title_empty(self, mock_smart_title, tmp_path):
        mock_smart_title.return_value = ""
        spec = tmp_path / "auth.md"
        spec.write_text("# User Authentication\n\nAdd login flow.")
        wr = normalize_spec_file(str(spec))
        assert wr.title == "User Authentication"

    @patch("worca.orchestrator.work_request.generate_smart_title")
    def test_falls_back_to_filename_when_no_heading(self, mock_smart_title, tmp_path):
        mock_smart_title.return_value = ""
        spec = tmp_path / "notes.md"
        spec.write_text("Just some notes without a heading.")
        wr = normalize_spec_file(str(spec))
        assert wr.title == "notes.md"

    @patch("worca.orchestrator.work_request.generate_smart_title")
    def test_full_content_in_description(self, mock_smart_title, tmp_path):
        mock_smart_title.return_value = "Title"
        content = "# Title\n\nLine 1\nLine 2"
        spec = tmp_path / "full.md"
        spec.write_text(content)
        wr = normalize_spec_file(str(spec))
        assert wr.description == content

    @patch("worca.orchestrator.work_request.generate_smart_title")
    def test_extracts_h2_heading_as_fallback(self, mock_smart_title, tmp_path):
        mock_smart_title.return_value = ""
        spec = tmp_path / "h2.md"
        spec.write_text("## Subsection Title\n\nContent here.")
        wr = normalize_spec_file(str(spec))
        assert wr.title == "Subsection Title"

    @patch("worca.orchestrator.work_request.generate_smart_title")
    def test_passes_source_hint_with_filename(self, mock_smart_title, tmp_path):
        mock_smart_title.return_value = "Generated Title"
        spec = tmp_path / "my-feature.md"
        spec.write_text("Some content here.")
        normalize_spec_file(str(spec))
        mock_smart_title.assert_called_once_with(
            "Some content here.", source_hint="spec file: my-feature.md"
        )


# --- normalize_github_issue ---

class TestNormalizeGithubIssue:
    @patch("worca.orchestrator.work_request.subprocess")
    def test_fetches_issue(self, mock_subprocess):
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = json.dumps({"title": "Bug in login", "body": "Steps to reproduce..."})
        mock_subprocess.run.return_value = mock_result

        wr = normalize_github_issue("gh:issue:42")
        assert wr.source_type == "github_issue"
        assert wr.title == "Bug in login"
        assert wr.description == "Steps to reproduce..."
        assert wr.source_ref == "gh:42"

        mock_subprocess.run.assert_called_once_with(
            ["gh", "issue", "view", "42", "--json", "title,body"],
            capture_output=True,
            text=True,
            env=ANY,
        )

    @patch("worca.orchestrator.work_request.subprocess")
    def test_raises_on_failure(self, mock_subprocess):
        mock_result = MagicMock()
        mock_result.returncode = 1
        mock_result.stderr = "not found"
        mock_subprocess.run.return_value = mock_result

        try:
            normalize_github_issue("gh:issue:99")
            assert False, "Should have raised RuntimeError"
        except RuntimeError as e:
            assert "99" in str(e)

    @patch("worca.orchestrator.work_request.subprocess")
    def test_handles_missing_body(self, mock_subprocess):
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = json.dumps({"title": "No body issue"})
        mock_subprocess.run.return_value = mock_result

        wr = normalize_github_issue("gh:issue:7")
        assert wr.title == "No body issue"
        assert wr.description == ""


# --- normalize_beads_task ---

class TestNormalizeBeadsTask:
    @patch("worca.orchestrator.work_request.subprocess")
    def test_fetches_beads_task(self, mock_subprocess):
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = "○ bd-a1b2 · Implement OAuth flow   [● P1 · OPEN]\n"
        mock_subprocess.run.return_value = mock_result

        wr = normalize_beads_task("bd:bd-a1b2")
        assert wr.source_type == "beads"
        assert wr.title == "Implement OAuth flow"
        assert wr.source_ref == "bd:bd-a1b2"

        mock_subprocess.run.assert_called_once_with(
            ["bd", "show", "bd-a1b2"],
            capture_output=True,
            text=True,
            env=ANY,
        )

    @patch("worca.orchestrator.work_request.subprocess")
    def test_raises_on_failure(self, mock_subprocess):
        mock_result = MagicMock()
        mock_result.returncode = 1
        mock_result.stderr = "task not found"
        mock_subprocess.run.return_value = mock_result

        try:
            normalize_beads_task("bd:bd-xxxx")
            assert False, "Should have raised RuntimeError"
        except RuntimeError as e:
            assert "bd-xxxx" in str(e)

    @patch("worca.orchestrator.work_request.subprocess")
    def test_falls_back_to_task_id_if_no_title_parsed(self, mock_subprocess):
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = "some unexpected output format\n"
        mock_subprocess.run.return_value = mock_result

        wr = normalize_beads_task("bd:bd-zz99")
        assert wr.title == "bd-zz99"


# --- _JIRA_URL_RE ---

class TestJiraUrlRegex:
    def test_matches_canonical_url(self):
        url = "https://rb-tracker.bosch.com/tracker01/browse/BIRM-594"
        m = _JIRA_URL_RE.match(url)
        assert m is not None
        assert m.group(1) == "https://rb-tracker.bosch.com/tracker01"
        assert m.group(2) == "BIRM-594"

    def test_matches_http_url(self):
        url = "http://jira.example.com/jira/browse/EXPFAM-13727"
        m = _JIRA_URL_RE.match(url)
        assert m is not None
        assert m.group(2) == "EXPFAM-13727"

    def test_matches_trailing_slash(self):
        url = "https://rb-tracker.bosch.com/tracker01/browse/BIRM-1/"
        m = _JIRA_URL_RE.match(url)
        assert m is not None
        assert m.group(2) == "BIRM-1"

    def test_matches_key_with_digits_and_underscore(self):
        url = "https://jira/proj/browse/PROJ_X1-42"
        m = _JIRA_URL_RE.match(url)
        assert m is not None
        assert m.group(2) == "PROJ_X1-42"

    def test_does_not_match_url_without_browse(self):
        assert _JIRA_URL_RE.match("https://jira.example.com/tracker01/issues/BIRM-594") is None

    def test_does_not_match_random_url(self):
        assert _JIRA_URL_RE.match("https://example.com/page") is None

    def test_does_not_match_github_url(self):
        assert _JIRA_URL_RE.match("https://github.com/owner/repo/issues/42") is None

    def test_does_not_match_lowercase_project(self):
        assert _JIRA_URL_RE.match("https://jira/p/browse/abc-1") is None


# --- _ensure_jtr_config ---

class TestEnsureJtrConfig:
    @patch("worca.orchestrator.work_request.subprocess")
    def test_existing_dir_is_noop(self, mock_subprocess, tmp_path):
        (tmp_path / ".jtr").mkdir()
        _ensure_jtr_config("https://jira/p/browse/X-1", str(tmp_path))
        mock_subprocess.run.assert_not_called()

    @patch("worca.orchestrator.work_request.subprocess")
    def test_runs_jtr_init_when_missing(self, mock_subprocess, tmp_path):
        mock_subprocess.run.return_value = MagicMock(returncode=0, stdout="", stderr="")
        url = "https://jira/p/browse/X-1"
        _ensure_jtr_config(url, str(tmp_path))
        mock_subprocess.run.assert_called_once_with(
            ["jtr", "init", url],
            capture_output=True,
            text=True,
            env=ANY,
            cwd=str(tmp_path),
        )

    @patch("worca.orchestrator.work_request.subprocess")
    def test_init_failure_raises_with_install_hint(self, mock_subprocess, tmp_path):
        mock_subprocess.run.return_value = MagicMock(
            returncode=1, stdout="", stderr="command not found"
        )
        with pytest.raises(RuntimeError, match="uv tool install"):
            _ensure_jtr_config("https://jira/p/browse/X-1", str(tmp_path))


# --- _check_jtr_auth ---

class TestCheckJtrAuth:
    @patch("worca.orchestrator.work_request.subprocess")
    def test_success_is_silent(self, mock_subprocess, tmp_path):
        mock_subprocess.run.return_value = MagicMock(returncode=0, stdout="{}", stderr="")
        _check_jtr_auth(str(tmp_path))

    @patch("worca.orchestrator.work_request.subprocess")
    def test_failure_surfaces_fix_hint(self, mock_subprocess, tmp_path):
        envelope = json.dumps({
            "error": "not_authenticated",
            "message": "WebSEAL intercepted",
            "fix": "jtr auth sso --force",
        })
        mock_subprocess.run.return_value = MagicMock(
            returncode=2, stdout=envelope, stderr=""
        )
        with pytest.raises(RuntimeError, match="jtr auth sso --force"):
            _check_jtr_auth(str(tmp_path))

    @patch("worca.orchestrator.work_request.subprocess")
    def test_failure_without_structured_envelope_uses_default_hint(
        self, mock_subprocess, tmp_path
    ):
        mock_subprocess.run.return_value = MagicMock(
            returncode=2, stdout="not json", stderr=""
        )
        with pytest.raises(RuntimeError, match="jtr auth pat"):
            _check_jtr_auth(str(tmp_path))

    @patch("worca.orchestrator.work_request.subprocess")
    def test_uses_project_root_cwd(self, mock_subprocess, tmp_path):
        mock_subprocess.run.return_value = MagicMock(returncode=0, stdout="{}", stderr="")
        _check_jtr_auth(str(tmp_path))
        assert mock_subprocess.run.call_args.kwargs["cwd"] == str(tmp_path)


# --- normalize_jira_ticket ---

_SAMPLE_JIRA_VIEW = {
    "ticket": {
        "key": "BIRM-594",
        "summary": "Implement OAuth flow",
        "status": "Open",
        "priority": "Medium",
        "issue_type": "Task",
        "description": "Body of the ticket\r\n\r\nWith *bold* and +highlight+.",
    },
    "comments": [
        {
            "id": "1",
            "author": {"display_name": "Alice Smith"},
            "body": "Looked into this; needs more thought.",
            "created": "2026-06-09T10:38:15.578+0200",
        },
        {
            "id": "2",
            "author": {"display_name": "Bob Lee"},
            "body": "+1",
            "created": "2026-06-10T11:00:00.000+0200",
        },
    ],
}


class TestNormalizeJiraTicket:
    @patch("worca.orchestrator.work_request.subprocess")
    def test_happy_path(self, mock_subprocess):
        mock_subprocess.run.return_value = MagicMock(
            returncode=0, stdout=json.dumps(_SAMPLE_JIRA_VIEW), stderr=""
        )
        wr = normalize_jira_ticket("jtr:BIRM-594")
        assert wr.source_type == "jira"
        assert wr.title == "Implement OAuth flow"
        assert wr.source_ref == "jtr:BIRM-594"
        assert "Body of the ticket" in wr.description
        assert "## Comments" in wr.description
        assert "Alice Smith" in wr.description
        assert "Bob Lee" in wr.description

    @patch("worca.orchestrator.work_request.subprocess")
    def test_no_comments_omits_section(self, mock_subprocess):
        payload = {"ticket": dict(_SAMPLE_JIRA_VIEW["ticket"]), "comments": []}
        mock_subprocess.run.return_value = MagicMock(
            returncode=0, stdout=json.dumps(payload), stderr=""
        )
        wr = normalize_jira_ticket("jtr:BIRM-594")
        assert "## Comments" not in wr.description

    @patch("worca.orchestrator.work_request.subprocess")
    def test_missing_description_handled(self, mock_subprocess):
        payload = {
            "ticket": {"key": "BIRM-1", "summary": "No body"},
            "comments": [],
        }
        mock_subprocess.run.return_value = MagicMock(
            returncode=0, stdout=json.dumps(payload), stderr=""
        )
        wr = normalize_jira_ticket("jtr:BIRM-1")
        assert wr.title == "No body"
        assert wr.description == ""

    @patch("worca.orchestrator.work_request.subprocess")
    def test_subprocess_failure_uses_structured_error(self, mock_subprocess):
        envelope = json.dumps({
            "error": "not_found",
            "message": "Issue does not exist",
            "fix": "Check the ticket key",
        })
        mock_subprocess.run.return_value = MagicMock(
            returncode=1, stdout=envelope, stderr=""
        )
        with pytest.raises(RuntimeError, match="Check the ticket key"):
            normalize_jira_ticket("jtr:GONE-1")

    @patch("worca.orchestrator.work_request.subprocess")
    def test_subprocess_failure_without_envelope_uses_default_hint(
        self, mock_subprocess
    ):
        mock_subprocess.run.return_value = MagicMock(
            returncode=1, stdout="", stderr="jtr: command not found"
        )
        with pytest.raises(RuntimeError, match="jtr auth status"):
            normalize_jira_ticket("jtr:GONE-1")

    def test_invalid_ref_empty(self):
        with pytest.raises(ValueError, match="Invalid Jira ref"):
            normalize_jira_ticket("jtr:")

    def test_invalid_ref_no_hyphen(self):
        with pytest.raises(ValueError, match="Invalid Jira ref"):
            normalize_jira_ticket("jtr:NOHYPHEN")

    @patch("worca.orchestrator.work_request.subprocess")
    def test_argv_matches_jtr_view(self, mock_subprocess):
        mock_subprocess.run.return_value = MagicMock(
            returncode=0, stdout=json.dumps(_SAMPLE_JIRA_VIEW), stderr=""
        )
        normalize_jira_ticket("jtr:BIRM-594")
        mock_subprocess.run.assert_called_once_with(
            ["jtr", "view", "BIRM-594", "--json"],
            capture_output=True,
            text=True,
            env=ANY,
        )


# --- normalize dispatcher ---

class TestNormalize:
    def test_dispatches_prompt(self):
        wr = normalize("prompt", "Do something")
        assert wr.source_type == "prompt"
        assert wr.title == "Do something"

    @patch("worca.orchestrator.work_request.generate_smart_title")
    def test_dispatches_spec(self, mock_smart_title, tmp_path):
        mock_smart_title.return_value = ""
        spec = tmp_path / "spec.md"
        spec.write_text("# My Spec\n\nDetails.")
        wr = normalize("spec", str(spec))
        assert wr.source_type == "spec_file"
        assert wr.title == "My Spec"

    @patch("worca.orchestrator.work_request.subprocess")
    def test_dispatches_github_issue(self, mock_subprocess):
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = json.dumps({"title": "Issue Title", "body": "Body"})
        mock_subprocess.run.return_value = mock_result

        wr = normalize("github", "gh:issue:10")
        assert wr.source_type == "github_issue"

    @patch("worca.orchestrator.work_request.subprocess")
    def test_dispatches_beads(self, mock_subprocess):
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = "○ bd-x1 · Task Title   [● P2 · OPEN]\n"
        mock_subprocess.run.return_value = mock_result

        wr = normalize("beads", "bd:bd-x1")
        assert wr.source_type == "beads"

    @patch("worca.orchestrator.work_request.generate_smart_title")
    def test_dispatches_plan(self, mock_smart_title, tmp_path):
        mock_smart_title.return_value = "Plan Title"
        plan = tmp_path / "plan.md"
        plan.write_text("# Plan\n\nContent.")
        wr = normalize("plan", str(plan))
        assert wr.source_type == "plan_file"
        assert wr.title == "Plan Title"
        assert wr.plan_path == str(plan)

    @patch("worca.orchestrator.work_request.generate_smart_title")
    def test_dispatches_plan_with_kwargs(self, mock_smart_title, tmp_path):
        mock_smart_title.return_value = "Kwargs Title"
        plan = tmp_path / "plan.md"
        plan.write_text("File content on disk")
        wr = normalize("plan", str(plan), content="Overridden content")
        assert wr.source_type == "plan_file"
        assert wr.title == "Kwargs Title"
        assert wr.description == "Overridden content"

    def test_raises_on_unknown_source(self):
        try:
            normalize("unknown", "something")
            assert False, "Should have raised ValueError"
        except ValueError as e:
            assert "Unknown source" in str(e)

    @patch("worca.orchestrator.work_request._check_jtr_auth")
    @patch("worca.orchestrator.work_request._ensure_jtr_config")
    @patch("worca.orchestrator.work_request.subprocess")
    def test_dispatches_jira_url(
        self, mock_subprocess, mock_ensure, mock_check
    ):
        mock_subprocess.run.return_value = MagicMock(
            returncode=0, stdout=json.dumps(_SAMPLE_JIRA_VIEW), stderr=""
        )
        url = "https://rb-tracker.bosch.com/tracker01/browse/BIRM-594"
        wr = normalize("source", url)
        assert wr.source_type == "jira"
        assert wr.source_ref == "jtr:BIRM-594"
        mock_ensure.assert_called_once()
        mock_check.assert_called_once()
        assert mock_ensure.call_args.args[0] == url

    @patch("worca.orchestrator.work_request._check_jtr_auth")
    @patch("worca.orchestrator.work_request._ensure_jtr_config")
    @patch("worca.orchestrator.work_request.subprocess")
    def test_dispatches_jtr_canonical_ref(
        self, mock_subprocess, mock_ensure, mock_check
    ):
        mock_subprocess.run.return_value = MagicMock(
            returncode=0, stdout=json.dumps(_SAMPLE_JIRA_VIEW), stderr=""
        )
        wr = normalize("source", "jtr:BIRM-594")
        assert wr.source_type == "jira"
        assert wr.source_ref == "jtr:BIRM-594"
        mock_ensure.assert_not_called()
        mock_check.assert_called_once()

    @patch("worca.orchestrator.work_request._check_jtr_auth")
    @patch("worca.orchestrator.work_request._ensure_jtr_config")
    @patch("worca.orchestrator.work_request.subprocess")
    def test_jira_url_does_not_trigger_github_path(
        self, mock_subprocess, mock_ensure, mock_check
    ):
        # Negative: a Jira URL must NOT be misrouted to normalize_github_issue
        mock_subprocess.run.return_value = MagicMock(
            returncode=0, stdout=json.dumps(_SAMPLE_JIRA_VIEW), stderr=""
        )
        wr = normalize("source", "https://rb-tracker.bosch.com/tracker01/browse/BIRM-1")
        assert wr.source_type == "jira"  # not "github_issue"


# --- _extract_plan_path ---

class TestExtractPlanPath:
    def test_extracts_plan_link(self, tmp_path, monkeypatch):
        plan = tmp_path / "docs" / "plans"
        plan.mkdir(parents=True)
        (plan / "W-023-batch.md").write_text("# Plan")
        monkeypatch.chdir(tmp_path)

        body = "## Plan\n\n- [W-023-batch.md](docs/plans/W-023-batch.md)"
        assert _extract_plan_path(body) == "docs/plans/W-023-batch.md"

    def test_returns_none_when_file_missing(self):
        body = "## Plan\n\n- [W-099-missing.md](docs/plans/W-099-missing.md)"
        assert _extract_plan_path(body) is None

    def test_returns_none_when_no_link(self):
        body = "Just a description with no plan link."
        assert _extract_plan_path(body) is None

    def test_returns_none_for_empty_body(self):
        assert _extract_plan_path("") is None
        assert _extract_plan_path(None) is None

    def test_picks_first_matching_link(self, tmp_path, monkeypatch):
        plan = tmp_path / "docs" / "plans"
        plan.mkdir(parents=True)
        (plan / "W-001-first.md").write_text("# First")
        (plan / "W-002-second.md").write_text("# Second")
        monkeypatch.chdir(tmp_path)

        body = (
            "- [first](docs/plans/W-001-first.md)\n"
            "- [second](docs/plans/W-002-second.md)"
        )
        assert _extract_plan_path(body) == "docs/plans/W-001-first.md"

    def test_extracts_plan_link_from_absolute_blob_url(self, tmp_path, monkeypatch):
        plan = tmp_path / "docs" / "plans"
        plan.mkdir(parents=True)
        (plan / "W-023-batch.md").write_text("# Plan")
        monkeypatch.chdir(tmp_path)

        body = "## Plan\n\n- [docs/plans/W-023-batch.md](https://github.com/SinishaDjukic/worca-cc/blob/main/docs/plans/W-023-batch.md)"
        assert _extract_plan_path(body) == "docs/plans/W-023-batch.md"

    def test_absolute_url_returns_none_when_file_missing(self):
        body = "## Plan\n\n- [docs/plans/W-099-missing.md](https://github.com/SinishaDjukic/worca-cc/blob/main/docs/plans/W-099-missing.md)"
        assert _extract_plan_path(body) is None

    def test_ignores_non_plan_links(self):
        body = "See [README](README.md) and [docs](docs/other.md)"
        assert _extract_plan_path(body) is None


# --- _extract_plan_path with custom plan_path_template ---

class TestExtractPlanPathCustomTemplate:
    def test_custom_prefix_matches_link_under_that_prefix(self, tmp_path, monkeypatch):
        plans = tmp_path / "plans"
        plans.mkdir()
        (plans / "W-007-foo.md").write_text("# Plan")
        monkeypatch.chdir(tmp_path)

        body = "## Plan\n\n- [plan](plans/W-007-foo.md)"
        assert _extract_plan_path(
            body, plan_path_template="plans/{title_slug}.md"
        ) == "plans/W-007-foo.md"

    def test_custom_prefix_with_deeper_nesting(self, tmp_path, monkeypatch):
        plans = tmp_path / "documentation" / "plans"
        plans.mkdir(parents=True)
        (plans / "W-008-deep.md").write_text("# Plan")
        monkeypatch.chdir(tmp_path)

        body = "## Plan\n\n- [plan](documentation/plans/W-008-deep.md)"
        assert _extract_plan_path(
            body,
            plan_path_template="documentation/plans/{title}.md",
        ) == "documentation/plans/W-008-deep.md"

    def test_custom_prefix_strict_ignores_default_docs_plans_link(
        self, tmp_path, monkeypatch
    ):
        # Both files exist, but only `plans/` should be considered when the
        # template is configured to write there. A link to docs/plans/* must
        # not match.
        (tmp_path / "plans").mkdir()
        (tmp_path / "plans" / "W-001-real.md").write_text("# Real")
        (tmp_path / "docs" / "plans").mkdir(parents=True)
        (tmp_path / "docs" / "plans" / "W-002-other.md").write_text("# Other")
        monkeypatch.chdir(tmp_path)

        body = "## Plan\n\n- [other](docs/plans/W-002-other.md)"
        assert _extract_plan_path(
            body, plan_path_template="plans/{title_slug}.md"
        ) is None

    def test_default_template_preserves_existing_behavior(self, tmp_path, monkeypatch):
        plan = tmp_path / "docs" / "plans"
        plan.mkdir(parents=True)
        (plan / "W-023-batch.md").write_text("# Plan")
        monkeypatch.chdir(tmp_path)

        body = "## Plan\n\n- [W-023](docs/plans/W-023-batch.md)"
        assert _extract_plan_path(
            body,
            plan_path_template="docs/plans/{timestamp}-{title_slug}.md",
        ) == "docs/plans/W-023-batch.md"

    def test_template_without_placeholder_uses_dirname(self, tmp_path, monkeypatch):
        # A template with no {placeholder} is a fixed path; treat its dirname
        # as the prefix so the regex still matches plan files in that dir.
        plans = tmp_path / "myplans"
        plans.mkdir()
        (plans / "fixed.md").write_text("# Plan")
        monkeypatch.chdir(tmp_path)

        body = "## Plan\n\n- [plan](myplans/fixed.md)"
        assert _extract_plan_path(
            body, plan_path_template="myplans/myplan.md"
        ) == "myplans/fixed.md"

    def test_empty_template_falls_back_to_default(self, tmp_path, monkeypatch):
        # An empty/None template must not collapse the prefix to "" (which would
        # match every markdown link); fall back to the default docs/plans/ prefix.
        plan = tmp_path / "docs" / "plans"
        plan.mkdir(parents=True)
        (plan / "W-009-empty.md").write_text("# Plan")
        monkeypatch.chdir(tmp_path)

        body = "## Plan\n\n- [plan](docs/plans/W-009-empty.md)"
        assert _extract_plan_path(body, plan_path_template="") == "docs/plans/W-009-empty.md"
        assert _extract_plan_path(body, plan_path_template=None) == "docs/plans/W-009-empty.md"

    def test_template_with_leading_dot_slash(self, tmp_path, monkeypatch):
        plans = tmp_path / "plans"
        plans.mkdir()
        (plans / "W-010-rel.md").write_text("# Plan")
        monkeypatch.chdir(tmp_path)

        body = "## Plan\n\n- [plan](plans/W-010-rel.md)"
        assert _extract_plan_path(
            body, plan_path_template="./plans/{title_slug}.md"
        ) == "plans/W-010-rel.md"

    def test_skips_first_match_with_missing_file_for_substring_collisions(
        self, tmp_path, monkeypatch
    ):
        # Custom prefix `plans/` regex can substring-match `docs/plans/foo.md`
        # → extract `plans/foo.md` which does not exist. The real plan link
        # at `plans/real.md` appears later in the body. The function must
        # iterate matches and return the first one whose file exists.
        (tmp_path / "plans").mkdir()
        (tmp_path / "plans" / "real.md").write_text("# Real")
        (tmp_path / "docs" / "plans").mkdir(parents=True)
        # Note: docs/plans/decoy.md exists, but plans/decoy.md (substring) does NOT.
        (tmp_path / "docs" / "plans" / "decoy.md").write_text("# Decoy")
        monkeypatch.chdir(tmp_path)

        body = (
            "- [decoy](docs/plans/decoy.md)\n"
            "- [real](plans/real.md)"
        )
        assert _extract_plan_path(
            body, plan_path_template="plans/{title_slug}.md"
        ) == "plans/real.md"


# --- normalize_github_issue with plan_path ---

class TestNormalizeGithubIssuePlanPath:
    def _mock_gh(self, mock_subprocess, title, body):
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = json.dumps({"title": title, "body": body})
        mock_subprocess.run.return_value = mock_result

    @patch("worca.orchestrator.work_request.subprocess")
    def test_sets_plan_path_when_link_and_file_exist(self, mock_subprocess, tmp_path, monkeypatch):
        plan = tmp_path / "docs" / "plans"
        plan.mkdir(parents=True)
        (plan / "W-023-batch.md").write_text("# Plan")
        monkeypatch.chdir(tmp_path)

        self._mock_gh(mock_subprocess, "W-023: Batch", "## Plan\n\n- [plan](docs/plans/W-023-batch.md)")
        wr = normalize_github_issue("gh:issue:30")
        assert wr.plan_path == "docs/plans/W-023-batch.md"

    @patch("worca.orchestrator.work_request.subprocess")
    def test_plan_path_none_when_file_missing(self, mock_subprocess):
        self._mock_gh(mock_subprocess, "W-099: Missing", "## Plan\n\n- [plan](docs/plans/W-099-missing.md)")
        wr = normalize_github_issue("gh:issue:99")
        assert wr.plan_path is None

    @patch("worca.orchestrator.work_request.subprocess")
    def test_plan_path_none_when_no_link(self, mock_subprocess):
        self._mock_gh(mock_subprocess, "Simple issue", "Just a bug description.")
        wr = normalize_github_issue("gh:issue:5")
        assert wr.plan_path is None

    @patch("worca.orchestrator.work_request.subprocess")
    def test_custom_template_routes_to_configured_prefix(
        self, mock_subprocess, tmp_path, monkeypatch
    ):
        plans = tmp_path / "plans"
        plans.mkdir()
        (plans / "W-031-custom.md").write_text("# Plan")
        monkeypatch.chdir(tmp_path)

        self._mock_gh(
            mock_subprocess,
            "W-031: Custom prefix",
            "## Plan\n\n- [plan](plans/W-031-custom.md)",
        )
        wr = normalize_github_issue(
            "gh:issue:31", plan_path_template="plans/{title_slug}.md"
        )
        assert wr.plan_path == "plans/W-031-custom.md"

    @patch("worca.orchestrator.work_request.subprocess")
    def test_custom_template_does_not_match_default_prefix(
        self, mock_subprocess, tmp_path, monkeypatch
    ):
        # File exists at docs/plans/ but template points to plans/ — do not match.
        (tmp_path / "docs" / "plans").mkdir(parents=True)
        (tmp_path / "docs" / "plans" / "W-040.md").write_text("# Plan")
        monkeypatch.chdir(tmp_path)

        self._mock_gh(
            mock_subprocess,
            "W-040",
            "## Plan\n\n- [plan](docs/plans/W-040.md)",
        )
        wr = normalize_github_issue(
            "gh:issue:40", plan_path_template="plans/{title_slug}.md"
        )
        assert wr.plan_path is None


# --- normalize dispatcher with plan_path_template ---

class TestNormalizeDispatcherPlanPathTemplate:
    @patch("worca.orchestrator.work_request.subprocess")
    def test_dispatch_threads_template_into_github_issue(
        self, mock_subprocess, tmp_path, monkeypatch
    ):
        plans = tmp_path / "plans"
        plans.mkdir()
        (plans / "W-050-thread.md").write_text("# Plan")
        monkeypatch.chdir(tmp_path)

        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = json.dumps({
            "title": "W-050",
            "body": "## Plan\n\n- [plan](plans/W-050-thread.md)",
        })
        mock_subprocess.run.return_value = mock_result

        wr = normalize(
            "source",
            "gh:issue:50",
            plan_path_template="plans/{title_slug}.md",
        )
        assert wr.source_type == "github_issue"
        assert wr.plan_path == "plans/W-050-thread.md"

    def test_dispatch_ignores_template_for_non_github_sources(self, tmp_path):
        # Threading the kwarg through must not break prompt/spec/plan/beads paths.
        wr = normalize(
            "prompt", "Just a prompt", plan_path_template="anything/{title}.md"
        )
        assert wr.source_type == "prompt"
        assert wr.title == "Just a prompt"


# --- attach_guide ---

class TestAttachGuide:
    """Tests for attach_guide(wr, guide_paths) -> WorkRequest."""

    def test_single_guide_populates_guide_content(self, tmp_path):
        from worca.orchestrator.work_request import attach_guide

        guide = tmp_path / "migration.md"
        guide.write_text("# Migration Steps\n\nStep 1: do this.")

        wr = WorkRequest(source_type="prompt", title="Fix bug", description="Original task.")
        result = attach_guide(wr, [str(guide)])

        # description is now untouched — the wrapper lives in the per-stage
        # .block.md templates, gated on {{#if has_guide}}.
        assert result.description == "Original task."
        assert "migration.md" in result.guide_content
        assert "Migration Steps" in result.guide_content
        assert "Step 1: do this." in result.guide_content

    def test_description_is_not_mutated(self, tmp_path):
        from worca.orchestrator.work_request import attach_guide

        guide = tmp_path / "spec.md"
        guide.write_text("Normative content here.")

        wr = WorkRequest(source_type="prompt", title="t", description="Task content.")
        result = attach_guide(wr, [str(guide)])

        # No header / divider injected into description — that's the template's job.
        assert "## Reference Guide" not in result.description
        assert "## Task" not in result.description
        assert result.description == "Task content."

    def test_multiple_guides_all_included(self, tmp_path):
        from worca.orchestrator.work_request import attach_guide

        guide_a = tmp_path / "alpha.md"
        guide_a.write_text("Alpha content.")
        guide_b = tmp_path / "beta.md"
        guide_b.write_text("Beta content.")

        wr = WorkRequest(source_type="prompt", title="t", description="Task.")
        result = attach_guide(wr, [str(guide_a), str(guide_b)])

        assert "alpha.md" in result.guide_content
        assert "Alpha content." in result.guide_content
        assert "beta.md" in result.guide_content
        assert "Beta content." in result.guide_content
        assert result.description == "Task."

    def test_empty_guide_list_returns_unchanged(self):
        from worca.orchestrator.work_request import attach_guide

        wr = WorkRequest(source_type="prompt", title="t", description="Original.")
        result = attach_guide(wr, [])

        assert result.description == "Original."
        assert result.guide_content == ""

    def test_returns_new_instance(self, tmp_path):
        from worca.orchestrator.work_request import attach_guide

        guide = tmp_path / "g.md"
        guide.write_text("guide")

        wr = WorkRequest(source_type="prompt", title="t", description="d")
        result = attach_guide(wr, [str(guide)])

        assert result is not wr

    def test_metadata_preserved(self, tmp_path):
        from worca.orchestrator.work_request import attach_guide

        guide = tmp_path / "g.md"
        guide.write_text("guide")

        wr = WorkRequest(
            source_type="github_issue",
            title="My Title",
            description="d",
            source_ref="gh:42",
            priority=1,
            plan_path="docs/plans/foo.md",
        )
        result = attach_guide(wr, [str(guide)])

        assert result.source_type == "github_issue"
        assert result.title == "My Title"
        assert result.source_ref == "gh:42"
        assert result.priority == 1
        assert result.plan_path == "docs/plans/foo.md"

    def test_missing_file_raises(self, tmp_path):
        from worca.orchestrator.work_request import attach_guide

        wr = WorkRequest(source_type="prompt", title="t", description="d")
        with pytest.raises((FileNotFoundError, OSError)):
            attach_guide(wr, [str(tmp_path / "nonexistent.md")])

    def test_raises_when_max_bytes_exceeded(self, tmp_path):
        from worca.orchestrator.work_request import attach_guide

        guide = tmp_path / "big.md"
        guide.write_text("x" * 200)  # 200 bytes

        wr = WorkRequest(source_type="prompt", title="t", description="d")
        with pytest.raises(ValueError, match="exceeds worca.guide.max_bytes"):
            attach_guide(wr, [str(guide)], max_bytes=100)

    def test_max_bytes_none_disables_cap(self, tmp_path):
        from worca.orchestrator.work_request import attach_guide

        guide = tmp_path / "big.md"
        guide.write_text("x" * 10_000)

        wr = WorkRequest(source_type="prompt", title="t", description="d")
        result = attach_guide(wr, [str(guide)], max_bytes=None)
        assert len(result.guide_content) > 9_000  # not truncated

    def test_max_bytes_sums_across_files(self, tmp_path):
        from worca.orchestrator.work_request import attach_guide

        a = tmp_path / "a.md"
        a.write_text("a" * 60)
        b = tmp_path / "b.md"
        b.write_text("b" * 60)

        wr = WorkRequest(source_type="prompt", title="t", description="d")
        # 120 bytes total content + filename headers; cap at 100 — should fail.
        with pytest.raises(ValueError, match="exceeds worca.guide.max_bytes"):
            attach_guide(wr, [str(a), str(b)], max_bytes=100)

    def test_pr_fields_preserved_with_guide(self, tmp_path):
        from worca.orchestrator.work_request import attach_guide

        guide = tmp_path / "spec.md"
        guide.write_text("Normative spec.")

        wr = WorkRequest(
            source_type="github_pr",
            title="Fix bug",
            description="PR body.",
            pr_number=42,
            pr_head_branch="worca/fix-abc",
            pr_base_branch="main",
            pr_is_cross_repo=True,
            review_comments=[{"id": "RC_1", "body": "Nit"}],
        )
        result = attach_guide(wr, [str(guide)])

        assert result.pr_number == 42
        assert result.pr_head_branch == "worca/fix-abc"
        assert result.pr_base_branch == "main"
        assert result.pr_is_cross_repo is True
        assert result.review_comments == [{"id": "RC_1", "body": "Nit"}]

    def test_pr_fields_preserved_empty_guide_list(self):
        from worca.orchestrator.work_request import attach_guide

        wr = WorkRequest(
            source_type="github_pr",
            title="Fix bug",
            description="PR body.",
            pr_number=7,
            pr_head_branch="worca/my-branch",
            pr_base_branch="main",
            pr_is_cross_repo=False,
            review_comments=[{"id": "RC_2", "body": "Fix this"}],
        )
        result = attach_guide(wr, [])

        assert result.pr_number == 7
        assert result.pr_head_branch == "worca/my-branch"
        assert result.pr_base_branch == "main"
        assert result.pr_is_cross_repo is False
        assert result.review_comments == [{"id": "RC_2", "body": "Fix this"}]


class TestResolveGuideMaxBytes:
    """resolve_guide_max_bytes(settings) reads worca.guide.max_bytes."""

    def test_reads_from_settings(self):
        from worca.orchestrator.work_request import resolve_guide_max_bytes

        settings = {"worca": {"guide": {"max_bytes": 4096}}}
        assert resolve_guide_max_bytes(settings) == 4096

    def test_default_when_missing(self):
        from worca.orchestrator.work_request import (
            GUIDE_MAX_BYTES_DEFAULT,
            resolve_guide_max_bytes,
        )

        assert resolve_guide_max_bytes({}) == GUIDE_MAX_BYTES_DEFAULT
        assert resolve_guide_max_bytes({"worca": {}}) == GUIDE_MAX_BYTES_DEFAULT
        assert resolve_guide_max_bytes({"worca": {"guide": {}}}) == GUIDE_MAX_BYTES_DEFAULT

    def test_default_is_128_kib(self):
        from worca.orchestrator.work_request import GUIDE_MAX_BYTES_DEFAULT

        assert GUIDE_MAX_BYTES_DEFAULT == 131072


# --- normalize_github_pr ---

class TestNormalizeGithubPr:
    """Tests for normalize_github_pr() — full implementation."""

    _GH_PR_RESPONSE = {
        "title": "Fix memory leak in connection pool",
        "body": "This PR fixes the memory leak described in #42.",
        "baseRefName": "main",
        "headRefName": "worca/fix-leak-abc123",
        "isCrossRepository": False,
        "author": {"login": "alice"},
    }

    _REVIEW_COMMENT = {
        "thread_id": "PRRT_aaa",
        "path": "src/pool.py",
        "line": 42,
        "diff_hunk": "@@ -40,6 @@",
        "author": "bob",
        "body": "this leaks a file handle",
        "kind": "inline",
        "created_at": "2026-06-03T12:00:00Z",
    }

    @pytest.fixture(autouse=True)
    def _patch_pr_helpers(self):
        """nwo is resolved via subprocess (gh) in gh_pr; stub it so
        normalize_github_pr never shells out during unit tests. nwo comes from
        the base repo (current_repo_nwo), NOT the PR's headRepository."""
        with patch(
            "worca.orchestrator.work_request.current_repo_nwo",
            return_value="owner/repo",
        ):
            yield

    def _mock_gh(self, mock_subprocess, response=None):
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = json.dumps(response if response is not None else self._GH_PR_RESPONSE)
        mock_subprocess.run.return_value = mock_result

    @patch("worca.orchestrator.work_request.fetch_review_feedback")
    @patch("worca.orchestrator.work_request.subprocess")
    def test_gh_pr_scheme_returns_github_pr_work_request(self, mock_subprocess, mock_fetch):
        self._mock_gh(mock_subprocess)
        mock_fetch.return_value = []
        wr = normalize_github_pr("gh:pr:42")
        assert wr.source_type == "github_pr"
        assert wr.pr_number == 42
        assert wr.source_ref == "gh:pr:42"

    @patch("worca.orchestrator.work_request.fetch_review_feedback")
    @patch("worca.orchestrator.work_request.subprocess")
    def test_gh_pr_scheme_title_from_pr_metadata(self, mock_subprocess, mock_fetch):
        self._mock_gh(mock_subprocess)
        mock_fetch.return_value = []
        wr = normalize_github_pr("gh:pr:42")
        assert wr.title == "Fix memory leak in connection pool"

    def test_gh_pr_scheme_invalid_number_raises(self):
        with pytest.raises(ValueError):
            normalize_github_pr("gh:pr:abc")

    @patch("worca.orchestrator.work_request.fetch_review_feedback")
    @patch("worca.orchestrator.work_request.subprocess")
    def test_normalize_github_pr_builds_work_request(self, mock_subprocess, mock_fetch):
        """Full: all WorkRequest PR-revision fields are populated correctly."""
        self._mock_gh(mock_subprocess)
        mock_fetch.return_value = [self._REVIEW_COMMENT]

        wr = normalize_github_pr("gh:pr:42")

        assert wr.source_type == "github_pr"
        assert wr.pr_number == 42
        assert wr.title == "Fix memory leak in connection pool"
        assert wr.pr_head_branch == "worca/fix-leak-abc123"
        assert wr.pr_base_branch == "main"
        assert wr.pr_is_cross_repo is False
        assert wr.source_ref == "gh:pr:42"
        assert wr.review_comments == [self._REVIEW_COMMENT]
        mock_fetch.assert_called_once_with("owner/repo", 42)

    @patch("worca.orchestrator.work_request.fetch_review_feedback")
    @patch("worca.orchestrator.work_request.subprocess")
    def test_review_feedback_description_synthesis(self, mock_subprocess, mock_fetch):
        """Description = original PR body + ## Review Feedback to Address with [file:line] anchors."""
        self._mock_gh(mock_subprocess)
        mock_fetch.return_value = [self._REVIEW_COMMENT]

        wr = normalize_github_pr("gh:pr:42")

        assert "This PR fixes the memory leak" in wr.description
        assert "## Review Feedback to Address" in wr.description
        assert "[src/pool.py:42]" in wr.description
        assert "@bob" in wr.description
        assert "this leaks a file handle" in wr.description
        assert "PRRT_aaa" in wr.description

    @patch("worca.orchestrator.work_request.fetch_review_feedback")
    @patch("worca.orchestrator.work_request.subprocess")
    def test_inline_comment_includes_diff_hunk_fence(self, mock_subprocess, mock_fetch):
        """An inline comment's diff hunk is nested under the bullet as a fenced
        ```diff block so the agent sees the exact code context, not just a
        path:line coordinate."""
        self._mock_gh(mock_subprocess)
        mock_fetch.return_value = [self._REVIEW_COMMENT]

        wr = normalize_github_pr("gh:pr:42")

        assert "  ```diff" in wr.description
        assert "  @@ -40,6 @@" in wr.description
        # The fence sits after the bullet for that comment.
        desc = wr.description
        assert desc.index("[src/pool.py:42]") < desc.index("```diff")

    @patch("worca.orchestrator.work_request.fetch_review_feedback")
    @patch("worca.orchestrator.work_request.subprocess")
    def test_review_summary_has_no_diff_fence(self, mock_subprocess, mock_fetch):
        """A review_summary item (empty diff_hunk) renders no fenced block."""
        self._mock_gh(mock_subprocess)
        mock_fetch.return_value = [
            {
                "thread_id": "",
                "path": "",
                "line": None,
                "diff_hunk": "",
                "author": "carol",
                "body": "add a test for the empty case",
                "kind": "review_summary",
                "created_at": "2026-06-03T12:00:00Z",
            }
        ]
        wr = normalize_github_pr("gh:pr:42")
        assert "```diff" not in wr.description

    @patch("worca.orchestrator.work_request.fetch_review_feedback")
    @patch("worca.orchestrator.work_request.subprocess")
    def test_no_review_comments_omits_feedback_section(self, mock_subprocess, mock_fetch):
        self._mock_gh(mock_subprocess)
        mock_fetch.return_value = []
        wr = normalize_github_pr("gh:pr:42")
        assert "## Review Feedback to Address" not in wr.description

    @patch("worca.orchestrator.work_request.fetch_review_feedback")
    @patch("worca.orchestrator.work_request.subprocess")
    def test_cross_repo_flag_set(self, mock_subprocess, mock_fetch):
        response = dict(self._GH_PR_RESPONSE, isCrossRepository=True)
        self._mock_gh(mock_subprocess, response)
        mock_fetch.return_value = []
        wr = normalize_github_pr("gh:pr:7")
        assert wr.pr_is_cross_repo is True

    @patch("worca.orchestrator.work_request.subprocess")
    def test_gh_failure_raises_runtime_error(self, mock_subprocess):
        mock_result = MagicMock()
        mock_result.returncode = 1
        mock_result.stderr = "authentication required"
        mock_subprocess.run.return_value = mock_result
        with pytest.raises(RuntimeError, match="Failed to fetch PR"):
            normalize_github_pr("gh:pr:99")

    @patch("worca.orchestrator.work_request.fetch_review_feedback")
    @patch("worca.orchestrator.work_request.subprocess")
    def test_nwo_resolved_from_base_repo_not_head_repository(
        self, mock_subprocess, mock_fetch
    ):
        """Regression: nwo must come from current_repo_nwo() (the base repo),
        never from the PR's headRepository — gh pr view does not expose a
        nameWithOwner there, so the old path silently fetched nothing."""
        self._mock_gh(mock_subprocess)
        mock_fetch.return_value = []
        with patch(
            "worca.orchestrator.work_request.current_repo_nwo",
            return_value="base-owner/base-repo",
        ):
            normalize_github_pr("gh:pr:42")
        nwo_arg = mock_fetch.call_args[0][0]
        assert nwo_arg == "base-owner/base-repo"

    @patch("worca.orchestrator.work_request.fetch_review_feedback")
    @patch("worca.orchestrator.work_request.subprocess")
    def test_empty_nwo_skips_fetch(self, mock_subprocess, mock_fetch):
        """If the base repo can't be resolved, ingestion is skipped, not crashed."""
        self._mock_gh(mock_subprocess)
        with patch(
            "worca.orchestrator.work_request.current_repo_nwo", return_value=""
        ):
            wr = normalize_github_pr("gh:pr:42")
        mock_fetch.assert_not_called()
        assert wr.review_comments == []

    @patch("worca.orchestrator.work_request.fetch_review_feedback")
    @patch("worca.orchestrator.work_request.subprocess")
    def test_pr_level_feedback_synthesized_without_anchor(
        self, mock_subprocess, mock_fetch
    ):
        """A review_summary item (no path / thread_id) renders as [PR-level]
        with no trailing (thread: …) suffix."""
        self._mock_gh(mock_subprocess)
        mock_fetch.return_value = [
            {
                "thread_id": "",
                "path": "",
                "line": None,
                "diff_hunk": "",
                "author": "carol",
                "body": "add a test for the empty case",
                "kind": "review_summary",
                "created_at": "2026-06-03T12:00:00Z",
            }
        ]
        wr = normalize_github_pr("gh:pr:42")
        assert "[PR-level] @carol:" in wr.description
        assert "(thread:" not in wr.description


# --- parse_pr_url number extraction ---

class TestParsePrUrlNumber:
    def test_pr_url_resolves_to_number(self):
        from worca.utils.pr_url import parse_pr_url
        result = parse_pr_url("https://github.com/owner/repo/pull/99")
        assert result["provider"] == "github"
        assert result["number"] == 99

    def test_pr_url_github_enterprise_resolves_number(self):
        from worca.utils.pr_url import parse_pr_url
        result = parse_pr_url("https://github.mycompany.com/owner/repo/pull/123")
        assert result["provider"] == "github"
        assert result["number"] == 123

    def test_pr_url_non_github_has_no_number(self):
        from worca.utils.pr_url import parse_pr_url
        result = parse_pr_url("https://gitlab.com/group/repo/-/merge_requests/5")
        assert result["provider"] == "gitlab"
        # number not required for non-github, but should not crash
        assert "number" not in result or result["number"] is None


# --- normalize dispatcher with gh:pr: ---

_DISPATCH_PR_RESPONSE = {
    "title": "Some PR",
    "body": "",
    "baseRefName": "main",
    "headRefName": "feature/x",
    "isCrossRepository": False,
    "author": {"login": "alice"},
}


class TestNormalizeGithubPrDispatch:
    @pytest.fixture(autouse=True)
    def _patch_pr_helpers(self):
        with patch(
            "worca.orchestrator.work_request.current_repo_nwo",
            return_value="owner/repo",
        ):
            yield

    @patch("worca.orchestrator.work_request.fetch_review_feedback", return_value=[])
    @patch("worca.orchestrator.work_request.subprocess")
    def test_normalize_dispatches_gh_pr_scheme(self, mock_subprocess, mock_fetch):
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = json.dumps(_DISPATCH_PR_RESPONSE)
        mock_subprocess.run.return_value = mock_result
        wr = normalize("source", "gh:pr:55")
        assert wr.source_type == "github_pr"
        assert wr.pr_number == 55

    @patch("worca.orchestrator.work_request.fetch_review_feedback", return_value=[])
    @patch("worca.orchestrator.work_request.subprocess")
    def test_normalize_dispatches_full_github_pr_url(self, mock_subprocess, mock_fetch):
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = json.dumps(_DISPATCH_PR_RESPONSE)
        mock_subprocess.run.return_value = mock_result
        wr = normalize("source", "https://github.com/owner/repo/pull/77")
        assert wr.source_type == "github_pr"
        assert wr.pr_number == 77

    @patch("worca.orchestrator.work_request.fetch_review_feedback", return_value=[])
    @patch("worca.orchestrator.work_request.subprocess")
    def test_normalize_pr_type_dispatches_gh_pr(self, mock_subprocess, mock_fetch):
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = json.dumps(_DISPATCH_PR_RESPONSE)
        mock_subprocess.run.return_value = mock_result
        wr = normalize("pr", "gh:pr:10")
        assert wr.source_type == "github_pr"

    def test_normalize_non_github_pr_url_raises(self):
        with pytest.raises(ValueError, match="not yet supported"):
            normalize("source", "https://gitlab.com/group/repo/-/merge_requests/5")

    @patch("worca.orchestrator.work_request.fetch_review_feedback", return_value=[])
    @patch("worca.orchestrator.work_request.subprocess")
    def test_normalize_full_github_pr_url_sets_source_ref(self, mock_subprocess, mock_fetch):
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = json.dumps(_DISPATCH_PR_RESPONSE)
        mock_subprocess.run.return_value = mock_result
        wr = normalize("source", "https://github.com/owner/repo/pull/33")
        assert wr.source_ref == "gh:pr:33"

    # --- repo_nwo propagation from a parsed URL ---
    # When a full GitHub PR URL is passed (regardless of dispatch path),
    # the owner/repo must reach `gh pr view --repo …` so the lookup hits
    # the right repo rather than gh's current-dir default. Without this,
    # launching against worca-cc/pull/313 from a different project would
    # silently try to find PR #313 in that other project's repo.

    @patch("worca.orchestrator.work_request.fetch_review_feedback", return_value=[])
    @patch("worca.orchestrator.work_request.subprocess")
    def test_full_url_passes_repo_flag_to_gh_view(
        self, mock_subprocess, mock_fetch
    ):
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = json.dumps(_DISPATCH_PR_RESPONSE)
        mock_subprocess.run.return_value = mock_result
        normalize("source", "https://github.com/some-owner/some-repo/pull/313")
        cmd = mock_subprocess.run.call_args[0][0]
        assert "--repo" in cmd
        idx = cmd.index("--repo")
        assert cmd[idx + 1] == "some-owner/some-repo"

    @patch("worca.orchestrator.work_request.fetch_review_feedback", return_value=[])
    @patch("worca.orchestrator.work_request.subprocess")
    def test_full_url_uses_url_repo_for_review_feedback(
        self, mock_subprocess, mock_fetch
    ):
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = json.dumps(_DISPATCH_PR_RESPONSE)
        mock_subprocess.run.return_value = mock_result
        normalize(
            "pr", "https://github.com/some-owner/some-repo/pull/313"
        )
        # Reviews must come from the URL's repo, not current_repo_nwo()
        mock_fetch.assert_called_once_with("some-owner/some-repo", 313)

    @patch("worca.orchestrator.work_request.fetch_review_feedback", return_value=[])
    @patch("worca.orchestrator.work_request.subprocess")
    def test_bare_gh_pr_scheme_still_falls_back_to_current_repo(
        self, mock_subprocess, mock_fetch
    ):
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = json.dumps(_DISPATCH_PR_RESPONSE)
        mock_subprocess.run.return_value = mock_result
        normalize("source", "gh:pr:55")
        cmd = mock_subprocess.run.call_args[0][0]
        # No --repo flag — gh resolves the current-dir default repo.
        assert "--repo" not in cmd
        # Reviews come from current_repo_nwo() = "owner/repo" (fixture).
        mock_fetch.assert_called_once_with("owner/repo", 55)

    @patch("worca.orchestrator.work_request.subprocess")
    def test_pr_fetch_error_message_includes_repo_hint(
        self, mock_subprocess
    ):
        from worca.orchestrator.work_request import normalize_github_pr

        mock_result = MagicMock()
        mock_result.returncode = 1
        mock_result.stdout = ""
        mock_result.stderr = "Could not resolve to a PullRequest"
        mock_subprocess.run.return_value = mock_result
        with pytest.raises(RuntimeError, match=r"in some-owner/some-repo"):
            normalize_github_pr("gh:pr:313", repo_nwo="some-owner/some-repo")


# --- graph report static-injection surface removed (W-053 query pivot) ---

class TestGraphReportSurfaceRemoved:
    """The static GRAPH_REPORT.md injection surface was dropped in favor of
    on-demand `graphify query` against the cached graph.json. Agents reach the
    graph via the GRAPHIFY_OUT env var the runner injects — no report content
    or graph path is carried on the WorkRequest or in any prompt.
    """

    def test_workrequest_has_no_graph_context_field(self):
        wr = WorkRequest(source_type="prompt", title="t", description="d")
        assert not hasattr(wr, "graph_context")

    def test_attach_graph_report_is_gone(self):
        import worca.orchestrator.work_request as wr_mod

        assert not hasattr(wr_mod, "attach_graph_report")
        assert not hasattr(wr_mod, "GRAPH_REPORT_MAX_BYTES_DEFAULT")
