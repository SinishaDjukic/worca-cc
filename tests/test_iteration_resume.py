"""Integration tests for iteration-level resume, pipeline_status transitions,
loop counter persistence, and PromptBuilder context save/load.

These tests exercise the runner's state management without spawning real Claude
subprocess calls — all agent calls are mocked.
"""

import os
from datetime import datetime, timezone
from unittest.mock import patch

import pytest

from worca.orchestrator.prompt_builder import PromptBuilder
from worca.orchestrator.resume import (
    find_last_completed_iteration,
    get_resume_iteration,
    restore_loop_counters,
    check_git_divergence,
)
from worca.orchestrator.control import write_control, read_control, delete_control
from worca.state.status import (
    init_status,
    save_status,
    load_status,
    start_iteration,
    complete_iteration,
    update_stage,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def run_dir(tmp_path):
    """Create a minimal run directory structure."""
    d = tmp_path / "runs" / "test-run"
    d.mkdir(parents=True)
    return str(d)


@pytest.fixture
def status_path(run_dir):
    return os.path.join(run_dir, "status.json")


@pytest.fixture
def base_status():
    """A status dict in the middle of a pipeline run."""
    return init_status(
        work_request={"title": "Test feature", "description": "Add tests"},
        branch="feature/test",
        git_head="abc123def456",
    )


# ---------------------------------------------------------------------------
# A1-A3: pipeline_status transitions
# ---------------------------------------------------------------------------


class TestPipelineStatusTransitions:
    """Verify that pipeline_status transitions correctly through lifecycle."""

    def test_init_status_starts_as_pending(self, base_status):
        assert base_status["pipeline_status"] == "pending"

    def test_pipeline_status_field_persists(self, base_status, status_path):
        base_status["pipeline_status"] = "running"
        save_status(base_status, status_path)
        loaded = load_status(status_path)
        assert loaded["pipeline_status"] == "running"

    def test_completed_status_persists(self, base_status, status_path):
        base_status["pipeline_status"] = "completed"
        base_status["completed_at"] = datetime.now(timezone.utc).isoformat()
        save_status(base_status, status_path)
        loaded = load_status(status_path)
        assert loaded["pipeline_status"] == "completed"
        assert loaded["completed_at"] is not None

    def test_failed_status_with_reason(self, base_status, status_path):
        base_status["pipeline_status"] = "failed"
        base_status["stop_reason"] = "loop_exhausted"
        save_status(base_status, status_path)
        loaded = load_status(status_path)
        assert loaded["pipeline_status"] == "failed"
        assert loaded["stop_reason"] == "loop_exhausted"

    def test_paused_status_via_control_file(self, base_status, status_path, tmp_path):
        """Simulates pause via control file."""
        worca_dir = str(tmp_path)
        run_id = "test-run"
        write_control(run_id, "pause", source="cli", base=worca_dir)
        ctrl = read_control(run_id, base=worca_dir)
        assert ctrl is not None
        assert ctrl["action"] == "pause"
        # Orchestrator would set this:
        base_status["pipeline_status"] = "paused"
        save_status(base_status, status_path)
        loaded = load_status(status_path)
        assert loaded["pipeline_status"] == "paused"
        # Control file consumed:
        delete_control(run_id, base=worca_dir)
        assert read_control(run_id, base=worca_dir) is None


# ---------------------------------------------------------------------------
# A4: loop counter persistence and restoration
# ---------------------------------------------------------------------------


class TestLoopCounterPersistence:
    """Verify loop counters survive across resume."""

    def test_loop_counters_init_empty(self, base_status):
        assert base_status["loop_counters"] == {}

    def test_loop_counters_round_trip(self, base_status, status_path):
        counters = {"implement_test": 2, "pr_changes": 1, "bead_iteration": 3}
        base_status["loop_counters"] = counters
        save_status(base_status, status_path)
        loaded = load_status(status_path)
        assert loaded["loop_counters"] == counters

    def test_restore_loop_counters_from_status(self, base_status):
        base_status["loop_counters"] = {"implement_test": 5}
        restored = restore_loop_counters(base_status)
        assert restored == {"implement_test": 5}

    def test_restore_loop_counters_missing_key(self, base_status):
        del base_status["loop_counters"]
        restored = restore_loop_counters(base_status)
        assert restored == {}

    def test_restore_loop_counters_returns_copy(self, base_status):
        base_status["loop_counters"] = {"implement_test": 1}
        restored = restore_loop_counters(base_status)
        restored["implement_test"] = 99
        # Original unmodified:
        assert base_status["loop_counters"]["implement_test"] == 1


# ---------------------------------------------------------------------------
# A5: PromptBuilder context save/load
# ---------------------------------------------------------------------------


class TestPromptBuilderContextPersistence:
    """Verify PromptBuilder context survives across save/load."""

    def test_save_creates_file(self, run_dir):
        pb = PromptBuilder("title", "desc")
        pb.update_context("plan_approach", "incremental TDD")
        path = os.path.join(run_dir, "prompt_context.json")
        pb.save_context(path)
        assert os.path.exists(path)

    def test_load_restores_context(self, run_dir):
        path = os.path.join(run_dir, "prompt_context.json")
        # Save
        pb1 = PromptBuilder("title", "desc")
        pb1.update_context("plan_approach", "incremental TDD")
        pb1.update_context("test_failures", ["test_a", "test_b"])
        pb1.save_context(path)
        # Load into fresh builder
        pb2 = PromptBuilder("title", "desc")
        pb2.load_context(path)
        assert pb2.get_context("plan_approach") == "incremental TDD"
        assert pb2.get_context("test_failures") == ["test_a", "test_b"]

    def test_load_missing_file_is_noop(self, run_dir):
        path = os.path.join(run_dir, "nonexistent.json")
        pb = PromptBuilder("title", "desc")
        pb.load_context(path)  # Should not raise

    def test_save_no_path_is_noop(self):
        pb = PromptBuilder("title", "desc")
        pb.update_context("key", "val")
        pb.save_context(None)  # Should not raise

    def test_context_accumulates_across_saves(self, run_dir):
        path = os.path.join(run_dir, "prompt_context.json")
        pb = PromptBuilder("title", "desc")
        pb.update_context("key1", "val1")
        pb.save_context(path)
        pb.update_context("key2", "val2")
        pb.save_context(path)
        # Load and verify both keys
        pb2 = PromptBuilder("title", "desc")
        pb2.load_context(path)
        assert pb2.get_context("key1") == "val1"
        assert pb2.get_context("key2") == "val2"


# ---------------------------------------------------------------------------
# A7: Iteration-level resume logic
# ---------------------------------------------------------------------------


class TestIterationLevelResume:
    """Test iteration tracking and dirty-state recovery."""

    def test_find_last_completed_iteration_empty(self):
        stage_data = {"status": "in_progress", "iterations": []}
        assert find_last_completed_iteration(stage_data) is None

    def test_find_last_completed_iteration(self):
        stage_data = {
            "status": "in_progress",
            "iterations": [
                {"number": 1, "status": "completed"},
                {"number": 2, "status": "completed"},
                {"number": 3, "status": "in_progress"},
            ],
        }
        assert find_last_completed_iteration(stage_data) == 2

    def test_get_resume_iteration_after_clean(self):
        stage_data = {
            "status": "in_progress",
            "iterations": [
                {"number": 1, "status": "completed"},
                {"number": 2, "status": "completed"},
            ],
        }
        assert get_resume_iteration(stage_data) == 3

    def test_dirty_iteration_discarded(self, base_status, status_path):
        """Dirty (in_progress) iteration is discarded — resume starts after last completed."""
        base_status["stages"]["implement"] = {
            "status": "in_progress",
            "iterations": [
                {"number": 1, "status": "completed", "outcome": "success"},
                {"number": 2, "status": "completed", "outcome": "success"},
                {"number": 3, "status": "in_progress"},  # dirty
            ],
        }
        stage_data = base_status["stages"]["implement"]
        last_completed = find_last_completed_iteration(stage_data)
        resume_iter = get_resume_iteration(stage_data)
        assert last_completed == 2
        assert resume_iter == 3  # restart iteration 3

    def test_all_completed_no_resume(self):
        stage_data = {
            "status": "completed",
            "iterations": [
                {"number": 1, "status": "completed"},
            ],
        }
        # All done — next would be 2
        assert get_resume_iteration(stage_data) == 2


# ---------------------------------------------------------------------------
# Git divergence guard
# ---------------------------------------------------------------------------


class TestGitDivergenceGuard:
    """Verify git HEAD check on resume."""

    @patch("worca.orchestrator.resume.get_current_git_head")
    def test_no_divergence(self, mock_head):
        mock_head.return_value = "abc123"
        status = {"git_head": "abc123"}
        result = check_git_divergence(status)
        assert result["diverged"] is False

    @patch("worca.orchestrator.resume.get_current_git_head")
    def test_divergence_detected(self, mock_head):
        mock_head.return_value = "def456"
        status = {"git_head": "abc123"}
        result = check_git_divergence(status)
        assert result["diverged"] is True
        assert result["stored"] == "abc123"
        assert result["current"] == "def456"

    @patch("worca.orchestrator.resume.get_current_git_head")
    def test_missing_stored_head(self, mock_head):
        mock_head.return_value = "abc123"
        status = {}
        result = check_git_divergence(status)
        # No stored head — can't compare, should not block
        assert result["diverged"] is False


# ---------------------------------------------------------------------------
# Integration: status + iterations + counters full flow
# ---------------------------------------------------------------------------


class TestFullStatusFlow:
    """End-to-end test of status manipulation as runner would do it."""

    def test_full_iteration_lifecycle(self, base_status, status_path):
        """Simulate: start → iteration 1 complete → iteration 2 complete → save counters."""
        base_status["pipeline_status"] = "running"
        base_status["run_id"] = "test-run"

        # Stage starts
        update_stage(base_status, "implement", status="in_progress")

        # Iteration 1
        start_iteration(base_status, "implement", agent="implementer", model="sonnet")
        complete_iteration(base_status, "implement", status="completed", outcome="success", duration_ms=5000)

        # Iteration 2
        start_iteration(base_status, "implement", agent="implementer", model="sonnet")
        complete_iteration(base_status, "implement", status="completed", outcome="success", duration_ms=3000)

        # Persist loop counters
        base_status["loop_counters"] = {"implement_test": 1}
        save_status(base_status, status_path)

        # Verify full state
        loaded = load_status(status_path)
        assert loaded["pipeline_status"] == "running"
        stage = loaded["stages"]["implement"]
        assert stage["status"] == "in_progress"
        assert len(stage["iterations"]) == 2
        assert stage["iterations"][0]["status"] == "completed"
        assert stage["iterations"][1]["status"] == "completed"
        assert loaded["loop_counters"]["implement_test"] == 1

    def test_resume_restores_full_state(self, base_status, status_path, run_dir):
        """Simulate a crash mid-iteration, then resume restoring all state."""
        # Set up state as if pipeline was running and crashed
        base_status["pipeline_status"] = "failed"
        base_status["stop_reason"] = "RuntimeError"
        base_status["loop_counters"] = {"implement_test": 2, "bead_iteration": 1}
        update_stage(base_status, "implement", status="in_progress")
        start_iteration(base_status, "implement", agent="implementer", model="sonnet")
        complete_iteration(base_status, "implement", status="completed", outcome="success")
        start_iteration(base_status, "implement", agent="implementer", model="sonnet")
        # Iteration 2 left in_progress (dirty)
        save_status(base_status, status_path)

        # Save PromptBuilder context
        pb = PromptBuilder("title", "desc")
        pb.update_context("plan_approach", "TDD")
        pb.update_context("files_changed", ["a.py", "b.py"])
        context_path = os.path.join(run_dir, "prompt_context.json")
        pb.save_context(context_path)

        # --- Resume ---
        loaded = load_status(status_path)
        assert loaded["pipeline_status"] == "failed"

        # Restore loop counters
        counters = restore_loop_counters(loaded)
        assert counters == {"implement_test": 2, "bead_iteration": 1}

        # Find resume point in implement stage
        stage_data = loaded["stages"]["implement"]
        last = find_last_completed_iteration(stage_data)
        assert last == 1  # iteration 1 completed, iteration 2 is dirty
        resume_from = get_resume_iteration(stage_data)
        assert resume_from == 2  # restart iteration 2

        # Restore PromptBuilder context
        pb2 = PromptBuilder("title", "desc")
        pb2.load_context(context_path)
        assert pb2.get_context("plan_approach") == "TDD"
        assert pb2.get_context("files_changed") == ["a.py", "b.py"]
