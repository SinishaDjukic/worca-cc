"""Agent dispatch rules and Beads task sync for SubagentStart/Stop events.

Reads JSON from stdin with an event field.
- subagent_start: checks dispatch rules, exit code 0 = allow, 2 = block.
- subagent_stop: closes bead on success if bead_id is provided.
"""

import json
import os
import sys

DISPATCH_RULES = {
    "planner": {"explore"},
    "coordinator": set(),
    "implementer": {"explore"},
    "tester": set(),
    "guardian": {"explore"},
    "plan_reviewer": set(),
}


def check_dispatch(parent_agent: str, child_agent: str) -> tuple:
    """Check if parent_agent is allowed to dispatch child_agent.

    Returns (0, "") for allowed, (2, reason) for blocked.
    Interactive mode (empty parent) allows all dispatches.
    """
    if not parent_agent:
        return (0, "")  # interactive mode, allow all
    allowed = DISPATCH_RULES.get(parent_agent, set())
    if child_agent in allowed:
        return (0, "")
    return (2, f"Blocked: {parent_agent} cannot dispatch {child_agent}")


def handle_agent_stop(agent_type: str, bead_id: str | None, success: bool) -> None:
    """Handle agent stop event. Close bead on success if bead_id is provided."""
    if success and bead_id:
        from worca.utils.beads import bd_close

        bd_close(bead_id)


def main():
    data = json.load(sys.stdin)
    event = data.get("event", "")
    if event == "subagent_start":
        parent = os.environ.get("WORCA_AGENT", "")
        child = data.get("agent_type", "")
        code, reason = check_dispatch(parent, child)
        if code != 0:
            print(reason, file=sys.stderr)
        sys.exit(code)
    elif event == "subagent_stop":
        agent_type = data.get("agent_type", "")
        bead_id = data.get("bead_id")
        success = data.get("success", False)
        handle_agent_stop(agent_type, bead_id, success)


if __name__ == "__main__":
    main()
