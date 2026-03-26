"""Tests for bd create run-label linking in post_tool_use hook."""
import json
import os
import sys
from unittest.mock import patch


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


class TestBeadCreatedEvent:
    """Test bead.created event emission via hook_emitter in _link_bd_create_to_run."""

    def setup_method(self):
        os.environ.pop("WORCA_RUN_ID", None)
        os.environ.pop("WORCA_EVENTS_PATH", None)

    def teardown_method(self):
        os.environ.pop("WORCA_RUN_ID", None)
        os.environ.pop("WORCA_EVENTS_PATH", None)

    def test_bead_created_event_emitted_on_successful_bd_create(self, tmp_path):
        """bead.created event is emitted via hook_emitter after parsing bd create output."""
        events_file = str(tmp_path / "events.jsonl")
        os.environ["WORCA_RUN_ID"] = "20260320-120000"
        os.environ["WORCA_EVENTS_PATH"] = events_file
        with patch("hooks.post_tool_use.subprocess.run"):
            _link_bd_create_to_run(
                "Bash",
                {"command": 'bd create --title="Add auth"'},
                {"stdout": "✓ Created issue: bd-xyz", "exit_code": 0},
            )
        assert os.path.exists(events_file)
        events = [json.loads(line) for line in open(events_file).readlines() if line.strip()]
        types = [e["event_type"] for e in events]
        assert "pipeline.bead.created" in types
        created = next(e for e in events if e["event_type"] == "pipeline.bead.created")
        assert created["payload"]["bead_id"] == "bd-xyz"

    def test_bead_created_not_emitted_on_failed_create(self, tmp_path):
        """bead.created is not emitted when bd create fails."""
        events_file = str(tmp_path / "events.jsonl")
        os.environ["WORCA_RUN_ID"] = "20260320-120000"
        os.environ["WORCA_EVENTS_PATH"] = events_file
        _link_bd_create_to_run(
            "Bash",
            {"command": 'bd create --title="Add auth"'},
            {"stdout": "Error: failed", "exit_code": 1},
        )
        # No events should be written
        assert not os.path.exists(events_file)

    def test_bead_created_emitted_for_each_bead_in_chain(self, tmp_path):
        """bead.created is emitted once per bead when multiple are created."""
        events_file = str(tmp_path / "events.jsonl")
        os.environ["WORCA_RUN_ID"] = "run-multi"
        os.environ["WORCA_EVENTS_PATH"] = events_file
        with patch("hooks.post_tool_use.subprocess.run"):
            _link_bd_create_to_run(
                "Bash",
                {"command": 'bd create --title="A" && bd create --title="B"'},
                {"stdout": "✓ Created issue: bd-aaa\n✓ Created issue: bd-bbb", "exit_code": 0},
            )
        events = [json.loads(line) for line in open(events_file).readlines() if line.strip()]
        created_events = [e for e in events if e["event_type"] == "pipeline.bead.created"]
        assert len(created_events) == 2
        ids = {e["payload"]["bead_id"] for e in created_events}
        assert ids == {"bd-aaa", "bd-bbb"}

    def test_bead_created_noop_when_events_path_not_set(self, tmp_path):
        """bead.created is silently skipped when WORCA_EVENTS_PATH is not set."""
        os.environ["WORCA_RUN_ID"] = "run-001"
        # WORCA_EVENTS_PATH not set
        with patch("hooks.post_tool_use.subprocess.run"):
            # Should not raise
            _link_bd_create_to_run(
                "Bash",
                {"command": 'bd create --title="test"'},
                {"stdout": "✓ Created issue: bd-zzz", "exit_code": 0},
            )
