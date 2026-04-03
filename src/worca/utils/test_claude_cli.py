"""Tests for claude_cli stream-json processing."""

import io
import json
import os
import signal
from unittest import mock

import pytest

from worca.utils.claude_cli import (
    _format_log_line,
    build_command,
    process_stream,
    run_agent,
    terminate_current,
)


# ---------------------------------------------------------------------------
# build_command
# ---------------------------------------------------------------------------

class TestBuildCommand:
    def test_default_stream_json(self):
        cmd, pf = build_command("hello", agent="agent.md")
        assert pf is None
        assert "--output-format" in cmd
        idx = cmd.index("--output-format")
        assert cmd[idx + 1] == "stream-json"
        assert "--verbose" in cmd

    def test_json_format_no_verbose(self):
        cmd, pf = build_command("hello", agent="agent.md", output_format="json")
        assert pf is None
        idx = cmd.index("--output-format")
        assert cmd[idx + 1] == "json"
        assert "--verbose" not in cmd

    def test_json_schema_inline(self):
        schema = '{"type":"object"}'
        cmd, pf = build_command("hello", agent="agent.md", json_schema=schema)
        assert pf is None
        assert "--json-schema" in cmd
        idx = cmd.index("--json-schema")
        assert cmd[idx + 1] == schema

    def test_json_schema_file(self, tmp_path):
        schema_file = tmp_path / "schema.json"
        schema_file.write_text('{"type":"object","required":["x"]}')
        cmd, pf = build_command("hello", agent="agent.md", json_schema=str(schema_file))
        assert pf is None
        idx = cmd.index("--json-schema")
        assert cmd[idx + 1] == '{"type":"object","required":["x"]}'

    def test_json_schema_missing_file(self):
        # Non-existent .json file falls back to using the string as-is
        cmd, pf = build_command("hello", agent="agent.md", json_schema="/no/such/file.json")
        assert pf is None
        idx = cmd.index("--json-schema")
        assert cmd[idx + 1] == "/no/such/file.json"

    def test_required_flags(self):
        cmd, pf = build_command("hello", agent="agent.md")
        assert pf is None
        assert "-p" in cmd
        assert "--agent" in cmd
        assert "--no-session-persistence" in cmd
        assert "--dangerously-skip-permissions" in cmd
        assert "--disallowedTools" in cmd
        idx = cmd.index("--disallowedTools")
        disallowed = cmd[idx + 1]
        assert "Skill" in disallowed
        assert "EnterPlanMode" in disallowed
        assert "EnterWorktree" in disallowed
        assert "TodoWrite" in disallowed

    def test_large_prompt_offloaded_to_file(self):
        large_prompt = "x" * (128 * 1024 + 1)
        cmd, pf = build_command(large_prompt, agent="agent.md")
        assert pf is not None
        try:
            # Prompt file should exist and contain the full prompt
            with open(pf) as f:
                assert f.read() == large_prompt
            # CLI arg should be a short "read this file" instruction, not the full prompt
            prompt_arg = cmd[cmd.index("-p") + 1]
            assert pf in prompt_arg
            assert len(prompt_arg) < 1024
        finally:
            os.unlink(pf)

    def test_small_prompt_stays_inline(self):
        small_prompt = "x" * 1000
        cmd, pf = build_command(small_prompt, agent="agent.md")
        assert pf is None
        prompt_arg = cmd[cmd.index("-p") + 1]
        assert prompt_arg == small_prompt


# ---------------------------------------------------------------------------
# _format_log_line
# ---------------------------------------------------------------------------

