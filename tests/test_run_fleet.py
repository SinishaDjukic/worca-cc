"""Tests for worca.scripts.run_fleet — arg parser skeleton + provisioning (W-040 Phase 2a)."""
import subprocess
import pytest
from unittest.mock import patch


def _completed(stdout="", stderr="", returncode=0):
    return subprocess.CompletedProcess(
        args=[], returncode=returncode, stdout=stdout, stderr=stderr
    )


class TestCreateParser:
    """Arg parser shape tests — pure-function, no subprocess."""

    def _parse(self, argv):
        from worca.scripts.run_fleet import create_parser
        return create_parser().parse_args(argv)

    # --- project targets ---

    def test_projects_single(self):
        args = self._parse(["--projects", "/repo/a", "--prompt", "x"])
        assert args.projects == ["/repo/a"]

    def test_projects_multiple(self):
        args = self._parse(["--projects", "/repo/a", "/repo/b", "--prompt", "x"])
        assert args.projects == ["/repo/a", "/repo/b"]

    def test_projects_file_flag(self):
        args = self._parse(["--projects-file", "repos.txt", "--prompt", "x"])
        assert args.projects_file == "repos.txt"

    def test_projects_absent_by_default(self):
        args = self._parse(["--prompt", "x"])
        assert args.projects is None

    def test_projects_file_absent_by_default(self):
        args = self._parse(["--prompt", "x"])
        assert args.projects_file is None

    # --- work request source ---

    def test_prompt_flag(self):
        args = self._parse(["--projects", "/repo/a", "--prompt", "Migrate auth"])
        assert args.prompt == "Migrate auth"

    def test_source_flag(self):
        args = self._parse(["--projects", "/repo/a", "--source", "gh:issue:42"])
        assert args.source == "gh:issue:42"

    def test_prompt_absent_by_default(self):
        args = self._parse(["--projects", "/repo/a"])
        assert args.prompt is None

    def test_source_absent_by_default(self):
        args = self._parse(["--projects", "/repo/a"])
        assert args.source is None

    def test_spec_flag(self):
        args = self._parse(["--projects", "/repo/a", "--spec", "docs/spec.md"])
        assert args.spec == "docs/spec.md"

    def test_spec_absent_by_default(self):
        args = self._parse(["--projects", "/repo/a"])
        assert args.spec is None

    # --- branch flags (§4 semantics) ---

    def test_head_template_flag(self):
        args = self._parse([
            "--projects", "/repo/a", "--prompt", "x",
            "--head-template", "migration/v2/{project}",
        ])
        assert args.head_template == "migration/v2/{project}"

    def test_head_template_absent_by_default(self):
        args = self._parse(["--projects", "/repo/a", "--prompt", "x"])
        assert args.head_template is None

    def test_base_flag(self):
        args = self._parse([
            "--projects", "/repo/a", "--prompt", "x",
            "--base", "dev",
        ])
        assert args.base == "dev"

    def test_base_absent_by_default(self):
        args = self._parse(["--projects", "/repo/a", "--prompt", "x"])
        assert args.base is None

    # --- guide ---

    def test_guide_single(self):
        args = self._parse([
            "--projects", "/repo/a", "--prompt", "x",
            "--guide", "docs/spec.md",
        ])
        assert args.guide == ["docs/spec.md"]

    def test_guide_repeatable(self):
        args = self._parse([
            "--projects", "/repo/a", "--prompt", "x",
            "--guide", "a.md", "--guide", "b.md",
        ])
        assert args.guide == ["a.md", "b.md"]

    def test_guide_absent_by_default(self):
        args = self._parse(["--projects", "/repo/a", "--prompt", "x"])
        assert args.guide is None

    # --- plan modes ---

    def test_plan_flag(self):
        args = self._parse([
            "--projects", "/repo/a", "--prompt", "x",
            "--plan", "docs/plans/W-040.md",
        ])
        assert args.plan == "docs/plans/W-040.md"

    def test_plan_absent_by_default(self):
        args = self._parse(["--projects", "/repo/a", "--prompt", "x"])
        assert args.plan is None

    def test_plan_first_flag_no_arg(self):
        args = self._parse([
            "--projects", "/repo/a", "/repo/b", "--prompt", "x",
            "--plan-first",
        ])
        assert args.plan_first is True

    def test_plan_first_absent_by_default(self):
        args = self._parse(["--projects", "/repo/a", "--prompt", "x"])
        assert args.plan_first is False

    # --- concurrency / circuit breaker ---

    def test_max_parallel_flag(self):
        args = self._parse([
            "--projects", "/repo/a", "--prompt", "x",
            "--max-parallel", "3",
        ])
        assert args.max_parallel == 3

    def test_max_parallel_default(self):
        args = self._parse(["--projects", "/repo/a", "--prompt", "x"])
        assert args.max_parallel == 5

    def test_fleet_failure_threshold_flag(self):
        args = self._parse([
            "--projects", "/repo/a", "--prompt", "x",
            "--fleet-failure-threshold", "0.5",
        ])
        assert args.fleet_failure_threshold == pytest.approx(0.5)

    def test_fleet_failure_threshold_default(self):
        args = self._parse(["--projects", "/repo/a", "--prompt", "x"])
        assert args.fleet_failure_threshold == pytest.approx(0.30)

    # --- resume ---

    def test_resume_flag(self):
        args = self._parse(["--resume", "f_20260512_abc"])
        assert args.resume == "f_20260512_abc"

    def test_resume_absent_by_default(self):
        args = self._parse(["--projects", "/repo/a", "--prompt", "x"])
        assert args.resume is None


