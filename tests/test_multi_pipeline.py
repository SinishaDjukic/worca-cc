"""Tests for .claude/scripts/run_multi.py -- multi-pipeline orchestration."""
import json
import os
import sys
import tempfile
from unittest import mock

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".claude"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".claude", "scripts"))

import run_multi
from run_multi import (
    _generate_run_id,
    _load_parallel_settings,
    _run_pipeline_in_worktree,
    _save_results,
    _slugify,
    create_parser,
    main,
)
from worca.orchestrator.work_request import WorkRequest


# ---------------------------------------------------------------------------
# _slugify
# ---------------------------------------------------------------------------


class TestSlugify:
    def test_basic(self):
        assert _slugify("Add auth") == "add-auth"

    def test_special_chars(self):
        assert _slugify("Add auth & search!") == "add-auth-search"

    def test_truncation(self):
        long = "a" * 50
        assert len(_slugify(long)) <= 30

    def test_strips_leading_trailing_dashes(self):
        assert _slugify("--hello--") == "hello"


# ---------------------------------------------------------------------------
# _generate_run_id
# ---------------------------------------------------------------------------


class TestGenerateRunId:
    def test_format(self):
        rid = _generate_run_id()
        # YYYYMMDD-HHMMSS-mmm-xxxx
        parts = rid.split("-")
        assert len(parts) == 4
        assert len(parts[0]) == 8  # YYYYMMDD
        assert len(parts[1]) == 6  # HHMMSS
        assert len(parts[2]) == 3  # mmm
        assert len(parts[3]) == 4  # xxxx hex

    def test_unique(self):
        ids = {_generate_run_id() for _ in range(10)}
        assert len(ids) == 10


# ---------------------------------------------------------------------------
# _load_parallel_settings
# ---------------------------------------------------------------------------


class TestLoadParallelSettings:
    def test_defaults_when_file_missing(self):
        settings = _load_parallel_settings("/nonexistent/path.json")
        assert settings["max_concurrent_pipelines"] == 3
        assert settings["default_base_branch"] == "main"
        assert settings["cleanup_policy"] == "on-success"
        assert settings["worktree_base_dir"] == ".worktrees"

    def test_overrides_from_file(self, tmp_path):
        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps({
            "worca": {
                "parallel": {
                    "max_concurrent_pipelines": 5,
                    "cleanup_policy": "always",
                }
            }
        }))
        result = _load_parallel_settings(str(settings_file))
        assert result["max_concurrent_pipelines"] == 5
        assert result["cleanup_policy"] == "always"
        # Non-overridden defaults remain
        assert result["default_base_branch"] == "main"

    def test_malformed_json(self, tmp_path):
        bad = tmp_path / "bad.json"
        bad.write_text("not json!!!")
        result = _load_parallel_settings(str(bad))
        # Falls back to all defaults
        assert result["max_concurrent_pipelines"] == 3

    def test_missing_worca_key(self, tmp_path):
        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps({"other": "stuff"}))
        result = _load_parallel_settings(str(settings_file))
        assert result["max_concurrent_pipelines"] == 3


# ---------------------------------------------------------------------------
# CLI argument parsing
# ---------------------------------------------------------------------------