class TestFormatLogLine:
    def test_init_event(self):
        event = {"type": "system", "subtype": "init", "model": "opus"}
        assert _format_log_line(event) == "[init] model=opus"

    def test_hook_event_skipped(self):
        event = {"type": "system", "subtype": "hook_started"}
        assert _format_log_line(event) is None

    def test_assistant_text(self):
        event = {
            "type": "assistant",
            "message": {
                "content": [{"type": "text", "text": "Hello world"}]
            },
        }
        assert _format_log_line(event) == "Hello world"

    def test_assistant_tool_use_read(self):
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

    def test_assistant_tool_use_bash(self):
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

    def test_assistant_mixed_content(self):
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

    def test_assistant_empty_text_skipped(self):
        event = {
            "type": "assistant",
            "message": {"content": [{"type": "text", "text": "  "}]},
        }
        assert _format_log_line(event) is None

    def test_result_event(self):
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

    def test_user_tool_result_ok(self):
        event = {
            "type": "user",
            "content": [
                {"type": "tool_result", "tool_use_id": "abcdef1234", "is_error": False}
            ],
        }
        line = _format_log_line(event)
        assert "[result:ok]" in line

    def test_user_tool_result_error(self):
        event = {
            "type": "user",
            "content": [
                {"type": "tool_result", "tool_use_id": "abcdef1234", "is_error": True}
            ],
        }
        line = _format_log_line(event)
        assert "[result:ERROR]" in line

    def test_unknown_event(self):
        event = {"type": "rate_limit_event"}
        assert _format_log_line(event) is None

    def test_tool_use_agent(self):
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

    def test_tool_use_write(self):
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

    def test_tool_use_edit(self):
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

    def test_tool_use_glob(self):
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

    def test_tool_use_unknown(self):
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
# process_stream
# ---------------------------------------------------------------------------

def _make_ndjson(*events):
    """Create an NDJSON stream (list of strings) from event dicts."""
    return [json.dumps(e) + "\n" for e in events]


class TestProcessStream:
    def test_basic_result(self):
        events = _make_ndjson(
            {"type": "system", "subtype": "init", "model": "opus"},
            {"type": "assistant", "message": {"content": [{"type": "text", "text": "hi"}]}},
            {"type": "result", "subtype": "success", "result": "hi", "total_cost_usd": 0.05},
        )
        result = process_stream(events)
        assert result["type"] == "result"
        assert result["result"] == "hi"

    def test_structured_output(self):
        events = _make_ndjson(
            {"type": "system", "subtype": "init", "model": "opus"},
            {
                "type": "result",
                "subtype": "success",
                "result": "",
                "structured_output": {"greeting": "hello"},
            },
        )
        result = process_stream(events)
        assert result["structured_output"] == {"greeting": "hello"}

    def test_no_result_raises(self):
        events = _make_ndjson(
            {"type": "system", "subtype": "init", "model": "opus"},
            {"type": "assistant", "message": {"content": [{"type": "text", "text": "hi"}]}},
        )
        with pytest.raises(RuntimeError, match="No result event"):
            process_stream(events)

    def test_log_file_written(self):
        events = _make_ndjson(
            {"type": "system", "subtype": "init", "model": "opus"},
            {"type": "assistant", "message": {"content": [{"type": "text", "text": "working"}]}},
            {"type": "result", "subtype": "success", "result": "done",
             "total_cost_usd": 0.1, "num_turns": 2, "duration_ms": 5000},
        )
        log_buf = io.StringIO()
        process_stream(events, log_file=log_buf)
        log_contents = log_buf.getvalue()
        assert "[init] model=opus" in log_contents
        assert "working" in log_contents
        assert "[done]" in log_contents

    def test_on_event_callback(self):
        captured = []
        events = _make_ndjson(
            {"type": "system", "subtype": "init", "model": "opus"},
            {"type": "result", "subtype": "success", "result": "ok"},
        )
        process_stream(events, on_event=captured.append)
        assert len(captured) == 2
        assert captured[0]["type"] == "system"
        assert captured[1]["type"] == "result"

    def test_invalid_json_lines_skipped(self):
        lines = [
            "not valid json\n",
            json.dumps({"type": "result", "subtype": "success", "result": "ok"}) + "\n",
        ]
        log_buf = io.StringIO()
        result = process_stream(lines, log_file=log_buf)
        assert result["type"] == "result"
        # Invalid line should be written raw to log
        assert "not valid json" in log_buf.getvalue()

    def test_empty_lines_skipped(self):
        lines = [
            "\n",
            "  \n",
            json.dumps({"type": "result", "subtype": "success", "result": "ok"}) + "\n",
        ]
        result = process_stream(lines)
        assert result["type"] == "result"

    def test_system_hook_events_not_logged(self):
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

    def test_multiple_assistant_events(self):
        events = _make_ndjson(
            {"type": "assistant", "message": {"content": [{"type": "text", "text": "step 1"}]}},
            {"type": "assistant", "message": {"content": [
                {"type": "tool_use", "name": "Bash", "input": {"command": "ls"}}
            ]}},
            {"type": "user", "content": [
                {"type": "tool_result", "tool_use_id": "abc123", "is_error": False}
            ]},
            {"type": "assistant", "message": {"content": [{"type": "text", "text": "step 2"}]}},
            {"type": "result", "subtype": "success", "result": "done",
             "total_cost_usd": 0.2, "num_turns": 3, "duration_ms": 10000},
        )
        log_buf = io.StringIO()
        result = process_stream(events, log_file=log_buf)
        log_contents = log_buf.getvalue()
        assert "step 1" in log_contents
        assert "[tool:Bash] ls" in log_contents
        assert "[result:ok]" in log_contents
        assert "step 2" in log_contents
        assert result["result"] == "done"


