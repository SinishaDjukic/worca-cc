"""Tests for --worktree mode in run_pipeline.py and runner.py.

Covers:
  - CLI parser accepts --worktree flag (default False)
  - --worktree is passed through to run_pipeline() as kwarg
  - run_pipeline() accepts worktree parameter (default False)
  - When worktree=True: create_branch is NOT called
  - When worktree=True: update_pipeline IS called with stage="starting" at pipeline start
  - When worktree=True: update_pipeline is called with status="completed" on success
  - When worktree=True: update_pipeline is called with status="failed" on failure
  - When worktree=True: status["worktree"] is set to True
  - When worktree=False: existing behavior unchanged (create_branch called, no registry)
"""

import inspect
import json
import sys
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch, call

import pytest

# Make .claude/scripts importable for CLI tests
sys.path.insert(0, str(Path(__file__).parent.parent / ".claude" / "scripts"))
import run_pipeline as _run_pipeline_module


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_settings(tmp_path):
    """Minimal settings.json with all stages disabled (fast test)."""
    settings = {
        "worca": {
            "stages": {
                "preflight": {"enabled": False},
                "plan": {"enabled": False},
                "coordinate": {"enabled": False},
                "implement": {"enabled": False},
                "test": {"enabled": False},
                "review": {"enabled": False},
                "pr": {"enabled": False},
                "learn": {"enabled": False},
            },
            "agents": {},
            "loops": {},
        }
    }
    f = tmp_path / "settings.json"
    f.write_text(json.dumps(settings))
    return str(f)


def _make_fake_status():
    return {
        "stage": "",
        "stages": {},
        "started_at": "2026-01-01T00:00:00+00:00",
        "branch": "test-branch",
        "work_request": {"title": "Test"},
        "run_id": "20260101-000000",
        "milestones": {},
    }


def _common_patches(stack):
    """Enter patches common to all runner tests. Returns dict of named mocks."""
    mocks = {}
    stack.enter_context(patch("worca.orchestrator.runner._write_pid"))
    stack.enter_context(patch("worca.orchestrator.runner._remove_pid"))
    stack.enter_context(patch("worca.orchestrator.runner._ensure_beads_initialized"))
    mocks["create_branch"] = stack.enter_context(
        patch("worca.orchestrator.runner.create_branch")
    )
    mocks["current_branch"] = stack.enter_context(
        patch("worca.orchestrator.runner.current_branch", return_value="worca/test-worktree-20260101-000000")
    )
    mocks["init_status"] = stack.enter_context(
        patch("worca.orchestrator.runner.init_status", return_value=_make_fake_status())
    )
    stack.enter_context(patch("worca.orchestrator.runner.save_status"))
    stack.enter_context(patch("worca.orchestrator.runner.start_iteration",
                              return_value={"number": 1}))
    stack.enter_context(patch("worca.orchestrator.runner.complete_iteration"))
    stack.enter_context(patch("worca.orchestrator.runner.update_stage"))
    stack.enter_context(patch("worca.orchestrator.runner.gh_issue_start"))
    stack.enter_context(patch("worca.orchestrator.runner.gh_issue_complete"))
    stack.enter_context(patch("worca.orchestrator.runner._init_orchestrator_log"))
    stack.enter_context(patch("worca.orchestrator.runner._close_orchestrator_log"))
    stack.enter_context(patch("worca.orchestrator.runner._render_agent_templates"))
    stack.enter_context(patch("worca.orchestrator.runner._run_learn_stage"))
    stack.enter_context(
        patch("worca.orchestrator.runner._generate_run_id", return_value="20260101-000000")
    )
    mocks["update_pipeline"] = stack.enter_context(
        patch("worca.orchestrator.runner.update_pipeline")
    )
    return mocks


# ---------------------------------------------------------------------------
# CLI parser: --worktree flag
# ---------------------------------------------------------------------------

