"""Tests for .claude/scripts/preflight_checks.py standalone script."""

import json
import subprocess
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch


# Make the scripts directory importable
sys.path.insert(0, str(Path(__file__).parent.parent / ".claude" / "scripts"))
import preflight_checks


# --- check_claude_cli ---

class TestCheckClaudeCli:
    def test_pass_when_found_and_version_ok(self):
        with patch("shutil.which", return_value="/usr/bin/claude"), \
             patch("subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(
                returncode=0, stdout="claude 1.0.40\n", stderr=""
            )
            status, msg = preflight_checks.check_claude_cli()
        assert status == "pass"
        assert "1.0.40" in msg

    def test_fail_when_not_in_path(self):
        with patch("shutil.which", return_value=None):
            status, msg = preflight_checks.check_claude_cli()
        assert status == "fail"
        assert "not found" in msg.lower()

    def test_fail_when_version_returns_nonzero(self):
        with patch("shutil.which", return_value="/usr/bin/claude"), \
             patch("subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=1, stdout="", stderr="error")
            status, _ = preflight_checks.check_claude_cli()
        assert status == "fail"

    def test_fail_on_timeout(self):
        with patch("shutil.which", return_value="/usr/bin/claude"), \
             patch("subprocess.run", side_effect=subprocess.TimeoutExpired("claude", 10)):
            status, msg = preflight_checks.check_claude_cli()
        assert status == "fail"
        assert "timed out" in msg.lower()


# --- check_git_repo ---

class TestCheckGitRepo:
    def test_pass_inside_repo(self):
        with patch("subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0, stdout="true\n")
            status, _ = preflight_checks.check_git_repo()
        assert status == "pass"

    def test_fail_outside_repo(self):
        with patch("subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=128, stdout="")
            status, msg = preflight_checks.check_git_repo()
        assert status == "fail"
        assert "git" in msg.lower()


# --- check_bd_cli ---

class TestCheckBdCli:
    def test_pass_when_found(self):
        with patch("shutil.which", return_value="/usr/bin/bd"):
            status, _ = preflight_checks.check_bd_cli()
        assert status == "pass"

    def test_fail_when_not_found(self):
        with patch("shutil.which", return_value=None):
            status, msg = preflight_checks.check_bd_cli()
        assert status == "fail"
        assert "not found" in msg.lower()


# --- check_settings_json ---

class TestCheckSettingsJson:
    def test_pass_with_valid_settings(self, tmp_path):
        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps({"worca": {"agents": {}}}))
        status, _ = preflight_checks.check_settings_json(settings_path=str(settings_file))
        assert status == "pass"

    def test_fail_when_file_missing(self, tmp_path):
        missing = str(tmp_path / "nonexistent.json")
        status, msg = preflight_checks.check_settings_json(settings_path=missing)
        assert status == "fail"
        assert "not found" in msg.lower()

    def test_fail_when_invalid_json(self, tmp_path):
        bad_file = tmp_path / "bad.json"
        bad_file.write_text("not valid json")
        status, msg = preflight_checks.check_settings_json(settings_path=str(bad_file))
        assert status == "fail"
        assert "invalid" in msg.lower()

    def test_fail_when_missing_worca_key(self, tmp_path):
        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps({"other": "data"}))
        status, msg = preflight_checks.check_settings_json(settings_path=str(settings_file))
        assert status == "fail"
        assert "worca" in msg.lower()


# --- check_agent_templates ---

class TestCheckAgentTemplates:
    REQUIRED = ["planner.md", "coordinator.md", "implementer.md", "tester.md", "guardian.md"]

    def test_pass_when_all_present(self, tmp_path):
        core_dir = tmp_path / "core"
        core_dir.mkdir()
        for name in self.REQUIRED:
            (core_dir / name).write_text("# template")
        status, msg = preflight_checks.check_agent_templates(core_dir=str(core_dir))
        assert status == "pass"
        assert "5" in msg

    def test_fail_when_one_missing(self, tmp_path):
        core_dir = tmp_path / "core"
        core_dir.mkdir()
        for name in self.REQUIRED[:-1]:  # all but last
            (core_dir / name).write_text("# template")
        status, msg = preflight_checks.check_agent_templates(core_dir=str(core_dir))
        assert status == "fail"
        assert "missing" in msg.lower()

    def test_fail_when_dir_empty(self, tmp_path):
        core_dir = tmp_path / "empty"
        core_dir.mkdir()
        status, msg = preflight_checks.check_agent_templates(core_dir=str(core_dir))
        assert status == "fail"

    def test_fail_message_names_missing_files(self, tmp_path):
        core_dir = tmp_path / "core"
        core_dir.mkdir()
        (core_dir / "planner.md").write_text("# template")
        status, msg = preflight_checks.check_agent_templates(core_dir=str(core_dir))
        assert status == "fail"
        assert "coordinator.md" in msg or "implementer.md" in msg


# --- check_disk_space ---

class TestCheckDiskSpace:
    def test_pass_when_enough_space(self):
        with patch("shutil.disk_usage") as mock_du:
            mock_du.return_value = MagicMock(free=2 * 1024 ** 3)  # 2GB
            status, msg = preflight_checks.check_disk_space()
        assert status == "pass"
        assert "2.0GB" in msg

    def test_fail_when_insufficient_space(self):
        with patch("shutil.disk_usage") as mock_du:
            mock_du.return_value = MagicMock(free=512 * 1024 ** 2)  # 512MB
            status, msg = preflight_checks.check_disk_space()
        assert status == "fail"
        assert "1GB" in msg or "1.0GB" in msg or "need" in msg.lower()


# --- warn checks ---

class TestWarnChecks:
    def test_gh_cli_pass_when_found(self):
        with patch("shutil.which", return_value="/usr/bin/gh"):
            status, _ = preflight_checks.check_gh_cli()
        assert status == "pass"

    def test_gh_cli_warn_when_not_found(self):
        with patch("shutil.which", return_value=None):
            status, msg = preflight_checks.check_gh_cli()
        assert status == "warn"
        assert "optional" in msg.lower()

    def test_python_available_pass_when_python3_found(self):
        with patch("shutil.which", side_effect=lambda x: "/usr/bin/python3" if x == "python3" else None):
            status, _ = preflight_checks.check_python_available()
        assert status == "pass"

    def test_python_available_pass_when_python_found(self):
        with patch("shutil.which", side_effect=lambda x: "/usr/bin/python" if x == "python" else None):
            status, _ = preflight_checks.check_python_available()
        assert status == "pass"

    def test_python_available_warn_when_neither_found(self):
        with patch("shutil.which", return_value=None):
            status, msg = preflight_checks.check_python_available()
        assert status == "warn"

    def test_test_runner_pass_when_pytest_found(self):
        with patch("shutil.which", return_value="/usr/bin/pytest"):
            status, _ = preflight_checks.check_test_runner()
        assert status == "pass"

    def test_test_runner_warn_when_not_found(self):
        with patch("shutil.which", return_value=None):
            status, msg = preflight_checks.check_test_runner()
        assert status == "warn"

    def test_node_available_pass_when_found(self):
        with patch("shutil.which", return_value="/usr/bin/node"):
            status, _ = preflight_checks.check_node_available()
        assert status == "pass"

    def test_node_available_warn_when_not_found(self):
        with patch("shutil.which", return_value=None):
            status, _ = preflight_checks.check_node_available()
        assert status == "warn"


# --- read_required_checks ---

class TestReadRequiredChecks:
    def test_returns_empty_when_no_preflight_key(self, tmp_path):
        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps({"worca": {}}))
        result = preflight_checks.read_required_checks(str(settings_file))
        assert result == []

    def test_returns_require_list(self, tmp_path):
        settings = {"worca": {"preflight": {"require": ["python_available", "test_runner"]}}}
        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps(settings))
        result = preflight_checks.read_required_checks(str(settings_file))
        assert result == ["python_available", "test_runner"]

    def test_returns_empty_on_missing_file(self, tmp_path):
        result = preflight_checks.read_required_checks(str(tmp_path / "missing.json"))
        assert result == []

    def test_returns_empty_on_malformed_json(self, tmp_path):
        bad_file = tmp_path / "bad.json"
        bad_file.write_text("not json")
        result = preflight_checks.read_required_checks(str(bad_file))
        assert result == []


