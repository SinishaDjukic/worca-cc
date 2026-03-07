"""Tests for worca.utils.claude_cli - Claude CLI wrapper."""

import json
from unittest.mock import patch, MagicMock

from worca.utils.claude_cli import run_agent, build_command


# --- build_command ---

def test_build_command_basic():
    cmd = build_command("do stuff", agent="planner", max_turns=40)
    assert cmd[0] == "claude"
    assert "-p" in cmd
    assert "do stuff" in cmd
    assert "--agent" in cmd
    assert "planner" in cmd
    assert "--max-turns" in cmd
    assert "40" in cmd


def test_build_command_default_output_format():
    cmd = build_command("prompt", agent="coder", max_turns=10)
    assert "--output-format" in cmd
    idx = cmd.index("--output-format")
    assert cmd[idx + 1] == "json"


def test_build_command_with_json_schema():
    cmd = build_command("prompt", agent="coder", max_turns=10, json_schema='{"type":"object"}')
    assert "--json-schema" in cmd
    idx = cmd.index("--json-schema")
    assert cmd[idx + 1] == '{"type":"object"}'


def test_build_command_without_json_schema():
    cmd = build_command("prompt", agent="coder", max_turns=10)
    assert "--json-schema" not in cmd


def test_build_command_includes_dangerously_skip_permissions():
    cmd = build_command("prompt", agent="planner", max_turns=5)
    assert "--dangerously-skip-permissions" in cmd


def test_build_command_includes_no_resume():
    cmd = build_command("prompt", agent="planner", max_turns=5)
    assert "--no-resume" in cmd


def test_build_command_custom_output_format():
    cmd = build_command("prompt", agent="planner", max_turns=5, output_format="text")
    idx = cmd.index("--output-format")
    assert cmd[idx + 1] == "text"


# --- run_agent ---

def test_run_agent_parses_json():
    response_data = {"result": "success", "output": "done"}
    mock_result = MagicMock()
    mock_result.returncode = 0
    mock_result.stdout = json.dumps(response_data)
    with patch("worca.utils.claude_cli.subprocess.run", return_value=mock_result):
        result = run_agent("do stuff", agent="planner", max_turns=40)
    assert result == response_data


def test_run_agent_raises_on_failure():
    mock_result = MagicMock()
    mock_result.returncode = 1
    mock_result.stderr = "Error: agent failed"
    mock_result.stdout = ""
    with patch("worca.utils.claude_cli.subprocess.run", return_value=mock_result):
        try:
            run_agent("fail", agent="planner", max_turns=5)
            assert False, "Should have raised"
        except RuntimeError as e:
            assert "agent failed" in str(e)


def test_run_agent_raises_on_invalid_json():
    mock_result = MagicMock()
    mock_result.returncode = 0
    mock_result.stdout = "not valid json {{"
    with patch("worca.utils.claude_cli.subprocess.run", return_value=mock_result):
        try:
            run_agent("prompt", agent="planner", max_turns=5)
            assert False, "Should have raised"
        except RuntimeError as e:
            assert "parse" in str(e).lower() or "json" in str(e).lower()


def test_run_agent_passes_correct_command():
    mock_result = MagicMock()
    mock_result.returncode = 0
    mock_result.stdout = '{"ok": true}'
    with patch("worca.utils.claude_cli.subprocess.run", return_value=mock_result) as mock_run:
        run_agent("my prompt", agent="implementer", max_turns=20, json_schema='{"type":"object"}')
    args = mock_run.call_args[0][0]
    assert args[0] == "claude"
    assert "--agent" in args
    assert "implementer" in args
    assert "--json-schema" in args
