"""Tests for worca.scripts.run_pipeline arg parsing and prompt merging."""
import json
import os
import pytest
from unittest.mock import patch, MagicMock

from worca.scripts.run_pipeline import create_parser, build_work_request


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

    @patch("worca.scripts.run_pipeline.normalize")
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

    @patch("worca.scripts.run_pipeline.normalize")
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

    @patch("worca.scripts.run_pipeline.normalize")
    def test_spec_dispatches_normalize(self, mock_normalize):
        from worca.orchestrator.work_request import WorkRequest
        mock_normalize.return_value = WorkRequest(
            source_type="spec_file", title="Spec Title", description="Spec body"
        )
        parser = create_parser()
        args = parser.parse_args(["--spec", "spec.md"])
        _wr = build_work_request(args)
        mock_normalize.assert_called_once_with("spec", "spec.md")

    @patch("worca.scripts.run_pipeline.normalize")
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

    @patch("worca.scripts.run_pipeline.normalize")
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

    @patch("worca.scripts.run_pipeline.normalize")
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

    @patch("worca.scripts.run_pipeline.normalize")
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

    @patch("worca.scripts.run_pipeline.normalize")
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

    @patch("worca.scripts.run_pipeline.normalize")
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

    @patch("worca.scripts.run_pipeline.normalize")
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


class TestTemplateArgs:
    """Test that --template and --param are registered in create_parser()."""

    def test_template_arg_present(self):
        parser = create_parser()
        args = parser.parse_args(["--template", "bugfix", "--prompt", "Fix login"])
        assert args.template == "bugfix"

    def test_template_absent_by_default(self):
        parser = create_parser()
        args = parser.parse_args(["--prompt", "Fix login"])
        assert args.template is None

    def test_param_arg_single(self):
        parser = create_parser()
        args = parser.parse_args([
            "--template", "bugfix", "--param", "key=val", "--prompt", "Fix",
        ])
        assert args.param == ["key=val"]

    def test_param_arg_multiple(self):
        parser = create_parser()
        args = parser.parse_args([
            "--template", "bugfix",
            "--param", "a=1",
            "--param", "b=hello",
            "--prompt", "Fix",
        ])
        assert args.param == ["a=1", "b=hello"]

    def test_param_absent_by_default(self):
        parser = create_parser()
        args = parser.parse_args(["--prompt", "Fix"])
        assert args.param is None


class TestParseParams:
    """Test the _parse_params helper."""

    def test_none_returns_empty(self):
        from worca.scripts.run_pipeline import _parse_params
        assert _parse_params(None) == {}

    def test_empty_list_returns_empty(self):
        from worca.scripts.run_pipeline import _parse_params
        assert _parse_params([]) == {}

    def test_single_pair(self):
        from worca.scripts.run_pipeline import _parse_params
        assert _parse_params(["key=val"]) == {"key": "val"}

    def test_multiple_pairs(self):
        from worca.scripts.run_pipeline import _parse_params
        assert _parse_params(["a=1", "b=two"]) == {"a": "1", "b": "two"}

    def test_value_contains_equals(self):
        from worca.scripts.run_pipeline import _parse_params
        assert _parse_params(["url=http://x.com/a=b"]) == {"url": "http://x.com/a=b"}

    def test_no_equals_raises_system_exit(self):
        from worca.scripts.run_pipeline import _parse_params
        with pytest.raises(SystemExit) as exc_info:
            _parse_params(["badformat"])
        assert exc_info.value.code == 2