class TestBranchFlagRejected:
    """--branch must be explicitly rejected at argparse time per §4."""

    def test_branch_flag_exits_with_error(self, capsys):
        from worca.scripts.run_fleet import create_parser
        with pytest.raises(SystemExit) as exc_info:
            create_parser().parse_args([
                "--projects", "/repo/a", "--prompt", "x",
                "--branch", "dev",
            ])
        assert exc_info.value.code != 0

    def test_branch_error_message_references_base(self, capsys):
        from worca.scripts.run_fleet import create_parser
        with pytest.raises(SystemExit):
            create_parser().parse_args([
                "--projects", "/repo/a", "--prompt", "x",
                "--branch", "dev",
            ])
        captured = capsys.readouterr()
        output = captured.err + captured.out
        assert "--base" in output

    def test_branch_error_message_references_head_template(self, capsys):
        from worca.scripts.run_fleet import create_parser
        with pytest.raises(SystemExit):
            create_parser().parse_args([
                "--projects", "/repo/a", "--prompt", "x",
                "--branch", "dev",
            ])
        captured = capsys.readouterr()
        output = captured.err + captured.out
        assert "--head-template" in output


class TestMainStub:
    """main() skeleton — exits cleanly without dispatching real work."""

    def test_main_returns_int(self, tmp_path):
        """main() must return an integer exit code."""
        from worca.scripts.run_fleet import main
        with patch("worca.scripts.run_fleet.check_target_readiness", return_value=(True, None)):
            result = main(["--projects", str(tmp_path), "--prompt", "x"])
        assert isinstance(result, int)

    def test_main_missing_work_request_exits_nonzero(self):
        from worca.scripts.run_fleet import main
        result = main(["--projects", "/repo/a"])
        assert result != 0


class TestMainLifecycleActions:
    """main() dispatches --pause / --stop to fleet_lifecycle and is mutually
    exclusive with --resume."""

    def test_pause_delegates_to_pause_fleet(self):
        from worca.scripts.run_fleet import main
        with patch(
            "worca.orchestrator.fleet_lifecycle.pause_fleet", return_value=2
        ) as mock_pause:
            result = main(["--pause", "f_202601010000_abcd1234"])
        assert result == 0
        mock_pause.assert_called_once_with("f_202601010000_abcd1234")

    def test_stop_delegates_to_stop_fleet(self):
        from worca.scripts.run_fleet import main
        with patch(
            "worca.orchestrator.fleet_lifecycle.stop_fleet", return_value=1
        ) as mock_stop:
            result = main(["--stop", "f_202601010000_abcd1234"])
        assert result == 0
        mock_stop.assert_called_once_with("f_202601010000_abcd1234")

    def test_pause_missing_manifest_exits_nonzero(self):
        from worca.scripts.run_fleet import main
        with patch(
            "worca.orchestrator.fleet_lifecycle.pause_fleet", return_value=None
        ):
            result = main(["--pause", "f_202601010000_abcd1234"])
        assert result == 1

    def test_stop_missing_manifest_exits_nonzero(self):
        from worca.scripts.run_fleet import main
        with patch(
            "worca.orchestrator.fleet_lifecycle.stop_fleet", return_value=None
        ):
            result = main(["--stop", "f_202601010000_abcd1234"])
        assert result == 1

    def test_resume_and_pause_mutually_exclusive(self):
        from worca.scripts.run_fleet import main
        result = main(["--resume", "f_a", "--pause", "f_b"])
        assert result == 2

    def test_pause_and_stop_mutually_exclusive(self):
        from worca.scripts.run_fleet import main
        result = main(["--pause", "f_a", "--stop", "f_b"])
        assert result == 2