class TestCLIParsing:
    def test_requests_flag(self):
        parser = create_parser()
        args = parser.parse_args(["--requests", "Add auth", "Add search"])
        assert args.requests == ["Add auth", "Add search"]
        assert args.sources is None

    def test_sources_flag(self):
        parser = create_parser()
        args = parser.parse_args(["--sources", "gh:issue:1", "gh:issue:2"])
        assert args.sources == ["gh:issue:1", "gh:issue:2"]
        assert args.requests is None

    def test_mutually_exclusive(self):
        parser = create_parser()
        with pytest.raises(SystemExit):
            parser.parse_args(["--requests", "x", "--sources", "y"])

    def test_requires_one_group(self):
        parser = create_parser()
        with pytest.raises(SystemExit):
            parser.parse_args([])

    def test_max_parallel(self):
        parser = create_parser()
        args = parser.parse_args(["--requests", "x", "--max-parallel", "5"])
        assert args.max_parallel == 5

    def test_base_branch(self):
        parser = create_parser()
        args = parser.parse_args(["--requests", "x", "--base-branch", "develop"])
        assert args.base_branch == "develop"

    def test_cleanup_choices(self):
        parser = create_parser()
        for choice in ("on-success", "always", "never"):
            args = parser.parse_args(["--requests", "x", "--cleanup", choice])
            assert args.cleanup == choice

    def test_cleanup_invalid(self):
        parser = create_parser()
        with pytest.raises(SystemExit):
            parser.parse_args(["--requests", "x", "--cleanup", "invalid"])

    def test_msize(self):
        parser = create_parser()
        args = parser.parse_args(["--requests", "x", "--msize", "3"])
        assert args.msize == 3

    def test_msize_invalid(self):
        parser = create_parser()
        with pytest.raises(SystemExit):
            parser.parse_args(["--requests", "x", "--msize", "11"])

    def test_mloops(self):
        parser = create_parser()
        args = parser.parse_args(["--requests", "x", "--mloops", "7"])
        assert args.mloops == 7

    def test_settings_default(self):
        parser = create_parser()
        args = parser.parse_args(["--requests", "x"])
        assert args.settings == ".claude/settings.json"

    def test_settings_custom(self):
        parser = create_parser()
        args = parser.parse_args(["--requests", "x", "--settings", "/tmp/s.json"])
        assert args.settings == "/tmp/s.json"

    def test_defaults(self):
        parser = create_parser()
        args = parser.parse_args(["--requests", "x"])
        assert args.max_parallel is None
        assert args.base_branch is None
        assert args.cleanup is None
        assert args.msize == 1
        assert args.mloops == 1


# ---------------------------------------------------------------------------
# reconcile_stale is called on startup
# ---------------------------------------------------------------------------


class TestReconcileStale:
    @mock.patch("run_multi.reconcile_stale", return_value=[])
    @mock.patch("run_multi.normalize", return_value=WorkRequest(
        source_type="prompt", title="test"))
    @mock.patch("run_multi.create_pipeline_worktree", return_value="")
    @mock.patch("run_multi._load_parallel_settings", return_value={
        "max_concurrent_pipelines": 3,
        "default_base_branch": "main",
        "cleanup_policy": "on-success",
        "worktree_base_dir": ".worktrees",
    })
    def test_reconcile_called_on_startup(self, mock_settings, mock_wt, mock_norm, mock_rec):
        # Will fail because worktree creation returns "", but reconcile should still be called
        main(["--requests", "test"])
        mock_rec.assert_called_once()

    @mock.patch("run_multi.reconcile_stale", return_value=["run-1", "run-2"])
    @mock.patch("run_multi.normalize", return_value=WorkRequest(
        source_type="prompt", title="test"))
    @mock.patch("run_multi.create_pipeline_worktree", return_value="")
    @mock.patch("run_multi._load_parallel_settings", return_value={
        "max_concurrent_pipelines": 3,
        "default_base_branch": "main",
        "cleanup_policy": "on-success",
        "worktree_base_dir": ".worktrees",
    })
    def test_reconcile_stale_reports_cleaned(self, mock_settings, mock_wt, mock_norm, mock_rec, capsys):
        main(["--requests", "test"])
        captured = capsys.readouterr()
        assert "Reconciled 2 stale pipeline(s)" in captured.out


# ---------------------------------------------------------------------------
# Worktree creation
# ---------------------------------------------------------------------------


