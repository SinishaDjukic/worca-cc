"""
Tests for worca.events.emitter — EventContext and emit_event().
"""

import json
import uuid
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

import pytest

from worca.events.emitter import EventContext, emit_event


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def tmp_events_file(tmp_path):
    return str(tmp_path / "events.jsonl")


@pytest.fixture
def ctx(tmp_events_file):
    """Basic enabled EventContext."""
    return EventContext(
        run_id="20260320-075700",
        branch="worca/w-003",
        work_request={"title": "Test run", "source_ref": "test", "priority": "P2"},
        events_path=tmp_events_file,
        settings_path="",
        enabled=True,
    )


@pytest.fixture
def disabled_ctx(tmp_events_file):
    """Disabled EventContext."""
    return EventContext(
        run_id="20260320-075700",
        branch="worca/w-003",
        work_request={"title": "Test run", "source_ref": "test", "priority": "P2"},
        events_path=tmp_events_file,
        settings_path="",
        enabled=False,
    )


# ---------------------------------------------------------------------------
# Envelope structure tests
# ---------------------------------------------------------------------------


def test_emit_event_writes_jsonl(ctx, tmp_events_file):
    emit_event(ctx, "pipeline.run.started", {"resume": False, "started_at": "2026-03-20T07:57:00Z"})
    ctx.close()
    lines = Path(tmp_events_file).read_text().strip().split("\n")
    assert len(lines) == 1
    event = json.loads(lines[0])
    assert isinstance(event, dict)


def test_emit_event_envelope_required_fields(ctx, tmp_events_file):
    emit_event(ctx, "pipeline.run.started", {"resume": False, "started_at": "2026-03-20T07:57:00Z"})
    ctx.close()
    event = json.loads(Path(tmp_events_file).read_text().strip())
    for field in ("schema_version", "event_id", "event_type", "timestamp", "run_id", "pipeline", "payload"):
        assert field in event, f"Missing required field: {field}"


def test_emit_event_schema_version_is_1(ctx, tmp_events_file):
    emit_event(ctx, "pipeline.run.started", {"resume": False, "started_at": "2026-03-20T07:57:00Z"})
    ctx.close()
    event = json.loads(Path(tmp_events_file).read_text().strip())
    assert event["schema_version"] == "1"


def test_emit_event_event_id_is_uuid4(ctx, tmp_events_file):
    emit_event(ctx, "pipeline.run.started", {"resume": False, "started_at": "2026-03-20T07:57:00Z"})
    ctx.close()
    event = json.loads(Path(tmp_events_file).read_text().strip())
    parsed = uuid.UUID(event["event_id"])
    assert parsed.version == 4


def test_emit_event_timestamp_is_iso8601(ctx, tmp_events_file):
    emit_event(ctx, "pipeline.run.started", {"resume": False, "started_at": "2026-03-20T07:57:00Z"})
    ctx.close()
    event = json.loads(Path(tmp_events_file).read_text().strip())
    # Should not raise
    dt = datetime.fromisoformat(event["timestamp"].replace("Z", "+00:00"))
    assert dt.tzinfo is not None


def test_emit_event_run_id_matches_ctx(ctx, tmp_events_file):
    emit_event(ctx, "pipeline.run.started", {"resume": False, "started_at": "2026-03-20T07:57:00Z"})
    ctx.close()
    event = json.loads(Path(tmp_events_file).read_text().strip())
    assert event["run_id"] == ctx.run_id


def test_emit_event_pipeline_field_has_branch_and_work_request(ctx, tmp_events_file):
    emit_event(ctx, "pipeline.run.started", {"resume": False, "started_at": "2026-03-20T07:57:00Z"})
    ctx.close()
    event = json.loads(Path(tmp_events_file).read_text().strip())
    assert event["pipeline"]["branch"] == ctx.branch
    assert event["pipeline"]["work_request"] == ctx.work_request


# ---------------------------------------------------------------------------
# Return value
# ---------------------------------------------------------------------------


def test_emit_event_returns_event_dict(ctx):
    result = emit_event(ctx, "pipeline.run.started", {"resume": False, "started_at": "2026-03-20T07:57:00Z"})
    assert isinstance(result, dict)
    assert result["event_type"] == "pipeline.run.started"
    ctx.close()


# ---------------------------------------------------------------------------
# Disabled context
# ---------------------------------------------------------------------------


def test_emit_event_disabled_returns_none(disabled_ctx, tmp_events_file):
    result = emit_event(disabled_ctx, "pipeline.run.started", {"resume": False, "started_at": "2026-03-20T07:57:00Z"})
    assert result is None


