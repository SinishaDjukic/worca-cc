"""Tests for _format_log_line and process_stream logging/NDJSON edge cases.

Migrated from src/worca/utils/test_claude_cli.py (TestFormatLogLine +
TestProcessStream) so they are collected by CI (testpaths = ["tests"]).
"""

import io
import json
import re
from datetime import datetime, timezone

import pytest

from worca.utils.claude_cli import (
    _format_log_line,
    _write_log_line,
    process_stream,
)

# ISO-8601 + TAB prefix that every persisted log line now carries. Mirrors the
# LOG_TS_RE sniff in worca-ui/server/log-tailer.js.
_TS_PREFIX_RE = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})\t"
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_ndjson(*events):
    return [json.dumps(e) + "\n" for e in events]


# ---------------------------------------------------------------------------
# _format_log_line
# ---------------------------------------------------------------------------


def test_format_log_line_init_event():
    event = {"type": "system", "subtype": "init", "model": "opus"}
    assert _format_log_line(event) == "[init] model=opus"


def test_format_log_line_hook_event_skipped():
    event = {"type": "system", "subtype": "hook_started"}
    assert _format_log_line(event) is None


def test_format_log_line_assistant_text():
    event = {
        "type": "assistant",
        "message": {"content": [{"type": "text", "text": "Hello world"}]},
    }
    assert _format_log_line(event) == "Hello world"


def test_format_log_line_assistant_tool_use_read():
    event = {
        "type": "assistant",
        "message": {
            "content": [
                {"type": "tool_use", "name": "Read", "input": {"file_path": "/foo/bar.py"}}
            ]
        },
    }
    line = _format_log_line(event)
    assert "[tool:Read]" in line
    assert "/foo/bar.py" in line


def test_format_log_line_assistant_tool_use_bash():
    event = {
        "type": "assistant",
        "message": {
            "content": [
                {"type": "tool_use", "name": "Bash", "input": {"command": "npm test"}}
            ]
        },
    }
    line = _format_log_line(event)
    assert "[tool:Bash]" in line
    assert "npm test" in line


def test_format_log_line_assistant_mixed_content():
    event = {
        "type": "assistant",
        "message": {
            "content": [
                {"type": "text", "text": "Let me check"},
                {"type": "tool_use", "name": "Grep", "input": {"pattern": "TODO"}},
            ]
        },
    }
    line = _format_log_line(event)
    assert "Let me check" in line
    assert "[tool:Grep]" in line
    assert " | " in line


def test_format_log_line_assistant_empty_text_skipped():
    event = {
        "type": "assistant",
        "message": {"content": [{"type": "text", "text": "  "}]},
    }
    assert _format_log_line(event) is None


def test_format_log_line_result_event():
    event = {
        "type": "result",
        "total_cost_usd": 1.234,
        "num_turns": 5,
        "duration_ms": 60000,
    }
    line = _format_log_line(event)
    assert "[done]" in line
    assert "turns=5" in line
    assert "$1.234" in line
    assert "60.0s" in line


def test_format_log_line_user_tool_result_ok():
    event = {
        "type": "user",
        "content": [
            {"type": "tool_result", "tool_use_id": "abcdef1234", "is_error": False}
        ],
    }
    line = _format_log_line(event)
    assert "[result:ok]" in line


def test_format_log_line_user_tool_result_error():
    event = {
        "type": "user",
        "content": [
            {"type": "tool_result", "tool_use_id": "abcdef1234", "is_error": True}
        ],
    }
    line = _format_log_line(event)
    assert "[result:ERROR]" in line


def test_format_log_line_unknown_event():
    event = {"type": "rate_limit_event"}
    assert _format_log_line(event) is None


def test_format_log_line_tool_use_agent():
    event = {
        "type": "assistant",
        "message": {
            "content": [
                {"type": "tool_use", "name": "Agent", "input": {"description": "search code"}}
            ]
        },
    }
    line = _format_log_line(event)
    assert "[tool:Agent]" in line
    assert "search code" in line


def test_format_log_line_tool_use_write():
    event = {
        "type": "assistant",
        "message": {
            "content": [
                {"type": "tool_use", "name": "Write", "input": {"file_path": "/a/b.ts"}}
            ]
        },
    }
    line = _format_log_line(event)
    assert "[tool:Write]" in line
    assert "/a/b.ts" in line


def test_format_log_line_tool_use_edit():
    event = {
        "type": "assistant",
        "message": {
            "content": [
                {"type": "tool_use", "name": "Edit", "input": {"file_path": "/c/d.py"}}
            ]
        },
    }
    line = _format_log_line(event)
    assert "[tool:Edit]" in line
    assert "/c/d.py" in line


def test_format_log_line_tool_use_glob():
    event = {
        "type": "assistant",
        "message": {
            "content": [
                {"type": "tool_use", "name": "Glob", "input": {"pattern": "**/*.ts"}}
            ]
        },
    }
    line = _format_log_line(event)
    assert "[tool:Glob]" in line
    assert "**/*.ts" in line


def test_format_log_line_tool_use_unknown():
    event = {
        "type": "assistant",
        "message": {
            "content": [
                {"type": "tool_use", "name": "CustomTool", "input": {"x": 1}}
            ]
        },
    }
    line = _format_log_line(event)
    assert "[tool:CustomTool]" in line


# ---------------------------------------------------------------------------
# process_stream — logging and NDJSON edge cases
# ---------------------------------------------------------------------------