class TestValidateBaseBranch:
    """Unit tests for validate_base_branch() — mocked subprocess, no real git."""

    def _call(self, projects, base, side_effect):
        from worca.scripts.run_fleet import validate_base_branch
        with patch("worca.scripts.run_fleet.subprocess.run", side_effect=side_effect):
            return validate_base_branch(projects, base)

    def test_all_present_returns_empty(self):
        result = self._call(
            ["/repo/a", "/repo/b"],
            "dev",
            [_completed("  dev\n"), _completed("  dev\n")],
        )
        assert result == []

    def test_one_missing_returns_that_path(self):
        result = self._call(
            ["/repo/a", "/repo/b"],
            "dev",
            [_completed("  dev\n"), _completed("")],
        )
        assert result == ["/repo/b"]

    def test_all_missing_returns_all_paths(self):
        result = self._call(
            ["/repo/a", "/repo/b", "/repo/c"],
            "release",
            [_completed(""), _completed(""), _completed("")],
        )
        assert result == ["/repo/a", "/repo/b", "/repo/c"]

    def test_empty_project_list_returns_empty(self):
        from worca.scripts.run_fleet import validate_base_branch
        with patch("worca.scripts.run_fleet.subprocess.run") as mock_run:
            result = validate_base_branch([], "dev")
        assert result == []
        mock_run.assert_not_called()

    def test_uses_git_C_branch_list(self):
        from worca.scripts.run_fleet import validate_base_branch
        with patch("worca.scripts.run_fleet.subprocess.run") as mock_run:
            mock_run.return_value = _completed("  main\n")
            validate_base_branch(["/repo/a"], "main")
        cmd = mock_run.call_args[0][0]
        assert cmd == ["git", "-C", "/repo/a", "branch", "--list", "main"]

    def test_whitespace_only_stdout_counts_as_missing(self):
        result = self._call(["/repo/a"], "dev", [_completed("   \n")])
        assert result == ["/repo/a"]

    def test_present_branch_stdout_not_missing(self):
        result = self._call(["/repo/a"], "main", [_completed("  main\n")])
        assert result == []


class TestMainBaseBranchValidation:
    """main() aborts with exit code 1 when --base branch is absent from some repos."""

    def test_base_missing_exits_nonzero(self):
        from worca.scripts.run_fleet import main
        with patch("worca.scripts.run_fleet.validate_base_branch", return_value=["/repo/b"]):
            result = main([
                "--projects", "/repo/a", "/repo/b",
                "--prompt", "x",
                "--base", "dev",
            ])
        assert result != 0

    def test_base_present_everywhere_continues(self):
        from worca.scripts.run_fleet import main
        with (
            patch("worca.scripts.run_fleet.validate_base_branch", return_value=[]),
            patch("worca.scripts.run_fleet.check_target_readiness", return_value=(True, None)),
            patch("worca.scripts.run_fleet.dispatch_fleet", return_value={}),
            patch("worca.orchestrator.fleet_manifest.write_fleet_manifest"),
        ):
            result = main(["--projects", "/repo/a", "--prompt", "x", "--base", "dev"])
        assert isinstance(result, int)
        assert result == 0

    def test_base_absent_skips_validation(self):
        from worca.scripts.run_fleet import main
        with (
            patch("worca.scripts.run_fleet.validate_base_branch") as mock_vbv,
            patch("worca.scripts.run_fleet.check_target_readiness", return_value=(True, None)),
            patch("worca.scripts.run_fleet.dispatch_fleet", return_value={}),
            patch("worca.orchestrator.fleet_manifest.write_fleet_manifest"),
        ):
            main(["--projects", "/repo/a", "--prompt", "x"])
        mock_vbv.assert_not_called()

    def test_error_message_lists_missing_repos(self, capsys):
        from worca.scripts.run_fleet import main
        with patch("worca.scripts.run_fleet.validate_base_branch",
                   return_value=["/repo/b", "/repo/c"]):
            main([
                "--projects", "/repo/a", "/repo/b", "/repo/c",
                "--prompt", "x",
                "--base", "dev",
            ])
        captured = capsys.readouterr()
        output = captured.err + captured.out
        assert "/repo/b" in output
        assert "/repo/c" in output

    def test_error_message_names_base_branch(self, capsys):
        from worca.scripts.run_fleet import main
        with patch("worca.scripts.run_fleet.validate_base_branch",
                   return_value=["/repo/a"]):
            main([
                "--projects", "/repo/a",
                "--prompt", "x",
                "--base", "my-branch",
            ])
        captured = capsys.readouterr()
        output = captured.err + captured.out
        assert "my-branch" in output


# ---------------------------------------------------------------------------
# Per-target readiness check (§2, post-W-040): the fleet is non-mutating —
# users must run `worca init` / `worca init --upgrade` themselves before
# launching. The fleet aborts on any unready target.
# ---------------------------------------------------------------------------


class TestCheckTargetReadiness:
    """Unit tests for check_target_readiness() — read-only, no subprocess."""

    def test_ready_when_versions_match(self, tmp_path):
        from worca.scripts.run_fleet import check_target_readiness
        worca_dir = tmp_path / ".claude" / "worca"
        worca_dir.mkdir(parents=True)
        (worca_dir / "__init__.py").write_text('__version__ = "9.9.9"\n')
        with patch("worca.__version__", "9.9.9"):
            ready, reason = check_target_readiness(str(tmp_path))
        assert ready is True
        assert reason is None

    def test_unready_when_no_worca_dir(self, tmp_path):
        from worca.scripts.run_fleet import check_target_readiness
        with patch("worca.__version__", "9.9.9"):
            ready, reason = check_target_readiness(str(tmp_path))
        assert ready is False
        assert "worca init" in reason
        assert "no .claude/worca" in reason

    def test_unready_when_versions_differ(self, tmp_path):
        from worca.scripts.run_fleet import check_target_readiness
        worca_dir = tmp_path / ".claude" / "worca"
        worca_dir.mkdir(parents=True)
        (worca_dir / "__init__.py").write_text('__version__ = "0.27.0"\n')
        with patch("worca.__version__", "0.28.0"):
            ready, reason = check_target_readiness(str(tmp_path))
        assert ready is False
        assert "0.27.0" in reason
        assert "0.28.0" in reason
        assert "worca init --upgrade" in reason

    def test_does_not_mutate_target(self, tmp_path):
        from worca.scripts.run_fleet import check_target_readiness
        worca_dir = tmp_path / ".claude" / "worca"
        worca_dir.mkdir(parents=True)
        init_file = worca_dir / "__init__.py"
        init_file.write_text('__version__ = "0.27.0"\n')
        original_mtime = init_file.stat().st_mtime
        original_contents = init_file.read_text()
        with patch("worca.__version__", "0.28.0"):
            check_target_readiness(str(tmp_path))
        # The target file is untouched by the check — the whole point of the
        # post-W-040 redesign is that fleet launches do NOT mutate targets.
        assert init_file.read_text() == original_contents
        assert init_file.stat().st_mtime == original_mtime


