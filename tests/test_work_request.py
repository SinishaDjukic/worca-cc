"""Tests for worca.orchestrator.work_request module."""
import json
from unittest.mock import patch, MagicMock, ANY

from worca.orchestrator.work_request import (
    WorkRequest,
    _extract_plan_path,
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
    def test_extracts_title_from_heading(self, tmp_path):
        spec = tmp_path / "auth.md"
        spec.write_text("# User Authentication\n\nAdd login flow.")
        wr = normalize_spec_file(str(spec))
        assert wr.source_type == "spec_file"
        assert wr.title == "User Authentication"
        assert "login flow" in wr.description
        assert wr.source_ref == str(spec)

    def test_uses_filename_when_no_heading(self, tmp_path):
        spec = tmp_path / "notes.md"
        spec.write_text("Just some notes without a heading.")
        wr = normalize_spec_file(str(spec))
        assert wr.title == "notes.md"

    def test_full_content_in_description(self, tmp_path):
        content = "# Title\n\nLine 1\nLine 2"
        spec = tmp_path / "full.md"
        spec.write_text(content)
        wr = normalize_spec_file(str(spec))
        assert wr.description == content

    def test_extracts_h2_heading(self, tmp_path):
        spec = tmp_path / "h2.md"
        spec.write_text("## Subsection Title\n\nContent here.")
        wr = normalize_spec_file(str(spec))
        assert wr.title == "Subsection Title"


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

    def test_dispatches_spec(self, tmp_path):
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