class TestWorktreeCreation:
    @mock.patch("run_multi.reconcile_stale", return_value=[])
    @mock.patch("run_multi._load_parallel_settings", return_value={
        "max_concurrent_pipelines": 3,
        "default_base_branch": "main",
        "cleanup_policy": "never",
        "worktree_base_dir": ".worktrees",
    })
    @mock.patch("run_multi.deregister_pipeline")
    @mock.patch("run_multi.remove_pipeline_worktree")
    @mock.patch("run_multi.update_pipeline")
    @mock.patch("run_multi.register_pipeline")
    @mock.patch("run_multi.init_worktree_beads")
    @mock.patch("run_multi.create_pipeline_worktree")
    @mock.patch("run_multi.normalize")
    @mock.patch("run_multi._save_results", return_value=".worca/multi/results.json")
    @mock.patch("run_multi._run_pipeline_in_worktree")
    def test_worktree_created_per_request(
        self, mock_run, mock_save, mock_norm, mock_create_wt,
        mock_init_beads, mock_register, mock_update,
        mock_remove, mock_dereg, mock_settings, mock_reconcile,
    ):
        mock_norm.side_effect = [
            WorkRequest(source_type="prompt", title="Add auth"),
            WorkRequest(source_type="prompt", title="Add search"),
        ]
        mock_create_wt.side_effect = ["/tmp/wt1", "/tmp/wt2"]
        mock_run.return_value = {"returncode": 0, "stdout": "", "stderr": ""}

        main(["--requests", "Add auth", "Add search"])

        assert mock_create_wt.call_count == 2
        # Verify base_branch is passed
        for call in mock_create_wt.call_args_list:
            assert call.args[2] == "main"  # base_branch

    @mock.patch("run_multi.reconcile_stale", return_value=[])
    @mock.patch("run_multi._load_parallel_settings", return_value={
        "max_concurrent_pipelines": 3,
        "default_base_branch": "main",
        "cleanup_policy": "never",
        "worktree_base_dir": ".worktrees",
    })
    @mock.patch("run_multi.register_pipeline")
    @mock.patch("run_multi.init_worktree_beads")
    @mock.patch("run_multi.create_pipeline_worktree")
    @mock.patch("run_multi.normalize")
    def test_beads_initialized_in_worktree(
        self, mock_norm, mock_create_wt, mock_init_beads,
        mock_register, mock_settings, mock_reconcile,
    ):
        mock_norm.return_value = WorkRequest(source_type="prompt", title="test")
        mock_create_wt.return_value = "/tmp/wt1"

        # Will fail at pipeline execution but beads init should happen
        with mock.patch("run_multi._run_pipeline_in_worktree",
                        return_value={"returncode": 0, "stdout": "", "stderr": ""}):
            with mock.patch("run_multi._save_results", return_value="x"):
                with mock.patch("run_multi.update_pipeline"):
                    main(["--requests", "test"])

        mock_init_beads.assert_called_once_with("/tmp/wt1")

    @mock.patch("run_multi.reconcile_stale", return_value=[])
    @mock.patch("run_multi._load_parallel_settings", return_value={
        "max_concurrent_pipelines": 3,
        "default_base_branch": "main",
        "cleanup_policy": "never",
        "worktree_base_dir": ".worktrees",
    })
    @mock.patch("run_multi.register_pipeline")
    @mock.patch("run_multi.init_worktree_beads")
    @mock.patch("run_multi.create_pipeline_worktree", return_value="/tmp/wt1")
    @mock.patch("run_multi.normalize")
    def test_pipeline_registered(
        self, mock_norm, mock_create_wt, mock_init_beads,
        mock_register, mock_settings, mock_reconcile,
    ):
        mock_norm.return_value = WorkRequest(source_type="prompt", title="My task")

        with mock.patch("run_multi._run_pipeline_in_worktree",
                        return_value={"returncode": 0, "stdout": "", "stderr": ""}):
            with mock.patch("run_multi._save_results", return_value="x"):
                with mock.patch("run_multi.update_pipeline"):
                    main(["--requests", "My task"])

        mock_register.assert_called_once()
        call_kwargs = mock_register.call_args
        assert call_kwargs.kwargs["worktree_path"] == "/tmp/wt1"
        assert call_kwargs.kwargs["title"] == "My task"

    @mock.patch("run_multi.reconcile_stale", return_value=[])
    @mock.patch("run_multi._load_parallel_settings", return_value={
        "max_concurrent_pipelines": 3,
        "default_base_branch": "main",
        "cleanup_policy": "never",
        "worktree_base_dir": ".worktrees",
    })
    @mock.patch("run_multi.normalize")
    @mock.patch("run_multi.create_pipeline_worktree", return_value="")
    def test_skips_failed_worktree(self, mock_create_wt, mock_norm, mock_settings, mock_reconcile):
        mock_norm.return_value = WorkRequest(source_type="prompt", title="test")
        code = main(["--requests", "test"])
        assert code == 1  # no pipelines ran


# ---------------------------------------------------------------------------
# Cleanup policies
# ---------------------------------------------------------------------------