# ---------------------------------------------------------------------------
# run_agent (integration with mocked subprocess)
# ---------------------------------------------------------------------------

class TestRunAgent:
    def _mock_popen(self, events, returncode=0):
        """Create a mock Popen that yields NDJSON events on stdout."""
        ndjson = "".join(json.dumps(e) + "\n" for e in events)

        mock_proc = mock.MagicMock()
        mock_proc.stdout = io.StringIO(ndjson)
        mock_proc.stderr = io.StringIO("")
        mock_proc.returncode = returncode
        mock_proc.pid = 12345
        mock_proc.wait.return_value = returncode
        return mock_proc

    @mock.patch("worca.utils.claude_cli.get_env", return_value={})
    @mock.patch("subprocess.Popen")
    def test_basic_run(self, mock_popen_cls, mock_env):
        events = [
            {"type": "system", "subtype": "init", "model": "opus"},
            {"type": "assistant", "message": {"content": [{"type": "text", "text": "hi"}]}},
            {"type": "result", "subtype": "success", "result": "hi",
             "total_cost_usd": 0.05, "num_turns": 1, "duration_ms": 3000},
        ]
        mock_popen_cls.return_value = self._mock_popen(events)

        result = run_agent(prompt="hello", agent="agent.md")
        assert result["type"] == "result"
        assert result["result"] == "hi"

    @mock.patch("worca.utils.claude_cli.get_env", return_value={})
    @mock.patch("subprocess.Popen")
    def test_structured_output(self, mock_popen_cls, mock_env):
        events = [
            {"type": "system", "subtype": "init", "model": "opus"},
            {"type": "result", "subtype": "success", "result": "",
             "structured_output": {"approach": "test", "tasks_outline": [], "branch_name": "test"},
             "total_cost_usd": 0.5, "num_turns": 3, "duration_ms": 30000},
        ]
        mock_popen_cls.return_value = self._mock_popen(events)

        result = run_agent(prompt="plan", agent="planner.md")
        assert result["structured_output"]["approach"] == "test"

    @mock.patch("worca.utils.claude_cli.get_env", return_value={})
    @mock.patch("subprocess.Popen")
    def test_log_file_created(self, mock_popen_cls, mock_env, tmp_path):
        events = [
            {"type": "system", "subtype": "init", "model": "opus"},
            {"type": "result", "subtype": "success", "result": "ok",
             "total_cost_usd": 0.01, "num_turns": 1, "duration_ms": 1000},
        ]
        mock_popen_cls.return_value = self._mock_popen(events)
        log_path = str(tmp_path / "logs" / "test.log")

        run_agent(prompt="hello", agent="agent.md", log_path=log_path)

        assert os.path.exists(log_path)
        contents = open(log_path).read()
        assert "[init]" in contents
        assert "[done]" in contents

    @mock.patch("worca.utils.claude_cli.get_env", return_value={})
    @mock.patch("subprocess.Popen")
    def test_on_event_callback(self, mock_popen_cls, mock_env):
        events = [
            {"type": "system", "subtype": "init", "model": "opus"},
            {"type": "result", "subtype": "success", "result": "ok"},
        ]
        mock_popen_cls.return_value = self._mock_popen(events)

        captured = []
        run_agent(prompt="hello", agent="agent.md", on_event=captured.append)
        assert len(captured) == 2

    @mock.patch("worca.utils.claude_cli.get_env", return_value={})
    @mock.patch("subprocess.Popen")
    def test_nonzero_exit_raises(self, mock_popen_cls, mock_env):
        events = [
            {"type": "result", "subtype": "error", "is_error": True,
             "result": "something went wrong"},
        ]
        mock_popen_cls.return_value = self._mock_popen(events, returncode=1)

        with pytest.raises(RuntimeError, match="exit code 1"):
            run_agent(prompt="hello", agent="agent.md")

    @mock.patch("worca.utils.claude_cli.get_env", return_value={})
    @mock.patch("subprocess.Popen")
    def test_signal_kill_raises_interrupted(self, mock_popen_cls, mock_env):
        events = [
            {"type": "result", "subtype": "error", "result": "killed"},
        ]
        mock_popen_cls.return_value = self._mock_popen(events, returncode=-15)

        with pytest.raises(InterruptedError, match="signal 15"):
            run_agent(prompt="hello", agent="agent.md")

    @mock.patch("worca.utils.claude_cli.get_env", return_value={})
    @mock.patch("subprocess.Popen")
    def test_stream_json_in_command(self, mock_popen_cls, mock_env):
        events = [
            {"type": "result", "subtype": "success", "result": "ok"},
        ]
        mock_popen_cls.return_value = self._mock_popen(events)

        run_agent(prompt="hello", agent="agent.md")

        call_args = mock_popen_cls.call_args[0][0]
        assert "--output-format" in call_args
        idx = call_args.index("--output-format")
        assert call_args[idx + 1] == "stream-json"
        assert "--verbose" in call_args

    @mock.patch("worca.utils.claude_cli.get_env", return_value={})
    @mock.patch("subprocess.Popen")
    def test_large_prompt_cleanup_on_success(self, mock_popen_cls, mock_env):
        """run_agent with large prompt cleans up temp file on success."""
        from worca.utils.claude_cli import _ARG_INLINE_LIMIT

        large_prompt = "x" * (_ARG_INLINE_LIMIT + 1)
        events = [
            {"type": "system", "subtype": "init", "model": "opus"},
            {"type": "result", "subtype": "success", "result": "ok",
             "total_cost_usd": 0.01, "num_turns": 1, "duration_ms": 1000},
        ]
        mock_popen_cls.return_value = self._mock_popen(events)

        result = run_agent(prompt=large_prompt, agent="agent.md")
        assert result["type"] == "result"

        # The temp file should have been created and then deleted
        # Verify by checking that Popen was called with a short redirect prompt
        call_args = mock_popen_cls.call_args[0][0]
        prompt_arg = call_args[call_args.index("-p") + 1]
        assert "Read the file at" in prompt_arg
        # Extract the temp file path from the prompt argument
        # Format: "Read the file at /tmp/worca_prompt_XXXX.md and follow..."
        tmp_path = prompt_arg.split("Read the file at ")[1].split(" and follow")[0]
        assert not os.path.exists(tmp_path), "Temp prompt file should be deleted after success"

    @mock.patch("worca.utils.claude_cli.get_env", return_value={})
    @mock.patch("subprocess.Popen")
    def test_large_prompt_cleanup_on_failure(self, mock_popen_cls, mock_env):
        """run_agent with large prompt cleans up temp file on subprocess failure."""
        from worca.utils.claude_cli import _ARG_INLINE_LIMIT

        large_prompt = "x" * (_ARG_INLINE_LIMIT + 1)
        events = [
            {"type": "result", "subtype": "error", "is_error": True,
             "result": "something went wrong"},
        ]
        mock_popen_cls.return_value = self._mock_popen(events, returncode=1)

        with pytest.raises(RuntimeError, match="exit code 1"):
            run_agent(prompt=large_prompt, agent="agent.md")

        # The temp file should still have been cleaned up despite the error
        call_args = mock_popen_cls.call_args[0][0]
        prompt_arg = call_args[call_args.index("-p") + 1]
        tmp_path = prompt_arg.split("Read the file at ")[1].split(" and follow")[0]
        assert not os.path.exists(tmp_path), "Temp prompt file should be deleted after failure"

    @mock.patch("worca.utils.claude_cli.get_env", return_value={})
    @mock.patch("subprocess.Popen")
    def test_large_prompt_cleanup_handles_oserror_silently(self, mock_popen_cls, mock_env):
        """If os.unlink raises OSError during cleanup, no exception propagates."""
        from worca.utils.claude_cli import _ARG_INLINE_LIMIT

        large_prompt = "x" * (_ARG_INLINE_LIMIT + 1)
        events = [
            {"type": "system", "subtype": "init", "model": "opus"},
            {"type": "result", "subtype": "success", "result": "ok",
             "total_cost_usd": 0.01, "num_turns": 1, "duration_ms": 1000},
        ]
        mock_popen_cls.return_value = self._mock_popen(events)

        with mock.patch("os.unlink", side_effect=OSError("disk error")):
            # Should not raise despite os.unlink failing
            result = run_agent(prompt=large_prompt, agent="agent.md")
            assert result["type"] == "result"
            assert result["result"] == "ok"


