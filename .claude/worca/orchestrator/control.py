"""Control file protocol utilities for pipeline lifecycle management.

Reads/writes/deletes .worca/runs/{run_id}/control.json.
Actions: pause, stop.
"""

import json
import os
from datetime import datetime, timezone
from pathlib import Path


VALID_ACTIONS = {"pause", "stop"}

_DEFAULT_BASE = ".worca"


def control_path(run_id: str, base: str = _DEFAULT_BASE) -> str:
    """Return the path to the control file for a given run_id."""
    return str(Path(base) / "runs" / run_id / "control.json")


def write_control(run_id: str, action: str, source: str = "cli", base: str = _DEFAULT_BASE) -> str:
    """Write a control file for the given run_id.

    Args:
        run_id: Pipeline run identifier.
        action: One of VALID_ACTIONS ("pause", "stop").
        source: Who issued the command ("cli", "ui", "webhook").
        base: Base directory (default ".worca").

    Returns:
        Path to the written file.

    Raises:
        ValueError: If action is not in VALID_ACTIONS.
    """
    if action not in VALID_ACTIONS:
        raise ValueError(f"invalid action {action!r}; must be one of {sorted(VALID_ACTIONS)}")

    path = Path(control_path(run_id, base=base))
    path.parent.mkdir(parents=True, exist_ok=True)

    payload = {
        "action": action,
        "requested_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": source,
    }

    path.write_text(json.dumps(payload, indent=2) + "\n")
    return str(path)


def read_control(run_id: str, base: str = _DEFAULT_BASE) -> dict | None:
    """Read and validate the control file for a given run_id.

    Returns:
        Parsed control dict, or None if file does not exist.

    Raises:
        ValueError: If the file contents fail schema validation.
    """
    path = control_path(run_id, base=base)
    if not os.path.exists(path):
        return None

    with open(path) as f:
        data = json.load(f)

    _validate(data)
    return data


def delete_control(run_id: str, base: str = _DEFAULT_BASE) -> None:
    """Delete the control file for a given run_id.

    No-op if the file does not exist.
    """
    path = control_path(run_id, base=base)
    try:
        os.unlink(path)
    except FileNotFoundError:
        pass


def _validate(data: dict) -> None:
    """Validate control file schema.

    Raises ValueError with a descriptive message on failure.
    """
    if "action" not in data:
        raise ValueError("control file missing required field: action")
    if "requested_at" not in data:
        raise ValueError("control file missing required field: requested_at")
    if data["action"] not in VALID_ACTIONS:
        raise ValueError(
            f"invalid action {data['action']!r}; must be one of {sorted(VALID_ACTIONS)}"
        )