# --- run_checks ---

class TestRunChecks:
    def _make_settings(self, tmp_path, require=None):
        settings = {"worca": {}}
        if require is not None:
            settings["worca"]["preflight"] = {"require": require}
        f = tmp_path / "settings.json"
        f.write_text(json.dumps(settings))
        return str(f)

    def _make_core_dir(self, tmp_path, present=None):
        core_dir = tmp_path / "core"
        core_dir.mkdir()
        names = present or ["planner.md", "coordinator.md", "implementer.md", "tester.md", "guardian.md"]
        for name in names:
            (core_dir / name).write_text("# template")
        return str(core_dir)

    def test_returns_three_tuple(self, tmp_path):
        settings_path = self._make_settings(tmp_path)
        core_dir = self._make_core_dir(tmp_path)
        with patch("shutil.which", return_value="/usr/bin/x"), \
             patch("subprocess.run") as mock_run, \
             patch("shutil.disk_usage") as mock_du:
            mock_run.return_value = MagicMock(returncode=0, stdout="1.0.0", stderr="")
            mock_du.return_value = MagicMock(free=2 * 1024 ** 3)
            result = preflight_checks.run_checks(settings_path=settings_path, core_dir=core_dir)
        checks, overall, summary = result
        assert isinstance(checks, list)
        assert overall in ("pass", "fail")
        assert isinstance(summary, str)

    def test_has_ten_checks(self, tmp_path):
        settings_path = self._make_settings(tmp_path)
        core_dir = self._make_core_dir(tmp_path)
        with patch("shutil.which", return_value="/usr/bin/x"), \
             patch("subprocess.run") as mock_run, \
             patch("shutil.disk_usage") as mock_du:
            mock_run.return_value = MagicMock(returncode=0, stdout="1.0.0", stderr="")
            mock_du.return_value = MagicMock(free=2 * 1024 ** 3)
            checks, _, _ = preflight_checks.run_checks(settings_path=settings_path, core_dir=core_dir)
        assert len(checks) == 10

    def test_each_check_has_required_fields(self, tmp_path):
        settings_path = self._make_settings(tmp_path)
        core_dir = self._make_core_dir(tmp_path)
        with patch("shutil.which", return_value="/usr/bin/x"), \
             patch("subprocess.run") as mock_run, \
             patch("shutil.disk_usage") as mock_du:
            mock_run.return_value = MagicMock(returncode=0, stdout="1.0.0", stderr="")
            mock_du.return_value = MagicMock(free=2 * 1024 ** 3)
            checks, _, _ = preflight_checks.run_checks(settings_path=settings_path, core_dir=core_dir)
        for check in checks:
            assert "name" in check
            assert "status" in check
            assert check["status"] in ("pass", "fail", "warn")
            assert "message" in check

    def test_overall_fail_when_any_check_fails(self, tmp_path):
        settings_path = self._make_settings(tmp_path)
        core_dir = self._make_core_dir(tmp_path)
        with patch("shutil.which", return_value=None), \
             patch("subprocess.run") as mock_run, \
             patch("shutil.disk_usage") as mock_du:
            mock_run.return_value = MagicMock(returncode=128, stdout="")
            mock_du.return_value = MagicMock(free=2 * 1024 ** 3)
            _, overall, _ = preflight_checks.run_checks(settings_path=settings_path, core_dir=core_dir)
        assert overall == "fail"

    def test_overall_pass_when_only_warnings(self, tmp_path):
        settings_path = self._make_settings(tmp_path)
        core_dir = self._make_core_dir(tmp_path)
        # All required checks pass, warn checks fail (but not promoted)
        with patch("shutil.which", side_effect=lambda x: "/usr/bin/x" if x in ("claude", "bd") else None), \
             patch("subprocess.run") as mock_run, \
             patch("shutil.disk_usage") as mock_du:
            mock_run.return_value = MagicMock(returncode=0, stdout="1.0.0", stderr="")
            mock_du.return_value = MagicMock(free=2 * 1024 ** 3)
            checks, overall, _ = preflight_checks.run_checks(settings_path=settings_path, core_dir=core_dir)
        assert overall == "pass"
        warn_checks = [c for c in checks if c["status"] == "warn"]
        assert len(warn_checks) > 0

    def test_promotes_warn_to_fail_when_in_require(self, tmp_path):
        settings_path = self._make_settings(tmp_path, require=["gh_cli"])
        core_dir = self._make_core_dir(tmp_path)
        with patch("shutil.which", return_value=None), \
             patch("subprocess.run") as mock_run, \
             patch("shutil.disk_usage") as mock_du:
            mock_run.return_value = MagicMock(returncode=128)
            mock_du.return_value = MagicMock(free=2 * 1024 ** 3)
            checks, overall, _ = preflight_checks.run_checks(settings_path=settings_path, core_dir=core_dir)
        gh_check = next(c for c in checks if c["name"] == "gh_cli")
        assert gh_check["status"] == "fail"
        assert overall == "fail"

    def test_warn_check_not_promoted_when_not_in_require(self, tmp_path):
        settings_path = self._make_settings(tmp_path, require=[])
        core_dir = self._make_core_dir(tmp_path)
        with patch("shutil.which", side_effect=lambda x: "/usr/bin/x" if x in ("claude", "bd") else None), \
             patch("subprocess.run") as mock_run, \
             patch("shutil.disk_usage") as mock_du:
            mock_run.return_value = MagicMock(returncode=0, stdout="1.0.0", stderr="")
            mock_du.return_value = MagicMock(free=2 * 1024 ** 3)
            checks, _, _ = preflight_checks.run_checks(settings_path=settings_path, core_dir=core_dir)
        gh_check = next(c for c in checks if c["name"] == "gh_cli")
        assert gh_check["status"] == "warn"

    def test_summary_format(self, tmp_path):
        settings_path = self._make_settings(tmp_path)
        core_dir = self._make_core_dir(tmp_path)
        with patch("shutil.which", return_value="/usr/bin/x"), \
             patch("subprocess.run") as mock_run, \
             patch("shutil.disk_usage") as mock_du:
            mock_run.return_value = MagicMock(returncode=0, stdout="1.0.0", stderr="")
            mock_du.return_value = MagicMock(free=2 * 1024 ** 3)
            _, _, summary = preflight_checks.run_checks(settings_path=settings_path, core_dir=core_dir)
        assert "checks passed" in summary
        assert "failed" in summary
        assert "warnings" in summary

    def test_check_names_cover_all_required(self, tmp_path):
        settings_path = self._make_settings(tmp_path)
        core_dir = self._make_core_dir(tmp_path)
        expected_names = {
            "claude_cli", "git_repo", "bd_cli", "settings_json",
            "agent_templates", "disk_space",
            "gh_cli", "python_available", "test_runner", "node_available",
        }
        with patch("shutil.which", return_value="/usr/bin/x"), \
             patch("subprocess.run") as mock_run, \
             patch("shutil.disk_usage") as mock_du:
            mock_run.return_value = MagicMock(returncode=0, stdout="1.0.0", stderr="")
            mock_du.return_value = MagicMock(free=2 * 1024 ** 3)
            checks, _, _ = preflight_checks.run_checks(settings_path=settings_path, core_dir=core_dir)
        names = {c["name"] for c in checks}
        assert names == expected_names


# --- Integration: run the script as subprocess ---

class TestScriptIntegration:
    SCRIPT = str(Path(__file__).parent.parent / ".claude" / "scripts" / "preflight_checks.py")
    PROJECT_ROOT = str(Path(__file__).parent.parent)

    def _run(self):
        return subprocess.run(
            [sys.executable, self.SCRIPT],
            capture_output=True, text=True,
            cwd=self.PROJECT_ROOT,
        )

    def test_outputs_valid_json(self):
        result = self._run()
        assert result.returncode in (0, 1)
        output = json.loads(result.stdout)
        assert "status" in output
        assert "checks" in output
        assert "summary" in output

    def test_exit_code_matches_status(self):
        result = self._run()
        output = json.loads(result.stdout)
        if output["status"] == "pass":
            assert result.returncode == 0
        else:
            assert result.returncode == 1

    def test_all_checks_have_valid_structure(self):
        result = self._run()
        output = json.loads(result.stdout)
        for check in output["checks"]:
            assert "name" in check
            assert "status" in check
            assert check["status"] in ("pass", "fail", "warn")
            assert "message" in check

    def test_no_stderr_output(self):
        result = self._run()
        assert result.stderr == ""
