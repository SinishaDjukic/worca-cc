"""Tests for test_gate.py - File-backed strike persistence."""
import json
import os

import pytest

from worca.hooks import test_gate
from worca.hooks.test_gate import check_test_gate


@pytest.fixture(autouse=True)
def reset_state(tmp_path, monkeypatch):
    """Reset strike state and point WORCA_RUN_DIR at a temp directory."""
    test_gate._state["strikes"] = 0
    monkeypatch.setenv("WORCA_RUN_DIR", str(tmp_path))
    yield
    test_gate._state["strikes"] = 0


# --- File-backed persistence across calls ---


class TestFilePersistence:
    def test_strikes_persist_across_calls(self, tmp_path):
        """Strike count written to file survives across calls."""
        check_test_gate("Bash", {"command": "pytest"}, exit_code=1)  # strike 1
        # Read the file directly to verify persistence
        state_file = tmp_path / "test_gate_strikes.json"
        assert state_file.exists()
        data = json.loads(state_file.read_text())
        assert data["strikes"] == 1

    def test_second_call_reads_persisted_strike(self, tmp_path):
        """Second call picks up strike count from file."""
        check_test_gate("Bash", {"command": "pytest"}, exit_code=1)  # strike 1
        # Reset in-memory state to prove file is used
        test_gate._state["strikes"] = 0
        code, reason = check_test_gate("Bash", {"command": "pytest"}, exit_code=1)  # strike 2
        assert code == 2
        assert "2" in reason

    def test_multiple_failures_accumulate_in_file(self, tmp_path):
        """Each failure increments the count in the file."""
        check_test_gate("Bash", {"command": "pytest"}, exit_code=1)
        check_test_gate("Bash", {"command": "pytest"}, exit_code=1)
        check_test_gate("Bash", {"command": "pytest"}, exit_code=1)
        state_file = tmp_path / "test_gate_strikes.json"
        data = json.loads(state_file.read_text())
        assert data["strikes"] == 3


# --- Reset on success ---


class TestFileResetOnSuccess:
    def test_success_resets_file_to_zero(self, tmp_path):
        """Passing tests reset the strike file to 0."""
        check_test_gate("Bash", {"command": "pytest"}, exit_code=1)  # strike 1
        check_test_gate("Bash", {"command": "pytest"}, exit_code=0)  # pass
        state_file = tmp_path / "test_gate_strikes.json"
        data = json.loads(state_file.read_text())
        assert data["strikes"] == 0

    def test_failure_after_reset_starts_at_one(self, tmp_path):
        """After a success reset, the next failure is strike 1 (warning, not block)."""
        check_test_gate("Bash", {"command": "pytest"}, exit_code=1)
        check_test_gate("Bash", {"command": "pytest"}, exit_code=0)  # reset
        code, reason = check_test_gate("Bash", {"command": "pytest"}, exit_code=1)
        assert code == 0  # warning, not block
        state_file = tmp_path / "test_gate_strikes.json"
        data = json.loads(state_file.read_text())
        assert data["strikes"] == 1


# --- Blocking after 2 consecutive failures ---


class TestFileBlocking:
    def test_blocks_after_two_failures(self):
        """Two consecutive failures result in a block (exit code 2)."""
        check_test_gate("Bash", {"command": "pytest"}, exit_code=1)  # strike 1
        code, reason = check_test_gate("Bash", {"command": "pytest"}, exit_code=1)  # strike 2
        assert code == 2
        assert "blocked" in reason.lower()

    def test_first_failure_warns_not_blocks(self):
        """First failure is a warning only (exit code 0)."""
        code, reason = check_test_gate("Bash", {"command": "pytest"}, exit_code=1)
        assert code == 0
        assert "warning" in reason.lower() or "strike" in reason.lower()


# --- Fallback to in-memory when WORCA_RUN_DIR not set ---


class TestFallbackInMemory:
    def test_no_run_dir_uses_memory(self, monkeypatch):
        """When WORCA_RUN_DIR is not set, falls back to in-memory state."""
        monkeypatch.delenv("WORCA_RUN_DIR", raising=False)
        test_gate._state["strikes"] = 0
        check_test_gate("Bash", {"command": "pytest"}, exit_code=1)
        assert test_gate._state["strikes"] == 1

    def test_no_run_dir_no_file_created(self, tmp_path, monkeypatch):
        """When WORCA_RUN_DIR is not set, no state file is created."""
        monkeypatch.delenv("WORCA_RUN_DIR", raising=False)
        test_gate._state["strikes"] = 0
        check_test_gate("Bash", {"command": "pytest"}, exit_code=1)
        state_file = tmp_path / "test_gate_strikes.json"
        assert not state_file.exists()

    def test_no_run_dir_still_blocks_after_two(self, monkeypatch):
        """In-memory fallback still blocks after 2 failures."""
        monkeypatch.delenv("WORCA_RUN_DIR", raising=False)
        test_gate._state["strikes"] = 0
        check_test_gate("Bash", {"command": "pytest"}, exit_code=1)
        code, reason = check_test_gate("Bash", {"command": "pytest"}, exit_code=1)
        assert code == 2


# --- Atomic write verification ---


class TestAtomicWrite:
    def test_state_file_exists_after_write(self, tmp_path):
        """State file exists after a strike is recorded."""
        check_test_gate("Bash", {"command": "pytest"}, exit_code=1)
        state_file = tmp_path / "test_gate_strikes.json"
        assert state_file.exists()

    def test_state_file_is_valid_json(self, tmp_path):
        """State file contains valid JSON after write."""
        check_test_gate("Bash", {"command": "pytest"}, exit_code=1)
        state_file = tmp_path / "test_gate_strikes.json"
        data = json.loads(state_file.read_text())
        assert "strikes" in data
        assert isinstance(data["strikes"], int)

    def test_no_temp_files_left_behind(self, tmp_path):
        """Atomic write should not leave .tmp files behind."""
        check_test_gate("Bash", {"command": "pytest"}, exit_code=1)
        tmp_files = list(tmp_path.glob("*.tmp"))
        assert tmp_files == []

    def test_run_dir_created_if_missing(self, tmp_path, monkeypatch):
        """If WORCA_RUN_DIR points to a non-existent subdirectory, it is created."""
        nested = tmp_path / "sub" / "dir"
        monkeypatch.setenv("WORCA_RUN_DIR", str(nested))
        check_test_gate("Bash", {"command": "pytest"}, exit_code=1)
        state_file = nested / "test_gate_strikes.json"
        assert state_file.exists()
