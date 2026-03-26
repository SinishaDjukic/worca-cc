"""
tests/test_events.py — Integration tests for the worca event subsystem.

Covers:
- events written to events.jsonl with correct envelope schema
- shell hooks receive event JSON on stdin
- failed hook doesn't halt pipeline
- wildcard handler catches all events
- multiple handlers per event type
"""

import json
import time
import uuid
from unittest.mock import patch

import pytest

from worca.events.emitter import EventContext, emit_event
from worca.orchestrator.events import dispatch_shell_hooks


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def ctx(tmp_path):
    """EventContext with no shell hooks (pure emitter tests)."""
    return EventContext(
        run_id="run-events-test",
        branch="worca/w-001",
        work_request={"title": "Test", "source_ref": "test", "priority": "P2"},
        events_path=str(tmp_path / "events.jsonl"),
        settings_path="",
        enabled=True,
    )


@pytest.fixture
def hooked_ctx(tmp_path):
    """EventContext factory that injects shell_hooks config."""
    def _make(hooks: dict, run_id: str = "run-hooks-test"):
        c = EventContext(
            run_id=run_id,
            branch="worca/w-001",
            work_request={"title": "Test", "source_ref": "test", "priority": "P2"},
            events_path=str(tmp_path / "events.jsonl"),
            settings_path="",
            enabled=True,
        )
        c._shell_hooks = hooks
        return c
    return _make


# ---------------------------------------------------------------------------
# events.jsonl — envelope schema
# ---------------------------------------------------------------------------


def test_events_written_to_jsonl(ctx, tmp_path):
    """emit_event writes one JSON line per event to events.jsonl."""
    emit_event(ctx, "pipeline.run.started", {"resume": False, "started_at": "2026-03-20T00:00:00Z"})
    ctx.close()

    events_file = tmp_path / "events.jsonl"
    assert events_file.exists(), "events.jsonl was not created"
    lines = events_file.read_text().strip().split("\n")
    assert len(lines) == 1
    assert json.loads(lines[0])["event_type"] == "pipeline.run.started"


def test_envelope_has_required_fields(ctx, tmp_path):
    """Each emitted event envelope contains all required schema fields."""
    emit_event(ctx, "pipeline.stage.started", {
        "stage": "plan", "iteration": 1, "agent": "planner",
        "model": "opus", "trigger": "initial", "max_turns": 10,
    })
    ctx.close()

    event = json.loads((tmp_path / "events.jsonl").read_text().strip())
    for field in ("schema_version", "event_id", "event_type", "timestamp", "run_id", "pipeline", "payload"):
        assert field in event, f"Missing required envelope field: {field!r}"


def test_envelope_schema_version_is_string_1(ctx, tmp_path):
    """schema_version must be the string '1'."""
    emit_event(ctx, "pipeline.run.started", {"resume": False, "started_at": "2026-03-20T00:00:00Z"})
    ctx.close()
    event = json.loads((tmp_path / "events.jsonl").read_text().strip())
    assert event["schema_version"] == "1"


def test_envelope_event_id_is_uuid4(ctx, tmp_path):
    """event_id must be a valid UUID v4."""
    emit_event(ctx, "pipeline.run.started", {"resume": False, "started_at": "2026-03-20T00:00:00Z"})
    ctx.close()
    event = json.loads((tmp_path / "events.jsonl").read_text().strip())
    parsed = uuid.UUID(event["event_id"])
    assert parsed.version == 4


def test_envelope_pipeline_contains_branch_and_work_request(ctx, tmp_path):
    """pipeline sub-object carries branch and work_request from EventContext."""
    emit_event(ctx, "pipeline.run.started", {"resume": False, "started_at": "2026-03-20T00:00:00Z"})
    ctx.close()
    event = json.loads((tmp_path / "events.jsonl").read_text().strip())
    assert event["pipeline"]["branch"] == ctx.branch
    assert event["pipeline"]["work_request"] == ctx.work_request


def test_multiple_events_each_on_own_line(ctx, tmp_path):
    """Multiple emits produce one JSON object per line."""
    emit_event(ctx, "pipeline.run.started", {"resume": False, "started_at": "2026-03-20T00:00:00Z"})
    emit_event(ctx, "pipeline.stage.started", {
        "stage": "plan", "iteration": 1, "agent": "planner",
        "model": "opus", "trigger": "initial", "max_turns": 10,
    })
    emit_event(ctx, "pipeline.stage.completed", {
        "stage": "plan", "iteration": 1, "duration_ms": 5000,
        "cost_usd": 0.01, "turns": 3, "outcome": "success",
    })
    ctx.close()

    lines = (tmp_path / "events.jsonl").read_text().strip().split("\n")
    assert len(lines) == 3
    types = [json.loads(line)["event_type"] for line in lines]
    assert types == [
        "pipeline.run.started",
        "pipeline.stage.started",
        "pipeline.stage.completed",
    ]