class TestMainReadinessCheck:
    """main() pre-flights every target before writing the manifest. Any
    unready target aborts the whole fleet with exit code 1 — no dispatch,
    no manifest write (or, when --fleet-id is set, the UI-pre-written
    manifest is updated to halted with halt_reason='targets_not_ready')."""

    def test_check_called_for_each_project(self):
        from worca.scripts.run_fleet import main
        with (
            patch("worca.scripts.run_fleet.check_target_readiness") as mock_check,
            patch("worca.scripts.run_fleet.dispatch_fleet", return_value={}),
            patch("worca.orchestrator.fleet_manifest.write_fleet_manifest"),
        ):
            mock_check.return_value = (True, None)
            result = main(["--projects", "/repo/a", "/repo/b", "--prompt", "x"])
        assert mock_check.call_count == 2
        assert result == 0

    def test_unready_target_aborts_with_nonzero_exit(self):
        from worca.scripts.run_fleet import main
        with (
            patch("worca.scripts.run_fleet.check_target_readiness") as mock_check,
            patch("worca.scripts.run_fleet.dispatch_fleet") as mock_dispatch,
            patch("worca.orchestrator.fleet_manifest.write_fleet_manifest") as mock_write,
        ):
            mock_check.return_value = (False, "no .claude/worca/ found")
            result = main(["--projects", "/repo/a", "--prompt", "x"])
        assert result == 1
        # Critical: nothing got written and nothing got dispatched.
        mock_write.assert_not_called()
        mock_dispatch.assert_not_called()

    def test_one_unready_aborts_whole_fleet(self):
        from worca.scripts.run_fleet import main
        with (
            patch("worca.scripts.run_fleet.check_target_readiness") as mock_check,
            patch("worca.scripts.run_fleet.dispatch_fleet") as mock_dispatch,
            patch("worca.orchestrator.fleet_manifest.write_fleet_manifest") as mock_write,
        ):
            mock_check.side_effect = [
                (True, None),
                (False, "no .claude/worca/ found"),
            ]
            result = main(["--projects", "/repo/a", "/repo/b", "--prompt", "x"])
        assert result == 1
        mock_write.assert_not_called()
        mock_dispatch.assert_not_called()

    def test_unready_prints_per_target_reason(self, capsys):
        from worca.scripts.run_fleet import main
        with (
            patch("worca.scripts.run_fleet.check_target_readiness") as mock_check,
            patch("worca.scripts.run_fleet.dispatch_fleet"),
            patch("worca.orchestrator.fleet_manifest.write_fleet_manifest"),
        ):
            mock_check.return_value = (False, "version 0.27.0 mismatch")
            main(["--projects", "/repo/a", "--prompt", "x"])
        err = capsys.readouterr().err
        assert "/repo/a" in err
        assert "version 0.27.0 mismatch" in err
        # The error message should also point at the manual fix.
        assert "fleet aborted" in err.lower()

    def test_unready_with_fleet_id_marks_manifest_halted(self):
        # When the UI invokes run_fleet.py with --fleet-id, the manifest is
        # already written and the dashboard is watching. We must update it
        # so the user sees a clear halt reason instead of a stuck-on-running
        # record.
        from worca.scripts.run_fleet import main
        with (
            patch("worca.scripts.run_fleet.check_target_readiness") as mock_check,
            patch("worca.scripts.run_fleet.update_fleet_status") as mock_update,
            patch("worca.scripts.run_fleet.dispatch_fleet"),
            patch("worca.orchestrator.fleet_manifest.write_fleet_manifest"),
        ):
            mock_check.return_value = (False, "no .claude/worca/ found")
            result = main([
                "--projects", "/repo/a",
                "--prompt", "x",
                "--fleet-id", "f_202601011200_abc12345",
            ])
        assert result == 1
        mock_update.assert_called_once_with(
            "f_202601011200_abc12345",
            "halted",
            halt_reason="targets_not_ready",
        )

    def test_unready_without_fleet_id_does_not_call_update_status(self):
        from worca.scripts.run_fleet import main
        with (
            patch("worca.scripts.run_fleet.check_target_readiness") as mock_check,
            patch("worca.scripts.run_fleet.update_fleet_status") as mock_update,
            patch("worca.scripts.run_fleet.dispatch_fleet"),
            patch("worca.orchestrator.fleet_manifest.write_fleet_manifest"),
        ):
            mock_check.return_value = (False, "no .claude/worca/ found")
            main(["--projects", "/repo/a", "--prompt", "x"])
        mock_update.assert_not_called()


