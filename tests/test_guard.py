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
        os.environ.pop("WORCA_AGENT", None)
        code, reason = check_guard("Write", {"file_path": "/project/.env.sample"})
        assert code == 0

    def test_allows_env_example(self):
        os.environ.pop("WORCA_AGENT", None)
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


# --- Block Planner writes ---

class TestBlockPlannerWrites:
    def test_blocks_planner_write_to_py_file(self):
        os.environ["WORCA_AGENT"] = "planner"
        try:
            code, reason = check_guard("Write", {"file_path": "/project/app.py"})
            assert code == 2
            assert "planner" in reason.lower()
        finally:
            del os.environ["WORCA_AGENT"]

    def test_blocks_planner_edit_to_source_file(self):
        os.environ["WORCA_AGENT"] = "planner"
        try:
            code, reason = check_guard("Edit", {"file_path": "/project/utils.js"})
            assert code == 2
        finally:
            del os.environ["WORCA_AGENT"]

    def test_allows_planner_write_master_plan(self):
        saved_plan_file = os.environ.pop("WORCA_PLAN_FILE", None)
        os.environ["WORCA_AGENT"] = "planner"
        try:
            code, reason = check_guard("Write", {"file_path": "/project/MASTER_PLAN.md"})
            assert code == 0
        finally:
            del os.environ["WORCA_AGENT"]
            if saved_plan_file is not None:
                os.environ["WORCA_PLAN_FILE"] = saved_plan_file

    def test_allows_implementer_write_source(self):
        os.environ["WORCA_AGENT"] = "implementer"
        try:
            code, reason = check_guard("Write", {"file_path": "/project/app.py"})
            assert code == 0
        finally:
            del os.environ["WORCA_AGENT"]


# --- Block Planner/Coordinator tests ---

class TestBlockPlannerTests:
    def test_blocks_planner_pytest(self):
        os.environ["WORCA_AGENT"] = "planner"
        try:
            code, reason = check_guard("Bash", {"command": "pytest tests/ -v"})
            assert code == 2
            assert "planner" in reason.lower()
        finally:
            del os.environ["WORCA_AGENT"]

    def test_blocks_coordinator_pytest(self):
        os.environ["WORCA_AGENT"] = "coordinator"
        try:
            code, reason = check_guard("Bash", {"command": "python -m pytest"})
            assert code == 2
            assert "coordinator" in reason.lower()
        finally:
            del os.environ["WORCA_AGENT"]

    def test_allows_implementer_pytest(self):
        os.environ["WORCA_AGENT"] = "implementer"
        try:
            code, reason = check_guard("Bash", {"command": "pytest tests/ -v"})
            assert code == 0
        finally:
            del os.environ["WORCA_AGENT"]

    def test_allows_planner_safe_bash(self):
        os.environ["WORCA_AGENT"] = "planner"
        try:
            code, reason = check_guard("Bash", {"command": "ls -la"})
            assert code == 0
        finally:
            del os.environ["WORCA_AGENT"]


# --- Block Coordinator writes ---

class TestBlockCoordinatorWrites:
    def test_blocks_coordinator_write(self):
        os.environ["WORCA_AGENT"] = "coordinator"
        try:
            code, reason = check_guard("Write", {"file_path": "/project/app.py"})
            assert code == 2
            assert "coordinator" in reason.lower()
        finally:
            del os.environ["WORCA_AGENT"]

    def test_blocks_coordinator_edit(self):
        os.environ["WORCA_AGENT"] = "coordinator"
        try:
            code, reason = check_guard("Edit", {"file_path": "/project/app.py"})
            assert code == 2
            assert "coordinator" in reason.lower()
        finally:
            del os.environ["WORCA_AGENT"]

    def test_allows_coordinator_read(self):
        os.environ["WORCA_AGENT"] = "coordinator"
        try:
            code, reason = check_guard("Read", {"file_path": "/project/app.py"})
            assert code == 0
        finally:
            del os.environ["WORCA_AGENT"]


# --- Block Tester writes ---

class TestBlockTesterWrites:
    def test_blocks_tester_write(self):
        os.environ["WORCA_AGENT"] = "tester"
        try:
            code, reason = check_guard("Write", {"file_path": "/project/app.py"})
            assert code == 2
            assert "tester" in reason.lower()
        finally:
            del os.environ["WORCA_AGENT"]

    def test_blocks_tester_edit(self):
        os.environ["WORCA_AGENT"] = "tester"
        try:
            code, reason = check_guard("Edit", {"file_path": "/project/config.json"})
            assert code == 2
        finally:
            del os.environ["WORCA_AGENT"]

    def test_allows_tester_read(self):
        os.environ["WORCA_AGENT"] = "tester"
        try:
            code, reason = check_guard("Read", {"file_path": "/project/app.py"})
            assert code == 0
        finally:
            del os.environ["WORCA_AGENT"]


# --- Planner with WORCA_PLAN_FILE env var ---

