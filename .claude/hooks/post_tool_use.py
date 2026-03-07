# /// script
# requires-python = ">=3.8"
# ///
"""PostToolUse hook: runs test_gate."""
import json
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from worca.hooks.test_gate import check_test_gate


def main():
    data = json.load(sys.stdin)
    tool_name = data.get("tool_name", "")
    tool_input = data.get("tool_input", {})
    exit_code = data.get("exit_code", 0)

    code, reason = check_test_gate(tool_name, tool_input, exit_code)
    if code != 0:
        print(reason, file=sys.stderr)
    elif reason:
        print(reason, file=sys.stderr)
    sys.exit(code)


if __name__ == "__main__":
    main()