# ---------------------------------------------------------------------------
# Phase 2b task 1 — Fleet manifest written by main() (§10)
# ---------------------------------------------------------------------------


class TestMainWritesFleetManifest:
    """main() writes an initial fleet manifest to ~/.worca/fleet-runs/<fleet_id>.json."""

    def test_manifest_written_when_projects_provided(self, tmp_path):
        from worca.scripts.run_fleet import main
        with (
            patch("worca.scripts.run_fleet.check_target_readiness", return_value=(True, None)),
            patch(
                "worca.orchestrator.fleet_manifest.write_fleet_manifest"
            ) as mock_write,
        ):
            main(["--projects", str(tmp_path), "--prompt", "Migrate auth"])
        mock_write.assert_called_once()

    def test_manifest_contains_fleet_id(self, tmp_path):
        from worca.scripts.run_fleet import main
        written = {}

        def capture(manifest, **kw):
            written.update(manifest)

        with (
            patch("worca.scripts.run_fleet.check_target_readiness", return_value=(True, None)),
            patch(
                "worca.orchestrator.fleet_manifest.write_fleet_manifest",
                side_effect=capture,
            ),
        ):
            main(["--projects", str(tmp_path), "--prompt", "Migrate auth"])
        assert "fleet_id" in written
        assert written["fleet_id"].startswith("f_")

    def test_manifest_contains_fleet_id_short(self, tmp_path):
        from worca.scripts.run_fleet import main
        written = {}

        def capture(manifest, **kw):
            written.update(manifest)

        with (
            patch("worca.scripts.run_fleet.check_target_readiness", return_value=(True, None)),
            patch(
                "worca.orchestrator.fleet_manifest.write_fleet_manifest",
                side_effect=capture,
            ),
        ):
            main(["--projects", str(tmp_path), "--prompt", "Migrate auth"])
        assert "fleet_id_short" in written
        assert written["fleet_id"].endswith(written["fleet_id_short"])

    def test_manifest_status_is_running(self, tmp_path):
        from worca.scripts.run_fleet import main
        written = {}

        def capture(manifest, **kw):
            written.update(manifest)

        with (
            patch("worca.scripts.run_fleet.check_target_readiness", return_value=(True, None)),
            patch(
                "worca.orchestrator.fleet_manifest.write_fleet_manifest",
                side_effect=capture,
            ),
        ):
            main(["--projects", str(tmp_path), "--prompt", "Migrate auth"])
        assert written["status"] == "running"
        assert written["halt_reason"] is None

    def test_manifest_guide_uploaded_false_for_cli_paths(self, tmp_path):
        from worca.scripts.run_fleet import main
        guide_file = tmp_path / "spec.md"
        guide_file.write_text("# Guide")
        written = {}

        def capture(manifest, **kw):
            written.update(manifest)

        with (
            patch("worca.scripts.run_fleet.check_target_readiness", return_value=(True, None)),
            patch(
                "worca.orchestrator.fleet_manifest.write_fleet_manifest",
                side_effect=capture,
            ),
        ):
            main([
                "--projects", str(tmp_path),
                "--prompt", "Migrate auth",
                "--guide", str(guide_file),
            ])
        assert written["guide"]["uploaded"] is False
        assert len(written["guide"]["paths"]) == 1

    def test_manifest_plan_mode_explicit_when_plan_flag(self, tmp_path):
        from worca.scripts.run_fleet import main
        written = {}

        def capture(manifest, **kw):
            written.update(manifest)

        with (
            patch("worca.scripts.run_fleet.check_target_readiness", return_value=(True, None)),
            patch(
                "worca.orchestrator.fleet_manifest.write_fleet_manifest",
                side_effect=capture,
            ),
        ):
            main([
                "--projects", str(tmp_path),
                "--prompt", "x",
                "--plan", "docs/plans/W-040.md",
            ])
        assert written["plan"]["mode"] == "explicit"

    def test_manifest_plan_mode_plan_first_when_flag(self, tmp_path):
        from worca.scripts.run_fleet import main
        written = {}

        def capture(manifest, **kw):
            written.update(manifest)

        with (
            patch("worca.scripts.run_fleet.check_target_readiness", return_value=(True, None)),
            patch(
                "worca.orchestrator.fleet_manifest.write_fleet_manifest",
                side_effect=capture,
            ),
        ):
            main([
                "--projects", str(tmp_path),
                "--prompt", "x",
                "--plan-first",
            ])
        assert written["plan"]["mode"] == "plan-first"

    def test_manifest_base_branch_from_base_flag(self, tmp_path):
        from worca.scripts.run_fleet import main
        written = {}

        def capture(manifest, **kw):
            written.update(manifest)

        with (
            patch("worca.scripts.run_fleet.validate_base_branch", return_value=[]),
            patch("worca.scripts.run_fleet.check_target_readiness", return_value=(True, None)),
            patch(
                "worca.orchestrator.fleet_manifest.write_fleet_manifest",
                side_effect=capture,
            ),
        ):
            main([
                "--projects", str(tmp_path),
                "--prompt", "x",
                "--base", "dev",
            ])
        assert written["base_branch"] == "dev"

    def test_manifest_not_written_when_no_projects(self):
        from worca.scripts.run_fleet import main
        with (
            patch(
                "worca.orchestrator.fleet_manifest.write_fleet_manifest"
            ) as mock_write,
        ):
            main(["--resume", "f_202605120809_abc123"])
        mock_write.assert_not_called()