def test_emit_event_disabled_writes_nothing(disabled_ctx, tmp_events_file):
    emit_event(disabled_ctx, "pipeline.run.started", {"resume": False, "started_at": "2026-03-20T07:57:00Z"})
    assert not Path(tmp_events_file).exists()


# ---------------------------------------------------------------------------
# Error isolation
# ---------------------------------------------------------------------------


def test_emit_event_catches_io_error(ctx, tmp_events_file):
    """I/O errors must not propagate."""
    with patch("builtins.open", side_effect=OSError("disk full")):
        # Should not raise
        result = emit_event(ctx, "pipeline.run.started", {"resume": False, "started_at": "now"})
    # Returns None on IO error (can't write)
    assert result is None or isinstance(result, dict)


def test_emit_event_catches_serialization_error(ctx, tmp_events_file):
    """Non-serializable payloads must not propagate."""
    bad_payload = {"fn": lambda x: x}  # not JSON-serializable
    # Should not raise
    result = emit_event(ctx, "pipeline.run.started", bad_payload)
    assert result is None or isinstance(result, dict)


# ---------------------------------------------------------------------------
# File handle reuse (lazy open + multiple writes)
# ---------------------------------------------------------------------------


def test_emit_event_multiple_writes_same_file(ctx, tmp_events_file):
    """Multiple sequential emits produce multiple JSONL lines in the same file."""
    emit_event(ctx, "pipeline.run.started", {"resume": False, "started_at": "2026-03-20T07:57:00Z"})
    emit_event(ctx, "pipeline.stage.started", {"stage": "plan", "iteration": 1, "agent": "planner", "model": "opus", "trigger": "initial", "max_turns": 10})
    emit_event(ctx, "pipeline.stage.completed", {"stage": "plan", "iteration": 1, "duration_ms": 5000, "cost_usd": 0.01, "turns": 3, "outcome": "success"})
    ctx.close()
    lines = Path(tmp_events_file).read_text().strip().split("\n")
    assert len(lines) == 3
    for line in lines:
        event = json.loads(line)
        assert "event_id" in event


def test_emit_event_unique_event_ids(ctx, tmp_events_file):
    """Each emitted event gets a unique UUID."""
    emit_event(ctx, "pipeline.run.started", {"resume": False, "started_at": "now"})
    emit_event(ctx, "pipeline.run.completed", {"duration_ms": 1000, "total_cost_usd": 0.0, "total_turns": 1, "total_tokens": 100, "stages_completed": []})
    ctx.close()
    lines = Path(tmp_events_file).read_text().strip().split("\n")
    ids = [json.loads(line)["event_id"] for line in lines]
    assert len(set(ids)) == 2


# ---------------------------------------------------------------------------
# EventContext.close()
# ---------------------------------------------------------------------------


def test_event_context_close_flushes_and_closes(ctx, tmp_events_file):
    emit_event(ctx, "pipeline.run.started", {"resume": False, "started_at": "now"})
    assert ctx._log_file is not None
    ctx.close()
    assert ctx._log_file is None or ctx._log_file.closed


# ---------------------------------------------------------------------------
# Settings loading
# ---------------------------------------------------------------------------


def test_event_context_reads_enabled_from_settings(tmp_path):
    settings_file = tmp_path / "settings.json"
    settings_file.write_text(json.dumps({"worca": {"events": {"enabled": False}}}))
    ctx = EventContext(
        run_id="20260320-075700",
        branch="main",
        work_request={"title": "t", "source_ref": "s", "priority": "P2"},
        events_path=str(tmp_path / "events.jsonl"),
        settings_path=str(settings_file),
    )
    assert ctx.enabled is False


def test_event_context_defaults_enabled_true_when_settings_missing(tmp_path):
    ctx = EventContext(
        run_id="20260320-075700",
        branch="main",
        work_request={"title": "t", "source_ref": "s", "priority": "P2"},
        events_path=str(tmp_path / "events.jsonl"),
        settings_path=str(tmp_path / "nonexistent.json"),
    )
    assert ctx.enabled is True


def test_event_context_defaults_enabled_true_when_events_key_missing(tmp_path):
    settings_file = tmp_path / "settings.json"
    settings_file.write_text(json.dumps({"worca": {}}))
    ctx = EventContext(
        run_id="20260320-075700",
        branch="main",
        work_request={"title": "t", "source_ref": "s", "priority": "P2"},
        events_path=str(tmp_path / "events.jsonl"),
        settings_path=str(settings_file),
    )
    assert ctx.enabled is True
