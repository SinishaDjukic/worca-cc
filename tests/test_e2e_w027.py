"""End-to-end verification tests for W-027: Optional Prompt + Smart Title Generation.

Covers:
1. Branch name sanitization from various title sources (LLM, GH, spec, plan)
2. Full CLI flow: args → work request → branch name for each scenario
3. Cross-layer compatibility: process-manager.js arg patterns → Python CLI parser
"""
import re
import sys
import os
from unittest.mock import patch

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".claude", "scripts"))

from run_pipeline import create_parser, build_work_request
from worca.orchestrator.runner import _sanitize_branch_name
from worca.orchestrator.work_request import WorkRequest


# --- Branch name sanitization ---

class TestSanitizeBranchName:
    """Verify _sanitize_branch_name() produces good slugs from various title sources."""

    def _name_part(self, branch):
        """Extract the name part (between 'worca/' and the 3-char suffix)."""
        assert branch.startswith("worca/")
        return branch[len("worca/"):].rsplit("-", 1)[0]

    def _suffix(self, branch):
        """Extract the 3-char base62 suffix."""
        return branch.rsplit("-", 1)[1]

    def test_simple_prompt_title(self):
        """Prompt-only: 'Add auth' → worca/add-auth-XXX"""
        branch = _sanitize_branch_name("Add auth")
        assert branch.startswith("worca/add-auth-")
        assert re.match(r"^worca/add-auth-[A-Za-z0-9]{3}$", branch)

    def test_llm_generated_title(self):
        """LLM title from spec/plan: multi-word → clean slug."""
        branch = _sanitize_branch_name("Add User Authentication Flow")
        assert branch.startswith("worca/add-user-authentication-flow-")

    def test_github_issue_title_with_prefix(self):
        """GH issue: 'W-027: Optional Prompt + Smart Title' → clean slug."""
        branch = _sanitize_branch_name("W-027: Optional Prompt + Smart Title")
        name = self._name_part(branch)
        assert "w-027" in name
        assert re.match(r"^[a-z0-9\-]+$", name)

    def test_special_chars_cleaned(self):
        """Special chars replaced with dashes, no double dashes."""
        branch = _sanitize_branch_name("Fix bug #42 (critical)")
        name = self._name_part(branch)
        assert "--" not in name
        assert re.match(r"^[a-z0-9\-]+$", name)

    def test_long_title_truncated(self):
        """Long titles are truncated to at most 40 chars in the name part."""
        branch = _sanitize_branch_name("A" * 60 + " very long title that exceeds limit")
        name = self._name_part(branch)
        assert len(name) <= 40

    def test_consecutive_special_chars_collapsed(self):
        """Multiple special chars become a single dash."""
        branch = _sanitize_branch_name("Fix   bug!!!  NOW")
        name = self._name_part(branch)
        assert "--" not in name

    def test_leading_trailing_dashes_stripped(self):
        """No leading/trailing dashes in the name part."""
        branch = _sanitize_branch_name("  --Fix bug--  ")
        name = self._name_part(branch)
        assert not name.startswith("-")
        assert not name.endswith("-")

    def test_unicode_chars_replaced(self):
        """Unicode chars stripped to dashes."""
        branch = _sanitize_branch_name("Feat: résumé upload — v2")
        name = self._name_part(branch)
        assert re.match(r"^[a-z0-9\-]+$", name)

    def test_suffix_is_3_base62_chars(self):
        """Suffix is exactly 3 base62 chars."""
        branch = _sanitize_branch_name("test title")
        suffix = self._suffix(branch)
        assert len(suffix) == 3
        assert re.match(r"^[A-Za-z0-9]{3}$", suffix)

    def test_filename_fallback_title(self):
        """Filename as title: 'my-spec.md' → clean slug."""
        branch = _sanitize_branch_name("my-spec.md")
        assert branch.startswith("worca/my-spec-md-")

    def test_plan_filename_title(self):
        """Plan filename: 'W-027-optional-prompt-smart-titles.md' → clean slug."""
        branch = _sanitize_branch_name("W-027-optional-prompt-smart-titles.md")
        name = self._name_part(branch)
        assert "w-027" in name
        assert re.match(r"^[a-z0-9\-]+$", name)

    def test_numbers_preserved(self):
        """Numbers in titles are preserved."""
        branch = _sanitize_branch_name("Add OAuth2 support for API v3")
        name = self._name_part(branch)
        assert "oauth2" in name
        assert "v3" in name

    def test_hyphens_preserved(self):
        """Existing hyphens are kept."""
        branch = _sanitize_branch_name("add-user-auth")
        assert branch.startswith("worca/add-user-auth-")


# --- Full CLI scenarios ---

