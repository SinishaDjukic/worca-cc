"""Tests for bd create run-label linking in post_tool_use hook."""
import os
import sys
from unittest.mock import patch, call

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".claude"))

from hooks.post_tool_use import _link_bd_create_to_run


class TestLinkBdCreateToRun:
    """Test _link_bd_create_to_run label tagging."""

    def setup_method(self):
        os.environ.pop("WORCA_RUN_ID", None)

    def teardown_method(self):
        os.environ.pop("WORCA_RUN_ID", None)

    def test_no_action_when_no_run_id(self):
        with patch("hooks.post_tool_use.subprocess.run") as mock_run:
            _link_bd_create_to_run(
                "Bash",
                {"command": 'bd create --title="test"'},
                {"stdout": "✓ Created issue: bd-abc", "exit_code": 0},
            )
            mock_run.assert_not_called()

    def test_no_action_for_non_bash_tool(self):
        os.environ["WORCA_RUN_ID"] = "20260310-211756"
        with patch("hooks.post_tool_use.subprocess.run") as mock_run:
            _link_bd_create_to_run(
                "Write",
                {"command": 'bd create --title="test"'},
                {"stdout": "✓ Created issue: bd-abc", "exit_code": 0},
            )
            mock_run.assert_not_called()

    def test_no_action_when_no_bd_create(self):
        os.environ["WORCA_RUN_ID"] = "20260310-211756"
        with patch("hooks.post_tool_use.subprocess.run") as mock_run:
            _link_bd_create_to_run(
                "Bash",
                {"command": "bd list"},
                {"stdout": "", "exit_code": 0},
            )
            mock_run.assert_not_called()

    def test_no_action_on_failed_create(self):
        os.environ["WORCA_RUN_ID"] = "20260310-211756"
        with patch("hooks.post_tool_use.subprocess.run") as mock_run:
            _link_bd_create_to_run(
                "Bash",
                {"command": 'bd create --title="test"'},
                {"stdout": "Error: something failed", "exit_code": 1},
            )
            mock_run.assert_not_called()

    def test_adds_label_on_successful_create(self):
        os.environ["WORCA_RUN_ID"] = "20260310-211756"
        with patch("hooks.post_tool_use.subprocess.run") as mock_run:
            _link_bd_create_to_run(
                "Bash",
                {"command": 'bd create --title="test" --type=task'},
                {"stdout": "✓ Created issue: bd-abc", "exit_code": 0},
            )
            mock_run.assert_called_once_with(
                ["bd", "label", "add", "bd-abc", "run:20260310-211756"],
                capture_output=True, text=True,
            )

    def test_handles_multiple_creates_in_chain(self):
        os.environ["WORCA_RUN_ID"] = "run-123"
        with patch("hooks.post_tool_use.subprocess.run") as mock_run:
            _link_bd_create_to_run(
                "Bash",
                {"command": 'bd create --title="A" && bd create --title="B"'},
                {
                    "stdout": "✓ Created issue: bd-aaa\n✓ Created issue: bd-bbb",
                    "exit_code": 0,
                },
            )
            assert mock_run.call_count == 2
            mock_run.assert_any_call(
                ["bd", "label", "add", "bd-aaa", "run:run-123"],
                capture_output=True, text=True,
            )
            mock_run.assert_any_call(
                ["bd", "label", "add", "bd-bbb", "run:run-123"],
                capture_output=True, text=True,
            )

    def test_no_action_when_stdout_has_no_created_line(self):
        os.environ["WORCA_RUN_ID"] = "run-456"
        with patch("hooks.post_tool_use.subprocess.run") as mock_run:
            _link_bd_create_to_run(
                "Bash",
                {"command": 'bd create --title="test"'},
                {"stdout": "Some other output", "exit_code": 0},
            )
            mock_run.assert_not_called()
