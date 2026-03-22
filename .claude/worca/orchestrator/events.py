"""
worca.orchestrator.events — shell hook dispatcher.

Reads worca.hooks config from settings.json and dispatches events to
configured shell commands via stdin. Runs async (fire-and-forget) and never
halts the pipeline on failures. Supports '*' catch-all handlers.

Hook config format (settings.json):
    "worca": {
      "hooks": {
        "pipeline.run.started": ["curl -s -X POST http://localhost:3000/webhook -d @-"],
        "stage.completed": ["./scripts/notify.sh"],
        "*": ["./scripts/log_all.sh"]
      }
    }

Each command receives the full event JSON envelope on stdin.
"""

import json
import subprocess
import sys
from typing import Optional


def dispatch_shell_hooks(event: Optional[dict], hooks_config: Optional[dict]) -> None:
    """Dispatch event to matching shell hook commands.

    For each matching handler:
    - Pipe the full event JSON to the command on stdin
    - Spawn as a background process (fire-and-forget, no wait)
    - Log any spawn errors to stderr, never raise

    Supports '*' catch-all handlers (run in addition to specific handlers).

    Args:
        event: The event envelope dict (must include 'event_type').
        hooks_config: Dict mapping event_type strings (or '*') to lists of
                      shell command strings. None or empty dict is a no-op.
    """
    if not hooks_config or not event:
        return

    event_type = event.get("event_type", "")

    try:
        event_json = json.dumps(event, ensure_ascii=False)
    except Exception as exc:
        print(
            f"[worca.events] Failed to serialize event for shell hooks: {exc}",
            file=sys.stderr,
        )
        return

    # Collect commands: specific handlers first, then catch-all
    commands = []
    commands.extend(hooks_config.get(event_type) or [])
    commands.extend(hooks_config.get("*") or [])

    for cmd in commands:
        if not cmd:
            continue
        try:
            proc = subprocess.Popen(
                cmd,
                shell=True,
                stdin=subprocess.PIPE,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            proc.stdin.write(event_json.encode("utf-8"))
            proc.stdin.close()
            # Fire-and-forget: do not call proc.wait()
        except Exception as exc:
            print(
                f"[worca.events] Shell hook dispatch error for {event_type!r}: {exc}",
                file=sys.stderr,
            )