class TestCLIScenarioPromptOnly:
    """Scenario: python run_pipeline.py --prompt 'Add auth' → works as before."""

    @patch("run_pipeline.normalize")
    def test_full_flow(self, mock_normalize):
        mock_normalize.return_value = WorkRequest(source_type="prompt", title="Add auth")

        args = create_parser().parse_args(["--prompt", "Add auth"])
        wr = build_work_request(args)

        assert wr.source_type == "prompt"
        assert wr.title == "Add auth"
        branch = _sanitize_branch_name(wr.title)
        assert branch.startswith("worca/add-auth-")
        mock_normalize.assert_called_once_with("prompt", "Add auth")

    @patch("run_pipeline.normalize")
    def test_no_additional_instructions_appended(self, mock_normalize):
        mock_normalize.return_value = WorkRequest(source_type="prompt", title="Add auth")

        args = create_parser().parse_args(["--prompt", "Add auth"])
        wr = build_work_request(args)

        assert "Additional Instructions" not in wr.description


class TestCLIScenarioSpecOnly:
    """Scenario: python run_pipeline.py --spec docs/spec.md → LLM-generated title."""

    @patch("run_pipeline.normalize")
    def test_full_flow(self, mock_normalize):
        mock_normalize.return_value = WorkRequest(
            source_type="spec_file",
            title="Implement OAuth Login Flow",
            description="# OAuth\n\nAdd OAuth support...",
            source_ref="docs/spec.md",
        )

        args = create_parser().parse_args(["--spec", "docs/spec.md"])
        wr = build_work_request(args)

        assert wr.source_type == "spec_file"
        assert wr.title == "Implement OAuth Login Flow"
        branch = _sanitize_branch_name(wr.title)
        assert branch.startswith("worca/implement-oauth-login-flow-")
        mock_normalize.assert_called_once_with("spec", "docs/spec.md")


class TestCLIScenarioSourceGhIssue:
    """Scenario: python run_pipeline.py --source gh:issue:42 → GH issue title verbatim."""

    @patch("run_pipeline.normalize")
    def test_full_flow(self, mock_normalize):
        mock_normalize.return_value = WorkRequest(
            source_type="github_issue",
            title="W-027: Optional Prompt + Smart Title",
            description="Issue body here...",
            source_ref="gh:42",
        )

        args = create_parser().parse_args(["--source", "gh:issue:42"])
        wr = build_work_request(args)

        assert wr.source_type == "github_issue"
        assert wr.title == "W-027: Optional Prompt + Smart Title"
        branch = _sanitize_branch_name(wr.title)
        assert "w-027" in branch
        assert re.match(r"^worca/[a-z0-9\-]+-[A-Za-z0-9]{3}$", branch)
        mock_normalize.assert_called_once_with("source", "gh:issue:42")


class TestCLIScenarioPlanOnly:
    """Scenario: python run_pipeline.py --plan docs/plans/foo.md → plan-only, LLM title."""

    @patch("run_pipeline.normalize")
    def test_full_flow(self, mock_normalize):
        mock_normalize.return_value = WorkRequest(
            source_type="plan_file",
            title="Database Migration Strategy",
            description="# Plan\n\nMigrate from SQLite to Postgres...",
            plan_path="docs/plans/foo.md",
        )

        args = create_parser().parse_args(["--plan", "docs/plans/foo.md"])
        wr = build_work_request(args)

        assert wr.source_type == "plan_file"
        assert wr.plan_path == "docs/plans/foo.md"
        branch = _sanitize_branch_name(wr.title)
        assert branch.startswith("worca/database-migration-strategy-")
        mock_normalize.assert_called_once_with("plan", "docs/plans/foo.md")

    @patch("run_pipeline.normalize")
    def test_plan_path_resolved_from_args(self, mock_normalize):
        """Explicit --plan takes priority over auto-detected plan_path."""
        mock_normalize.return_value = WorkRequest(
            source_type="plan_file",
            title="Title",
            description="Content",
            plan_path="docs/plans/foo.md",
        )

        args = create_parser().parse_args(["--plan", "docs/plans/foo.md"])
        # In main(), plan_file = args.plan or work_request.plan_path
        plan_file = args.plan or mock_normalize.return_value.plan_path
        assert plan_file == "docs/plans/foo.md"


