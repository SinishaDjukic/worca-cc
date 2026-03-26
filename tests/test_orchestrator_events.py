"""
Tests for worca.orchestrator.events — shell hook dispatch.

dispatch_shell_hooks(event, hooks_config) fires configured shell commands
with the event JSON on stdin, async (fire-and-forget), logs failures, never
raises. Supports '*' catch-all.
"""

import json
import time
import uuid
from datetime import datetime, timezone
from unittest.mock import patch


from worca.orchestrator.events import dispatch_shell_hooks


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_event(event_type="pipeline.run.started", run_id="run-001", payload=None):
    return {
        "schema_version": "1",
        "event_id": str(uuid.uuid4()),
        "event_type": event_type,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "run_id": run_id,
        "payload": payload or {},
    }


# ---------------------------------------------------------------------------
# Basic dispatch tests
# ---------------------------------------------------------------------------


def test_dispatch_calls_matching_command(tmp_path):
    """Command is invoked when its event type matches."""
    out_file = tmp_path / "out.json"
    event = _make_event("pipeline.run.started")
    hooks = {"pipeline.run.started": [f"cat > {out_file}"]}

    dispatch_shell_hooks(event, hooks)

    # Give the async process a moment
    deadline = time.time() + 2.0
    while not out_file.exists() and time.time() < deadline:
        time.sleep(0.05)

    assert out_file.exists(), "Command was not invoked"
    data = json.loads(out_file.read_text())
    assert data["event_type"] == "pipeline.run.started"
    assert data["run_id"] == "run-001"


def test_dispatch_pipes_full_envelope_on_stdin(tmp_path):
    """All envelope fields are present in stdin data."""
    out_file = tmp_path / "out.json"
    event = _make_event("pipeline.stage.started", payload={"stage": "plan"})
    hooks = {"pipeline.stage.started": [f"cat > {out_file}"]}

    dispatch_shell_hooks(event, hooks)

    deadline = time.time() + 2.0
    while not out_file.exists() and time.time() < deadline:
        time.sleep(0.05)

    assert out_file.exists()
    data = json.loads(out_file.read_text())
    for field in ("schema_version", "event_id", "event_type", "timestamp", "run_id", "payload"):
        assert field in data, f"Missing field: {field}"
    assert data["payload"]["stage"] == "plan"


def test_dispatch_does_not_call_nonmatching_command(tmp_path):
    """Command is NOT invoked when event type does not match."""
    out_file = tmp_path / "out.json"
    event = _make_event("pipeline.run.completed")
    hooks = {"pipeline.run.started": [f"cat > {out_file}"]}

    dispatch_shell_hooks(event, hooks)
    time.sleep(0.1)

    assert not out_file.exists(), "Command should not have been invoked"


def test_dispatch_wildcard_catches_all_events(tmp_path):
    """'*' catch-all handler is invoked for any event type."""
    out_file = tmp_path / "out.json"
    event = _make_event("pipeline.stage.completed")
    hooks = {"*": [f"cat > {out_file}"]}

    dispatch_shell_hooks(event, hooks)

    deadline = time.time() + 2.0
    while not out_file.exists() and time.time() < deadline:
        time.sleep(0.05)

    assert out_file.exists(), "Wildcard handler was not invoked"
    data = json.loads(out_file.read_text())
    assert data["event_type"] == "pipeline.stage.completed"


def test_dispatch_specific_and_wildcard_both_fire(tmp_path):
    """Both specific and '*' handlers fire for a matching event."""
    out_specific = tmp_path / "specific.json"
    out_wildcard = tmp_path / "wildcard.json"
    event = _make_event("pipeline.run.started")
    hooks = {
        "pipeline.run.started": [f"cat > {out_specific}"],
        "*": [f"cat > {out_wildcard}"],
    }

    dispatch_shell_hooks(event, hooks)

    deadline = time.time() + 2.0
    while (not out_specific.exists() or not out_wildcard.exists()) and time.time() < deadline:
        time.sleep(0.05)

    assert out_specific.exists(), "Specific handler not invoked"
    assert out_wildcard.exists(), "Wildcard handler not invoked"