class TestCleanupPolicy:
    def _run_with_cleanup(self, policy, returncodes):
        """Helper: run main with given cleanup policy and pipeline return codes."""
        n = len(returncodes)
        worktrees = [f"/tmp/wt{i}" for i in range(n)]
        titles = [f"task-{i}" for i in range(n)]

        mock_norms = [
            WorkRequest(source_type="prompt", title=t) for t in titles
        ]

        results = [
            {"returncode": rc, "stdout": "", "stderr": ""}
            for rc in returncodes
        ]

        with mock.patch("run_multi.reconcile_stale", return_value=[]), \
             mock.patch("run_multi._load_parallel_settings", return_value={
                 "max_concurrent_pipelines": 3,
                 "default_base_branch": "main",
                 "cleanup_policy": policy,
                 "worktree_base_dir": ".worktrees",
             }), \
             mock.patch("run_multi.normalize", side_effect=mock_norms), \
             mock.patch("run_multi.create_pipeline_worktree", side_effect=worktrees), \
             mock.patch("run_multi.init_worktree_beads"), \
             mock.patch("run_multi.register_pipeline"), \
             mock.patch("run_multi.update_pipeline"), \
             mock.patch("run_multi._run_pipeline_in_worktree", side_effect=results), \
             mock.patch("run_multi._save_results", return_value="x"), \
             mock.patch("run_multi.remove_pipeline_worktree", return_value=True) as mock_remove, \
             mock.patch("run_multi.deregister_pipeline") as mock_dereg:

            requests_args = ["--requests"] + titles
            main(requests_args)
            return mock_remove, mock_dereg

    def test_on_success_removes_only_successful(self):
        mock_remove, mock_dereg = self._run_with_cleanup("on-success", [0, 1, 0])
        # Should remove worktrees for rc=0 only (index 0 and 2)
        assert mock_remove.call_count == 2
        removed_paths = {c.args[0] for c in mock_remove.call_args_list}
        assert "/tmp/wt0" in removed_paths
        assert "/tmp/wt2" in removed_paths
        assert "/tmp/wt1" not in removed_paths

    def test_always_removes_all(self):
        mock_remove, mock_dereg = self._run_with_cleanup("always", [0, 1, 0])
        assert mock_remove.call_count == 3
        assert mock_dereg.call_count == 3

    def test_never_removes_none(self):
        mock_remove, mock_dereg = self._run_with_cleanup("never", [0, 0, 0])
        assert mock_remove.call_count == 0
        assert mock_dereg.call_count == 0

    def test_on_success_deregisters_cleaned(self):
        mock_remove, mock_dereg = self._run_with_cleanup("on-success", [0, 1])
        # Only successful pipeline deregistered
        assert mock_dereg.call_count == 1


# ---------------------------------------------------------------------------
# Results saved to JSON
# ---------------------------------------------------------------------------


class TestResultsSaving:
    def test_save_results(self, tmp_path):
        # Temporarily override the results directory
        results = [
            {"returncode": 0, "title": "A", "run_id": "r1"},
            {"returncode": 1, "title": "B", "run_id": "r2"},
        ]

        orig_cwd = os.getcwd()
        os.chdir(tmp_path)
        try:
            path = _save_results(results, 42.5)
            assert os.path.exists(path)

            with open(path) as f:
                data = json.load(f)

            assert data["total"] == 2
            assert data["succeeded"] == 1
            assert data["failed"] == 1
            assert data["elapsed_seconds"] == 42.5
            assert len(data["pipelines"]) == 2
        finally:
            os.chdir(orig_cwd)

    def test_results_saved_during_main(self):
        """Verify main() calls _save_results."""
        with mock.patch("run_multi.reconcile_stale", return_value=[]), \
             mock.patch("run_multi._load_parallel_settings", return_value={
                 "max_concurrent_pipelines": 3,
                 "default_base_branch": "main",
                 "cleanup_policy": "never",
                 "worktree_base_dir": ".worktrees",
             }), \
             mock.patch("run_multi.normalize",
                        return_value=WorkRequest(source_type="prompt", title="t")), \
             mock.patch("run_multi.create_pipeline_worktree", return_value="/tmp/wt"), \
             mock.patch("run_multi.init_worktree_beads"), \
             mock.patch("run_multi.register_pipeline"), \
             mock.patch("run_multi.update_pipeline"), \
             mock.patch("run_multi._run_pipeline_in_worktree",
                        return_value={"returncode": 0, "stdout": "", "stderr": ""}), \
             mock.patch("run_multi._save_results", return_value="x") as mock_save:

            main(["--requests", "t"])

        mock_save.assert_called_once()
        results_arg = mock_save.call_args.args[0]
        assert len(results_arg) == 1
        assert results_arg[0]["returncode"] == 0


# ---------------------------------------------------------------------------
# Sources dispatch
# ---------------------------------------------------------------------------


