# /// script
# requires-python = ">=3.8"
# ///
"""SubagentStart hook: enforces agent dispatch rules."""
import json
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from worca.hooks.tracking import check_dispatch

try:
    from worca.events.hook_emitter import emit_from_hook
except ImportError:
    emit_from_hook = None


def main():
    data = json.load(sys.stdin)
    parent = os.environ.get("WORCA_AGENT", "")
    child = data.get("agent_type", "")

    code, reason = check_dispatch(parent, child)
    if code != 0:
        if emit_from_hook:
            emit_from_hook("pipeline.hook.dispatch_blocked", {
                "agent": parent,
                "subagent_type": child,
                "reason": reason,
            })
        print(reason, file=sys.stderr)
    sys.exit(code)


if __name__ == "__main__":
    main()