class TestTemplateMain:
    """Integration tests for --template flag in main()."""

    def _make_settings(self, tmp_path, worca_config=None):
        """Write a minimal settings.json and return its path."""
        data = {"worca": worca_config or {}}
        p = tmp_path / ".claude" / "settings.json"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(data))
        return str(p)

    def test_unknown_template_exits_with_error(self, tmp_path, capsys):
        from worca.scripts.run_pipeline import main
        from worca.orchestrator.templates import TemplateError
        settings_path = self._make_settings(tmp_path)

        mock_resolver = MagicMock()
        mock_resolver.apply.side_effect = TemplateError("Template 'nope' not found.", "not_found")

        with patch("sys.argv", [
            "run_pipeline.py", "--prompt", "Fix bug",
            "--template", "nope",
            "--settings", settings_path,
            "--status-dir", str(tmp_path / ".worca"),
        ]):
            with patch("worca.scripts.run_pipeline._make_template_resolver", return_value=mock_resolver):
                with pytest.raises(SystemExit) as exc_info:
                    main()
        assert exc_info.value.code == 2
        captured = capsys.readouterr()
        assert "nope" in captured.err

    @patch("worca.scripts.run_pipeline.run_pipeline")
    def test_template_config_merged_before_launch(self, mock_run_pipeline, tmp_path):
        """Template apply() is called with current worca config; merged settings passed to runner."""
        from worca.scripts.run_pipeline import main

        settings_path = self._make_settings(tmp_path, {"loops": {"test": 2}})

        # Capture the temp settings content before the finally block deletes it
        captured_settings = {}

        def capture_and_return(*args, **kwargs):
            temp_path = kwargs.get("settings_path", "")
            if temp_path and os.path.exists(temp_path):
                with open(temp_path) as f:
                    captured_settings["data"] = json.load(f)
                captured_settings["path"] = temp_path
            return {"pipeline_status": "completed", "run_id": "run-001"}

        mock_run_pipeline.side_effect = capture_and_return

        mock_resolver = MagicMock()
        mock_resolver.apply.return_value = {"loops": {"test": 3}, "stages": {}}
        mock_resolver.get.return_value = MagicMock(agents_dir=None)

        with patch("sys.argv", [
            "run_pipeline.py", "--prompt", "Fix bug",
            "--template", "bugfix",
            "--settings", settings_path,
            "--status-dir", str(tmp_path / ".worca"),
        ]):
            with patch("worca.scripts.run_pipeline._make_template_resolver", return_value=mock_resolver):
                with patch("worca.scripts.run_pipeline.normalize") as mock_norm:
                    from worca.orchestrator.work_request import WorkRequest
                    mock_norm.return_value = WorkRequest(source_type="prompt", title="Fix bug")
                    main()

        # apply() called with current worca config
        mock_resolver.apply.assert_called_once()
        call_args = mock_resolver.apply.call_args
        assert call_args[0][0] == "bugfix"
        assert call_args[0][1] == {"loops": {"test": 2}}

        # run_pipeline called with a temp settings path (not the original)
        call_kwargs = mock_run_pipeline.call_args[1]
        assert call_kwargs["settings_path"] != settings_path

        # Temp file contained merged worca config at call time
        assert "data" in captured_settings, "Temp settings file was not readable during run_pipeline call"
        assert captured_settings["data"]["worca"]["loops"]["test"] == 3

    @patch("worca.scripts.run_pipeline.run_pipeline")
    def test_template_snapshot_written_to_run_dir(self, mock_run_pipeline, tmp_path):
        """After run_pipeline returns, snapshot_to_run is called with the correct run_dir."""
        from worca.scripts.run_pipeline import main

        settings_path = self._make_settings(tmp_path)
        status_dir = tmp_path / ".worca"
        run_id = "20260408-120000-123-abcd"
        mock_run_pipeline.return_value = {"pipeline_status": "completed", "run_id": run_id}

        mock_resolver = MagicMock()
        mock_resolver.apply.return_value = {}
        mock_resolver.get.return_value = MagicMock(agents_dir=None)

        with patch("sys.argv", [
            "run_pipeline.py", "--prompt", "Fix bug",
            "--template", "bugfix",
            "--settings", settings_path,
            "--status-dir", str(status_dir),
        ]):
            with patch("worca.scripts.run_pipeline._make_template_resolver", return_value=mock_resolver):
                with patch("worca.scripts.run_pipeline.normalize") as mock_norm:
                    from worca.orchestrator.work_request import WorkRequest
                    mock_norm.return_value = WorkRequest(source_type="prompt", title="Fix bug")
                    main()

        expected_run_dir = str(status_dir / "runs" / run_id)
        mock_resolver.snapshot_to_run.assert_called_once_with("bugfix", expected_run_dir, {})

    @patch("worca.scripts.run_pipeline.run_pipeline")
    def test_param_overrides_passed_to_apply_and_snapshot(self, mock_run_pipeline, tmp_path):
        """--param values are parsed and forwarded to apply() and snapshot_to_run()."""
        from worca.scripts.run_pipeline import main

        settings_path = self._make_settings(tmp_path)
        status_dir = tmp_path / ".worca"
        run_id = "20260408-120000-456-efgh"
        mock_run_pipeline.return_value = {"pipeline_status": "completed", "run_id": run_id}

        mock_resolver = MagicMock()
        mock_resolver.apply.return_value = {}
        mock_resolver.get.return_value = MagicMock(agents_dir=None)

        with patch("sys.argv", [
            "run_pipeline.py", "--prompt", "Fix bug",
            "--template", "quick-fix",
            "--param", "severity=high",
            "--param", "scope=auth",
            "--settings", settings_path,
            "--status-dir", str(status_dir),
        ]):
            with patch("worca.scripts.run_pipeline._make_template_resolver", return_value=mock_resolver):
                with patch("worca.scripts.run_pipeline.normalize") as mock_norm:
                    from worca.orchestrator.work_request import WorkRequest
                    mock_norm.return_value = WorkRequest(source_type="prompt", title="Fix bug")
                    main()

        expected_params = {"severity": "high", "scope": "auth"}
        # params forwarded to apply()
        assert mock_resolver.apply.call_args[0][2] == expected_params
        # params forwarded to snapshot_to_run()
        mock_resolver.snapshot_to_run.assert_called_once_with(
            "quick-fix",
            str(status_dir / "runs" / run_id),
            expected_params,
        )

    @patch("worca.scripts.run_pipeline.run_pipeline")
    def test_merged_settings_written_to_run_dir(self, mock_run_pipeline, tmp_path):
        """After template run, merged settings.json is written to run_dir."""
        from worca.scripts.run_pipeline import main

        settings_path = self._make_settings(tmp_path, {"loops": {"test": 1}})
        status_dir = tmp_path / ".worca"
        run_id = "20260408-120000-789-ijkl"
        run_dir = status_dir / "runs" / run_id
        run_dir.mkdir(parents=True, exist_ok=True)

        mock_run_pipeline.return_value = {"pipeline_status": "completed", "run_id": run_id}

        mock_resolver = MagicMock()
        mock_resolver.apply.return_value = {"loops": {"test": 5}}
        mock_resolver.get.return_value = MagicMock(agents_dir=None)
        mock_resolver.snapshot_to_run.return_value = None

        with patch("sys.argv", [
            "run_pipeline.py", "--prompt", "Fix bug",
            "--template", "bugfix",
            "--settings", settings_path,
            "--status-dir", str(status_dir),
        ]):
            with patch("worca.scripts.run_pipeline._make_template_resolver", return_value=mock_resolver):
                with patch("worca.scripts.run_pipeline.normalize") as mock_norm:
                    from worca.orchestrator.work_request import WorkRequest
                    mock_norm.return_value = WorkRequest(source_type="prompt", title="Fix bug")
                    main()

        settings_file = run_dir / "settings.json"
        assert settings_file.exists(), "settings.json should be written to run_dir"
        written = json.loads(settings_file.read_text())
        assert written["worca"]["loops"]["test"] == 5

    @patch("worca.scripts.run_pipeline.run_pipeline")
    def test_no_template_no_regression(self, mock_run_pipeline, tmp_path):
        """Without --template, run_pipeline is called with the original settings path."""
        from worca.scripts.run_pipeline import main

        settings_path = self._make_settings(tmp_path)
        mock_run_pipeline.return_value = {"pipeline_status": "completed", "run_id": "run-001"}

        with patch("sys.argv", [
            "run_pipeline.py", "--prompt", "Fix bug",
            "--settings", settings_path,
            "--status-dir", str(tmp_path / ".worca"),
        ]):
            with patch("worca.scripts.run_pipeline.normalize") as mock_norm:
                from worca.orchestrator.work_request import WorkRequest
                mock_norm.return_value = WorkRequest(source_type="prompt", title="Fix bug")
                main()

        call_kwargs = mock_run_pipeline.call_args[1]
        assert call_kwargs["settings_path"] == settings_path

    @patch("worca.scripts.run_pipeline.run_pipeline")
    def test_agents_dir_stored_in_merged_settings(self, mock_run_pipeline, tmp_path):
        """If template has agents_dir, it is stored in merged worca config."""
        from worca.scripts.run_pipeline import main

        settings_path = self._make_settings(tmp_path)
        status_dir = tmp_path / ".worca"
        run_id = "20260408-120000-000-mnop"
        run_dir = status_dir / "runs" / run_id
        run_dir.mkdir(parents=True, exist_ok=True)

        captured_settings = {}

        def capture_and_return(*args, **kwargs):
            temp_path = kwargs.get("settings_path", "")
            if temp_path and os.path.exists(temp_path):
                with open(temp_path) as f:
                    captured_settings["data"] = json.load(f)
            return {"pipeline_status": "completed", "run_id": run_id}

        mock_run_pipeline.side_effect = capture_and_return

        mock_resolver = MagicMock()
        mock_resolver.apply.return_value = {}
        mock_template = MagicMock()
        mock_template.agents_dir = "/some/template/agents"
        mock_resolver.get.return_value = mock_template
        mock_resolver.snapshot_to_run.return_value = None

        with patch("sys.argv", [
            "run_pipeline.py", "--prompt", "Fix bug",
            "--template", "bugfix",
            "--settings", settings_path,
            "--status-dir", str(status_dir),
        ]):
            with patch("worca.scripts.run_pipeline._make_template_resolver", return_value=mock_resolver):
                with patch("worca.scripts.run_pipeline.normalize") as mock_norm:
                    from worca.orchestrator.work_request import WorkRequest
                    mock_norm.return_value = WorkRequest(source_type="prompt", title="Fix bug")
                    main()

        assert "data" in captured_settings, "Temp settings file was not readable during run_pipeline call"
        assert captured_settings["data"]["worca"].get("_template_agents_dir") == "/some/template/agents"