class TestMainProjectsResolution:
    """main() resolves projects from --projects and/or --projects-file, then
    errors with exit 2 if the merged list is empty (previously the script
    would silently exit 0 when --projects-file was used alone)."""

    def _common_mocks(self):
        """Patches that let main() reach (or skip) dispatch without doing real work."""
        return (
            patch("worca.scripts.run_fleet.check_target_readiness", return_value=(True, None)),
            patch("worca.scripts.run_fleet.dispatch_fleet", return_value={}),
            patch("worca.orchestrator.fleet_manifest.write_fleet_manifest"),
        )

    def test_no_projects_at_all_exits_2(self, capsys):
        from worca.scripts.run_fleet import main
        # No --projects, no --projects-file → empty list → exit 2
        result = main(["--prompt", "x"])
        assert result == 2
        captured = capsys.readouterr()
        assert "no target projects" in captured.err

    def test_projects_file_alone_resolves_projects(self, tmp_path):
        """--projects-file alone is sufficient — was previously dead code."""
        from worca.scripts.run_fleet import main
        pf = tmp_path / "repos.txt"
        pf.write_text("/repo/a\n/repo/b\n")

        with (
            patch("worca.scripts.run_fleet.check_target_readiness", return_value=(True, None)),
            patch("worca.scripts.run_fleet.dispatch_fleet", return_value={}) as mock_dispatch,
            patch("worca.orchestrator.fleet_manifest.write_fleet_manifest"),
        ):
            result = main(["--projects-file", str(pf), "--prompt", "x"])

        assert result == 0
        # dispatch_fleet was called with both repos as targets
        kwargs = mock_dispatch.call_args[1]
        target_dirs = [t["project_dir"] for t in kwargs["targets"]]
        assert target_dirs == ["/repo/a", "/repo/b"]

    def test_projects_file_merges_with_projects_flag(self, tmp_path):
        from worca.scripts.run_fleet import main
        pf = tmp_path / "repos.txt"
        pf.write_text("/repo/b\n/repo/c\n")

        with (
            patch("worca.scripts.run_fleet.check_target_readiness", return_value=(True, None)),
            patch("worca.scripts.run_fleet.dispatch_fleet", return_value={}) as mock_dispatch,
            patch("worca.orchestrator.fleet_manifest.write_fleet_manifest"),
        ):
            main([
                "--projects", "/repo/a",
                "--projects-file", str(pf),
                "--prompt", "x",
            ])

        kwargs = mock_dispatch.call_args[1]
        target_dirs = [t["project_dir"] for t in kwargs["targets"]]
        assert target_dirs == ["/repo/a", "/repo/b", "/repo/c"]

    def test_projects_file_skips_blank_lines_and_comments(self, tmp_path):
        from worca.scripts.run_fleet import main
        pf = tmp_path / "repos.txt"
        pf.write_text(
            "# comment\n"
            "/repo/a\n"
            "\n"
            "   \n"
            "# another comment\n"
            "/repo/b\n"
        )

        with (
            patch("worca.scripts.run_fleet.check_target_readiness", return_value=(True, None)),
            patch("worca.scripts.run_fleet.dispatch_fleet", return_value={}) as mock_dispatch,
            patch("worca.orchestrator.fleet_manifest.write_fleet_manifest"),
        ):
            main(["--projects-file", str(pf), "--prompt", "x"])

        kwargs = mock_dispatch.call_args[1]
        target_dirs = [t["project_dir"] for t in kwargs["targets"]]
        assert target_dirs == ["/repo/a", "/repo/b"]

    def test_projects_file_with_only_comments_exits_2(self, tmp_path, capsys):
        """An effectively-empty file is treated the same as no file at all."""
        from worca.scripts.run_fleet import main
        pf = tmp_path / "repos.txt"
        pf.write_text("# just comments\n# nothing else\n")

        result = main(["--projects-file", str(pf), "--prompt", "x"])
        assert result == 2
        assert "no target projects" in capsys.readouterr().err

    def test_projects_file_unreadable_exits_1(self, tmp_path, capsys):
        from worca.scripts.run_fleet import main
        result = main([
            "--projects-file", str(tmp_path / "does-not-exist.txt"),
            "--prompt", "x",
        ])
        assert result == 1
        assert "failed to read --projects-file" in capsys.readouterr().err

    def test_projects_dedupe_preserves_order(self, tmp_path):
        """Duplicate paths between --projects and --projects-file are deduped."""
        from worca.scripts.run_fleet import main
        pf = tmp_path / "repos.txt"
        pf.write_text("/repo/a\n/repo/c\n")

        with (
            patch("worca.scripts.run_fleet.check_target_readiness", return_value=(True, None)),
            patch("worca.scripts.run_fleet.dispatch_fleet", return_value={}) as mock_dispatch,
            patch("worca.orchestrator.fleet_manifest.write_fleet_manifest"),
        ):
            main([
                "--projects", "/repo/a", "/repo/b",
                "--projects-file", str(pf),
                "--prompt", "x",
            ])

        kwargs = mock_dispatch.call_args[1]
        target_dirs = [t["project_dir"] for t in kwargs["targets"]]
        assert target_dirs == ["/repo/a", "/repo/b", "/repo/c"]


