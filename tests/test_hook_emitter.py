"""
Tests for worca.events.hook_emitter — lightweight emitter for subprocess hooks.
"""

import json
import os
from unittest.mock import MagicMock, patch



# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_env(events_path, run_id):
    return {"WORCA_EVENTS_PATH": events_path, "WORCA_RUN_ID": run_id}


# ---------------------------------------------------------------------------
# Basic emission tests
# ---------------------------------------------------------------------------


def test_emit_from_hook_writes_valid_jsonl(tmp_path):
    events_file = str(tmp_path / "events.jsonl")
    env = _make_env(events_file, "run-001")
    with patch.dict(os.environ, env, clear=False):
        from worca.events.hook_emitter import emit_from_hook
        emit_from_hook("pipeline.hook.blocked", {"agent": "guardian", "tool": "Bash", "reason": "blocked"})

    lines = open(events_file).readlines()
    assert len(lines) == 1
    event = json.loads(lines[0])
    assert event["event_type"] == "pipeline.hook.blocked"
    assert event["payload"]["agent"] == "guardian"


def test_emit_from_hook_envelope_fields(tmp_path):
    events_file = str(tmp_path / "events.jsonl")
    env = _make_env(events_file, "run-xyz")
    with patch.dict(os.environ, env, clear=False):
        from worca.events.hook_emitter import emit_from_hook
        emit_from_hook("pipeline.hook.test_gate", {"agent": "tester", "strike": 1, "action": "warn"})

    event = json.loads(open(events_file).read())
    assert event["schema_version"] == "1"
    assert "event_id" in event
    assert "timestamp" in event
    assert event["run_id"] == "run-xyz"
    assert "payload" in event


def test_emit_from_hook_no_pipeline_field(tmp_path):
    """Hooks lack full context — pipeline field must be absent."""
    events_file = str(tmp_path / "events.jsonl")
    env = _make_env(events_file, "run-abc")
    with patch.dict(os.environ, env, clear=False):
        from worca.events.hook_emitter import emit_from_hook
        emit_from_hook("pipeline.hook.blocked", {"agent": "a", "tool": "t", "reason": "r"})

    event = json.loads(open(events_file).read())
    assert "pipeline" not in event


def test_emit_from_hook_noop_when_events_path_missing(tmp_path):
    """Silent no-op when WORCA_EVENTS_PATH is not set."""
    env_without_path = {"WORCA_RUN_ID": "run-001"}
    # Ensure WORCA_EVENTS_PATH is not set
    with patch.dict(os.environ, env_without_path, clear=False):
        old = os.environ.pop("WORCA_EVENTS_PATH", None)
        try:
            from worca.events.hook_emitter import emit_from_hook
            # Should not raise
            result = emit_from_hook("pipeline.hook.blocked", {"agent": "a", "tool": "t", "reason": "r"})
            assert result is None
        finally:
            if old is not None:
                os.environ["WORCA_EVENTS_PATH"] = old


def test_emit_from_hook_noop_when_run_id_missing(tmp_path):
    """Silent no-op when WORCA_RUN_ID is not set."""
    events_file = str(tmp_path / "events.jsonl")
    env_without_run_id = {"WORCA_EVENTS_PATH": events_file}
    with patch.dict(os.environ, env_without_run_id, clear=False):
        old = os.environ.pop("WORCA_RUN_ID", None)
        try:
            from worca.events.hook_emitter import emit_from_hook
            result = emit_from_hook("pipeline.hook.blocked", {"agent": "a", "tool": "t", "reason": "r"})
            assert result is None
        finally:
            if old is not None:
                os.environ["WORCA_RUN_ID"] = old

    # File should not have been written
    assert not os.path.exists(events_file)


def test_emit_from_hook_calls_flush(tmp_path):
    """write + flush per event."""
    events_file = str(tmp_path / "events.jsonl")
    env = _make_env(events_file, "run-001")

    mock_fh = MagicMock()
    mock_fh.__enter__ = lambda s: s
    mock_fh.__exit__ = MagicMock(return_value=False)

    with patch.dict(os.environ, env, clear=False):
        with patch("builtins.open", return_value=mock_fh):
            from worca.events import hook_emitter
            import importlib
            importlib.reload(hook_emitter)
            hook_emitter.emit_from_hook("pipeline.hook.blocked", {"agent": "a", "tool": "t", "reason": "r"})

    mock_fh.flush.assert_called_once()


def test_emit_from_hook_io_error_silent(tmp_path):
    """I/O errors must not propagate — hook must not crash the agent."""
    env = _make_env("/nonexistent/path/events.jsonl", "run-001")
    # The directory doesn't exist, so open in append mode will fail on some systems
    # We simulate this by patching open to raise
    with patch.dict(os.environ, env, clear=False):
        with patch("builtins.open", side_effect=IOError("disk full")):
            from worca.events import hook_emitter
            import importlib
            importlib.reload(hook_emitter)
            # Must not raise
            result = hook_emitter.emit_from_hook("pipeline.hook.blocked", {"agent": "a", "tool": "t", "reason": "r"})
            assert result is None


def test_emit_from_hook_appends_multiple_events(tmp_path):
    """Multiple calls append separate lines."""
    events_file = str(tmp_path / "events.jsonl")
    env = _make_env(events_file, "run-001")
    with patch.dict(os.environ, env, clear=False):
        from worca.events import hook_emitter
        import importlib
        importlib.reload(hook_emitter)
        hook_emitter.emit_from_hook("pipeline.hook.blocked", {"agent": "a", "tool": "t", "reason": "r1"})
        hook_emitter.emit_from_hook("pipeline.hook.test_gate", {"agent": "a", "strike": 1, "action": "warn"})

    lines = open(events_file).readlines()
    assert len(lines) == 2
    events = [json.loads(line) for line in lines]
    assert events[0]["event_type"] == "pipeline.hook.blocked"
    assert events[1]["event_type"] == "pipeline.hook.test_gate"