def test_dispatch_multiple_handlers_for_one_event(tmp_path):
    """Multiple commands for one event type are all invoked."""
    out1 = tmp_path / "out1.json"
    out2 = tmp_path / "out2.json"
    event = _make_event("pipeline.run.started")
    hooks = {"pipeline.run.started": [f"cat > {out1}", f"cat > {out2}"]}

    dispatch_shell_hooks(event, hooks)

    deadline = time.time() + 2.0
    while (not out1.exists() or not out2.exists()) and time.time() < deadline:
        time.sleep(0.05)

    assert out1.exists(), "First handler not invoked"
    assert out2.exists(), "Second handler not invoked"


# ---------------------------------------------------------------------------
# Empty / no-op cases
# ---------------------------------------------------------------------------


def test_dispatch_empty_hooks_config_is_noop():
    """Empty hooks config — no error, no-op."""
    event = _make_event()
    dispatch_shell_hooks(event, {})  # Must not raise


def test_dispatch_empty_handler_list_is_noop():
    """Empty list for an event type — no error."""
    event = _make_event("pipeline.run.started")
    dispatch_shell_hooks(event, {"pipeline.run.started": []})  # Must not raise


def test_dispatch_empty_wildcard_list_is_noop():
    """Empty wildcard list — no error."""
    event = _make_event()
    dispatch_shell_hooks(event, {"*": []})  # Must not raise


# ---------------------------------------------------------------------------
# Fire-and-forget (async / non-blocking)
# ---------------------------------------------------------------------------


def test_dispatch_does_not_block_on_slow_command():
    """dispatch_shell_hooks returns quickly even if the command is slow."""
    event = _make_event()
    hooks = {"pipeline.run.started": ["sleep 10"]}

    start = time.time()
    dispatch_shell_hooks(event, hooks)
    elapsed = time.time() - start

    # Should return in well under 1 second
    assert elapsed < 1.0, f"dispatch_shell_hooks blocked for {elapsed:.2f}s"


# ---------------------------------------------------------------------------
# Error isolation — never raises
# ---------------------------------------------------------------------------


def test_dispatch_nonexistent_command_does_not_raise():
    """A command that doesn't exist must not raise."""
    event = _make_event()
    hooks = {"pipeline.run.started": ["/nonexistent/command --arg"]}
    dispatch_shell_hooks(event, hooks)  # Must not raise


def test_dispatch_failing_command_does_not_raise():
    """A command that exits non-zero must not raise."""
    event = _make_event()
    hooks = {"pipeline.run.started": ["false"]}
    dispatch_shell_hooks(event, hooks)  # Must not raise


def test_dispatch_popen_exception_does_not_raise():
    """If Popen itself throws, dispatch_shell_hooks must not propagate."""
    event = _make_event()
    hooks = {"pipeline.run.started": ["any-command"]}
    with patch("subprocess.Popen", side_effect=OSError("spawn failed")):
        dispatch_shell_hooks(event, hooks)  # Must not raise


def test_dispatch_failure_logged_to_stderr(capsys):
    """Dispatch failures are logged to stderr."""
    event = _make_event()
    hooks = {"pipeline.run.started": ["any-command"]}
    with patch("subprocess.Popen", side_effect=OSError("spawn failed")):
        dispatch_shell_hooks(event, hooks)

    captured = capsys.readouterr()
    assert "spawn failed" in captured.err or len(captured.err) > 0


# ---------------------------------------------------------------------------
# hooks_config schema
# ---------------------------------------------------------------------------


def test_dispatch_handles_none_hooks_config_gracefully():
    """None hooks_config is treated as empty (no error)."""
    event = _make_event()
    dispatch_shell_hooks(event, None)  # Must not raise


def test_dispatch_ignores_unrecognized_event_type(tmp_path):
    """An event type with no handler and no '*' is silently ignored."""
    event = _make_event("pipeline.custom.event")
    hooks = {"pipeline.run.started": ["true"]}
    dispatch_shell_hooks(event, hooks)  # Must not raise


def test_dispatch_event_json_is_valid_json_on_stdin(tmp_path):
    """The data piped to stdin must be valid JSON (not prettified, compact)."""
    out_file = tmp_path / "out.txt"
    event = _make_event("pipeline.run.started", payload={"key": "value"})
    hooks = {"pipeline.run.started": [f"cat > {out_file}"]}

    dispatch_shell_hooks(event, hooks)

    deadline = time.time() + 2.0
    while not out_file.exists() and time.time() < deadline:
        time.sleep(0.05)

    raw = out_file.read_text()
    # Must be parseable as JSON
    parsed = json.loads(raw)
    assert parsed["payload"]["key"] == "value"