class TestWorktreeCLIParser:

    def test_parser_accepts_worktree_flag(self):
        """create_parser() must accept --worktree as a boolean flag."""
        parser = _run_pipeline_module.create_parser()
        args = parser.parse_args(["--prompt", "test", "--worktree"])
        assert args.worktree is True

    def test_worktree_defaults_to_false(self):
        """--worktree defaults to False when not provided."""
        parser = _run_pipeline_module.create_parser()
        args = parser.parse_args(["--prompt", "test"])
        assert args.worktree is False


# ---------------------------------------------------------------------------
# run_pipeline() signature
# ---------------------------------------------------------------------------

class TestRunPipelineWorktreeParam:

    def test_run_pipeline_accepts_worktree_param(self):
        """run_pipeline() must accept a worktree keyword argument."""
        from worca.orchestrator.runner import run_pipeline
        sig = inspect.signature(run_pipeline)
        assert "worktree" in sig.parameters

    def test_run_pipeline_worktree_defaults_false(self):
        """worktree must default to False."""
        from worca.orchestrator.runner import run_pipeline
        sig = inspect.signature(run_pipeline)
        param = sig.parameters["worktree"]
        assert param.default is False


# ---------------------------------------------------------------------------
# Worktree mode: create_branch skipped
# ---------------------------------------------------------------------------

class TestWorktreeSkipsBranchCreation:

    def test_create_branch_not_called_when_worktree_true(self, tmp_path):
        """When worktree=True, create_branch() must NOT be called."""
        from worca.orchestrator.runner import run_pipeline
        from worca.orchestrator.work_request import WorkRequest

        settings_path = _make_settings(tmp_path)
        wr = WorkRequest(title="Test worktree", description="test", source_type="prompt")

        with ExitStack() as stack:
            mocks = _common_patches(stack)

            run_pipeline(
                wr,
                settings_path=settings_path,
                status_path=str(tmp_path / "status.json"),
                worktree=True,
            )

        mocks["create_branch"].assert_not_called()

    def test_create_branch_called_when_worktree_false(self, tmp_path):
        """When worktree=False (default), create_branch() must be called."""
        from worca.orchestrator.runner import run_pipeline
        from worca.orchestrator.work_request import WorkRequest

        settings_path = _make_settings(tmp_path)
        wr = WorkRequest(title="Test normal", description="test", source_type="prompt")

        with ExitStack() as stack:
            mocks = _common_patches(stack)

            run_pipeline(
                wr,
                settings_path=settings_path,
                status_path=str(tmp_path / "status.json"),
                worktree=False,
            )

        mocks["create_branch"].assert_called_once()


# ---------------------------------------------------------------------------
# Worktree mode: status["worktree"] set
# ---------------------------------------------------------------------------

class TestWorktreeStatusFlag:

    def test_status_has_worktree_true_when_worktree_mode(self, tmp_path):
        """When worktree=True, returned status must have worktree=True."""
        from worca.orchestrator.runner import run_pipeline
        from worca.orchestrator.work_request import WorkRequest

        settings_path = _make_settings(tmp_path)
        wr = WorkRequest(title="Test worktree", description="test", source_type="prompt")

        with ExitStack() as stack:
            mocks = _common_patches(stack)

            result = run_pipeline(
                wr,
                settings_path=settings_path,
                status_path=str(tmp_path / "status.json"),
                worktree=True,
            )

        assert result.get("worktree") is True

    def test_status_no_worktree_key_when_worktree_false(self, tmp_path):
        """When worktree=False, status should NOT have worktree key."""
        from worca.orchestrator.runner import run_pipeline
        from worca.orchestrator.work_request import WorkRequest

        settings_path = _make_settings(tmp_path)
        wr = WorkRequest(title="Test normal", description="test", source_type="prompt")

        with ExitStack() as stack:
            mocks = _common_patches(stack)

            result = run_pipeline(
                wr,
                settings_path=settings_path,
                status_path=str(tmp_path / "status.json"),
                worktree=False,
            )

        assert "worktree" not in result


# ---------------------------------------------------------------------------
# Worktree mode: update_pipeline called at start with stage="starting"
# ---------------------------------------------------------------------------

