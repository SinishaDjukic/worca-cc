"""Tests for sequenced plan file paths (plan-NNN.md).

Covers:
- _next_plan_path helper in runner.py
- guard.py allowing plan-NNN.md for planner agent
- Backward compatibility with MASTER_PLAN.md
"""
import os
import pytest
from worca.orchestrator.runner import _next_plan_path
from worca.hooks.guard import check_guard


# --- _next_plan_path ---

class TestNextPlanPath:
    def test_returns_plan_001_for_empty_dir(self, tmp_path):
        result = _next_plan_path(str(tmp_path))
        assert result == os.path.join(str(tmp_path), "plan-001.md")

    def test_returns_plan_002_when_001_exists(self, tmp_path):
        (tmp_path / "plan-001.md").write_text("# Plan 1")
        result = _next_plan_path(str(tmp_path))
        assert result == os.path.join(str(tmp_path), "plan-002.md")

    def test_returns_plan_003_when_001_and_002_exist(self, tmp_path):
        (tmp_path / "plan-001.md").write_text("# Plan 1")
        (tmp_path / "plan-002.md").write_text("# Plan 2")
        result = _next_plan_path(str(tmp_path))
        assert result == os.path.join(str(tmp_path), "plan-003.md")

    def test_handles_gap_in_sequence(self, tmp_path):
        """If plan-001.md and plan-003.md exist, next should be plan-004.md."""
        (tmp_path / "plan-001.md").write_text("# Plan 1")
        (tmp_path / "plan-003.md").write_text("# Plan 3")
        result = _next_plan_path(str(tmp_path))
        assert result == os.path.join(str(tmp_path), "plan-004.md")

    def test_ignores_non_plan_files(self, tmp_path):
        """Other .md files in the dir should not affect numbering."""
        (tmp_path / "status.json").write_text("{}")
        (tmp_path / "README.md").write_text("# Readme")
        result = _next_plan_path(str(tmp_path))
        assert result == os.path.join(str(tmp_path), "plan-001.md")

    def test_ignores_malformed_plan_filenames(self, tmp_path):
        """Files like plan-abc.md or plan-1.md should not match."""
        (tmp_path / "plan-abc.md").write_text("bad")
        (tmp_path / "plan-1.md").write_text("bad")
        result = _next_plan_path(str(tmp_path))
        assert result == os.path.join(str(tmp_path), "plan-001.md")


# --- Guard allows plan-NNN.md for planner ---

class TestGuardPlannerPlanFiles:
    def test_allows_planner_write_plan_001(self, monkeypatch):
        monkeypatch.setenv("WORCA_AGENT", "planner")
        monkeypatch.delenv("WORCA_PLAN_FILE", raising=False)
        code, reason = check_guard("Write", {"file_path": "/run/plan-001.md"})
        assert code == 0

    def test_allows_planner_write_plan_042(self, monkeypatch):
        monkeypatch.setenv("WORCA_AGENT", "planner")
        monkeypatch.delenv("WORCA_PLAN_FILE", raising=False)
        code, reason = check_guard("Write", {"file_path": "/run/plan-042.md"})
        assert code == 0

    def test_allows_planner_write_master_plan_backward_compat(self, monkeypatch):
        """MASTER_PLAN.md should still be allowed for backward compatibility."""
        monkeypatch.setenv("WORCA_AGENT", "planner")
        monkeypatch.delenv("WORCA_PLAN_FILE", raising=False)
        code, reason = check_guard("Write", {"file_path": "/project/MASTER_PLAN.md"})
        assert code == 0

    def test_blocks_planner_write_other_file(self, monkeypatch):
        monkeypatch.setenv("WORCA_AGENT", "planner")
        monkeypatch.delenv("WORCA_PLAN_FILE", raising=False)
        code, reason = check_guard("Write", {"file_path": "/project/app.py"})
        assert code == 2
        assert "planner" in reason.lower()

    def test_blocks_planner_write_plan_without_three_digits(self, monkeypatch):
        """plan-1.md does not match the plan-NNN.md pattern."""
        monkeypatch.setenv("WORCA_AGENT", "planner")
        monkeypatch.delenv("WORCA_PLAN_FILE", raising=False)
        code, reason = check_guard("Write", {"file_path": "/run/plan-1.md"})
        assert code == 2

    def test_blocks_planner_write_plan_with_extra_chars(self, monkeypatch):
        """plan-001-extra.md does not match the plan-NNN.md pattern."""
        monkeypatch.setenv("WORCA_AGENT", "planner")
        monkeypatch.delenv("WORCA_PLAN_FILE", raising=False)
        code, reason = check_guard("Write", {"file_path": "/run/plan-001-extra.md"})
        assert code == 2

    def test_plan_file_env_takes_precedence(self, monkeypatch):
        """When WORCA_PLAN_FILE is set, only that exact file is allowed."""
        monkeypatch.setenv("WORCA_AGENT", "planner")
        monkeypatch.setenv("WORCA_PLAN_FILE", "/run/plan-005.md")
        code, reason = check_guard("Write", {"file_path": "/run/plan-005.md"})
        assert code == 0
        # Different plan file should be blocked
        code, reason = check_guard("Write", {"file_path": "/run/plan-001.md"})
        assert code == 2


# --- PromptBuilder uses plan_file from context ---

class TestPromptBuilderPlanFile:
    def test_plan_prompt_uses_context_plan_file(self):
        from worca.orchestrator.prompt_builder import PromptBuilder
        pb = PromptBuilder("Test title", "Test desc", claude_md_path="/nonexistent")
        pb.update_context("plan_file", "/run/plan-001.md")
        prompt = pb.build("plan")
        assert "/run/plan-001.md" in prompt
        assert "MASTER_PLAN.md" not in prompt

    def test_plan_prompt_falls_back_to_master_plan(self):
        from worca.orchestrator.prompt_builder import PromptBuilder
        pb = PromptBuilder("Test title", "Test desc", claude_md_path="/nonexistent")
        prompt = pb.build("plan")
        assert "MASTER_PLAN.md" in prompt
