# /// script
# requires-python = ">=3.8"
# ///
"""SubagentStop hook: updates Beads task status."""
import json
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from worca.hooks.tracking import handle_agent_stop


def main():
    data = json.load(sys.stdin)
    agent_type = data.get("agent_type", "")
    bead_id = data.get("bead_id")
    success = data.get("success", False)

    handle_agent_stop(agent_type, bead_id, success)
    sys.exit(0)


if __name__ == "__main__":
    main()