# ---------------------------------------------------------------------------
# Shell hooks receive event JSON on stdin
# ---------------------------------------------------------------------------


def test_shell_hook_receives_event_json_on_stdin(tmp_path, hooked_ctx):
    """Shell hook command receives full event JSON envelope on stdin."""
    out_file = tmp_path / "hook_out.json"
    ctx = hooked_ctx({"pipeline.run.started": [f"cat > {out_file}"]})

    emit_event(ctx, "pipeline.run.started", {"resume": False, "started_at": "2026-03-20T00:00:00Z"})

    deadline = time.time() + 3.0
    while not out_file.exists() and time.time() < deadline:
        time.sleep(0.05)

    assert out_file.exists(), "Shell hook was not invoked"
    data = json.loads(out_file.read_text())
    assert data["event_type"] == "pipeline.run.started"
    assert data["run_id"] == "run-hooks-test"


def test_shell_hook_stdin_contains_all_envelope_fields(tmp_path, hooked_ctx):
    """All required envelope fields are present in stdin JSON."""
    out_file = tmp_path / "hook_out.json"
    ctx = hooked_ctx({"pipeline.stage.started": [f"cat > {out_file}"]})

    emit_event(ctx, "pipeline.stage.started", {
        "stage": "plan", "iteration": 1, "agent": "planner",
        "model": "opus", "trigger": "initial", "max_turns": 10,
    })

    deadline = time.time() + 3.0
    while not out_file.exists() and time.time() < deadline:
        time.sleep(0.05)

    assert out_file.exists()
    data = json.loads(out_file.read_text())
    for field in ("schema_version", "event_id", "event_type", "timestamp", "run_id", "payload"):
        assert field in data, f"Missing field in stdin JSON: {field!r}"
    assert data["payload"]["stage"] == "plan"


# ---------------------------------------------------------------------------
# Failed hook doesn't halt pipeline
# ---------------------------------------------------------------------------


def test_failed_hook_does_not_halt_emit_event(ctx):
    """emit_event succeeds even when shell hook dispatch raises internally."""
    with patch("worca.orchestrator.events.dispatch_shell_hooks", side_effect=RuntimeError("boom")):
        # emit_event must not raise
        result = emit_event(ctx, "pipeline.run.started", {"resume": False, "started_at": "now"})
    # Event should still be written (returns the event dict or None, not raising)
    assert result is None or isinstance(result, dict)
    ctx.close()


def test_failing_hook_command_does_not_raise(tmp_path, hooked_ctx):
    """A hook command that exits non-zero must not propagate an exception."""
    ctx = hooked_ctx({"pipeline.run.started": ["false"]})
    # Must not raise
    emit_event(ctx, "pipeline.run.started", {"resume": False, "started_at": "now"})
    ctx.close()


def test_nonexistent_hook_command_does_not_raise(tmp_path, hooked_ctx):
    """A hook command that doesn't exist must not propagate an exception."""
    ctx = hooked_ctx({"pipeline.run.started": ["/no/such/command --arg"]})
    # Must not raise
    emit_event(ctx, "pipeline.run.started", {"resume": False, "started_at": "now"})
    ctx.close()


def test_dispatch_popen_exception_does_not_halt_pipeline():
    """If Popen itself throws, dispatch_shell_hooks must not propagate."""
    event = {
        "schema_version": "1",
        "event_id": str(uuid.uuid4()),
        "event_type": "pipeline.run.started",
        "timestamp": "2026-03-20T00:00:00+00:00",
        "run_id": "run-001",
        "payload": {},
    }
    hooks = {"pipeline.run.started": ["any-command"]}
    with patch("subprocess.Popen", side_effect=OSError("spawn failed")):
        dispatch_shell_hooks(event, hooks)  # Must not raise


# ---------------------------------------------------------------------------
# Wildcard handler catches all events
# ---------------------------------------------------------------------------


def test_wildcard_handler_fires_for_any_event_type(tmp_path, hooked_ctx):
    """'*' catch-all handler is invoked regardless of event_type."""
    out_file = tmp_path / "wildcard.json"
    ctx = hooked_ctx({"*": [f"cat > {out_file}"]})

    emit_event(ctx, "pipeline.stage.completed", {
        "stage": "test", "iteration": 2, "duration_ms": 1000,
        "cost_usd": 0.0, "turns": 1, "outcome": "success",
    })

    deadline = time.time() + 3.0
    while not out_file.exists() and time.time() < deadline:
        time.sleep(0.05)

    assert out_file.exists(), "Wildcard handler was not invoked"
    data = json.loads(out_file.read_text())
    assert data["event_type"] == "pipeline.stage.completed"


