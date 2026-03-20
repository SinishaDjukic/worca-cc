"""
worca.events.hook_emitter — lightweight event emitter for hook subprocess scripts.

Hook scripts run as separate processes and cannot access EventContext directly.
This module reads WORCA_EVENTS_PATH and WORCA_RUN_ID from the environment and
appends a minimal envelope to the JSONL file. No webhook delivery is performed.

If either env var is missing, all calls silently no-op. All I/O errors are
caught and silently swallowed so that a failing emit never crashes a hook.
"""

import json
import os
import uuid
from datetime import datetime, timezone


def emit_from_hook(event_type: str, payload: dict):
    """Append a minimal event envelope to the JSONL log.

    Reads WORCA_EVENTS_PATH and WORCA_RUN_ID from the environment.
    Returns the event dict on success, None on no-op or error. Never raises.
    """
    events_path = os.environ.get("WORCA_EVENTS_PATH")
    run_id = os.environ.get("WORCA_RUN_ID")

    if not events_path or not run_id:
        return None

    try:
        event = {
            "schema_version": "1",
            "event_id": str(uuid.uuid4()),
            "event_type": event_type,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "run_id": run_id,
            "payload": payload,
        }
        line = json.dumps(event, ensure_ascii=False)
    except Exception:
        return None

    try:
        fh = open(events_path, "a", encoding="utf-8")
        fh.write(line + "\n")
        fh.flush()
        fh.close()
    except Exception:
        return None

    return event