class TestWorktreeRegistryUpdateAtStart:

    def test_update_pipeline_starting_called_when_worktree_true(self, tmp_path):
        """When worktree=True, update_pipeline(stage='starting') must be called."""
        from worca.orchestrator.runner import run_pipeline
        from worca.orchestrator.work_request import WorkRequest

        settings_path = _make_settings(tmp_path)
        wr = WorkRequest(title="Test worktree", description="test", source_type="prompt")

        with ExitStack() as stack:
            mocks = _common_patches(stack)

            run_pipeline(
                wr,
                settings_path=settings_path,
                status_path=str(tmp_path / "status.json"),
                worktree=True,
            )

        # First call should be stage="starting"
        mocks["update_pipeline"].assert_any_call(
            "20260101-000000", stage="starting",
            base=str(Path(tmp_path / "status.json").parent),
        )

    def test_update_pipeline_not_called_when_worktree_false(self, tmp_path):
        """When worktree=False, update_pipeline() must NOT be called."""
        from worca.orchestrator.runner import run_pipeline
        from worca.orchestrator.work_request import WorkRequest

        settings_path = _make_settings(tmp_path)
        wr = WorkRequest(title="Test normal", description="test", source_type="prompt")

        with ExitStack() as stack:
            mocks = _common_patches(stack)

            run_pipeline(
                wr,
                settings_path=settings_path,
                status_path=str(tmp_path / "status.json"),
                worktree=False,
            )

        mocks["update_pipeline"].assert_not_called()


# ---------------------------------------------------------------------------
# Worktree mode: update_pipeline on completion
# ---------------------------------------------------------------------------

class TestWorktreeUpdatePipelineOnCompletion:

    def test_update_pipeline_called_completed_on_success(self, tmp_path):
        """On successful pipeline, update_pipeline must be called with status='completed'."""
        from worca.orchestrator.runner import run_pipeline
        from worca.orchestrator.work_request import WorkRequest

        settings_path = _make_settings(tmp_path)
        wr = WorkRequest(title="Test worktree", description="test", source_type="prompt")

        with ExitStack() as stack:
            mocks = _common_patches(stack)

            run_pipeline(
                wr,
                settings_path=settings_path,
                status_path=str(tmp_path / "status.json"),
                worktree=True,
            )

        mocks["update_pipeline"].assert_any_call(
            "20260101-000000", status="completed",
            base=str(Path(tmp_path / "status.json").parent),
        )

    def test_update_pipeline_called_failed_on_error(self, tmp_path):
        """On pipeline failure, update_pipeline must be called with status='failed'."""
        from worca.orchestrator.runner import run_pipeline, PipelineError
        from worca.orchestrator.work_request import WorkRequest

        settings_path = _make_settings(tmp_path)
        wr = WorkRequest(title="Test worktree fail", description="test", source_type="prompt")

        # Make _render_agent_templates raise to simulate failure
        with ExitStack() as stack:
            mocks = _common_patches(stack)
            # Override _render_agent_templates to raise
            stack.enter_context(
                patch("worca.orchestrator.runner._render_agent_templates",
                      side_effect=PipelineError("boom"))
            )

            with pytest.raises(PipelineError):
                run_pipeline(
                    wr,
                    settings_path=settings_path,
                    status_path=str(tmp_path / "status.json"),
                    worktree=True,
                )

        mocks["update_pipeline"].assert_any_call(
            "20260101-000000", status="failed",
            base=str(Path(tmp_path / "status.json").parent),
        )

    def test_update_pipeline_not_called_when_worktree_false(self, tmp_path):
        """When worktree=False, update_pipeline() must NOT be called."""
        from worca.orchestrator.runner import run_pipeline
        from worca.orchestrator.work_request import WorkRequest

        settings_path = _make_settings(tmp_path)
        wr = WorkRequest(title="Test normal", description="test", source_type="prompt")

        with ExitStack() as stack:
            mocks = _common_patches(stack)

            run_pipeline(
                wr,
                settings_path=settings_path,
                status_path=str(tmp_path / "status.json"),
                worktree=False,
            )

        mocks["update_pipeline"].assert_not_called()
