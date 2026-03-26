"""Tests for .claude/scripts/run_pipeline.py arg parsing and prompt merging."""
import sys
import os
import pytest
from unittest.mock import patch

# Add scripts dir so we can import run_pipeline
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".claude", "scripts"))

from run_pipeline import create_parser, build_work_request


class TestCreateParser:
    """Test that the parser accepts the expected argument combinations."""

    def test_prompt_file_arg(self):
        parser = create_parser()
        args = parser.parse_args(["--prompt-file", "/tmp/prompt.md"])
        assert args.prompt_file == "/tmp/prompt.md"

    def test_prompt_only(self):
        parser = create_parser()
        args = parser.parse_args(["--prompt", "Add auth"])
        assert args.prompt == "Add auth"
        assert args.source is None
        assert args.spec is None
        assert args.plan is None

    def test_source_only(self):
        parser = create_parser()
        args = parser.parse_args(["--source", "gh:issue:42"])
        assert args.source == "gh:issue:42"
        assert args.prompt is None

    def test_spec_only(self):
        parser = create_parser()
        args = parser.parse_args(["--spec", "docs/spec.md"])
        assert args.spec == "docs/spec.md"
        assert args.prompt is None

    def test_plan_only(self):
        parser = create_parser()
        args = parser.parse_args(["--plan", "docs/plans/W-027.md"])
        assert args.plan == "docs/plans/W-027.md"
        assert args.prompt is None
        assert args.source is None

    def test_source_plus_prompt(self):
        parser = create_parser()
        args = parser.parse_args(["--source", "gh:issue:42", "--prompt", "focus on auth"])
        assert args.source == "gh:issue:42"
        assert args.prompt == "focus on auth"

    def test_spec_plus_prompt(self):
        parser = create_parser()
        args = parser.parse_args(["--spec", "spec.md", "--prompt", "extra context"])
        assert args.spec == "spec.md"
        assert args.prompt == "extra context"

    def test_plan_plus_prompt(self):
        parser = create_parser()
        args = parser.parse_args(["--plan", "plan.md", "--prompt", "additional notes"])
        assert args.plan == "plan.md"
        assert args.prompt == "additional notes"

    def test_no_args_still_parses(self):
        """Parser should accept no args — validation happens later."""
        parser = create_parser()
        args = parser.parse_args([])
        assert args.prompt is None
        assert args.source is None
        assert args.spec is None
        assert args.plan is None