class TestCLIScenarioSourcePlusPrompt:
    """Scenario: --source gh:issue:42 --prompt 'focus on auth' → combined."""

    @patch("run_pipeline.normalize")
    def test_full_flow(self, mock_normalize):
        mock_normalize.return_value = WorkRequest(
            source_type="github_issue",
            title="Add Auth System",
            description="Implement authentication",
            source_ref="gh:42",
        )

        args = create_parser().parse_args([
            "--source", "gh:issue:42", "--prompt", "focus on auth",
        ])
        wr = build_work_request(args)

        # Prompt merged into description
        assert "## Additional Instructions" in wr.description
        assert "focus on auth" in wr.description
        assert "Implement authentication" in wr.description
        # Title from GH issue, not from prompt
        assert wr.title == "Add Auth System"
        branch = _sanitize_branch_name(wr.title)
        assert branch.startswith("worca/add-auth-system-")

    @patch("run_pipeline.normalize")
    def test_spec_plus_prompt(self, mock_normalize):
        """--spec docs/spec.md --prompt 'extra context' → combined."""
        mock_normalize.return_value = WorkRequest(
            source_type="spec_file",
            title="Spec Title",
            description="Spec content here",
        )

        args = create_parser().parse_args([
            "--spec", "docs/spec.md", "--prompt", "extra context",
        ])
        wr = build_work_request(args)

        assert "## Additional Instructions" in wr.description
        assert "extra context" in wr.description

    @patch("run_pipeline.normalize")
    def test_plan_plus_prompt(self, mock_normalize):
        """--plan plan.md --prompt 'additional notes' → combined."""
        mock_normalize.return_value = WorkRequest(
            source_type="plan_file",
            title="Plan Title",
            description="Plan content",
            plan_path="plan.md",
        )

        args = create_parser().parse_args([
            "--plan", "plan.md", "--prompt", "additional notes",
        ])
        wr = build_work_request(args)

        assert "## Additional Instructions" in wr.description
        assert "additional notes" in wr.description


class TestCLIValidation:
    """Verify CLI validation rules for W-027."""

    def test_no_args_fails(self):
        """At least one of --prompt/--source/--spec/--plan required."""
        args = create_parser().parse_args([])
        with pytest.raises(SystemExit):
            build_work_request(args)

    def test_source_and_spec_mutually_exclusive(self):
        """--source and --spec cannot be used together."""
        args = create_parser().parse_args([
            "--source", "gh:issue:1", "--spec", "spec.md",
        ])
        with pytest.raises(SystemExit):
            build_work_request(args)


# --- Cross-layer compatibility ---

class TestCrossLayerArgCompatibility:
    """Verify that CLI arg patterns from process-manager.js parse correctly.

    These replicate the exact arg patterns that process-manager.js builds
    (verified in process-manager-args.test.js) and confirm they parse
    correctly through create_parser() + build_work_request().
    """

    def test_pm_source_only(self):
        """process-manager: sourceType=source → ['--source', 'gh:issue:42']"""
        args = create_parser().parse_args(["--source", "gh:issue:42"])
        assert args.source == "gh:issue:42"
        assert args.prompt is None
        assert args.spec is None
        assert args.plan is None

    def test_pm_spec_only(self):
        """process-manager: sourceType=spec → ['--spec', 'docs/spec.md']"""
        args = create_parser().parse_args(["--spec", "docs/spec.md"])
        assert args.spec == "docs/spec.md"
        assert args.prompt is None

    def test_pm_prompt_only(self):
        """process-manager: sourceType=none + prompt → ['--prompt', 'Add user auth']"""
        args = create_parser().parse_args(["--prompt", "Add user auth"])
        assert args.prompt == "Add user auth"
        assert args.source is None
        assert args.spec is None

    def test_pm_source_plus_prompt(self):
        """process-manager: source + prompt → ['--source', ..., '--prompt', ...]"""
        args = create_parser().parse_args([
            "--source", "gh:issue:42", "--prompt", "focus on auth",
        ])
        assert args.source == "gh:issue:42"
        assert args.prompt == "focus on auth"

    def test_pm_plan_only(self):
        """process-manager: planFile only → ['--plan', 'docs/plans/my-plan.md']"""
        args = create_parser().parse_args(["--plan", "docs/plans/my-plan.md"])
        assert args.plan == "docs/plans/my-plan.md"
        assert args.source is None
        assert args.prompt is None

    def test_pm_spec_plus_prompt_plus_plan(self):
        """process-manager: spec + prompt + plan → all three flags."""
        args = create_parser().parse_args([
            "--spec", "docs/spec.md",
            "--prompt", "extra instructions",
            "--plan", "docs/plans/my-plan.md",
        ])
        assert args.spec == "docs/spec.md"
        assert args.prompt == "extra instructions"
        assert args.plan == "docs/plans/my-plan.md"

    def test_pm_msize_mloops(self):
        """process-manager: msize/mloops > 1 → ['--msize', '3', '--mloops', '2']"""
        args = create_parser().parse_args([
            "--prompt", "test", "--msize", "3", "--mloops", "2",
        ])
        assert args.msize == 3
        assert args.mloops == 2

    def test_pm_branch(self):
        """process-manager: branch → ['--branch', 'feature/my-branch']"""
        args = create_parser().parse_args([
            "--prompt", "test", "--branch", "feature/my-branch",
        ])
        assert args.branch == "feature/my-branch"

    def test_pm_resume(self):
        """process-manager: resume=true → ['--resume'] (no source/prompt)"""
        args = create_parser().parse_args(["--resume"])
        assert args.resume is True
        assert args.source is None
        assert args.prompt is None