def test_wildcard_fires_when_no_specific_handler(tmp_path):
    """Wildcard fires even when no specific handler matches."""
    out_file = tmp_path / "wildcard.json"
    event = {
        "schema_version": "1",
        "event_id": str(uuid.uuid4()),
        "event_type": "pipeline.bead.created",
        "timestamp": "2026-03-20T00:00:00+00:00",
        "run_id": "run-001",
        "payload": {},
    }
    hooks = {
        "pipeline.run.started": ["true"],
        "*": [f"cat > {out_file}"],
    }

    dispatch_shell_hooks(event, hooks)

    deadline = time.time() + 3.0
    while not out_file.exists() and time.time() < deadline:
        time.sleep(0.05)

    assert out_file.exists(), "Wildcard handler not invoked for unmatched event type"


def test_wildcard_and_specific_both_fire(tmp_path, hooked_ctx):
    """Both the specific handler and '*' handler fire for a matching event."""
    out_specific = tmp_path / "specific.json"
    out_wildcard = tmp_path / "wildcard.json"
    ctx = hooked_ctx({
        "pipeline.run.started": [f"cat > {out_specific}"],
        "*": [f"cat > {out_wildcard}"],
    })

    emit_event(ctx, "pipeline.run.started", {"resume": False, "started_at": "now"})

    deadline = time.time() + 3.0
    while (not out_specific.exists() or not out_wildcard.exists()) and time.time() < deadline:
        time.sleep(0.05)

    assert out_specific.exists(), "Specific handler not invoked"
    assert out_wildcard.exists(), "Wildcard handler not invoked"


# ---------------------------------------------------------------------------
# Multiple handlers per event type
# ---------------------------------------------------------------------------


def test_multiple_handlers_all_invoked(tmp_path, hooked_ctx):
    """All commands in a list are invoked for a single matching event."""
    out1 = tmp_path / "handler1.json"
    out2 = tmp_path / "handler2.json"
    ctx = hooked_ctx({
        "pipeline.run.started": [f"cat > {out1}", f"cat > {out2}"],
    })

    emit_event(ctx, "pipeline.run.started", {"resume": False, "started_at": "now"})

    deadline = time.time() + 3.0
    while (not out1.exists() or not out2.exists()) and time.time() < deadline:
        time.sleep(0.05)

    assert out1.exists(), "First handler not invoked"
    assert out2.exists(), "Second handler not invoked"


def test_multiple_handlers_each_receive_same_event_json(tmp_path, hooked_ctx):
    """Each of the multiple handlers receives identical event JSON."""
    out1 = tmp_path / "handler1.json"
    out2 = tmp_path / "handler2.json"
    ctx = hooked_ctx({
        "pipeline.run.started": [f"cat > {out1}", f"cat > {out2}"],
    })

    emit_event(ctx, "pipeline.run.started", {"resume": False, "started_at": "2026-03-20T00:00:00Z"})

    deadline = time.time() + 3.0
    while (not out1.exists() or not out2.exists()) and time.time() < deadline:
        time.sleep(0.05)

    data1 = json.loads(out1.read_text())
    data2 = json.loads(out2.read_text())
    assert data1["event_type"] == data2["event_type"] == "pipeline.run.started"
    assert data1["run_id"] == data2["run_id"]


def test_three_handlers_wildcard_plus_two_specific(tmp_path):
    """Three total handlers (2 specific + 1 wildcard) all fire."""
    out1 = tmp_path / "s1.json"
    out2 = tmp_path / "s2.json"
    out_wc = tmp_path / "wc.json"

    event = {
        "schema_version": "1",
        "event_id": str(uuid.uuid4()),
        "event_type": "pipeline.run.started",
        "timestamp": "2026-03-20T00:00:00+00:00",
        "run_id": "run-multi",
        "payload": {},
    }
    hooks = {
        "pipeline.run.started": [f"cat > {out1}", f"cat > {out2}"],
        "*": [f"cat > {out_wc}"],
    }

    dispatch_shell_hooks(event, hooks)

    deadline = time.time() + 3.0
    while not all(f.exists() for f in (out1, out2, out_wc)) and time.time() < deadline:
        time.sleep(0.05)

    assert out1.exists(), "First specific handler not invoked"
    assert out2.exists(), "Second specific handler not invoked"
    assert out_wc.exists(), "Wildcard handler not invoked"
