"""Tests for worca.utils.claude_cli - Claude CLI wrapper."""

import json
from unittest.mock import patch, MagicMock

from worca.utils.claude_cli import run_agent, build_command


# --- build_command ---

def test_build_command_basic():
    cmd, pf = build_command("do stuff", agent="planner")
    assert pf is None
    assert cmd[0] == "claude"
    assert "-p" in cmd
    assert "do stuff" in cmd
    assert "--agent" in cmd
    assert "planner" in cmd


def test_build_command_default_output_format():
    cmd, pf = build_command("prompt", agent="coder")
    assert pf is None
    assert "--output-format" in cmd
    idx = cmd.index("--output-format")
    assert cmd[idx + 1] == "stream-json"


def test_build_command_with_json_schema():
    cmd, pf = build_command("prompt", agent="coder", json_schema='{"type":"object"}')
    assert pf is None
    assert "--json-schema" in cmd
    idx = cmd.index("--json-schema")
    assert cmd[idx + 1] == '{"type":"object"}'


def test_build_command_without_json_schema():
    cmd, pf = build_command("prompt", agent="coder")
    assert pf is None
    assert "--json-schema" not in cmd


def test_build_command_includes_dangerously_skip_permissions():
    cmd, pf = build_command("prompt", agent="planner")
    assert pf is None
    assert "--dangerously-skip-permissions" in cmd


def test_build_command_includes_no_session_persistence():
    cmd, pf = build_command("prompt", agent="planner")
    assert pf is None
    assert "--no-session-persistence" in cmd


def test_build_command_with_model():
    cmd, pf = build_command("prompt", agent="coder", model="claude-sonnet-4-6")
    assert pf is None
    assert "--model" in cmd
    idx = cmd.index("--model")
    assert cmd[idx + 1] == "claude-sonnet-4-6"


def test_build_command_without_model():
    cmd, pf = build_command("prompt", agent="coder")
    assert pf is None
    assert "--model" not in cmd


def test_build_command_no_max_turns():
    """max-turns is not a valid claude CLI flag."""
    cmd, pf = build_command("prompt", agent="planner")
    assert pf is None
    assert "--max-turns" not in cmd


def test_build_command_custom_output_format():
    cmd, pf = build_command("prompt", agent="planner", output_format="text")
    assert pf is None
    idx = cmd.index("--output-format")
    assert cmd[idx + 1] == "text"


def test_build_command_reads_schema_file(tmp_path):
    schema_file = tmp_path / "schema.json"
    schema_file.write_text('{"type":"object","required":["name"]}')
    cmd, pf = build_command("prompt", agent="coder", json_schema=str(schema_file))
    assert pf is None
    idx = cmd.index("--json-schema")
    assert cmd[idx + 1] == '{"type":"object","required":["name"]}'


# --- run_agent ---

def _make_mock_popen(result_event, returncode=0):
    """Create a mock Popen that yields a stream-json result event on stdout."""
    mock_proc = MagicMock()
    mock_proc.returncode = returncode
    mock_proc.pid = 12345
    # stdout yields NDJSON lines
    result_line = json.dumps({"type": "result", **result_event})
    mock_proc.stdout = iter([result_line + "\n"])
    mock_proc.stderr = iter([])
    mock_proc.wait.return_value = returncode
    return mock_proc


def test_run_agent_parses_json():
    result_event = {"result": "success", "output": "done"}
    mock_proc = _make_mock_popen(result_event)
    with patch("worca.utils.claude_cli.subprocess.Popen", return_value=mock_proc):
        result = run_agent("do stuff", agent="planner", max_turns=40)
    assert result["result"] == "success"
    assert result["type"] == "result"


def test_run_agent_raises_on_failure():
    result_event = {"is_error": True, "result": "agent failed"}
    mock_proc = _make_mock_popen(result_event, returncode=1)
    with patch("worca.utils.claude_cli.subprocess.Popen", return_value=mock_proc):
        try:
            run_agent("fail", agent="planner", max_turns=5)
            assert False, "Should have raised"
        except RuntimeError as e:
            assert "agent failed" in str(e)


def test_run_agent_raises_on_invalid_json():
    mock_proc = MagicMock()
    mock_proc.returncode = 0
    mock_proc.pid = 12345
    mock_proc.stdout = iter(["not valid json {{\n"])
    mock_proc.stderr = iter([])
    mock_proc.wait.return_value = 0
    with patch("worca.utils.claude_cli.subprocess.Popen", return_value=mock_proc):
        try:
            run_agent("prompt", agent="planner", max_turns=5)
            assert False, "Should have raised"
        except RuntimeError as e:
            assert "result" in str(e).lower() or "stream" in str(e).lower()


def test_run_agent_passes_correct_command():
    result_event = {"ok": True}
    mock_proc = _make_mock_popen(result_event)
    with patch("worca.utils.claude_cli.subprocess.Popen", return_value=mock_proc) as mock_popen:
        run_agent("my prompt", agent="implementer", max_turns=20, json_schema='{"type":"object"}')
    args = mock_popen.call_args[0][0]
    assert args[0] == "claude"
    assert "--agent" in args
    assert "implementer" in args
    assert "--json-schema" in args


def test_run_agent_max_turns_accepted_but_ignored():
    """max_turns is accepted for API compatibility but not passed to CLI."""
    result_event = {"ok": True}
    mock_proc = _make_mock_popen(result_event)
    with patch("worca.utils.claude_cli.subprocess.Popen", return_value=mock_proc) as mock_popen:
        run_agent("prompt", agent="planner", max_turns=999)
    args = mock_popen.call_args[0][0]
    assert "--max-turns" not in args


def test_run_agent_passes_model_to_cli():
    result_event = {"ok": True}
    mock_proc = _make_mock_popen(result_event)
    with patch("worca.utils.claude_cli.subprocess.Popen", return_value=mock_proc) as mock_popen:
        run_agent("prompt", agent="implementer", model="claude-sonnet-4-6")
    args = mock_popen.call_args[0][0]
    assert "--model" in args
    idx = args.index("--model")
    assert args[idx + 1] == "claude-sonnet-4-6"


def test_run_agent_omits_model_when_none():
    result_event = {"ok": True}
    mock_proc = _make_mock_popen(result_event)
    with patch("worca.utils.claude_cli.subprocess.Popen", return_value=mock_proc) as mock_popen:
        run_agent("prompt", agent="planner")
    args = mock_popen.call_args[0][0]
    assert "--model" not in args
