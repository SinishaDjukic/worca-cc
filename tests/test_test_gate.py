"""Tests for test_gate.py - Escalating strike system for test failures."""
import pytest
from worca.hooks import test_gate
from worca.hooks.test_gate import check_test_gate


@pytest.fixture(autouse=True)
def reset_strikes():
    """Reset strike counter before each test."""
    test_gate._state["strikes"] = 0
    yield
    test_gate._state["strikes"] = 0


# --- Track test failures / warn on first ---

class TestFirstStrike:
    def test_first_failure_returns_zero(self):
        code, reason = check_test_gate("Bash", {"command": "pytest tests/"}, exit_code=1)
        assert code == 0

    def test_first_failure_warns(self):
        code, reason = check_test_gate("Bash", {"command": "pytest tests/"}, exit_code=1)
        assert code == 0
        assert "warning" in reason.lower() or "strike" in reason.lower()

    def test_first_failure_increments_counter(self):
        check_test_gate("Bash", {"command": "pytest tests/"}, exit_code=1)
        assert test_gate._state["strikes"] == 1


# --- Block on second+ strike ---

class TestSecondStrike:
    def test_second_failure_blocks(self):
        check_test_gate("Bash", {"command": "pytest"}, exit_code=1)  # strike 1
        code, reason = check_test_gate("Bash", {"command": "pytest"}, exit_code=1)  # strike 2
        assert code == 2
        assert "blocked" in reason.lower() or "failure" in reason.lower()

    def test_third_failure_also_blocks(self):
        check_test_gate("Bash", {"command": "pytest"}, exit_code=1)  # strike 1
        check_test_gate("Bash", {"command": "pytest"}, exit_code=1)  # strike 2
        code, reason = check_test_gate("Bash", {"command": "pytest"}, exit_code=1)  # strike 3
        assert code == 2
        assert "3" in reason

    def test_strike_count_in_message(self):
        check_test_gate("Bash", {"command": "pytest"}, exit_code=1)
        code, reason = check_test_gate("Bash", {"command": "pytest"}, exit_code=1)
        assert "2" in reason


# --- Reset on success ---

class TestResetOnSuccess:
    def test_success_resets_strikes(self):
        check_test_gate("Bash", {"command": "pytest"}, exit_code=1)  # strike 1
        check_test_gate("Bash", {"command": "pytest"}, exit_code=0)  # pass -> reset
        assert test_gate._state["strikes"] == 0

    def test_failure_after_reset_is_first_strike(self):
        check_test_gate("Bash", {"command": "pytest"}, exit_code=1)  # strike 1
        check_test_gate("Bash", {"command": "pytest"}, exit_code=0)  # reset
        code, reason = check_test_gate("Bash", {"command": "pytest"}, exit_code=1)  # strike 1 again
        assert code == 0  # warning, not block
        assert test_gate._state["strikes"] == 1

    def test_success_returns_zero(self):
        code, reason = check_test_gate("Bash", {"command": "pytest"}, exit_code=0)
        assert code == 0


# --- Ignore non-test commands ---

class TestIgnoreNonTest:
    def test_ignores_non_pytest_bash(self):
        code, reason = check_test_gate("Bash", {"command": "ls -la"}, exit_code=1)
        assert code == 0
        assert reason == ""

    def test_ignores_non_bash_tool(self):
        code, reason = check_test_gate("Write", {"file_path": "test.py"}, exit_code=0)
        assert code == 0
        assert reason == ""

    def test_non_pytest_doesnt_affect_counter(self):
        check_test_gate("Bash", {"command": "pytest"}, exit_code=1)  # strike 1
        check_test_gate("Bash", {"command": "ls -la"}, exit_code=1)  # ignored
        assert test_gate._state["strikes"] == 1

    def test_ignores_read_tool(self):
        code, reason = check_test_gate("Read", {"file_path": "pytest.ini"}, exit_code=0)
        assert code == 0
        assert reason == ""


# --- pytest substring matching ---

class TestPytestSubstring:
    def test_matches_pytest_with_args(self):
        code, reason = check_test_gate("Bash", {"command": "pytest tests/ -v"}, exit_code=1)
        assert code == 0  # first strike = warning
        assert test_gate._state["strikes"] == 1

    def test_matches_python_m_pytest(self):
        code, reason = check_test_gate("Bash", {"command": "python -m pytest"}, exit_code=1)
        assert test_gate._state["strikes"] == 1
