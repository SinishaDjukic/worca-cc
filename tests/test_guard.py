"""Tests for guard.py - PreToolUse safety gates."""
import os
import pytest
from worca.hooks.guard import check_guard


# --- Block rm -rf ---

class TestBlockRmRf:
    def test_blocks_rm_rf_slash(self):
        code, reason = check_guard("Bash", {"command": "rm -rf /"})
        assert code == 2
        assert "rm" in reason.lower()

    def test_blocks_rm_rf_directory(self):
        code, reason = check_guard("Bash", {"command": "rm -rf /some/dir"})
        assert code == 2

    def test_blocks_rm_with_separate_r_f_flags(self):
        code, reason = check_guard("Bash", {"command": "rm -r -f /some/dir"})
        assert code == 2

    def test_blocks_rm_fr(self):
        code, reason = check_guard("Bash", {"command": "rm -fr /tmp/stuff"})
        assert code == 2

    def test_allows_simple_rm(self):
        code, reason = check_guard("Bash", {"command": "rm file.txt"})
        assert code == 0

    def test_allows_rm_single_r_flag(self):
        code, reason = check_guard("Bash", {"command": "rm -r dir/"})
        assert code == 0

    def test_allows_rm_single_f_flag(self):
        code, reason = check_guard("Bash", {"command": "rm -f file.txt"})
        assert code == 0


# --- Block .env access ---

class TestBlockEnvAccess:
    def test_blocks_write_to_dotenv(self):
        code, reason = check_guard("Write", {"file_path": "/project/.env"})
        assert code == 2
        assert ".env" in reason

    def test_blocks_edit_to_dotenv(self):
        code, reason = check_guard("Edit", {"file_path": "/project/.env"})
        assert code == 2

    def test_allows_env_sample(self):
        code, reason = check_guard("Write", {"file_path": "/project/.env.sample"})
        assert code == 0

    def test_allows_env_example(self):
        code, reason = check_guard("Edit", {"file_path": "/project/.env.example"})
        assert code == 0

    def test_allows_read_dotenv(self):
        code, reason = check_guard("Read", {"file_path": "/project/.env"})
        assert code == 0


# --- Block commits when not Guardian ---

class TestBlockNonGuardianCommits:
    def test_blocks_commit_when_agent_is_implementer(self):
        os.environ["WORCA_AGENT"] = "implementer"
        try:
            code, reason = check_guard("Bash", {"command": "git commit -m 'fix'"})
            assert code == 2
            assert "commit" in reason.lower() or "guardian" in reason.lower()
        finally:
            del os.environ["WORCA_AGENT"]

    def test_allows_commit_when_agent_is_guardian(self):
        os.environ["WORCA_AGENT"] = "guardian"
        try:
            code, reason = check_guard("Bash", {"command": "git commit -m 'fix'"})
            assert code == 0
        finally:
            del os.environ["WORCA_AGENT"]

    def test_allows_commit_when_no_agent_env(self):
        os.environ.pop("WORCA_AGENT", None)
        code, reason = check_guard("Bash", {"command": "git commit -m 'fix'"})
        assert code == 0

    def test_blocks_commit_amend_when_not_guardian(self):
        os.environ["WORCA_AGENT"] = "planner"
        try:
            code, reason = check_guard("Bash", {"command": "git commit --amend"})
            assert code == 2
        finally:
            del os.environ["WORCA_AGENT"]


# --- Block force push ---

class TestBlockForcePush:
    def test_blocks_git_push_force(self):
        code, reason = check_guard("Bash", {"command": "git push --force"})
        assert code == 2
        assert "force" in reason.lower() or "push" in reason.lower()

    def test_blocks_git_push_dash_f(self):
        code, reason = check_guard("Bash", {"command": "git push -f origin main"})
        assert code == 2

    def test_blocks_git_push_force_with_lease(self):
        # --force-with-lease still contains --force pattern; should block
        code, reason = check_guard("Bash", {"command": "git push --force-with-lease"})
        assert code == 2

    def test_allows_normal_git_push(self):
        code, reason = check_guard("Bash", {"command": "git push origin main"})
        assert code == 0


# --- Allow everything else ---

class TestAllowDefault:
    def test_allows_read(self):
        code, reason = check_guard("Read", {"file_path": "/some/file.py"})
        assert code == 0

    def test_allows_glob(self):
        code, reason = check_guard("Glob", {"pattern": "**/*.py"})
        assert code == 0

    def test_allows_safe_bash(self):
        code, reason = check_guard("Bash", {"command": "ls -la"})
        assert code == 0

    def test_allows_write_to_normal_file(self):
        code, reason = check_guard("Write", {"file_path": "/project/app.py"})
        assert code == 0