class TestSourcesDispatch:
    @mock.patch("run_multi.reconcile_stale", return_value=[])
    @mock.patch("run_multi._load_parallel_settings", return_value={
        "max_concurrent_pipelines": 3,
        "default_base_branch": "main",
        "cleanup_policy": "never",
        "worktree_base_dir": ".worktrees",
    })
    @mock.patch("run_multi.normalize")
    @mock.patch("run_multi.create_pipeline_worktree", return_value="/tmp/wt1")
    @mock.patch("run_multi.init_worktree_beads")
    @mock.patch("run_multi.register_pipeline")
    @mock.patch("run_multi.update_pipeline")
    @mock.patch("run_multi._run_pipeline_in_worktree",
                return_value={"returncode": 0, "stdout": "", "stderr": ""})
    @mock.patch("run_multi._save_results", return_value="x")
    def test_sources_use_source_normalize(
        self, mock_save, mock_run, mock_update, mock_register,
        mock_init_beads, mock_create_wt, mock_norm,
        mock_settings, mock_reconcile,
    ):
        mock_norm.return_value = WorkRequest(
            source_type="github_issue", title="Fix bug",
            description="Fix the bug in auth",
        )

        main(["--sources", "gh:issue:42"])

        mock_norm.assert_called_once_with("source", "gh:issue:42")


# ---------------------------------------------------------------------------
# Exit code
# ---------------------------------------------------------------------------


class TestExitCode:
    def _run_main(self, returncodes):
        """Helper to run main and return exit code."""
        n = len(returncodes)
        worktrees = [f"/tmp/wt{i}" for i in range(n)]
        titles = [f"task-{i}" for i in range(n)]
        norms = [WorkRequest(source_type="prompt", title=t) for t in titles]
        results = [{"returncode": rc, "stdout": "", "stderr": ""} for rc in returncodes]

        with mock.patch("run_multi.reconcile_stale", return_value=[]), \
             mock.patch("run_multi._load_parallel_settings", return_value={
                 "max_concurrent_pipelines": 3,
                 "default_base_branch": "main",
                 "cleanup_policy": "never",
                 "worktree_base_dir": ".worktrees",
             }), \
             mock.patch("run_multi.normalize", side_effect=norms), \
             mock.patch("run_multi.create_pipeline_worktree", side_effect=worktrees), \
             mock.patch("run_multi.init_worktree_beads"), \
             mock.patch("run_multi.register_pipeline"), \
             mock.patch("run_multi.update_pipeline"), \
             mock.patch("run_multi._run_pipeline_in_worktree", side_effect=results), \
             mock.patch("run_multi._save_results", return_value="x"):
            return main(["--requests"] + titles)

    def test_all_succeed_exit_0(self):
        assert self._run_main([0, 0, 0]) == 0

    def test_any_fail_exit_1(self):
        assert self._run_main([0, 1, 0]) == 1

    def test_all_fail_exit_1(self):
        assert self._run_main([1, 1]) == 1


# ---------------------------------------------------------------------------
# Registry updates on completion
# ---------------------------------------------------------------------------


class TestRegistryUpdates:
    @mock.patch("run_multi.reconcile_stale", return_value=[])
    @mock.patch("run_multi._load_parallel_settings", return_value={
        "max_concurrent_pipelines": 3,
        "default_base_branch": "main",
        "cleanup_policy": "never",
        "worktree_base_dir": ".worktrees",
    })
    @mock.patch("run_multi.normalize")
    @mock.patch("run_multi.create_pipeline_worktree")
    @mock.patch("run_multi.init_worktree_beads")
    @mock.patch("run_multi.register_pipeline")
    @mock.patch("run_multi.update_pipeline")
    @mock.patch("run_multi._run_pipeline_in_worktree")
    @mock.patch("run_multi._save_results", return_value="x")
    def test_registry_updated_on_success(
        self, mock_save, mock_run, mock_update, mock_register,
        mock_init_beads, mock_create_wt, mock_norm,
        mock_settings, mock_reconcile,
    ):
        mock_norm.return_value = WorkRequest(source_type="prompt", title="task")
        mock_create_wt.return_value = "/tmp/wt1"
        mock_run.return_value = {"returncode": 0, "stdout": "", "stderr": ""}

        main(["--requests", "task"])

        mock_update.assert_called_once()
        assert mock_update.call_args.kwargs["status"] == "succeeded"

    @mock.patch("run_multi.reconcile_stale", return_value=[])
    @mock.patch("run_multi._load_parallel_settings", return_value={
        "max_concurrent_pipelines": 3,
        "default_base_branch": "main",
        "cleanup_policy": "never",
        "worktree_base_dir": ".worktrees",
    })
    @mock.patch("run_multi.normalize")
    @mock.patch("run_multi.create_pipeline_worktree")
    @mock.patch("run_multi.init_worktree_beads")
    @mock.patch("run_multi.register_pipeline")
    @mock.patch("run_multi.update_pipeline")
    @mock.patch("run_multi._run_pipeline_in_worktree")
    @mock.patch("run_multi._save_results", return_value="x")
    def test_registry_updated_on_failure(
        self, mock_save, mock_run, mock_update, mock_register,
        mock_init_beads, mock_create_wt, mock_norm,
        mock_settings, mock_reconcile,
    ):
        mock_norm.return_value = WorkRequest(source_type="prompt", title="task")
        mock_create_wt.return_value = "/tmp/wt1"
        mock_run.return_value = {"returncode": 1, "stdout": "", "stderr": "err"}

        main(["--requests", "task"])

        mock_update.assert_called_once()
        assert mock_update.call_args.kwargs["status"] == "failed"