# ---------------------------------------------------------------------------
# terminate_current
# ---------------------------------------------------------------------------

class TestTerminateCurrent:
    @mock.patch("os.killpg")
    @mock.patch("os.getpgid", return_value=999)
    def test_terminate_sends_sigterm(self, mock_getpgid, mock_killpg):
        import worca.utils.claude_cli as cli
        mock_proc = mock.MagicMock()
        mock_proc.pid = 123
        with cli._proc_lock:
            cli._current_proc = mock_proc
        try:
            terminate_current()
            mock_killpg.assert_called_once_with(999, signal.SIGTERM)
        finally:
            with cli._proc_lock:
                cli._current_proc = None

    def test_terminate_no_proc(self):
        import worca.utils.claude_cli as cli
        with cli._proc_lock:
            cli._current_proc = None
        # Should not raise
        terminate_current()


# ---------------------------------------------------------------------------
# Runner integration: verify structured_output extraction
# ---------------------------------------------------------------------------

class TestRunnerIntegration:
    """Verify that run_agent output is compatible with runner.py's extraction."""

    def test_structured_output_extraction(self):
        """Simulate what runner.py does with run_agent output."""
        # This is what run_agent returns (the result event)
        raw = {
            "type": "result",
            "subtype": "success",
            "result": "",
            "structured_output": {
                "approach": "incremental",
                "tasks_outline": [{"title": "task 1", "description": "do thing"}],
                "branch_name": "worca/feature-x",
            },
            "total_cost_usd": 0.5,
        }

        # runner.py logic:
        if isinstance(raw, dict) and "structured_output" in raw:
            structured, envelope = raw["structured_output"], raw
        else:
            structured, envelope = raw, raw

        assert structured["approach"] == "incremental"
        assert envelope["total_cost_usd"] == 0.5
