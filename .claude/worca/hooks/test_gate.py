"""PostToolUse hook: Escalating strike system for test failures.

Reads JSON from stdin with tool_name, tool_input, and exit_code.
Exit code 0 = allow (with optional warning), exit code 2 = block.
"""
import json
import sys

_state = {"strikes": 0}


def check_test_gate(tool_name: str, tool_input: dict, exit_code: int) -> tuple:
    """Check if repeated test failures should block further progress.

    Returns (exit_code, reason) where exit_code 0 = allow, 2 = block.
    """
    if tool_name != "Bash":
        return (0, "")

    command = tool_input.get("command", "")
    if "pytest" not in command:
        return (0, "")

    if exit_code == 0:
        _state["strikes"] = 0
        return (0, "")

    _state["strikes"] += 1

    if _state["strikes"] == 1:
        return (0, "Warning: test failure (strike 1). Fix before continuing.")

    return (2, "Blocked: {} consecutive test failures. Fix tests before proceeding.".format(
        _state["strikes"]
    ))


def main():
    data = json.load(sys.stdin)
    tool_name = data.get("tool_name", "")
    tool_input = data.get("tool_input", {})
    tool_exit_code = data.get("exit_code", 0)
    code, reason = check_test_gate(tool_name, tool_input, tool_exit_code)
    if code != 0:
        print(reason, file=sys.stderr)
    elif reason:
        print(reason, file=sys.stderr)
    sys.exit(code)


if __name__ == "__main__":
    main()
