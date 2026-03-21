"""
worca.events.emitter — EventContext dataclass and emit_event() function.

EventContext is created once per pipeline run and threaded to all emission
points. emit_event() builds the JSON envelope, appends to the JSONL log,
and queues webhook delivery. All I/O is wrapped in try/except — errors are
logged to stderr and never propagated to the pipeline.
"""

import json
import re
import sys
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import IO, Optional

from worca.utils.settings import load_settings as _load_settings_merged

# Valid event pattern: alphanumerics, dots, underscores, and * only
_VALID_PATTERN_RE = re.compile(r'^[a-zA-Z0-9._*]+$')


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _load_settings(settings_path: str) -> dict:
    """Load settings JSON with .local.json merge support; return empty dict on any error."""
    if not settings_path:
        return {}
    try:
        return _load_settings_merged(settings_path)
    except Exception:
        return {}


def _validate_webhook(wh: dict) -> Optional[str]:
    """Validate a single webhook config dict.

    Returns an error message string if invalid, or None if valid.
    Does NOT check control/secret requirements (handled separately).
    """
    url = wh.get("url", "")
    if not url or not (url.startswith("https://") or url.startswith("http://localhost")):
        return f"URL must start with https:// or http://localhost, got: {url!r}"

    timeout_ms = wh.get("timeout_ms")
    if timeout_ms is not None and not (1000 <= timeout_ms <= 30000):
        return f"timeout_ms must be 1000-30000, got: {timeout_ms}"

    max_retries = wh.get("max_retries")
    if max_retries is not None and not (0 <= max_retries <= 10):
        return f"max_retries must be 0-10, got: {max_retries}"

    events = wh.get("events")
    if events:
        for pattern in events:
            if not _VALID_PATTERN_RE.match(pattern):
                return f"events pattern contains invalid characters: {pattern!r}"

    return None


# ---------------------------------------------------------------------------
# EventContext
# ---------------------------------------------------------------------------


@dataclass
class EventContext:
    """Pipeline-run-scoped context for event emission.

    Created once in run_pipeline() and passed to every emit call site.
    """

    run_id: str
    branch: str
    work_request: dict
    events_path: str          # .worca/runs/{run_id}/events.jsonl
    settings_path: str
    enabled: bool = True      # may be overridden from settings at init
    _webhooks: list = field(default=None, repr=False)
    _control_webhooks: list = field(default=None, repr=False)
    _log_file: Optional[IO] = field(default=None, repr=False)

    def __post_init__(self):
        # If `enabled` was not explicitly set to False by the caller,
        # check the settings file for worca.events.enabled.
        # Explicit False from caller is preserved (disabled_ctx fixture).
        # We re-check only when the caller left the default True.
        if self.enabled:
            settings = _load_settings(self.settings_path)
            events_cfg = settings.get("worca", {}).get("events", {})
            # Default is True; only set False if explicitly configured.
            self.enabled = events_cfg.get("enabled", True)

        raw_webhooks = self._webhooks
        if raw_webhooks is None:
            settings = _load_settings(self.settings_path)
            raw_webhooks = settings.get("worca", {}).get("webhooks", [])

        self._webhooks = []
        self._control_webhooks = []
        for wh in (raw_webhooks or []):
            err = _validate_webhook(wh)
            if err:
                print(f"[worca.events] Invalid webhook config (skipping): {err}", file=sys.stderr)
                continue
            if wh.get("control"):
                if not wh.get("secret"):
                    print(
                        f"[worca.events] Control webhook {wh.get('url')!r} requires a "
                        f"non-empty secret (skipping)",
                        file=sys.stderr,
                    )
                    continue
                self._control_webhooks.append(wh)
            else:
                self._webhooks.append(wh)

    @property
    def control_webhooks(self) -> list:
        """Return validated control webhooks (control=True with non-empty secret)."""
        return self._control_webhooks or []

    def _open_log(self) -> Optional[IO]:
        """Lazily open the events JSONL file in append mode."""
        if self._log_file is None or self._log_file.closed:
            try:
                import os
                os.makedirs(os.path.dirname(self.events_path) or ".", exist_ok=True)
                self._log_file = open(self.events_path, "a", encoding="utf-8")
            except Exception as exc:
                print(f"[worca.events] Failed to open events file: {exc}", file=sys.stderr)
                return None
        return self._log_file

    def close(self):
        """Flush and close the event log file handle."""
        if self._log_file is not None and not self._log_file.closed:
            try:
                self._log_file.flush()
                self._log_file.close()
            except Exception as exc:
                print(f"[worca.events] Failed to close events file: {exc}", file=sys.stderr)
        self._log_file = None


# ---------------------------------------------------------------------------
# emit_event
# ---------------------------------------------------------------------------


def emit_event(
    ctx: EventContext,
    event_type: str,
    payload: dict,
) -> Optional[dict]:
    """Emit a pipeline event.

    Builds the full envelope, appends to the JSONL log, and queues any
    configured webhooks for async delivery.

    Returns the event dict on success, None if disabled or on error.
    Never raises.
    """
    if not ctx.enabled:
        return None

    try:
        event = {
            "schema_version": "1",
            "event_id": str(uuid.uuid4()),
            "event_type": event_type,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "run_id": ctx.run_id,
            "pipeline": {
                "branch": ctx.branch,
                "work_request": ctx.work_request,
            },
            "payload": payload,
        }
        line = json.dumps(event, ensure_ascii=False)  # may raise on bad payload
    except Exception as exc:
        print(f"[worca.events] Serialization error for {event_type}: {exc}", file=sys.stderr)
        return None

    try:
        fh = ctx._open_log()
        if fh is None:
            return None
        fh.write(line + "\n")
        fh.flush()
    except Exception as exc:
        print(f"[worca.events] Write error for {event_type}: {exc}", file=sys.stderr)
        return None

    # Queue webhook delivery (non-blocking, best-effort) for observer webhooks only.
    # Control webhooks receive sync delivery only at pause points via _check_control_response().
    if ctx._webhooks:
        try:
            from worca.events.webhook import deliver_webhook
            for wh in ctx._webhooks:
                deliver_webhook(event, wh)
        except Exception as exc:
            print(f"[worca.events] Webhook dispatch error: {exc}", file=sys.stderr)

    return event


# ---------------------------------------------------------------------------
# Control webhook response handling
# ---------------------------------------------------------------------------


def _check_control_response(ctx: EventContext, event: dict) -> Optional[str]:
    """Deliver event to all control webhooks synchronously and return action if any.

    Iterates over ctx.control_webhooks, calling deliver_webhook_sync() for each.
    Returns the first non-"continue" action string found, or None if all are
    "continue" / no control webhooks are configured.

    Never raises — all errors are logged to stderr.
    """
    if not ctx.control_webhooks:
        return None
    try:
        from worca.events.webhook import deliver_webhook_sync
        for wh in ctx.control_webhooks:
            response = deliver_webhook_sync(event, wh)
            if response and "control" in response:
                action = response["control"].get("action", "continue")
                if action and action != "continue":
                    return action
    except Exception as exc:
        print(f"[worca.events] Control response error: {exc}", file=sys.stderr)
    return None