class TestParseRunIdFromStdout:
    """run_worktree.py prints `<run_id>\\n<worktree_path>\\n` on success — the
    dispatcher reads the first line and registers it back into the fleet
    manifest's children array (Fix B for empty-children manifest bug)."""

    def test_returns_first_line(self):
        from worca.scripts.run_fleet import _parse_run_id_from_stdout
        out = "20260512-204709-032-dfd2\n/repos/test/.worktrees/abc\n"
        assert _parse_run_id_from_stdout(out) == "20260512-204709-032-dfd2"

    def test_returns_none_for_empty_stdout(self):
        from worca.scripts.run_fleet import _parse_run_id_from_stdout
        assert _parse_run_id_from_stdout("") is None
        assert _parse_run_id_from_stdout(None) is None

    def test_rejects_path_looking_first_line(self):
        from worca.scripts.run_fleet import _parse_run_id_from_stdout
        assert _parse_run_id_from_stdout("/tmp/some/path\nother\n") is None

    def test_rejects_first_line_with_spaces(self):
        from worca.scripts.run_fleet import _parse_run_id_from_stdout
        assert _parse_run_id_from_stdout("error: something went wrong\n") is None

    def test_strips_whitespace(self):
        from worca.scripts.run_fleet import _parse_run_id_from_stdout
        assert _parse_run_id_from_stdout("  r-001  \n/path\n") == "r-001"


# ---- W-069: --max-beads passthrough -----------------------------------------

class TestMaxBeadsFleet:
    """--max-beads is parsed and forwarded to build_child_cmd."""

    def _parse(self, argv):
        from worca.scripts.run_fleet import create_parser
        return create_parser().parse_args(argv)

    def test_max_beads_default_none(self):
        args = self._parse(["--prompt", "x", "--projects", "/p"])
        assert args.max_beads is None

    def test_max_beads_parsed(self):
        args = self._parse(["--prompt", "x", "--projects", "/p", "--max-beads", "4"])
        assert args.max_beads == 4

    def test_max_beads_zero_accepted(self):
        args = self._parse(["--prompt", "x", "--projects", "/p", "--max-beads", "0"])
        assert args.max_beads == 0

    def test_build_child_cmd_includes_max_beads_when_set(self):
        from worca.scripts.run_fleet import build_child_cmd
        cmd = build_child_cmd(
            project_dir="/p",
            fleet_id="f-001",
            prompt="x",
            max_beads=3,
        )
        idx = cmd.index("--max-beads")
        assert cmd[idx + 1] == "3"

    def test_build_child_cmd_omits_max_beads_when_none(self):
        from worca.scripts.run_fleet import build_child_cmd
        cmd = build_child_cmd(
            project_dir="/p",
            fleet_id="f-001",
            prompt="x",
            max_beads=None,
        )
        assert "--max-beads" not in cmd

    def test_build_child_cmd_includes_max_beads_zero(self):
        from worca.scripts.run_fleet import build_child_cmd
        cmd = build_child_cmd(
            project_dir="/p",
            fleet_id="f-001",
            prompt="x",
            max_beads=0,
        )
        idx = cmd.index("--max-beads")
        assert cmd[idx + 1] == "0"


# ---- Phase 5: --claude-md-mode passthrough -----------------------------------