class TestPlannerPlanFileEnv:
    def test_allows_planner_write_to_plan_file_from_env(self):
        os.environ["WORCA_AGENT"] = "planner"
        os.environ["WORCA_PLAN_FILE"] = "/project/docs/plans/my-plan.md"
        try:
            code, reason = check_guard("Write", {"file_path": "/project/docs/plans/my-plan.md"})
            assert code == 0
        finally:
            del os.environ["WORCA_AGENT"]
            del os.environ["WORCA_PLAN_FILE"]

    def test_blocks_planner_write_wrong_file_with_env(self):
        os.environ["WORCA_AGENT"] = "planner"
        os.environ["WORCA_PLAN_FILE"] = "/project/docs/plans/my-plan.md"
        try:
            code, reason = check_guard("Write", {"file_path": "/project/app.py"})
            assert code == 2
            assert "planner" in reason.lower() or "may only write" in reason.lower()
        finally:
            del os.environ["WORCA_AGENT"]
            del os.environ["WORCA_PLAN_FILE"]

    def test_allows_planner_write_master_plan_without_env(self):
        """Backward compat: without WORCA_PLAN_FILE, MASTER_PLAN.md is still allowed."""
        os.environ["WORCA_AGENT"] = "planner"
        os.environ.pop("WORCA_PLAN_FILE", None)
        try:
            code, reason = check_guard("Write", {"file_path": "/project/MASTER_PLAN.md"})
            assert code == 0
        finally:
            del os.environ["WORCA_AGENT"]


# --- Block Bash file writes for read-only agents ---

class TestBlockBashFileWrites:
    """Coordinator and tester must not bypass Write/Edit guards via Bash."""

    def test_blocks_coordinator_cat_redirect(self):
        os.environ["WORCA_AGENT"] = "coordinator"
        try:
            code, reason = check_guard("Bash", {"command": "cat > /project/app.py << 'EOF'\nprint('hello')\nEOF"})
            assert code == 2
            assert "coordinator" in reason.lower()
        finally:
            del os.environ["WORCA_AGENT"]

    def test_blocks_coordinator_echo_redirect(self):
        os.environ["WORCA_AGENT"] = "coordinator"
        try:
            code, reason = check_guard("Bash", {"command": 'echo "hello" > /project/file.txt'})
            assert code == 2
        finally:
            del os.environ["WORCA_AGENT"]

    def test_blocks_coordinator_tee(self):
        os.environ["WORCA_AGENT"] = "coordinator"
        try:
            code, reason = check_guard("Bash", {"command": "echo 'data' | tee /project/file.txt"})
            assert code == 2
        finally:
            del os.environ["WORCA_AGENT"]

    def test_blocks_coordinator_python_file_write(self):
        os.environ["WORCA_AGENT"] = "coordinator"
        try:
            code, reason = check_guard("Bash", {"command": """python3 -c "open('file.py','w').write('code')" """})
            assert code == 2
        finally:
            del os.environ["WORCA_AGENT"]

    def test_blocks_coordinator_python_heredoc_write(self):
        os.environ["WORCA_AGENT"] = "coordinator"
        try:
            code, reason = check_guard("Bash", {"command": "python3 << 'PYSCRIPT'\nopen('file.py','w').write('x')\nPYSCRIPT"})
            assert code == 2
        finally:
            del os.environ["WORCA_AGENT"]

    def test_blocks_coordinator_sed_inplace(self):
        os.environ["WORCA_AGENT"] = "coordinator"
        try:
            code, reason = check_guard("Bash", {"command": "sed -i 's/old/new/g' file.py"})
            assert code == 2
        finally:
            del os.environ["WORCA_AGENT"]

    def test_blocks_coordinator_cp(self):
        os.environ["WORCA_AGENT"] = "coordinator"
        try:
            code, reason = check_guard("Bash", {"command": "cp source.py dest.py"})
            assert code == 2
        finally:
            del os.environ["WORCA_AGENT"]

    def test_blocks_tester_cat_redirect(self):
        os.environ["WORCA_AGENT"] = "tester"
        try:
            code, reason = check_guard("Bash", {"command": "cat > /project/app.py << 'EOF'\ncode\nEOF"})
            assert code == 2
            assert "tester" in reason.lower()
        finally:
            del os.environ["WORCA_AGENT"]

    def test_allows_coordinator_bd_commands(self):
        os.environ["WORCA_AGENT"] = "coordinator"
        try:
            code, reason = check_guard("Bash", {"command": "bd create --title='task' --type=task"})
            assert code == 0
        finally:
            del os.environ["WORCA_AGENT"]

    def test_allows_coordinator_bd_list(self):
        os.environ["WORCA_AGENT"] = "coordinator"
        try:
            code, reason = check_guard("Bash", {"command": "bd list --status=open"})
            assert code == 0
        finally:
            del os.environ["WORCA_AGENT"]

    def test_allows_coordinator_ls(self):
        os.environ["WORCA_AGENT"] = "coordinator"
        try:
            code, reason = check_guard("Bash", {"command": "ls -la /project/"})
            assert code == 0
        finally:
            del os.environ["WORCA_AGENT"]

    def test_allows_coordinator_grep(self):
        os.environ["WORCA_AGENT"] = "coordinator"
        try:
            code, reason = check_guard("Bash", {"command": "grep -r 'pattern' /project/"})
            assert code == 0
        finally:
            del os.environ["WORCA_AGENT"]

    def test_allows_implementer_cat_redirect(self):
        """Implementer is not read-only, should be allowed."""
        os.environ["WORCA_AGENT"] = "implementer"
        try:
            code, reason = check_guard("Bash", {"command": "cat > /project/app.py << 'EOF'\ncode\nEOF"})
            assert code == 0
        finally:
            del os.environ["WORCA_AGENT"]

    def test_allows_no_agent_cat_redirect(self):
        """No WORCA_AGENT set — no restrictions."""
        os.environ.pop("WORCA_AGENT", None)
        code, reason = check_guard("Bash", {"command": "cat > /project/app.py << 'EOF'\ncode\nEOF"})
        assert code == 0
