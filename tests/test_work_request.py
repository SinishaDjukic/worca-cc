"""Tests for worca.orchestrator.work_request module."""
import json
import subprocess
from unittest.mock import patch, MagicMock, ANY

from worca.orchestrator.work_request import (
    WorkRequest,
    _extract_plan_path,
    generate_smart_title,
    normalize_plan_file,
    normalize_prompt,
    normalize_spec_file,
    normalize_github_issue,
    normalize_beads_task,
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
        # Verify claude was called with haiku model
        args = mock_run.call_args
        cmd = args[0][0]
        assert "claude" in cmd
        assert "--model" in cmd
        assert "haiku" in cmd

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

    def test_prompt_has_no_description(self):
        wr = normalize_prompt("Refactor logging")
        assert wr.description == ""

    def test_prompt_default_priority(self):
        wr = normalize_prompt("task")
        assert wr.priority == 2


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

    def test_ignores_non_plan_links(self):
        body = "See [README](README.md) and [docs](docs/other.md)"
        assert _extract_plan_path(body) is None


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