# ---------------------------------------------------------------------------
# Settings-driven defaults
# ---------------------------------------------------------------------------


class TestSettingsDefaults:
    @mock.patch("run_multi.reconcile_stale", return_value=[])
    @mock.patch("run_multi.normalize",
                return_value=WorkRequest(source_type="prompt", title="t"))
    @mock.patch("run_multi.create_pipeline_worktree", return_value="/tmp/wt")
    @mock.patch("run_multi.init_worktree_beads")
    @mock.patch("run_multi.register_pipeline")
    @mock.patch("run_multi.update_pipeline")
    @mock.patch("run_multi._run_pipeline_in_worktree",
                return_value={"returncode": 0, "stdout": "", "stderr": ""})
    @mock.patch("run_multi._save_results", return_value="x")
    def test_base_branch_from_settings(
        self, mock_save, mock_run, mock_update, mock_register,
        mock_init_beads, mock_create_wt, mock_norm, mock_reconcile,
        tmp_path,
    ):
        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps({
            "worca": {
                "parallel": {
                    "max_concurrent_pipelines": 2,
                    "default_base_branch": "develop",
                    "cleanup_policy": "never",
                }
            }
        }))

        main(["--requests", "t", "--settings", str(settings_file)])

        # Verify create_pipeline_worktree was called with "develop"
        assert mock_create_wt.call_args.args[2] == "develop"

    @mock.patch("run_multi.reconcile_stale", return_value=[])
    @mock.patch("run_multi.normalize",
                return_value=WorkRequest(source_type="prompt", title="t"))
    @mock.patch("run_multi.create_pipeline_worktree", return_value="/tmp/wt")
    @mock.patch("run_multi.init_worktree_beads")
    @mock.patch("run_multi.register_pipeline")
    @mock.patch("run_multi.update_pipeline")
    @mock.patch("run_multi._run_pipeline_in_worktree",
                return_value={"returncode": 0, "stdout": "", "stderr": ""})
    @mock.patch("run_multi._save_results", return_value="x")
    def test_cli_overrides_settings(
        self, mock_save, mock_run, mock_update, mock_register,
        mock_init_beads, mock_create_wt, mock_norm, mock_reconcile,
        tmp_path,
    ):
        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps({
            "worca": {
                "parallel": {
                    "default_base_branch": "develop",
                }
            }
        }))

        main(["--requests", "t", "--settings", str(settings_file),
              "--base-branch", "feature"])

        # CLI flag should override settings
        assert mock_create_wt.call_args.args[2] == "feature"


# ---------------------------------------------------------------------------
# Worktree mode flag passed to subprocess
# ---------------------------------------------------------------------------


class TestWorktreeMode:
    @mock.patch("run_multi.subprocess.run")
    def test_worktree_flag_passed(self, mock_subprocess):
        mock_subprocess.return_value = mock.Mock(
            returncode=0, stdout="ok", stderr=""
        )

        _run_pipeline_in_worktree("/tmp/wt", "test prompt", 1, 1, "s.json")

        cmd = mock_subprocess.call_args.args[0]
        assert "--worktree" in cmd
        assert "--prompt" in cmd
        assert "test prompt" in cmd
