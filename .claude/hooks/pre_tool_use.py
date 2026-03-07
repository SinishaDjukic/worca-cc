# /// script
# requires-python = ">=3.8"
# ///
"""PreToolUse hook: runs guard and plan_check."""
import json
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from worca.hooks.guard import check_guard
from worca.hooks.plan_check import check_plan


def main():
    data = json.load(sys.stdin)
    tool_name = data.get("tool_name", "")
    tool_input = data.get("tool_input", {})

    # Guard check first
    code, reason = check_guard(tool_name, tool_input)
    if code != 0:
        print(reason, file=sys.stderr)
        sys.exit(code)

    # Plan check second
    code, reason = check_plan(tool_name, tool_input)
    if code != 0:
        print(reason, file=sys.stderr)
        sys.exit(code)

    sys.exit(0)


if __name__ == "__main__":
    main()