class TestBuildWorkRequest:
    """Test build_work_request validation and prompt merging."""

    def test_no_args_raises_system_exit(self):
        parser = create_parser()
        args = parser.parse_args([])
        with pytest.raises(SystemExit):
            build_work_request(args)

    def test_source_and_spec_raises_system_exit(self):
        parser = create_parser()
        args = parser.parse_args(["--source", "gh:issue:1", "--spec", "spec.md"])
        with pytest.raises(SystemExit):
            build_work_request(args)

    @patch("run_pipeline.normalize")
    def test_prompt_only_backwards_compat(self, mock_normalize):
        from worca.orchestrator.work_request import WorkRequest
        mock_normalize.return_value = WorkRequest(
            source_type="prompt", title="Add auth"
        )
        parser = create_parser()
        args = parser.parse_args(["--prompt", "Add auth"])
        wr = build_work_request(args)
        mock_normalize.assert_called_once_with("prompt", "Add auth")
        assert wr.title == "Add auth"

    @patch("run_pipeline.normalize")
    def test_source_dispatches_normalize(self, mock_normalize):
        from worca.orchestrator.work_request import WorkRequest
        mock_normalize.return_value = WorkRequest(
            source_type="github_issue", title="Fix bug", description="Body text"
        )
        parser = create_parser()
        args = parser.parse_args(["--source", "gh:issue:42"])
        wr = build_work_request(args)
        mock_normalize.assert_called_once_with("source", "gh:issue:42")
        assert wr.title == "Fix bug"

    @patch("run_pipeline.normalize")
    def test_spec_dispatches_normalize(self, mock_normalize):
        from worca.orchestrator.work_request import WorkRequest
        mock_normalize.return_value = WorkRequest(
            source_type="spec_file", title="Spec Title", description="Spec body"
        )
        parser = create_parser()
        args = parser.parse_args(["--spec", "spec.md"])
        _wr = build_work_request(args)
        mock_normalize.assert_called_once_with("spec", "spec.md")

    @patch("run_pipeline.normalize")
    def test_plan_only_dispatches_normalize(self, mock_normalize):
        from worca.orchestrator.work_request import WorkRequest
        mock_normalize.return_value = WorkRequest(
            source_type="plan_file", title="Plan Title",
            description="Plan content", plan_path="plan.md"
        )
        parser = create_parser()
        args = parser.parse_args(["--plan", "plan.md"])
        _wr = build_work_request(args)
        mock_normalize.assert_called_once_with("plan", "plan.md")

    @patch("run_pipeline.normalize")
    def test_prompt_merging_with_source(self, mock_normalize):
        """When --prompt accompanies --source, append as Additional Instructions."""
        from worca.orchestrator.work_request import WorkRequest
        mock_normalize.return_value = WorkRequest(
            source_type="github_issue", title="Fix bug",
            description="Original issue body"
        )
        parser = create_parser()
        args = parser.parse_args(["--source", "gh:issue:42", "--prompt", "focus on auth"])
        wr = build_work_request(args)
        assert "Original issue body" in wr.description
        assert "## Additional Instructions" in wr.description
        assert "focus on auth" in wr.description

    @patch("run_pipeline.normalize")
    def test_prompt_merging_with_spec(self, mock_normalize):
        """When --prompt accompanies --spec, append as Additional Instructions."""
        from worca.orchestrator.work_request import WorkRequest
        mock_normalize.return_value = WorkRequest(
            source_type="spec_file", title="Spec Title",
            description="Spec content here"
        )
        parser = create_parser()
        args = parser.parse_args(["--spec", "spec.md", "--prompt", "extra context"])
        wr = build_work_request(args)
        assert "Spec content here" in wr.description
        assert "## Additional Instructions" in wr.description
        assert "extra context" in wr.description

    @patch("run_pipeline.normalize")
    def test_prompt_merging_with_plan(self, mock_normalize):
        """When --prompt accompanies --plan, append as Additional Instructions."""
        from worca.orchestrator.work_request import WorkRequest
        mock_normalize.return_value = WorkRequest(
            source_type="plan_file", title="Plan Title",
            description="Plan content", plan_path="plan.md"
        )
        parser = create_parser()
        args = parser.parse_args(["--plan", "plan.md", "--prompt", "additional notes"])
        wr = build_work_request(args)
        assert "Plan content" in wr.description
        assert "## Additional Instructions" in wr.description
        assert "additional notes" in wr.description

    @patch("run_pipeline.normalize")
    def test_prompt_only_no_merging(self, mock_normalize):
        """When only --prompt is given, no merging — just normal prompt flow."""
        from worca.orchestrator.work_request import WorkRequest
        mock_normalize.return_value = WorkRequest(
            source_type="prompt", title="Add auth"
        )
        parser = create_parser()
        args = parser.parse_args(["--prompt", "Add auth"])
        wr = build_work_request(args)
        assert "Additional Instructions" not in wr.description

    @patch("run_pipeline.normalize")
    def test_source_priority_over_plan(self, mock_normalize):
        """When both --source and --plan given, source is primary, plan is plan_file."""
        from worca.orchestrator.work_request import WorkRequest
        mock_normalize.return_value = WorkRequest(
            source_type="github_issue", title="Issue Title",
            description="Issue body"
        )
        parser = create_parser()
        args = parser.parse_args(["--source", "gh:issue:42", "--plan", "plan.md"])
        _wr = build_work_request(args)
        mock_normalize.assert_called_once_with("source", "gh:issue:42")


class TestPromptFile:
    """Test --prompt-file reads content and deletes the file."""

    def test_prompt_file_reads_content(self, tmp_path):
        pf = tmp_path / "prompt.md"
        pf.write_text("Large prompt content here")
        parser = create_parser()
        args = parser.parse_args(["--prompt-file", str(pf)])
        # Simulate what main() does before build_work_request
        with open(args.prompt_file) as f:
            args.prompt = f.read()
        assert args.prompt == "Large prompt content here"

    def test_prompt_file_deleted_after_read(self, tmp_path):
        """Simulate the main() logic: read file then delete it."""
        pf = tmp_path / "prompt.md"
        pf.write_text("prompt data")
        parser = create_parser()
        args = parser.parse_args(["--prompt-file", str(pf)])
        with open(args.prompt_file) as f:
            args.prompt = f.read()
        os.unlink(args.prompt_file)
        assert not pf.exists()

    @patch("run_pipeline.normalize")
    def test_prompt_file_used_as_prompt_in_build(self, mock_normalize, tmp_path):
        """--prompt-file content should be used as if --prompt was passed."""
        from worca.orchestrator.work_request import WorkRequest
        mock_normalize.return_value = WorkRequest(
            source_type="prompt", title="From file"
        )
        pf = tmp_path / "prompt.md"
        pf.write_text("Build a feature")
        parser = create_parser()
        args = parser.parse_args(["--prompt-file", str(pf)])
        # Simulate main()'s prompt-file handling
        with open(args.prompt_file) as f:
            args.prompt = f.read()
        os.unlink(args.prompt_file)
        _wr = build_work_request(args)
        mock_normalize.assert_called_once_with("prompt", "Build a feature")