def test_process_stream_log_file_written():
    events = _make_ndjson(
        {"type": "system", "subtype": "init", "model": "opus"},
        {"type": "assistant", "message": {"content": [{"type": "text", "text": "working"}]}},
        {
            "type": "result",
            "subtype": "success",
            "result": "done",
            "total_cost_usd": 0.1,
            "num_turns": 2,
            "duration_ms": 5000,
        },
    )
    log_buf = io.StringIO()
    process_stream(events, log_file=log_buf)
    log_contents = log_buf.getvalue()
    assert "[init] model=opus" in log_contents
    assert "working" in log_contents
    assert "[done]" in log_contents


def test_process_stream_on_event_callback():
    captured = []
    events = _make_ndjson(
        {"type": "system", "subtype": "init", "model": "opus"},
        {"type": "result", "subtype": "success", "result": "ok"},
    )
    process_stream(events, on_event=captured.append)
    assert len(captured) == 2
    assert captured[0]["type"] == "system"
    assert captured[1]["type"] == "result"


def test_process_stream_invalid_json_lines_skipped():
    lines = [
        "not valid json\n",
        json.dumps({"type": "result", "subtype": "success", "result": "ok"}) + "\n",
    ]
    log_buf = io.StringIO()
    result = process_stream(lines, log_file=log_buf)
    assert result["type"] == "result"
    assert "not valid json" in log_buf.getvalue()


def test_process_stream_empty_lines_skipped():
    lines = [
        "\n",
        "  \n",
        json.dumps({"type": "result", "subtype": "success", "result": "ok"}) + "\n",
    ]
    result = process_stream(lines)
    assert result["type"] == "result"


def test_process_stream_system_hook_events_not_logged():
    events = _make_ndjson(
        {"type": "system", "subtype": "hook_started", "hook_name": "test"},
        {"type": "system", "subtype": "hook_response", "hook_name": "test", "output": "..."},
        {"type": "result", "subtype": "success", "result": "ok"},
    )
    log_buf = io.StringIO()
    process_stream(events, log_file=log_buf)
    log_contents = log_buf.getvalue()
    assert "hook" not in log_contents.lower()
    assert "[done]" in log_contents


def test_process_stream_no_result_raises():
    events = _make_ndjson(
        {"type": "system", "subtype": "init", "model": "opus"},
        {"type": "assistant", "message": {"content": [{"type": "text", "text": "hi"}]}},
    )
    with pytest.raises(RuntimeError, match="No result event"):
        process_stream(events)


# ---------------------------------------------------------------------------
# _write_log_line — ISO-8601 write-time prefix
# ---------------------------------------------------------------------------


def test_write_log_line_prefixes_iso_timestamp_and_tab():
    now = datetime(2026, 6, 14, 12, 0, 0, tzinfo=timezone.utc)
    buf = io.StringIO()
    _write_log_line(buf, "[tool:Read] foo.py", now=now)
    assert buf.getvalue() == "2026-06-14T12:00:00.000+00:00\t[tool:Read] foo.py\n"


def test_write_log_line_collapses_embedded_newlines():
    # Embedded newlines must not split one logical record into multiple physical
    # lines — otherwise the reader's "first field is the timestamp" invariant
    # breaks for the continuation lines.
    now = datetime(2026, 6, 14, 12, 0, 0, tzinfo=timezone.utc)
    buf = io.StringIO()
    _write_log_line(buf, "line one\nline two\r\nline three", now=now)
    written = buf.getvalue()
    assert written.count("\n") == 1  # exactly one trailing physical newline
    assert written.endswith("\n")
    assert "line one⏎ line two⏎ line three" in written


def test_write_log_line_first_field_parses_as_timestamp():
    now = datetime(2026, 6, 14, 12, 0, 0, tzinfo=timezone.utc)
    buf = io.StringIO()
    _write_log_line(buf, "anything", now=now)
    ts_field = buf.getvalue().split("\t", 1)[0]
    # Round-trips back to an aware datetime.
    assert datetime.fromisoformat(ts_field) == now


def test_process_stream_log_lines_carry_timestamp_prefix():
    events = _make_ndjson(
        {"type": "system", "subtype": "init", "model": "opus"},
        {"type": "assistant", "message": {"content": [{"type": "text", "text": "working"}]}},
        {
            "type": "result",
            "subtype": "success",
            "result": "done",
            "total_cost_usd": 0.1,
            "num_turns": 2,
            "duration_ms": 5000,
        },
    )
    log_buf = io.StringIO()
    process_stream(events, log_file=log_buf)
    physical_lines = [ln for ln in log_buf.getvalue().split("\n") if ln]
    assert physical_lines, "expected at least one log line"
    for ln in physical_lines:
        assert _TS_PREFIX_RE.match(ln), f"line missing timestamp prefix: {ln!r}"
    # The human-readable content survives after the prefix.
    joined = log_buf.getvalue()
    assert "[init] model=opus" in joined
    assert "working" in joined
    assert "[done]" in joined


def test_process_stream_invalid_json_line_is_timestamped():
    lines = [
        "not valid json\n",
        json.dumps({"type": "result", "subtype": "success", "result": "ok"}) + "\n",
    ]
    log_buf = io.StringIO()
    process_stream(lines, log_file=log_buf)
    raw_line = log_buf.getvalue().split("\n")[0]
    assert _TS_PREFIX_RE.match(raw_line)
    assert raw_line.endswith("\tnot valid json")
