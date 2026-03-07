# /// script
# requires-python = ">=3.8"
# ///
"""SubagentStart hook: enforces agent dispatch rules."""
import json
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from worca.hooks.tracking import check_dispatch


def main():
    data = json.load(sys.stdin)
    parent = os.environ.get("WORCA_AGENT", "")
    child = data.get("agent_type", "")

    code, reason = check_dispatch(parent, child)
    if code != 0:
        print(reason, file=sys.stderr)
    sys.exit(code)


if __name__ == "__main__":
    main()