class TestClaudeMdModeFleet:
    """--claude-md-mode is parsed and forwarded to build_child_cmd."""

    def _parse(self, argv):
        from worca.scripts.run_fleet import create_parser
        return create_parser().parse_args(argv)

    def test_claude_md_mode_default_none(self):
        args = self._parse(["--prompt", "x", "--projects", "/p"])
        assert args.claude_md_mode is None

    def test_claude_md_mode_parsed(self):
        args = self._parse(["--prompt", "x", "--projects", "/p", "--claude-md-mode", "project"])
        assert args.claude_md_mode == "project"

    def test_build_child_cmd_includes_claude_md_mode_when_set(self):
        from worca.scripts.run_fleet import build_child_cmd
        cmd = build_child_cmd(
            project_dir="/p",
            fleet_id="f-001",
            prompt="x",
            claude_md_mode="project+local",
        )
        idx = cmd.index("--claude-md-mode")
        assert cmd[idx + 1] == "project+local"

    def test_build_child_cmd_omits_claude_md_mode_when_none(self):
        from worca.scripts.run_fleet import build_child_cmd
        cmd = build_child_cmd(
            project_dir="/p",
            fleet_id="f-001",
            prompt="x",
            claude_md_mode=None,
        )
        assert "--claude-md-mode" not in cmd

    def test_manifest_persists_claude_md_mode(self, tmp_path):
        from worca.scripts.run_fleet import main
        written = {}

        def capture(manifest, **kw):
            written.update(manifest)

        with (
            patch("worca.scripts.run_fleet.check_target_readiness", return_value=(True, None)),
            patch(
                "worca.orchestrator.fleet_manifest.write_fleet_manifest",
                side_effect=capture,
            ),
        ):
            main(["--projects", str(tmp_path), "--prompt", "x", "--claude-md-mode", "project"])
        assert written["claude_md_mode"] == "project"

    def test_manifest_claude_md_mode_none_when_not_set(self, tmp_path):
        from worca.scripts.run_fleet import main
        written = {}

        def capture(manifest, **kw):
            written.update(manifest)

        with (
            patch("worca.scripts.run_fleet.check_target_readiness", return_value=(True, None)),
            patch(
                "worca.orchestrator.fleet_manifest.write_fleet_manifest",
                side_effect=capture,
            ),
        ):
            main(["--projects", str(tmp_path), "--prompt", "x"])
        assert written["claude_md_mode"] is None

    def test_resume_fleet_passes_claude_md_mode_to_dispatch(self):
        from worca.scripts.run_fleet import resume_fleet
        manifest = {
            "fleet_id": "f_202601011200_abc123",
            "work_request": {"description": "Fix auth", "source": None},
            "base_branch": None,
            "guide": {"paths": []},
            "plan": {"path": None},
            "max_parallel": 3,
            "fleet_failure_threshold": 0.30,
            "claude_md_mode": "project",
            "children": [
                {"project_path": "/repo/a", "run_id": None},
            ],
        }
        with (
            patch("worca.scripts.run_fleet.read_fleet_manifest", return_value=manifest),
            patch("worca.scripts.run_fleet.update_fleet_status"),
            patch("worca.scripts.run_fleet.dispatch_fleet") as mock_dispatch,
        ):
            resume_fleet("f_202601011200_abc123")

        mock_dispatch.assert_called_once()
        call_kwargs = mock_dispatch.call_args[1]
        assert call_kwargs["claude_md_mode"] == "project"

    def test_resume_fleet_none_claude_md_mode_when_absent_from_manifest(self):
        from worca.scripts.run_fleet import resume_fleet
        manifest = {
            "fleet_id": "f_202601011200_abc123",
            "work_request": {"description": "Fix auth", "source": None},
            "base_branch": None,
            "guide": {"paths": []},
            "plan": {"path": None},
            "max_parallel": 3,
            "fleet_failure_threshold": 0.30,
            "children": [
                {"project_path": "/repo/a", "run_id": None},
            ],
        }
        with (
            patch("worca.scripts.run_fleet.read_fleet_manifest", return_value=manifest),
            patch("worca.scripts.run_fleet.update_fleet_status"),
            patch("worca.scripts.run_fleet.dispatch_fleet") as mock_dispatch,
        ):
            resume_fleet("f_202601011200_abc123")

        mock_dispatch.assert_called_once()
        call_kwargs = mock_dispatch.call_args[1]
        assert call_kwargs["claude_md_mode"] is None


# ---- --spec passthrough -------------------------------------------------------

class TestSpecFleet:
    """--spec is parsed, validated, and forwarded to build_child_cmd."""

    def _parse(self, argv):
        from worca.scripts.run_fleet import create_parser
        return create_parser().parse_args(argv)

    def test_build_child_cmd_includes_spec(self):
        from worca.scripts.run_fleet import build_child_cmd
        cmd = build_child_cmd(
            project_dir="/p",
            fleet_id="f-001",
            spec="docs/spec.md",
        )
        assert "--spec" in cmd and "docs/spec.md" in cmd
        assert "--source" not in cmd
        assert "--prompt" not in cmd

    def test_build_child_cmd_spec_with_prompt(self):
        from worca.scripts.run_fleet import build_child_cmd
        cmd = build_child_cmd(
            project_dir="/p",
            fleet_id="f-001",
            spec="docs/spec.md",
            prompt="focus on auth",
        )
        assert "--spec" in cmd and "docs/spec.md" in cmd
        assert "--prompt" in cmd and "focus on auth" in cmd

    def test_build_child_cmd_omits_spec_when_none(self):
        from worca.scripts.run_fleet import build_child_cmd
        cmd = build_child_cmd(
            project_dir="/p",
            fleet_id="f-001",
            prompt="x",
            spec=None,
        )
        assert "--spec" not in cmd

    def test_spec_and_source_rejected(self):
        from worca.scripts.run_fleet import main
        rc = main(["--projects", "/repo/a", "--spec", "s.md", "--source", "gh:issue:1"])
        assert rc == 2
