"""Tests for agent telemetry on_event callback in runner.py (T9).

Tests the _make_agent_event_handler() factory and _summarize_tool_input() helper.
"""
import json
from unittest.mock import MagicMock, patch

from worca.orchestrator.runner import _summarize_tool_input, _make_agent_event_handler
from worca.orchestrator.stages import Stage
from worca.events.types import (
    AGENT_SPAWNED,
    AGENT_TOOL_USE,
    AGENT_TOOL_RESULT,
    AGENT_TEXT,
    AGENT_COMPLETED,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_ctx():
    """Return a mock EventContext that records emitted events."""
    ctx = MagicMock()
    ctx.enabled = True
    return ctx


def _tool_use_block(name, input_dict, tool_id="tu_abc123"):
    return {"type": "tool_use", "id": tool_id, "name": name, "input": input_dict}


def _assistant_event(blocks):
    return {"type": "assistant", "message": {"content": blocks}}


def _user_tool_result_event(tool_use_id, is_error=False):
    return {
        "type": "user",
        "content": [
            {"type": "tool_result", "tool_use_id": tool_use_id, "is_error": is_error, "content": []}
        ],
    }


# ---------------------------------------------------------------------------
# _summarize_tool_input tests
# ---------------------------------------------------------------------------

def test_summarize_read():
    block = _tool_use_block("Read", {"file_path": "/foo/bar.py"})
    assert _summarize_tool_input(block) == "/foo/bar.py"


def test_summarize_write():
    block = _tool_use_block("Write", {"file_path": "/out.txt", "content": "lots of content..."})
    assert _summarize_tool_input(block) == "/out.txt"


def test_summarize_edit():
    block = _tool_use_block("Edit", {"file_path": "/src/main.py", "old_string": "x", "new_string": "y"})
    assert _summarize_tool_input(block) == "/src/main.py"


def test_summarize_bash():
    cmd = "echo hello world"
    block = _tool_use_block("Bash", {"command": cmd})
    assert _summarize_tool_input(block) == cmd


def test_summarize_bash_truncates_at_120():
    cmd = "x" * 200
    block = _tool_use_block("Bash", {"command": cmd})
    result = _summarize_tool_input(block)
    assert len(result) == 120
    assert result == cmd[:120]


def test_summarize_grep():
    block = _tool_use_block("Grep", {"pattern": "def foo", "path": "/src"})
    assert _summarize_tool_input(block) == "def foo"


def test_summarize_glob():
    block = _tool_use_block("Glob", {"pattern": "**/*.py"})
    assert _summarize_tool_input(block) == "**/*.py"


def test_summarize_agent():
    block = _tool_use_block("Agent", {"description": "explore codebase", "prompt": "long prompt..."})
    assert _summarize_tool_input(block) == "explore codebase"


def test_summarize_unknown_tool_returns_empty():
    block = _tool_use_block("UnknownTool", {"data": "whatever"})
    assert _summarize_tool_input(block) == ""


# ---------------------------------------------------------------------------
# _make_agent_event_handler — disabled when ctx is None
# ---------------------------------------------------------------------------

def test_handler_is_none_when_ctx_is_none():
    handler = _make_agent_event_handler(None, Stage.PLAN, 1, ".claude/settings.json")
    assert handler is None


# ---------------------------------------------------------------------------
# _make_agent_event_handler — agent_telemetry disabled in settings
# ---------------------------------------------------------------------------

def test_handler_is_none_when_telemetry_disabled(tmp_path):
    settings = tmp_path / "settings.json"
    settings.write_text(json.dumps({"worca": {"events": {"agent_telemetry": False}}}))
    ctx = _make_ctx()
    handler = _make_agent_event_handler(ctx, Stage.PLAN, 1, str(settings))
    assert handler is None


# ---------------------------------------------------------------------------
# system init → agent.spawned
# ---------------------------------------------------------------------------

def test_system_init_emits_agent_spawned():
    ctx = _make_ctx()
    with patch("worca.orchestrator.runner.emit_event") as mock_emit:
        handler = _make_agent_event_handler(ctx, Stage.PLAN, 1, ".claude/settings.json")
        handler({"type": "system", "subtype": "init", "model": "claude-sonnet-4-6"})

    mock_emit.assert_called_once()
    event_type = mock_emit.call_args[0][1]
    payload = mock_emit.call_args[0][2]
    assert event_type == AGENT_SPAWNED
    assert payload["stage"] == "plan"
    assert payload["model"] == "claude-sonnet-4-6"
    assert payload["iteration"] == 1


def test_system_hook_event_not_emitted():
    """Hook system events should be silently ignored."""
    ctx = _make_ctx()
    with patch("worca.orchestrator.runner.emit_event") as mock_emit:
        handler = _make_agent_event_handler(ctx, Stage.PLAN, 1, ".claude/settings.json")
        handler({"type": "system", "subtype": "hook", "hook": "post_tool_use"})

    mock_emit.assert_not_called()


# ---------------------------------------------------------------------------
# assistant tool_use → agent.tool_use
# ---------------------------------------------------------------------------

def test_tool_use_block_emits_agent_tool_use():
    ctx = _make_ctx()
    with patch("worca.orchestrator.runner.emit_event") as mock_emit:
        handler = _make_agent_event_handler(ctx, Stage.IMPLEMENT, 2, ".claude/settings.json")
        block = _tool_use_block("Bash", {"command": "pytest tests/"})
        handler(_assistant_event([block]))

    mock_emit.assert_called_once()
    event_type = mock_emit.call_args[0][1]
    payload = mock_emit.call_args[0][2]
    assert event_type == AGENT_TOOL_USE
    assert payload["tool"] == "Bash"
    assert payload["tool_input_summary"] == "pytest tests/"
    assert payload["stage"] == "implement"
    assert payload["iteration"] == 2
    assert payload["turn"] == 1


def test_multiple_tool_use_blocks_in_one_message():
    ctx = _make_ctx()
    with patch("worca.orchestrator.runner.emit_event") as mock_emit:
        handler = _make_agent_event_handler(ctx, Stage.TEST, 1, ".claude/settings.json")
        blocks = [
            _tool_use_block("Read", {"file_path": "/a.py"}, "tu_1"),
            _tool_use_block("Grep", {"pattern": "class Foo"}, "tu_2"),
        ]
        handler(_assistant_event(blocks))

    assert mock_emit.call_count == 2
    types = [c[0][1] for c in mock_emit.call_args_list]
    assert all(t == AGENT_TOOL_USE for t in types)


# ---------------------------------------------------------------------------
# assistant text → agent.text
# ---------------------------------------------------------------------------

def test_text_block_emits_agent_text():
    ctx = _make_ctx()
    with patch("worca.orchestrator.runner.emit_event") as mock_emit:
        handler = _make_agent_event_handler(ctx, Stage.PLAN, 1, ".claude/settings.json")
        text = "Here is my analysis of the codebase."
        handler(_assistant_event([{"type": "text", "text": text}]))

    mock_emit.assert_called_once()
    event_type = mock_emit.call_args[0][1]
    payload = mock_emit.call_args[0][2]
    assert event_type == AGENT_TEXT
    assert payload["text_length"] == len(text)
    assert payload["stage"] == "plan"


def test_empty_text_block_not_emitted():
    """Empty text blocks should not produce events (no-signal noise)."""
    ctx = _make_ctx()
    with patch("worca.orchestrator.runner.emit_event") as mock_emit:
        handler = _make_agent_event_handler(ctx, Stage.PLAN, 1, ".claude/settings.json")
        handler(_assistant_event([{"type": "text", "text": ""}]))

    mock_emit.assert_not_called()


# ---------------------------------------------------------------------------
# user tool_result → agent.tool_result
# ---------------------------------------------------------------------------

def test_tool_result_success_emits_agent_tool_result():
    ctx = _make_ctx()
    with patch("worca.orchestrator.runner.emit_event") as mock_emit:
        handler = _make_agent_event_handler(ctx, Stage.IMPLEMENT, 1, ".claude/settings.json")
        # First emit a tool_use so we track the tool name
        handler(_assistant_event([_tool_use_block("Bash", {"command": "ls"}, "tu_xyz")]))
        mock_emit.reset_mock()
        # Now a tool_result
        handler(_user_tool_result_event("tu_xyz", is_error=False))

    mock_emit.assert_called_once()
    event_type = mock_emit.call_args[0][1]
    payload = mock_emit.call_args[0][2]
    assert event_type == AGENT_TOOL_RESULT
    assert payload["is_error"] is False
    assert payload["tool"] == "Bash"


def test_tool_result_error_emits_is_error_true():
    ctx = _make_ctx()
    with patch("worca.orchestrator.runner.emit_event") as mock_emit:
        handler = _make_agent_event_handler(ctx, Stage.TEST, 1, ".claude/settings.json")
        handler(_assistant_event([_tool_use_block("Bash", {"command": "bad"}, "tu_err")]))
        mock_emit.reset_mock()
        handler(_user_tool_result_event("tu_err", is_error=True))

    payload = mock_emit.call_args[0][2]
    assert payload["is_error"] is True


# ---------------------------------------------------------------------------
# result → agent.completed
# ---------------------------------------------------------------------------

def test_result_event_emits_agent_completed():
    ctx = _make_ctx()
    with patch("worca.orchestrator.runner.emit_event") as mock_emit:
        handler = _make_agent_event_handler(ctx, Stage.PLAN, 3, ".claude/settings.json")
        handler({
            "type": "result",
            "num_turns": 15,
            "total_cost_usd": 0.42,
            "duration_ms": 8000,
        })

    mock_emit.assert_called_once()
    event_type = mock_emit.call_args[0][1]
    payload = mock_emit.call_args[0][2]
    assert event_type == AGENT_COMPLETED
    assert payload["turns"] == 15
    assert payload["cost_usd"] == 0.42
    assert payload["duration_ms"] == 8000
    assert payload["stage"] == "plan"
    assert payload["iteration"] == 3


# ---------------------------------------------------------------------------
# run_stage passes on_event to run_agent when ctx provided
# ---------------------------------------------------------------------------

def test_run_stage_passes_on_event_when_ctx_provided():
    mock_config = {
        "agent": "planner", "model": "claude-opus-4-6",
        "max_turns": 40, "schema": "plan.json",
    }
    mock_ctx = _make_ctx()
    with patch("worca.orchestrator.runner.get_stage_config", return_value=mock_config):
        with patch("worca.orchestrator.runner.run_agent", return_value={"ok": True}) as mock_run:
            from worca.orchestrator.runner import run_stage
            run_stage(Stage.PLAN, {"prompt": "build auth"}, ctx=mock_ctx)

    call_kwargs = mock_run.call_args.kwargs
    assert "on_event" in call_kwargs
    assert call_kwargs["on_event"] is not None


def test_run_stage_on_event_is_none_when_no_ctx():
    mock_config = {
        "agent": "planner", "model": "claude-opus-4-6",
        "max_turns": 40, "schema": "plan.json",
    }
    with patch("worca.orchestrator.runner.get_stage_config", return_value=mock_config):
        with patch("worca.orchestrator.runner.run_agent", return_value={"ok": True}) as mock_run:
            from worca.orchestrator.runner import run_stage
            run_stage(Stage.PLAN, {"prompt": "build auth"})

    call_kwargs = mock_run.call_args.kwargs
    assert call_kwargs.get("on_event") is None
